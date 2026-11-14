import { expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { formatTailMessage } from '../prompts/formatTail';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { parseVariableText } from '../parsers/variableText';
import { parseVariableResponse } from '../parsers/variableText/response';
import { defaultSettings } from '../ui/settings/model';
import { stageContext } from './fixtures/eventStages';

// 最终格式提醒：紧贴生成点重复输出骨架，降低长上下文末端掉格式的概率。
// 骨架会被模型照抄，所以下面同时用正式解析器验证"模板自身是合法形状"。
const regular = () => {
  const a = stageContext();
  a.draft.turnKind = 'regular';
  a.draft.story!.turnKind = 'regular';
  return a;
};
const reserved = /<\s*\/?\s*(?:thinking|think|judge|正文|短期记忆|变量规划|行动选项)/iu;
const slice = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to) + to.length);

it('正文阶段：提醒并入确认历史后的收尾 user 消息，含骨架与最低字数', async () => {
  const a = regular();
  const settings = defaultSettings();
  const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings, cotAllowed: true });
  const last = prompt.messages.at(-1)!;
  expect(last.role).toBe('user');
  expect(last.content).toContain('【最终格式提醒】');
  expect(last.content).toContain('<变量规划>[]</变量规划>');
  expect(last.content).toContain(`不少于 ${settings.prompts.minNarrativeChars} 字`);
  expect(last.content).toContain('<行动选项>');
  expect(last.content).toContain('请按已确认的本阶段协议生成当前回合。');
  // 确认历史仍然在提醒之前；GAME_CONTEXT 消息保持原样可被程序解析。
  expect(prompt.messages.at(-2)!.role).toBe('assistant');
  const context = prompt.messages.find((m) => m.content.startsWith('<GAME_CONTEXT>'))!;
  expect(context.content.endsWith('</GAME_CONTEXT>')).toBe(true);
});

it('正文阶段关闭行动选项与确认历史时：提醒是末尾独立 user 消息且声明不要行动选项块', async () => {
  const a = regular();
  const settings = defaultSettings();
  settings.prompts.actionOptions = false;
  const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings, cotAllowed: false });
  const last = prompt.messages.at(-1)!;
  expect(last.role).toBe('user');
  expect(last.content).toContain('【最终格式提醒】');
  expect(last.content).toContain('不要输出<行动选项>块');
  expect(last.content).not.toContain('请按已确认');
  expect(prompt.messages.at(-2)!.content.startsWith('<GAME_CONTEXT>')).toBe(true);
});

it('变量与世界阶段：末尾分别是三区块骨架与五数组空形状提醒', async () => {
  const a = regular();
  const variables = await composePrompt({ stage: 'variables', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings: defaultSettings() });
  const variablesTail = variables.messages.at(-1)!;
  expect(variablesTail.role).toBe('user');
  expect(variablesTail.content).toContain('<说明>');
  expect(variablesTail.content).toContain('</命令>');
  const world = await composePrompt({ stage: 'world', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings: defaultSettings() });
  const worldTail = world.messages.at(-1)!;
  expect(worldTail.role).toBe('user');
  expect(worldTail.content).toContain('{"worldCommands":[],"taskCommands":[],"eventCommands":[],"visibleHooks":[],"unresolved":[]}');
  expect(worldTail.content).not.toContain('<正文>');
});

it('正文模板可被严格解析：骨架按字面解析成功，占位文字不含任何保留标签', () => {
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 5;
  settings.prompts.actionOptions = false;
  const tail = formatTailMessage('story', { actionOptions: false, minNarrativeChars: 5 })!;
  const skeleton = slice(tail, '<thinking>', '</变量规划>');
  // 占位文字里不得出现保留标签字面量（照抄不会触发 tag_nested）。
  for (const content of ['创作要点提纲', '完整连续的小说正文', '本回合事实摘要']) {
    expect(skeleton).toContain(content);
    expect(reserved.test(content)).toBe(false);
  }
  const parsed = parseStoryEnvelope(skeleton, 'regular', settings);
  expect(parsed.planning).toBe('创作要点提纲');
  expect(parsed.story.narrative).toBe('完整连续的小说正文');
  expect(parsed.story.variableGuide).toEqual([]);
  // thinking 可选：骨架去掉第一行后仍可解析（#149 行为）。
  const withoutThinking = skeleton.slice(skeleton.indexOf('<正文>'));
  expect(parseStoryEnvelope(withoutThinking, 'regular', settings).story.narrative).toBe('完整连续的小说正文');
  // 启用行动选项的骨架：标签结构按字面合法，填入真实行动后整体可解析。
  const actionTail = formatTailMessage('story', { actionOptions: true, minNarrativeChars: 5 })!;
  const actionSkeleton = slice(actionTail, '<thinking>', '</行动选项>').replace('每行一条短行动', '查看周围\n继续交谈\n离开房间');
  settings.prompts.actionOptions = true;
  expect(parseStoryEnvelope(actionSkeleton, 'regular', settings).story.actionOptions).toEqual(['查看周围', '继续交谈', '离开房间']);
});

it('变量模板可被严格解析：无变化骨架经正式解析返回 0 条命令', () => {
  const tail = formatTailMessage('variables', { actionOptions: true, minNarrativeChars: 1500 })!;
  const skeleton = slice(tail, '<thinking>', '</命令>');
  const response = parseVariableResponse(skeleton);
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.value.analysis).toBe('变量变化分析结论');
    expect(response.value.description).toContain('- ');
  }
  const commands = parseVariableText(skeleton);
  expect(commands.ok).toBe(true);
  if (commands.ok) expect(commands.value).toEqual([]);
});

it('世界模板空形状是严格 JSON 且五数组齐全', () => {
  const tail = formatTailMessage('world', { actionOptions: true, minNarrativeChars: 1500 })!;
  const shape = tail.split('\n').find((line) => line.startsWith('{'))!;
  const parsed = JSON.parse(shape) as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual(['eventCommands', 'taskCommands', 'unresolved', 'visibleHooks', 'worldCommands']);
  for (const value of Object.values(parsed)) expect(value).toEqual([]);
});

it('记忆阶段无格式提醒；提醒文本不含未替换占位符', () => {
  expect(formatTailMessage('memory', { actionOptions: true, minNarrativeChars: 1500 })).toBeUndefined();
  for (const stage of ['story', 'variables', 'world'] as const) {
    const text = formatTailMessage(stage, { actionOptions: true, minNarrativeChars: 1500 })!;
    expect(/\{\{[^{}]*\}\}/.test(text)).toBe(false);
  }
});
