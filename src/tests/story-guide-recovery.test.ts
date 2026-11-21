import { describe, expect, it } from 'vitest';
import { storyGuideRawLimit } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { defaultSettings } from '../ui/settings/model';
import { openingTimeSelection, pendingOpeningClock } from '../domain/openingTime';
import { contextFor } from '../prompts/context';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { worldDraft, worldState } from './fixtures/world';
import { openingGuideTimes as time, openingGuideEntry as opening, wrappedOpeningGuide as brokenTime, ordinaryGuideRaw as rawReference } from './fixtures/storyGuide';

const settings = defaultSettings();
settings.prompts.actionOptions = false;
settings.prompts.minNarrativeChars = 5;
const guide = (entries: unknown[]) => JSON.stringify(entries);
const envelope = (input: string) => `<正文>【旁白】主角走进资料室核对今天的安排。</正文><短期记忆>核对安排。</短期记忆><变量规划>${input}</变量规划>`;
const parse = (input: string) => parseStoryEnvelope(envelope(input), 'opening', settings);
const pending = { ...worldState(), worldClock: pendingOpeningClock, openingTimePending: true as const };
const select = (input: string) => openingTimeSelection(pending, { story: parse(input).story, turnKind: 'opening', userInput: '' });

describe('开局时间输入与提供给 Variables 的普通参考', () => {
  it.each([
    ['旧版字符串', guide([opening(JSON.stringify(time))]), time],
    ['直接对象', guide([opening(time)]), time],
    ['真实问题的嵌套引号', `[${brokenTime()}]`, time],
    ['同结构不同合法时间', `[${brokenTime({ ...time, endAt: '2026-10-15T18:15:00+08:00' })}]`, { ...time, endAt: '2026-10-15T18:15:00+08:00' }],
  ] as const)('%s 保存形式仍是合法时间字符串', (_label, input, expected) => {
    expect(JSON.parse(parse(input).story.variableGuide[0].observedFact)).toEqual(expected);
    expect(select(input)).toMatchObject(expected);
  });
  it('完整正文保留普通错误项原文及合法时间', () => {
    const { story } = parse(`[${rawReference}, ${JSON.stringify(opening(time))}]`);
    expect(story.narrative).toContain('核对今天的安排');
    expect(story.variableGuide).toEqual([opening(JSON.stringify(time))]);
    expect(story).toHaveProperty('variableGuideReferences', [{ group: 'npc', text: rawReference }]);
  });
});

describe('确定性边界', () => {
  it('结构合法但普通值类型错误时保留原始空格和拼写', () => {
    const raw = '{"group": "items", "observedFact": 42 }';
    expect(parse('[' + raw + ']').story.variableGuideReferences).toEqual([{ group: 'items', text: raw }]);
  });
  it.each([
    ['不完整包装', '[{"group":"time","subjectHint":"time:opening","observedFact":"{"startAt":"2026-10-15T17:45:00+08:00"}]', 'guide_json'],
    ['关键帧与坏项分隔不清', '[' + rawReference + ' ' + JSON.stringify(opening(time)) + ']', 'guide_json'],
    ['借普通组声明时间', '[{"group":"npc","subjectHint":"time:pause","observedFact":\'时间不明确\'}]', 'guide_json'],
    ['历史视角损坏', '[{"group":"time","subjectHint":"time:retrospective","observedFact":\'历史\'}]', 'guide_json'],
    ['普通组带坏入场权限', guide([{ group: 'npc', observedFact: 42, eventInteraction: { action: 'accept' } }]), 'story_schema'],
    ['事件回执格式损坏', guide([{ group: 'event', observedFact: '先等候', eventInteraction: { eventId: 'event', entryId: 'entry', action: 'accept' } }]), 'receipt_status'],
    ['事件裁定时间格式损坏', guide([{ group: 'event', observedFact: '先等候', eventNarration: { eventId: 'event', mode: 'enter', at: '2026-02-30T08:00:00+08:00' } }]), 'story_schema'],
    ['开局字段不完整', guide([opening({ startAt: time.startAt })]), 'opening_format'],
    ['结束倒退', guide([opening({ ...time, endAt: '2026-10-15T17:44:00+08:00' })]), 'opening_reversed'],
    ['非法中国时区', guide([opening({ ...time, startAt: '2026-10-15T17:45:00+09:00' })]), 'opening_timezone'],
    ['非法公历日', guide([opening({ ...time, startAt: '2026-02-29T17:45:00+08:00' })]), 'opening_format'],
    ['重复时间键', '[{"group":"time","subjectHint":"time:opening","observedFact":{"startAt":"2026-10-15T17:40:00+08:00","startAt":"2026-10-15T17:45:00+08:00","endAt":"2026-10-15T18:05:00+08:00"}}]', 'guide_json'],
    ['旧版字符串的重复时间键', '[' + rawReference + ',' + JSON.stringify(opening('{"startAt":"2026-10-15T17:40:00+08:00","startAt":"2026-10-15T17:45:00+08:00","endAt":"2026-10-15T18:05:00+08:00"}')) + ']', 'guide_json'],
    ['重复回执动作', '[' + rawReference + ',{"group":"event","observedFact":"实际收到通知","eventInteraction":{"eventId":"event","entryId":"entry","action":"declined","action":"acknowledged"}}]', 'guide_json'],
    ['原文过长', guide([{ group: 'npc', observedFact: false, textEvidence: '长'.repeat(4000) }]), 'guide_reference_limit'],
    ['坏项过多', guide(Array.from({ length: 13 }, () => ({ group: 'npc', observedFact: 42 }))), 'guide_reference_limit'],
  ])('%s 保留原文、不授予执行权', (_label, input) => {
    const { story } = parse(input);
    expect(story.variableGuideRaw).toBe(input);
    expect(story.variableGuide).toEqual([]);
  });
  it.each([
    ['没有唯一时间', '[' + rawReference + ']', 'opening_missing'],
    ['两条时间', guide([opening(time), opening(JSON.stringify(time))]), 'opening_duplicate'],
  ])('%s 仍由待定开局校验拒绝', (_label, input, storyRule) => {
    expect(() => select(input)).toThrow(expect.objectContaining({ diagnostic: expect.objectContaining({ storyRule }) }));
  });
  it.each([
    ['缺少正文', /<正文>[^]*?<\/正文>/u, '', 'tag_missing'],
    ['正文标签不闭合且缺少后续锚点', /<\/正文>[^]*$/u, '', 'tag_unclosed'],
    ['正文过短', /【旁白】主角走进资料室核对今天的安排。/u, '短', 'narrative_short'],
  ] as const)('%s 仍先执行正文封套和长度校验', (_label, pattern, replacement, storyRule) => {
    expect(() => parseStoryEnvelope(envelope('[' + rawReference + ']').replace(pattern, replacement), 'opening', settings))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ storyRule }) }));
  });
});

