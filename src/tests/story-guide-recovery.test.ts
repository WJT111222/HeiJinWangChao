import { describe, expect, it } from 'vitest';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { defaultSettings } from '../ui/settings/model';
import { openingTimeSelection, pendingOpeningClock } from '../domain/openingTime';
import { worldState } from './fixtures/world';
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
  ])('%s 不生成新 Story', (_label, input, storyRule) => {
    expect(() => parse(input)).toThrow(expect.objectContaining({ details: expect.objectContaining({ storyRule }) }));
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
