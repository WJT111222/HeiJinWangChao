import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, rerollStory, VariableResultSchema } from '../domain/drafts';
import { AiClient } from '../services/ai/client';
import { runStageRequest } from '../services/ai/runtime';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses } from '../services/ai/stageResponses';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { defaultSettings } from '../ui/settings/model';
import { record, array, string } from '../services/ai/protocols';
import { worldState, worldResult } from './fixtures/world';
import { story } from './fixtures/game';
import { variableTextEnvelope } from './fixtures/variableReply';

function setup(protocol: Protocol = 'openai') {
  const channel = newChannel(protocol); channel.defaultModel = 'story'; channel.compatibility.jsonMode = true;
  const config = defaultAiConfig(); config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const entries = new Map<string, string>(), storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-variable-source-secret');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  return { config, vault, settings };
}
const response = (text: string, protocol: Protocol = 'openai', reason = 'stop') => Response.json(protocol === 'openai'
  ? { choices: [{ message: { content: text }, finish_reason: reason }] }
  : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text }] }, finishReason: reason === 'stop' ? 'STOP' : 'MAX_TOKENS' }] }
  : { content: [{ type: 'text', text }], stop_reason: reason === 'stop' ? 'end_turn' : 'max_tokens' });
const variableText = (body: string) => variableTextEnvelope(`<命令>\n${body}\n</命令>`);
afterEach(() => { stageResponses.clear(); vi.restoreAllMocks(); });

describe('正式单请求、完整性与协议隔离', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s完整三标签执行四操作，不强制原生JSON或增加请求', async protocol => {
    const a = setup(protocol), state = worldState(), draft = rerollStory(createTurnDraft(state.saveId, 0, 'source-api', 'opening', ''), { ...story, turnKind: 'opening' });
    const text = variableText('set protagonist.skills = ["驾驶","急救"]\npush protagonist.skills = "烹饪"\nadd economy.cash = -3000\ndelete protagonist.skills[0]');
    const transport = vi.fn<typeof fetch>(async () => response(text, protocol));
    const result = await runStageRequest({ settings: a.settings, state, draft, stage: 'variables', mode: 'opening', userInput: '' }, a.config, a.vault, {}, new AiClient(transport));
    expect(VariableResultSchema.parse(result.result).commands.some(c => c.type === 'UpdateProtagonist' && c.changes.skills?.join(',') === '急救,烹饪')).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1); const body = record(JSON.parse(String(transport.mock.calls[0][1]?.body)));
    expect(body).not.toHaveProperty('response_format'); expect(record(body.generationConfig)).not.toHaveProperty('responseMimeType');
    expect(stageResponses.getSnapshot().find(entry => entry.stage === 'variables')?.text).toBe(text);
    expect(state.economy.cash).toBe(10000);
  });
  it('流有完整三个标签但缺少终态时，整体拒绝并保留原文，不自动再付费', async () => {
    const a = setup(), state = worldState(), draft = rerollStory(createTurnDraft(state.saveId, 0, 'cut-source', 'opening', ''), { ...story, turnKind: 'opening' });
    const text = variableText('add economy.cash = -3000');
    const transport = vi.fn<typeof fetch>(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    await expect(runStageRequest({ settings: a.settings, state, draft, stage: 'variables', mode: 'opening', userInput: '' }, a.config, a.vault, { stream: true }, new AiClient(transport)))
      .rejects.toMatchObject({ code: 'stream_interrupted', details: { variableStep: 'response' } });
    expect(transport).toHaveBeenCalledTimes(1); expect(state.economy.cash).toBe(10000);
    expect(stageResponses.getSnapshot().find(entry => entry.stage === 'variables')).toMatchObject({ status: 'failed', text });
  });
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s输出Token截断不接纳合法命令子集', async protocol => {
    const a = setup(protocol), state = worldState(), draft = rerollStory(createTurnDraft(state.saveId, 0, 'limit-source', 'opening', ''), { ...story, turnKind: 'opening' });
    const transport = vi.fn<typeof fetch>(async () => response(variableText('add economy.cash = -3000'), protocol, 'length'));
    await expect(runStageRequest({ settings: a.settings, state, draft, stage: 'variables', mode: 'opening', userInput: '' }, a.config, a.vault, {}, new AiClient(transport)))
      .rejects.toMatchObject({ code: 'output_limit', details: { variableStep: 'response' } });
    expect(transport).toHaveBeenCalledTimes(1); expect(state.economy.cash).toBe(10000);
  });
});

it('真实协调器开局→变量四操作→World投影→原子结算→刷新恢复→普通回合', async () => {
  const a = setup(), repo = await SaveRepository.open('source-live', new IDBFactory()), state = worldState();
  await repo.create(state); await repo.saveDraft(createTurnDraft(state.saveId, 0, 'source-live-opening', 'opening', ''), null);
  const calls: string[] = [], worlds: Record<string, unknown>[] = [];
  const client = new AiClient(async (_url, init) => {
    const body = record(JSON.parse(String(init?.body))), stage = string(body.model); calls.push(stage);
    const turn = calls.filter(value => value === 'story').length;
    if (stage === 'story') {
      const text = '<thinking>本轮创作提纲。</thinking><正文>主角用餐后，与现场人物讨论接下来的安排。</正文><短期记忆>在现场用餐并交流。</短期记忆><变量规划>[]</变量规划>';
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (stage === 'world') {
      const message = array(body.messages).map(record).find(m => m.role === 'user' && string(m.content).startsWith('<GAME_CONTEXT>'));
      if (!message) throw Error('world context');
      worlds.push(record(JSON.parse(string(message.content).replace(/^<GAME_CONTEXT>\n|\n<\/GAME_CONTEXT>$/g, ''))));
      return response(JSON.stringify(worldResult()));
    }
    return response(variableText(`set worldClock = "2026-10-18T08:${turn === 1 ? '10' : '20'}:00+08:00"\nset protagonist.skills = ["驾驶","急救"]\npush protagonist.skills = "烹饪"\nadd economy.cash = -3000\nset npc[scene].relationshipText = "合作的同事"\nadd npc[scene].affinity = 2\npush npc[scene].memories = {"text":"一起用餐交流","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}\ndelete protagonist.skills[0]`));
  });
  const runner = new TurnCoordinator(repo, client);
  try {
    for (let turn = 1; turn <= 2; turn++) {
      const draft = await repo.loadDraft(state.saveId); if (!draft) throw Error('draft');
      const generated = await generateAndSettleTurn(runner, repo, { ...a, draft }, { check: () => undefined, onSettling: () => undefined });
      expect(generated.committed?.state.turnNumber).toBe(turn);
      const loaded = await repo.loadGame(state.saveId); expect(loaded.state.economy.cash).toBe(10000 - turn * 3000);
      expect(loaded.state.protagonist.skills).toEqual(['急救', '烹饪']); expect(loaded.state.npc.scene.memories).toHaveLength(turn);
      expect(loaded.draft?.userInput).toBe('');
      expect(JSON.stringify(worlds[turn - 1])).toContain('合作的同事');
      if (turn === 1) { if (!loaded.draft) throw Error('draft'); await repo.bindTurnAction(loaded.draft, '继续在现场交流', true, true); }
    }
    expect(calls).toEqual(['story','variables','world','story','variables','world']);
    const loaded = await repo.loadGame(state.saveId); expect(loaded.state.journal).toHaveLength(2); expect(loaded.state.memories.short).toHaveLength(2);
  } finally { runner.dispose(); repo.close(); }
});
