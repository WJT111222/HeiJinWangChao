import { describe, expect, it } from 'vitest';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { recoverStoryEnvelope } from '../services/validation/storyEnvelopeRecovery';
import { defaultSettings } from '../ui/settings/model';
import { AiError } from '../services/ai/errors';

const narrative = '【旁白】雨停了，街边的灯亮起来。\n【吴思源】今晚把账本再看一遍。\n【旁白】两人拿起手机，继续核对生活费用。';
const tail = '<短期记忆>两人一起核对本周生活费。</短期记忆><变量规划>[]</变量规划>';
const choices = '<行动选项>继续讨论\n准备晚饭\n查看课表</行动选项>';
const plan = '<thinking>维持已有场景，不代玩家做重大选择。</thinking>';
const steps = Array.from({ length: 16 }, (_, i) => `Step ${i}｜本轮第${i}项创作方向\n- 根据现有世界事实保持人物连续性。`).join('\n\n');
const preface = `${steps}\n\n现在按照这些规划写正文，保证层次完整。\n`;

function settings(actions: boolean) {
  const value = defaultSettings(); value.prompts.minNarrativeChars = 10; value.prompts.actionOptions = actions;
  return value;
}
function fails(raw: string, actions = true) {
  try { parseStoryEnvelope(raw, 'regular', settings(actions)); }
  catch (error) { expect(error).toBeInstanceOf(AiError); return error as AiError; }
  throw Error('预期正文结构不应通过');
}

