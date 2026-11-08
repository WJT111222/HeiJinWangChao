import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { array, record, string } from '../services/ai/protocols';
import { stageResponses } from '../services/ai/stageResponses';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { contextV2Fixture } from './fixtures/contextV2';
import { expectFullState, sentContext } from './fixtures/contextAssertions';
import { variableReply } from './fixtures/variableReply';
import { submission } from './fixtures/turn';
import { worldResult } from './fixtures/world';

const resources: { dispose: () => void }[] = [];
afterEach(() => { resources.splice(0).forEach(resource => resource.dispose()); stageResponses.clear(); });
async function setup() {
  const a = contextV2Fixture(), factory = new IDBFactory();
  const repo = await SaveRepository.open('context-v2-runtime', factory); resources.push({ dispose: () => repo.close() });
  // 模拟重载已有V6存档；create只允许全新空历史，不能冒充已提交八轮的新游戏。
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('context-v2-runtime');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(a.state);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  const initial = createTurnDraft(a.state.saveId, a.state.revision, a.draft.turnId, 'regular', a.draft.userInput);
  await repo.saveDraft(initial, null);
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'story';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const data = new Map<string, string>(), store = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-only-context-v2');
  a.settings.prompts.minNarrativeChars = 1; a.settings.prompts.actionOptions = false;
  return { ...a, initial, factory, repo, config, vault };
}
function request(init?: RequestInit) {
  const body = record(JSON.parse(String(init?.body)));
  const messages = array(body.messages).map(value => {
    const message = record(value);
    return { role: string(message.role) as 'system' | 'user' | 'assistant', content: string(message.content) };
  });
  return { stage: string(body.model), context: sentContext(messages), body };
}
const response = (text: string) => Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });

describe('上下文 V2经真实Coordinator、Runtime、Mock传输与原子提交', () => {
  it('三次请求完整背景到达实际请求体；World使用合法投影；候选不改存档，提交后重载和重放保持一致', async () => {
    const a = await setup(), calls: ReturnType<typeof request>[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const call = request(init); calls.push(call);
      const draft = (await a.repo.loadDraft(a.state.saveId))!;
      expectFullState(call.context, call.stage === 'world' ? projectTurn(a.state, draft) : a.state);
      expect(call.context.PLAYER_ACTION).toBe(a.draft.userInput);
      expect(array(record(call.context.MEMORY_CONTEXT).recentTurns)).toHaveLength(3);
      expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
      if (call.stage === 'story') {
        const story = a.draft.story!;
        const text = `<thinking>保持作者与角色知识边界。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }
      expect(call.context.STORY_RESULT).toMatchObject(draft.story!);
      if (call.stage === 'variables') return response(variableReply(a.draft.variables!.result));
      expect(call.context.variablePending).toBe(false);
      expect(call.context.VARIABLE_RESULT).toEqual(draft.variables);
      expect(record(record(call.context.SAVE_STATE).economy).cash).toBe(7000);
      return response(JSON.stringify(worldResult([{ type: 'RecordHistory', commandId: 'world-history', evidence: '本幕谈话',
        entry: { id: 'new-history', title: '本幕谈话', summary: '现场人物讲述旧日经历', knowledgeKind: 'reported', sourceRef: { kind: 'npc', id: 'scene-ordinary' }, actorRefs: [], relatedEntryIds: [] } }])));
    });
    const runner = new TurnCoordinator(a.repo, new AiClient(fetcher)); resources.push(runner);
    const result = await runner.generate({ ...a, draft: a.initial });
    expect(result.status).toBe('complete');
    expect(calls.map(call => call.stage)).toEqual(['story', 'variables', 'world']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
    expect(result.draft.world!.validation).toBe('validated');
    const committed = await a.repo.commitTurn(submission(result.draft, '下一步'));
    expect(committed.state.schemaVersion).toBe(6);
    expect(committed.state.revision).toBe(a.state.revision + 1);
    expect(committed.state.journal).toHaveLength(9);
    expect(committed.state.journal.at(-1)!.story).toEqual(result.draft.story);
    expect(committed.state.npc).toEqual(a.state.npc);
    expect(committed.state.economy.cash).toBe(7000);
    expect(committed.state.timeline.at(-1)!.id).toBe('new-history');
    const second = await SaveRepository.open('context-v2-runtime', a.factory); resources.push({ dispose: () => second.close() });
    expect((await second.loadGame(a.state.saveId)).state).toEqual(committed.state);
    expect((await second.commitTurn(submission(result.draft, '下一步'))).replayed).toBe(true);
    const next = sentContext((await composePrompt({ state: committed.state, settings: a.settings, stage: 'story', mode: 'regular', userInput: '下一步' })).messages);
    expect(array(record(next.MEMORY_CONTEXT).recentTurns).at(-1)).toMatchObject(result.draft.story!);
    expectFullState(next, committed.state);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('缺少Variables时实际World请求读取完整基线，但只保存preview且不能Commit', async () => {
    const a = await setup();
    const ready = await a.repo.saveDraft(rerollStory(a.initial, a.draft.story!), a.initial.draftRevision);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const call = request(init);
      expect(call.stage).toBe('world'); expectFullState(call.context, a.state);
      expect(call.context.variablePending).toBe(true); expect(call.context.VARIABLE_RESULT).toBeUndefined();
      expect(call.context.PLAYER_ACTION).toBe(a.draft.userInput);
      return response(JSON.stringify(worldResult()));
    });
    const stage = new WorldStage(a.repo, new AiClient(fetcher)); resources.push(stage);
    const preview = await stage.generate({ ...a, draft: ready });
    expect(preview.world!.validation).toBe('preview'); expect(preview.stageStatus.world).toBe('preview');
    await expect(a.repo.commitTurn(submission(preview))).rejects.toThrow();
    expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
