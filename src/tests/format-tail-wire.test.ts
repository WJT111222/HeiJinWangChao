import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { composePrompt } from '../prompts/composer';
import type { ComposeInput } from '../prompts/context';
import { formatTailMessage } from '../prompts/formatTail';
import { inspectBudget } from '../prompts/budgetInspection';
import { runStageRequest } from '../services/ai/runtime';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { array, record, string } from '../services/ai/protocols';
import type { AiMessage } from '../services/ai/protocols';
import { stageResponses } from '../services/ai/stageResponses';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';
import { inlineRecoveryNarrative } from './fixtures/storyRecovery';
import { variableTextEnvelope } from './fixtures/variableReply';
import { endStage, stageCommand, stageContext } from './fixtures/eventStages';
import { sentContext } from './fixtures/contextAssertions';

const emptyWorld = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] };
const evidence: { protocol: Protocol; scenario: string; body: Record<string, unknown> }[] = [];
afterEach(() => stageResponses.clear());
afterAll(async () => {
  // Optional acceptance artifact: synthetic request bodies only, never headers/credentials.
  if (process.env.PR151_WIRE_EVIDENCE) await writeFile(process.env.PR151_WIRE_EVIDENCE, JSON.stringify(evidence, null, 2));
});

function regular(stage: 'story' | 'variables' | 'world'): ComposeInput & { stage: 'story' | 'variables' | 'world' } {
  const state = game(), settings = defaultSettings(); settings.prompts.minNarrativeChars = 1500;
  state.turnNumber = 1;
  state.journal.push({ turnId: 'previous-format-turn', revision: state.revision,
    story: { turnKind: 'opening', narrative: inlineRecoveryNarrative, summary: '主角核对笔记。', variableGuide: [] }, relatedActorRefs: [] });
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'format-wire', 'regular', '继续核对笔记'), {
    turnKind: 'regular', narrative: inlineRecoveryNarrative, summary: '主角核对笔记。', variableGuide: [],
  });
  return { stage, mode: 'regular', state, draft, userInput: draft.userInput, settings };
}
function reply(text: string, protocol: Protocol) {
  return Response.json(protocol === 'gemini'
    ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
    : protocol === 'anthropic'
      ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}
async function verify(protocol: Protocol, scenario: string, input: ReturnType<typeof regular>, text: string, confirmation = false, rejectedRule?: string) {
  const channel = newChannel(protocol), config = defaultAiConfig();
  channel.baseUrl = 'http://127.0.0.1:1'; channel.defaultModel = 'mock-format-tail';
  channel.compatibility.cotMode = confirmation ? 'confirmation' : 'off';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
  const values = new Map<string, string>(), storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-format-tail-key');
  const before = structuredClone(input), fetcher = vi.fn<typeof fetch>(async () => reply(text, protocol));
  const pending = runStageRequest(input, config, vault, { stream: false }, new AiClient(fetcher));
  let result;
  if (rejectedRule) await expect(pending).rejects.toMatchObject({ details: input.stage === 'world' ? { worldRule: rejectedRule } : { variableStep: rejectedRule } });
  else result = await pending;
  expect(fetcher).toHaveBeenCalledTimes(1); expect(input).toEqual(before);
  const body = record(JSON.parse(String(fetcher.mock.calls[0][1]!.body)));
  expect(JSON.stringify(body)).not.toContain('mock-format-tail-key');
  evidence.push({ protocol, scenario, body });
  const expected = await composePrompt({ ...input, cotAllowed: input.stage === 'story' && confirmation });
  const messages: AiMessage[] = protocol === 'gemini'
    ? array(body.contents).map(value => { const row = record(value); return { role: row.role === 'model' ? 'assistant' : 'user', content: array(row.parts).map(part => string(record(part).text)).join('') }; })
    : array(body.messages).map(value => { const row = record(value); return { role: row.role as AiMessage['role'], content: string(row.content) }; });
  expect(messages).toEqual(protocol === 'gemini' || protocol === 'anthropic' ? expected.messages.filter(m => m.role !== 'system') : expected.messages);
  if (protocol === 'gemini') expect(array(record(body.systemInstruction).parts).map(part => string(record(part).text)).join('')).toBe(expected.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'));
  if (protocol === 'anthropic') expect(body.system).toBe(expected.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n'));
  expect(messages.at(-1)?.role).toBe('user');
  const tail = formatTailMessage(input.stage, input.settings.prompts)!;
  expect(messages.at(-1)?.content).toBe(tail + (input.stage === 'story' && confirmation ? '\n请按已确认的本阶段协议生成当前回合。' : ''));
  expect(messages.filter(m => m.content.includes('【最终格式提醒】'))).toHaveLength(1);
  const context = messages.filter(m => /^<GAME_CONTEXT>\n[\s\S]*\n<\/GAME_CONTEXT>$/.test(m.content));
  expect(context).toHaveLength(1); expect(context[0].content).not.toContain('【最终格式提醒】');
  expect(sentContext(messages)).toEqual(sentContext(expected.messages));
  if (input.stage === 'story' && confirmation) expect(messages.at(-2)?.role).toBe('assistant');
  else expect(messages.at(-2)?.content).toBe(context[0].content);
  const budget = inspectBudget(expected.messages);
  expect(budget.reconciliation.characters).toBe(0);
  expect(budget.categories.find(row => row.id === 'other')!.characters).toBeGreaterThanOrEqual(Array.from(tail).length);
  return { result, context: sentContext(messages) };
}

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const thinking of [false, true]) for (const actions of [false, true]) for (const confirmation of [false, true]) {
    it(`${protocol} Story出站：thinking=${thinking} actions=${actions} confirmation=${confirmation}`, async () => {
      const input = regular('story'); input.settings.prompts.actionOptions = actions;
      const text = `${thinking ? '<thinking>核对已有场景。</thinking>' : ''}<正文>${inlineRecoveryNarrative}</正文><短期记忆>主角核对笔记。</短期记忆><变量规划>[]</变量规划>${actions ? '<行动选项>继续核对\n看看周围\n留在原处</行动选项>' : ''}`;
      const { result } = await verify(protocol, `story:${thinking}:${actions}:${confirmation}`, input, text, confirmation);
      expect(result?.result).toMatchObject({ narrative: inlineRecoveryNarrative, summary: '主角核对笔记。', variableGuide: [] });
      expect(result?.storyInspection?.planning).toBe(thinking ? '核对已有场景。' : '');
      if (actions) expect(result?.result).toHaveProperty('actionOptions', ['继续核对', '看看周围', '留在原处']);
      else expect(result?.result).not.toHaveProperty('actionOptions');
    });
  }
  for (const mode of ['empty', 'valid', 'invalid'] as const) {
    it(`${protocol} Variables真实出站与严格三区块解析：${mode}`, async () => {
      const input = regular('variables');
      const command = mode === 'empty' ? '' : mode === 'valid' ? 'set protagonist.emotionText = "保持平静"' : 'set protagonist.notAFormalField = "bad"';
      const { result } = await verify(protocol, `variables:${mode}`, input, variableTextEnvelope(`<命令>\n${command}\n</命令>`), false, mode === 'invalid' ? 'mapping' : undefined);
      if (mode === 'empty') expect(result?.result).toHaveProperty('commands', []);
      if (mode === 'valid') expect(result?.result).toHaveProperty('commands', [expect.objectContaining({ type: 'UpdateProtagonist', changes: { emotionText: '保持平静' } })]);
    });
  }
  for (const mode of ['idle', 'due-handled', 'due-omitted'] as const) {
    it(`${protocol} World真实出站五数组与到期事项：${mode}`, async () => {
      let input = regular('world'), response: unknown = emptyWorld;
      if (mode !== 'idle') {
        const a = stageContext(); input = { ...input, mode: 'opening', state: a.state, draft: a.draft, userInput: a.draft.userInput };
        if (mode === 'due-handled') response = { ...a.response, eventCommands: [stageCommand(endStage(a.state.events['stage-one']))] };
      }
      const { result, context } = await verify(protocol, `world:${mode}`, input, JSON.stringify(response), false, mode === 'due-omitted' ? 'stage_due' : undefined);
      if (mode === 'idle') expect(result?.result).toEqual(emptyWorld);
      else expect(record(context.EVENT_SCHEDULE).due).toEqual(expect.arrayContaining([expect.objectContaining({ eventId: 'stage-one', mode: 'stage_resolution' })]));
      if (mode === 'due-handled') expect(result?.result).toHaveProperty('eventCommands', [expect.objectContaining({ type: 'SaveEvent', event: expect.objectContaining({ id: 'stage-one', status: 'resolved' }) })]);
    });
  }
}