describe('Story optional project planning, without relaxing mandatory payloads', () => {
  it.each(['opening', 'regular'] as const)('%s两种正式模式都接受有/无项目规划', mode => {
    for (const actions of [false, true]) {
      const suffix = tail + (actions ? choices : '');
      const noPlanning = parseStoryEnvelope(`<正文>${narrative}</正文>${suffix}`, mode, settings(actions));
      expect(noPlanning).toMatchObject({ planning: '', story: { turnKind: mode, narrative, summary: '两人一起核对本周生活费。', variableGuide: [] } });
      expect(noPlanning.story.actionOptions).toEqual(actions ? ['继续讨论', '准备晚饭', '查看课表'] : undefined);
      const withPlanning = parseStoryEnvelope(plan + `<正文>${narrative}</正文>` + suffix, mode, settings(actions));
      expect(withPlanning.planning).toContain('维持已有场景');
      expect(withPlanning.story).toEqual(noPlanning.story);
    }
  });

  it('显式空规划仍不能冒充合法规划；嵌套与重复保留原诊断', () => {
    expect(fails(`<thinking> \n </thinking><正文>${narrative}</正文>${tail}${choices}`).details)
      .toMatchObject({ storyRule: 'planning_empty', storyTag: 'thinking' });
    expect(fails(`<thinking>未闭合<正文>${narrative}</正文>${tail}${choices}`).details)
      .toMatchObject({ storyRule: 'tag_unclosed', storyTag: 'thinking' });
    expect(fails(`<正文>${narrative}<正文>重复</正文></正文>${tail}${choices}`).details)
      .toMatchObject({ storyRule: 'tag_nested', storyTag: '正文' });
  });

  it('缺少真正的正文/摘要/规划/启用选项仍严格失败，不凭空补写', () => {
    expect(fails(tail + choices).details).toMatchObject({ storyRule: 'tag_missing', storyTag: '正文' });
    expect(fails(`<正文>${narrative}</正文><变量规划>[]</变量规划>${choices}`).details)
      .toMatchObject({ storyRule: 'tag_missing', storyTag: '短期记忆' });
    expect(fails(`<正文>${narrative}</正文><短期记忆>已核对。</短期记忆>${choices}`).details)
      .toMatchObject({ storyRule: 'tag_missing', storyTag: '变量规划' });
    expect(fails(`<正文>${narrative}</正文>${tail}`).details)
      .toMatchObject({ storyRule: 'tag_missing', storyTag: '行动选项' });
    expect(fails(`<正文>${narrative}</正文>${tail}${choices}`, false).details)
      .toMatchObject({ storyRule: 'tag_unexpected', storyTag: '行动选项' });
  });

  it('未标记的单一正文仅在明确旁白起点和完整后续结构时恢复，不修改原文', () => {
    const raw = `${narrative}\n${tail}\n${choices}`;
    const normalized = recoverStoryEnvelope(raw, true);
    expect(normalized).toBe(`<正文>${narrative}</正文>\n${tail}\n${choices}`);
    const parsed = parseStoryEnvelope(raw, 'regular', settings(true));
    expect(parsed.planning).toBe('');
    expect(parsed.story.narrative).toBe(narrative);
    expect(raw.startsWith('【旁白】')).toBe(true);
  });

  it('真实掉格式形状：完整 Step 0–15 + 转入正文句 + 旁白小说 + 完整后续块，可无付费重试地恢复', () => {
    const raw = preface + narrative + '\n' + tail + '\n' + choices;
    const normalized = recoverStoryEnvelope(raw, true);
    expect(normalized).toBeDefined();
    expect(normalized).not.toContain('Step 0');
    expect(normalized).not.toContain('现在按照这些规划写正文');
    const result = parseStoryEnvelope(raw, 'regular', settings(true));
    expect(result.planning).toBe('');
    expect(result.story.narrative).toBe(narrative);
    expect(result.story.actionOptions).toHaveLength(3);
  });

  it('已有完整封套不做恢复；有明确planning但漏正文标签时只包裹现成小说', () => {
    const tagged = plan + `<正文>${narrative}</正文>` + tail + choices;
    expect(recoverStoryEnvelope(tagged, true)).toBeUndefined();
    const raw = plan + '\n' + narrative + '\n' + tail + choices;
    expect(parseStoryEnvelope(raw, 'opening', settings(true))).toMatchObject({ planning: '维持已有场景，不代玩家做重大选择。', story: { narrative } });
  });

  it.each([
    ['断裂的Step前缀', steps.replace('Step 12｜', 'Step 13｜') + '\n现在按照这些规划写正文。\n' + narrative + tail + choices],
    ['没有明确转入正文语句', steps + '\n' + narrative + tail + choices],
    ['混入未知前言', '我随便先说点话。\n' + narrative + tail + choices],
    ['缺失摘要尾部', narrative + '<变量规划>[]</变量规划>' + choices],
    ['被截断的行动选项', narrative + tail + '<行动选项>等候'],
    ['有孤立正文闭合', narrative + '</正文>' + tail + choices],
    ['正文中含未闭合保留标签', narrative + '<thinking>坏标签' + tail + choices],
    ['多余顶层前缀', plan + '\n无依据的规划外文字\n' + narrative + tail + choices],
  ])('%s不能模糊猜测、补造或接受截断响应', (_case, raw) => {
    expect(recoverStoryEnvelope(raw, true)).toBeUndefined();
    expect(fails(raw).code).toBe('invalid_output');
  });

  it('恢复之后依然执行字数、JSON与 Schema 的全部正式规则', () => {
    expect(fails('【旁白】短。\n' + tail + choices).details).toMatchObject({ storyRule: 'narrative_short' });
    expect(fails(narrative + '<短期记忆>已核对。</短期记忆><变量规划>{坏JSON}</变量规划>' + choices).code).toBe('invalid_json');
    expect(fails(narrative + '<短期记忆>已核对。</短期记忆><变量规划>[{"group":"npc","observedFact":42}]</变量规划>' + choices).details)
      .toMatchObject({ storyRule: 'story_schema' });
  });

  it.each(['step 9｜仍在规划', '### Step 9｜仍在规划', '**Step 9｜仍在规划**', '- Step 9：仍在规划'])('恢复正文中的规划标题 %s 必须拒绝，不能混入小说', heading => {
    const raw = preface + narrative + '\n' + heading + '\n- 内部创作预算。\n' + tail + choices;
    expect(recoverStoryEnvelope(raw, true)).toBeUndefined();
    expect(fails(raw).code).toBe('invalid_output');
  });

  it.each(['Step 16：额外步骤', '### Step 15｜重复步骤', '**Step 15｜重复步骤**'])('完整编号之外的 %s 不能因格式不同被悄然丢弃', heading => {
    const raw = steps + '\n' + heading + '\n现在按照这些规划写正文，保证层次完整。\n' + narrative + tail + choices;
    expect(recoverStoryEnvelope(raw, true)).toBeUndefined();
    expect(fails(raw).code).toBe('invalid_output');
  });

  it.each(['<thinking private="x">', '<正文 invalid="x">', '<THINKING>'])('无标签规划前缀中的畸形结构 %s 不能被恢复静默抹去', brokenTag => {
    const raw = preface.replace('Step 7｜', brokenTag + '\nStep 7｜') + narrative + tail + choices;
    expect(recoverStoryEnvelope(raw, true)).toBeUndefined();
    expect(fails(raw).code).toBe('invalid_output');
  });

  it.each(['。', '.', '：'])('完全相同的明确转正文句允许句末标点 %s', punctuation => {
    const raw = steps + '\n现在按照这些规划写正文' + punctuation + '\n' + narrative + tail + choices;
    expect(parseStoryEnvelope(raw, 'regular', settings(true)).story.narrative).toBe(narrative);
  });

  it.each(['### Step $n｜', '**Step $n：', 'Step $n:'])('完整0–15规划的明确标题格式 %s 不影响确定的正文边界', heading => {
    const formatted = steps.replace(/Step (\d+)｜/g, (_whole, n: string) => heading.replace('$n', n));
    const raw = formatted + '\n现在按照这些规划写正文。\n' + narrative + tail + choices;
    const result = parseStoryEnvelope(raw, 'regular', settings(true));
    expect(result.planning).toBe(''); expect(result.story.narrative).toBe(narrative);
    expect(result.story.summary).toBe('两人一起核对本周生活费。');
  });
});
