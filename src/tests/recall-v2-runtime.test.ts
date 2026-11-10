import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { VariableStage } from '../workflows/variableStage';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { array, record, string } from '../services/ai/protocols';
import { stageResponses } from '../services/ai/stageResponses';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { recallV2Fixture } from './fixtures/recallV2';
import { expectWorldWithNpcProjection, sentContext } from './fixtures/contextAssertions';
import { variableReply } from './fixtures/variableReply';
import { submission } from './fixtures/turn';
import { worldResult } from './fixtures/world';

const resources: { dispose: () => void }[] = [];
afterEach(() => { resources.splice(0).forEach(resource => resource.dispose()); stageResponses.clear(); });
async function setup(action?: string) {
  const a = recallV2Fixture(), factory = new IDBFactory();
  if (action) a.draft.userInput = action;
  const repo = await SaveRepository.open('recall-v2-runtime', factory); resources.push({ dispose: () => repo.close() });
  // 模拟重载已有V6存档；create只允许全新空历史，不能冒充已提交八轮的新游戏。
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('recall-v2-runtime');
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

describe('200回合共享召回：真实Coordinator、Runtime与Mock网络', () => {
  it('三阶段实际请求收到旧史，候选保存后原子提交、重载、幂等重放仅发生一次', async () => {
    const a = await setup(), calls: ReturnType<typeof request>[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const call = request(init); calls.push(call);
      const draft = (await a.repo.loadDraft(a.state.saveId))!;
      const recalled = array(record(call.context.MEMORY_CONTEXT).recalledTurns).map(record);
      expect(recalled.map(entry => entry.turnId)).toEqual(expect.arrayContaining(['history-8', 'history-25', 'history-60', 'history-130', 'history-140']));
      expect(recalled.every(entry => entry.source === 'journal' && entry.status === 'committed')).toBe(true);
      expectWorldWithNpcProjection(call.context, call.stage === 'world' ? projectTurn(a.state, draft) : a.state, 200);
      expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
      if (call.stage === 'story') {
        const story = a.draft.story!;
        const text = `<thinking>根据原文保持连续性。</thinking><正文>${story.narrative}</正文><短期记忆>${story.summary}</短期记忆><变量规划>${JSON.stringify(story.variableGuide)}</变量规划>`;
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }
      expect(call.context.STORY_RESULT).toMatchObject(draft.story!);
      if (call.stage === 'variables') return response(variableReply(a.draft.variables!.result));
      expect(call.context.variablePending).toBe(false);
      expect(call.context.VARIABLE_RESULT).toEqual(draft.variables);
      expect(record(record(call.context.SAVE_STATE).economy).cash).toBe(7000);
      expect(recalled.map(entry => entry.turnId)).toEqual(expect.arrayContaining(['history-30', 'history-90', 'history-160']));
      expect(record(call.context.SAVE_STATE).revision).toBe(200);
      const world = worldResult([{ type: 'RecordHistory', commandId: 'current-history', evidence: '本轮谈话',
        entry: { id: 'new-history', title: '本轮谈话', summary: '双方讨论旧约的下一步', knowledgeKind: 'reported',
          sourceRef: { kind: 'npc', id: 'zhang' }, actorRefs: [], relatedEntryIds: ['plan-change'] } }]);
      world.eventCommands.push({ type: 'SaveEvent', commandId: 'defer-escort', evidence: '仍在等待摆渡人，延后评估',
        event: { ...a.state.events.escort, status: 'blocked', estimatedEndAt: '2026-10-18T09:00:00+08:00',
          blockers: ['等待摆渡人'], sourceTurnIds: [...a.state.events.escort.sourceTurnIds, draft.turnId] } });
      return response(JSON.stringify(world));
    });
    const runner = new TurnCoordinator(a.repo, new AiClient(fetcher)); resources.push(runner);
    const outcome = await runner.generate({ ...a, draft: a.initial });
    expect(outcome.status).toBe('complete');
    expect(calls.map(call => call.stage)).toEqual(['story', 'variables', 'world']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
    expect((await a.repo.loadDraft(a.state.saveId))!.story).toEqual(outcome.draft.story);
    const committed = await a.repo.commitTurn(submission(outcome.draft, '下一步'));
    expect(committed.state.revision).toBe(201); expect(committed.state.journal).toHaveLength(201);
    expect(committed.state.journal.slice(0, 200)).toEqual(a.state.journal);
    expect(committed.state.schemaVersion).toBe(9); expect(committed.state.economy.cash).toBe(7000);
    expect(committed.state.economy.debts).toEqual(a.state.economy.debts);
    expect(committed.state.npc).toEqual(a.state.npc);
    const second = await SaveRepository.open('recall-v2-runtime', a.factory); resources.push({ dispose: () => second.close() });
    expect((await second.loadGame(a.state.saveId)).state).toEqual(committed.state);
    expect((await second.commitTurn(submission(outcome.draft, '下一步'))).replayed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const next = sentContext((await composePrompt({ state: committed.state, settings: a.settings, stage: 'story', mode: 'regular', userInput: '下一步' })).messages);
    expect(array(record(next.MEMORY_CONTEXT).recentTurns).at(-1)).toMatchObject(outcome.draft.story!);
  });

  it.each(['missing', 'preview'] as const)('World实际请求忽略%s Variables的状态与检索线索，不能提交', async validation => {
    const a = await setup('吃饭。'), initial = a.initial;
    let ready = await a.repo.saveDraft(rerollStory(initial, { ...a.draft.story!, narrative: '经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。', variableGuide: [] }), initial.draftRevision);
    if (validation === 'preview') ready = await a.repo.saveDraft({
      ...ready, draftRevision: ready.draftRevision + 1,
      variables: { ...a.draft.variables!, validation: 'preview', result: { ...a.draft.variables!.result, commands: [
        ...a.draft.variables!.result.commands,
        { type: 'UpdateNpc', commandId: 'unvalidated-reference', npcId: 'zhang', expectedRevision: 200, changes: { healthText: '候选状态' }, evidence: '未验证' },
      ] } }, stageStatus: { ...ready.stageStatus, variables: 'preview' },
    }, ready.draftRevision);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const call = request(init);
      expectWorldWithNpcProjection(call.context, a.state);
      expect(call.context.variablePending).toBe(true); expect(call.context.VARIABLE_RESULT).toBeUndefined();
      const recalled = array(record(call.context.MEMORY_CONTEXT).recalledTurns).map(entry => record(entry).turnId);
      expect(recalled).not.toContain('history-8');
      expect(recalled).toEqual(expect.arrayContaining(['history-30', 'history-90', 'history-160']));
      return response(JSON.stringify(worldResult()));
    });
    const stage = new WorldStage(a.repo, new AiClient(fetcher)); resources.push(stage);
    const result = await stage.generate({ ...a, draft: ready });
    expect(result.world!.validation).toBe('preview');
    await expect(a.repo.commitTurn(submission(result))).rejects.toThrow();
    expect(await a.repo.load(a.state.saveId)).toEqual(a.state); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('重Roll后真实Variables请求仅使用当前候选，旧候选不成为永久历史', async () => {
    const a = await setup('吃饭。'), initial = a.initial;
    const old = await a.repo.saveDraft(rerollStory(initial, { ...a.draft.story!, narrative: `${a.draft.story!.narrative}旧候选独有标记。` }), initial.draftRevision);
    const fresh = await a.repo.saveDraft(rerollStory(old, { ...a.draft.story!, narrative: '经过十分钟，主角完成用餐。主角已经用现金支付30元吃饭。', variableGuide: [] }), old.draftRevision);
    const before = structuredClone(fresh);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const call = request(init);
      expect(JSON.stringify(call.context)).not.toContain('旧候选独有标记');
      expect(record(call.context.STORY_RESULT).narrative).toBe(fresh.story!.narrative);
      expect(record(call.context.MEMORY_CONTEXT).recalledTurns).toEqual([]);
      return response(variableReply(a.draft.variables!.result));
    });
    const stage = new VariableStage(a.repo, new AiClient(fetcher)); resources.push(stage);
    const result = await stage.generate({ ...a, draft: fresh });
    expect(result.variables!.validation).toBe('validated');
    expect(fresh).toEqual(before); expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
