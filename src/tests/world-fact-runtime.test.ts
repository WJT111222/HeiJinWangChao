import { sceneWorldSettings as defaultSettings, sceneWorldDraft as createTurnDraft } from './fixtures/stageScope';
import { saveFixtureStory } from './fixtures/turn';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldStage } from '../workflows/worldStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';

import { schoolContext, schoolResult, schoolTask, syntheticSchoolBatch } from './fixtures/worldChineseFact';
import { originalSchoolContext } from './fixtures/worldSchoolOriginalContext';

let repo: SaveRepository, draft: TurnDraft;
const stages: WorldStage[] = [];
async function seed(context = schoolContext()) {
  repo = await SaveRepository.open('school-fact-test', new IDBFactory());
  await repo.create(context.state);
  const initial = createTurnDraft('save-a', 0, context.draft.turnId, context.draft.turnKind, '');
  await repo.saveDraft(initial, null);
  await saveFixtureStory(repo,rerollStory(initial, context.draft.story!), 0);
  draft = await repo.saveDraft({ ...context.draft, draftRevision: 2 }, 1);
}
beforeEach(async () => { await seed(); });
afterEach(() => { stages.splice(0).forEach(stage => stage.dispose()); repo.close(); });
function options(protocol: Protocol = 'openai') {
  const config = defaultAiConfig(), channel = { ...newChannel(protocol), defaultModel: 'mock-world' };
  config.channels = [channel];
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: '' };
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'mock-school-key');
  return { config, vault, settings: defaultSettings() };
}
function wire(value: unknown, protocol: Protocol = 'openai') {
  const text = JSON.stringify(value);
  return Response.json(protocol === 'openai' ? { choices: [{ message: { content: text }, finish_reason: 'stop' }] }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
    : { content: [{ type: 'text', text }], stop_reason: 'end_turn' });
}
function runner(fetcher: typeof fetch) {
  const stage = new WorldStage(repo, new AiClient(fetcher)); stages.push(stage); return stage;
}

it.each(['openai', 'gemini', 'anthropic'] as const)('%s 实际 Runtime→WorldStage→IDB 保存真实证据的任务及合成事件候选，不提前提交', async protocol => {
  const before = await repo.load('save-a'), response = syntheticSchoolBatch();
  const fetcher = vi.fn<typeof fetch>(async () => wire(response, protocol));
  const saved = await runner(fetcher).generate({ ...options(protocol), draft });
  expect(saved.world).toMatchObject({ validation: 'validated', result: { taskCommands: [schoolTask()] } });
  expect(saved.world!.result.eventCommands).toHaveLength(2);
  expect(saved.stageStatus.world).toBe('ready');
  expect(saved.story).toEqual(draft.story);
  expect(saved.variables).toEqual(draft.variables);
  expect(await repo.loadDraft('save-a')).toEqual(saved);
  expect(await repo.load('save-a')).toEqual(before);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('不存在的行动者被跳过；摘要保留安全位置和原因，原状态不变', async () => {
  const before = await repo.load('save-a'), command=schoolTask();
  command.task.actorRef.id='missing-organization';
  const fetcher = vi.fn<typeof fetch>(async () => wire(schoolResult(command)));
  const saved = await runner(fetcher).generate({ ...options(), draft });
  const report = saved.world?.result.settlement;
  expect(report).toMatchObject({accepted:0,skipped:[{group:'taskCommands',groupIndex:0,commandIndex:0,field:'actorRef',reason:'permission'}]});
  expect(JSON.stringify(report)).not.toMatch(/学校|missing-organization|mock-school-key/);
  expect(saved.story).toEqual(draft.story);
  expect(saved.variables).toEqual(draft.variables);
  expect(saved.world?.result.taskCommands).toEqual([]);
  expect(await repo.load('save-a')).toEqual(before);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('原始响应命令在新协议容器中通过Runtime（原文件不变），保留上游与正式存档边界',async()=>{
  repo.close();await seed(originalSchoolContext());
  const before=await repo.load('save-a'),fetcher=vi.fn<typeof fetch>(async()=>wire(originalSchoolContext().response));
  const ready=await runner(fetcher).generate({...options(),draft});
  expect(ready.world?.result.eventCommands).toHaveLength(2);expect(ready.stageStatus.world).toBe('ready');
  expect(await repo.load('save-a')).toEqual(before);expect(fetcher).toHaveBeenCalledTimes(1);
});