describe('可选的本轮变量笔记', () => {
  it.each(['开局：回到公寓。', '[{"group":"其他","observedFact":42},]', '', brokenTime(),
    guide([{ group: 'time', subjectHint: 'time:normal', observedFact: '从9:15出发，回家时10:00' }])])('原样保存笔记 %s', raw => {
    expect(parse(raw).story).toMatchObject({ narrative: expect.stringContaining('资料室'), variableGuideRaw: raw });
  });
  it('完整正文和摘要可以省略变量规划块', () => {
    const source = envelope('').replace('<变量规划></变量规划>', '');
    expect(parseStoryEnvelope(source, 'regular', settings).story).toMatchObject({ variableGuide: [], variableGuideRaw: '' });
  });
});

it.each(['', '已经付款。'])('Variables 按正文补充人物变化并忽略无依据的交易，笔记=%s', async raw => {
  const state = worldState();
  const draft = worldDraft(false, 'opening');
  const narrative = '医师刚下夜班，揉着眼睛。主角只问了价格便离开。';
  draft.story = { ...draft.story!, narrative, variableGuideRaw: raw };
  const context = contextFor({ stage: 'variables', mode: 'opening', settings, state, draft, userInput: '' });
  expect(context).toMatchObject({ VARIABLE_GUIDE_NOTES: raw, STORY_RESULT: { narrative }, PLAYER_ACTION: draft.userInput });
  const result = await parseTextVariables('<thinking>核对正文</thinking><说明>医师疲惫，只询价。</说明><命令>\nset npc[npc-a].healthText = "夜班后疲惫"\n</命令>', state, draft);
  expect(result.commands.map(c => c.type)).toEqual(['UpdateNpc']);
  const projected = projectTurn(state, { ...draft, variables: { ...worldDraft().variables!, result } });
  expect(projected.npc['npc-a'].healthText).toBe('夜班后疲惫');
  expect(projected.economy).toEqual(state.economy);
});

it('超长参考只保存有界前缀，后缀和参考文字都不授予命令', () => {
  const source = '长'.repeat(storyGuideRawLimit) + '尾部';
  const { story, notes } = parse(source);
  expect(story.variableGuideRaw).toBe(source.slice(0, storyGuideRawLimit));
  expect(story.variableGuideRawTruncated).toBe(true);
  expect(story.variableGuide).toEqual([]);
  expect(notes.join('')).not.toContain('长长');
});

it.each([
  { clocks: [] },
  { clocks: [time.endAt, time.startAt] },
  { clocks: [pendingOpeningClock] },
  { clocks: [time.startAt, time.startAt, time.endAt] },
])('Variables 缺失或非法开局窗口不能变成正式候选：$clocks', async ({ clocks }) => {
  const draft = worldDraft(false, 'opening');
  draft.useVariableStage = true;
  draft.story = parse('按日程出发').story;
  const lines = clocks.map(clock => 'set worldClock = ' + JSON.stringify(clock));
  const raw = '<thinking>核对时间</thinking><说明>核对开局</说明><命令>\n' + lines.join('\n') + '\n</命令>';
  await expect(parseTextVariables(raw, pending, draft)).rejects.toThrow();
  expect(draft.variables).toBeUndefined();
  expect(pending.worldClock).toBe(pendingOpeningClock);
});

it('预览变量候选不提供开局时间，World 不使用预览日期或内部占位时钟', () => {
  const draft = worldDraft(true, 'opening');
  draft.story = parse('开局地点已经确定').story;
  draft.variables!.validation = 'preview';
  draft.stageStatus.variables = 'preview';
  expect(openingTimeSelection(pending, draft)).toBeUndefined();
  expect(() => contextFor({ stage: 'world', mode: 'opening', settings, state: pending, draft, userInput: '' }))
    .toThrow(expect.objectContaining({ code: 'time_data' }));
});
