import { describe, expect, it } from 'vitest';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { AiError, safeAiError } from '../services/ai/errors';
import { defaultSettings } from '../ui/settings/model';
import type { StoryDiagnostic } from '../domain/storyDiagnostics';
import { storyFailure } from '../services/validation/storyDiagnostics';
import { runtimeLogEvent } from '../ui/game/runtimeLog';

const body = '<thinking>规划</thinking><正文>一二三四五六七八九十</正文><短期记忆>已到站。</短期记忆><变量规划>[]</变量规划><行动选项>等候\n离开\n询问</行动选项>';
function settings() { const value = defaultSettings(); value.prompts.minNarrativeChars = 10; return value; }
function failure(text: string) {
  try { parseStoryEnvelope(text, 'regular', settings()); } catch (error) { expect(error).toBeInstanceOf(AiError); return error as AiError; }
  throw Error('预期拒绝');
}
describe('Story failures report the actual existing rejection branch', () => {
  it.each([
    ['missing narrative', body.replace(/<正文>.*?<\/正文>/, ''), 'tag_missing', '正文'],
    ['unclosed narrative', body.replace('</正文>', ''), 'tag_unclosed', '正文'],
    ['wrong order', body.replace('<正文>一二三四五六七八九十</正文><短期记忆>已到站。</短期记忆>', '<短期记忆>已到站。</短期记忆><正文>一二三四五六七八九十</正文>'), 'tag_order', '短期记忆'],
    ['duplicate', body.replace('</正文>', '</正文><正文>额外</正文>'), 'tag_nested', '正文'],
    ['nested', body.replace('一二三四五六七八九十', '<judge>私密内容</judge>一二三四五六七八九十'), 'tag_nested', 'judge'],
    ['empty planning', body.replace('>规划<', '> \n <'), 'planning_empty', 'thinking'],
    ['empty summary', body.replace('已到站。', ' \n '), 'summary_empty', '短期记忆'],
    ['invalid guide JSON', body.replace('[]', '[secret-value'), 'guide_json', '变量规划'],
    ['unrecognized', 'secret-prefix' + body, 'structure_unrecognized', undefined],
  ])('%s', (_name, text, rule, tag) => {
    const error = failure(text!);
    expect(error.details).toMatchObject({ storyRule: rule, ...(tag ? { storyTag: tag } : {}) });
    const log = runtimeLogEvent(1, 'story', 'failed', error);
    expect(log).toMatchObject({ stage: 'story', storyRule: rule });
    expect(log.message).toContain('本次正文未保存');
    expect(JSON.stringify(log)).not.toContain('secret-');
  });
  it('counts non-whitespace Unicode characters exactly; other blocks cannot compensate', () => {
    const error = failure(body.replace('一二三四五六七八九十', '一 \n😀二'));
    expect(error).toMatchObject({ code: 'invalid_output', details: { storyRule: 'narrative_short', actualCount: 3, minimumCount: 10 } });
    expect(error.message).toContain('3 字符'); expect(error.message).toContain('10 字符');
  });
  it.each([0, 2, 6])('reports %i action options without changing the 3–5 rule', count => {
    const error = failure(body.replace('等候\n离开\n询问', Array.from({ length: count }, () => '等候').join('\n')));
    expect(error.details).toMatchObject({ storyRule: 'actions_count', actualCount: count, minimumCount: 3, maximumCount: 5 });
  });
  it.each([
    ['[{"group":"npc","observedFact":42}]', 'variableGuide.0.observedFact', 0],
    ['[{}, {"group":"secret-group","observedFact":"私密正文"}]', 'variableGuide.0.group', 0],
    ['[{"group":"npc","observedFact":"既有事实"},{"group":"time","observedFact":null}]', 'variableGuide.1.observedFact', 1],
    ['{"secret-key":"secret-value"}', 'variableGuide', undefined],
  ])('identifies guide Schema field and index, never invalid input: %s', (guide, path, index) => {
    const error = failure(body.replace('[]', guide));
    expect(error.details).toMatchObject({ storyRule: 'story_schema', fieldPath: path, ...(index === undefined ? {} : { guideIndex: index }) });
    expect(JSON.stringify(safeAiError(error))).not.toMatch(/secret-|私密正文/);
  });
  it('valid Story still returns the same fields and options; optional options unchanged', () => {
    expect(parseStoryEnvelope(body, 'regular', settings())).toEqual({ planning: '规划', story: {
      turnKind: 'regular', narrative: '一二三四五六七八九十', summary: '已到站。', variableGuide: [], actionOptions: ['等候', '离开', '询问'],
    } });
    const noOptions = settings(); noOptions.prompts.actionOptions = false;
    expect(parseStoryEnvelope(body.split('<行动选项>')[0], 'regular', noOptions).story.actionOptions).toBeUndefined();
    expect(() => parseStoryEnvelope(body, 'regular', noOptions)).toThrow();
  });
});

describe('Story diagnostic privacy and compatibility', () => {
  it('unknown Schema keys and supplied values never enter diagnostics', () => {
    const error = failure(body.replace('[]', '[{"group":"npc","observedFact":"private-game-detail","private-secret-key":42}]'));
    expect(error.details).toMatchObject({ storyRule: 'story_schema', storyIssue: 'unrecognized_keys', fieldPath: 'variableGuide.0' });
    expect(JSON.stringify(safeAiError(error))).not.toContain('private-');
  });
  it('forged diagnostic metadata cannot export arbitrary text, tags or nonfinite counts', () => {
    const details = { storyRule: 'narrative_short', storyTag: 'private-secret-tag', fieldPath: 'private-secret-path', actualCount: NaN, minimumCount: Infinity, guideIndex: -1, storyIssue: 'private-secret-rule' } as unknown as StoryDiagnostic;
    const error = new AiError('invalid_output', undefined, details), serialized = JSON.stringify(runtimeLogEvent(1, 'story', 'failed', error));
    expect(serialized).not.toContain('private-'); expect(serialized).not.toContain('undefined'); expect(serialized).not.toContain('NaN');
    expect(error.details).toEqual({ storyRule: 'narrative_short' });
  });
  it('unclassified invalid_output explicitly says unrecognized structure and points to temporary raw response', () => {
    const value = safeAiError(storyFailure(new AiError('invalid_output')));
    expect(value).toMatchObject({ code: 'invalid_output', details: { storyRule: 'structure_unrecognized' } });
    expect(value.message).toContain('正文输出结构无法识别'); expect(value.message).toContain('临时模型原文');
  });
  it('keeps the invalid_json parent code and existing 3/5 option acceptance boundaries', () => {
    expect(failure(body.replace('[]', '{')).code).toBe('invalid_json');
    for (const count of [3, 5]) {
      const raw = body.replace('等候\n离开\n询问', Array.from({ length: count }, () => '等候').join('\n'));
      expect(parseStoryEnvelope(raw, 'regular', settings()).story.actionOptions).toHaveLength(count);
    }
  });
});
