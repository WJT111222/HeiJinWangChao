import { expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { formatTailMessage } from '../prompts/formatTail';
import { defaultSettings } from '../ui/settings/model';
import { stageContext } from './fixtures/eventStages';

// 最终格式提醒：紧贴生成点重复输出骨架，降低长上下文末端掉格式的概率。
const regular = () => {
  const a = stageContext();
  a.draft.turnKind = 'regular';
  a.draft.story!.turnKind = 'regular';
  return a;
};

it('正文阶段：提醒并入确认历史后的收尾 user 消息，含骨架与最低字数', async () => {
  const a = regular();
  const settings = defaultSettings();
  const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings, cotAllowed: true });
  const last = prompt.messages.at(-1)!;
  expect(last.role).toBe('user');
  expect(last.content).toContain('【最终格式提醒】');
  expect(last.content).toContain('<变量规划>严格JSON数组；无更新写 []</变量规划>');
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

it('记忆阶段无格式提醒；提醒文本不含未替换占位符', () => {
  expect(formatTailMessage('memory', { actionOptions: true, minNarrativeChars: 1500 })).toBeUndefined();
  for (const stage of ['story', 'variables', 'world'] as const) {
    const text = formatTailMessage(stage, { actionOptions: true, minNarrativeChars: 1500 })!;
    expect(/\{\{[^{}]*\}\}/.test(text)).toBe(false);
  }
});
