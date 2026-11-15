import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TurnDraftSchema } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { StoryStage, storyError } from '../workflows/storyStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { reserveStageSession, withBrowserLock } from '../workflows/stageGuard';
import { completeDraft } from './fixtures/turn';
import { worldState } from './fixtures/world';

let repo: SaveRepository;
beforeEach(async () => {
  repo = await SaveRepository.open('story-concurrency', new IDBFactory());
  await repo.create(worldState());
  await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
});
afterEach(() => { repo.close(); vi.unstubAllGlobals(); });
async function bound(failed: boolean) {
  const waiting = (await repo.loadDraft('save-a'))!;
  const draft = await repo.bindTurnAction(waiting, '保留玩家原行动', true, true);
  return failed ? repo.saveDraft(TurnDraftSchema.parse({ ...draft, draftRevision: draft.draftRevision + 1,
    stageStatus: { ...draft.stageStatus, story: 'failed' },
    failures: [{ stage: 'story', attempt: 1, storyRevision: 0, errorCode: 'authorization', retryable: false }],
  }), draft.draftRevision, undefined, draft) : draft;
}
function browser(locks?: unknown) {
  vi.stubGlobal('window', {});
  vi.stubGlobal('navigator', { locks });
}
function input() {
  const channel = newChannel(), config = defaultAiConfig();
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' };
  const values = new Map<string, string>(), storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); },
  };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-only');
  return { config, vault, settings: defaultSettings(), orderPreferences: {} };
}

describe('付费前跨标签互斥与保守降级', () => {
  it.each([false, true])('浏览器无锁时不重绑 pending/failed=%s，正式状态与草稿不变', async failed => {
    const draft = await bound(failed), before = await repo.loadGame('save-a'); browser();
    const failure = await repo.bindTurnAction(draft, '不能丢失的编辑', true, true).catch(error => error);
    expect(failure).toMatchObject({ code: 'concurrency_unavailable' });
    expect(storyError(failure)).toContain('Web Locks');
    expect(await repo.loadGame('save-a')).toEqual(before);
  });
  it.each([false, true])('无锁时手动 Story 和 Coordinator 均在请求及写草稿前拒绝，failed=%s', async failed => {
    const draft = await bound(failed), before = await repo.loadGame('save-a'), options = input();
    const transport = vi.fn(async () => new Response('', { status: 401 })), client = new AiClient(transport);
    browser();
    for (const runner of [new StoryStage(repo, client), new TurnCoordinator(repo, client)]) {
      await expect(runner.generate({ ...options, draft })).rejects.toMatchObject({ code: 'concurrency_unavailable' });
      expect(transport).not.toHaveBeenCalled(); expect(await repo.loadGame('save-a')).toEqual(before);
    }
  });
  it('已有 Web Lock 时手动 Story 在请求前拒绝', async () => {
    const draft = await bound(true), before = await repo.loadGame('save-a');
    const transport = vi.fn(async () => new Response('', { status: 401 }));
    const request = vi.fn(async (_name, _options, callback) => callback(null)); browser({ request });
    await expect(new StoryStage(repo, new AiClient(transport)).generate({ ...input(), draft })).rejects.toMatchObject({ code: 'STORY_BUSY' });
    expect(transport).not.toHaveBeenCalled(); expect(await repo.loadGame('save-a')).toEqual(before);
  });
  it('浏览器拒绝锁 API 时不降级执行，不丢失输入', async () => {
    const draft = await bound(true), before = await repo.loadGame('save-a');
    browser({ request: vi.fn(async () => { throw new DOMException('private detail', 'SecurityError'); }) });
    const failure = await repo.bindTurnAction(draft, '保留未发送输入', true, true).catch(error => error);
    expect(failure).toMatchObject({ code: 'concurrency_unavailable' });
    expect(storyError(failure)).not.toContain('private detail');
    expect(await repo.loadGame('save-a')).toEqual(before);
  });
  it('整轮锁内阶段复用本次有效所有权，释放后不可复用，伪造作用域也无效', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback({ name: 'heijin.turn:save-a' })); browser({ request });
    const session = reserveStageSession('save-a'), work = vi.fn(async () => 'done');
    let expired: ReturnType<typeof session.guard> | undefined;
    try {
      await withBrowserLock('save-a', async scope => {
        expired = session.guard(scope);
        await expect(expired.run('save-a', work)).resolves.toBe('done');
      }, { required: true });
      expect(request).toHaveBeenCalledTimes(1);
      await expect(expired!.run('save-a', work)).rejects.toMatchObject({ code: 'concurrency_unavailable' });
      await expect(session.guard({}).run('save-a', work)).rejects.toMatchObject({ code: 'concurrency_unavailable' });
      expect(work).toHaveBeenCalledTimes(1);
    } finally { session.release(); }
  });
});
