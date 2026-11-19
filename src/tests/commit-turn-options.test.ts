import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository, newTurnId } from '../services/storage/saveRepository';
import { completeDraft, submission } from './fixtures/turn';
import { worldState, worldResult, npcUpdate } from './fixtures/world';
import { reserveStageSession, withBrowserLock, type HeldStage } from '../workflows/stageGuard';

/**
 * 阶段 C2 接口准备：commitTurn 的可选参数（预生成 nextTurnId、复用已持有的会话与锁）。
 * 省略新参数时行为必须与原来完全相同；错误、失效、其他存档的持有凭据都不能复用。
 */
let repo: SaveRepository, factory: IDBFactory;
beforeEach(async () => {
  factory = new IDBFactory();
  repo = await SaveRepository.open('commit-options', factory);
  await repo.create(worldState());
});
afterEach(() => repo.close());

async function rawReceipts(): Promise<Array<{ turnId: string; nextTurnId: string }>> {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = factory.open('commit-options'); r.onsuccess = () => resolve(r.result); });
  const all = await new Promise<Array<{ turnId: string; nextTurnId: string }>>((resolve) => {
    const r = db.transaction('turnReceipts', 'readonly').objectStore('turnReceipts').getAll(); r.onsuccess = () => resolve(r.result);
  });
  db.close();
  return all;
}
async function unchanged(run: () => Promise<unknown>, code: string) {
  const before = await repo.loadGame('save-a');
  const receipts = await rawReceipts();
  await expect(run()).rejects.toMatchObject({ code });
  expect(await repo.loadGame('save-a')).toEqual(before);
  expect(await rawReceipts()).toEqual(receipts);
}

describe('commitTurn：省略新参数时行为不变', () => {
  it('不传 options 与传空对象：都由仓库生成 turn-UUID 格式的下一回合 ID，并写入回执', async () => {
    const draft = await completeDraft(repo, { world: worldResult([npcUpdate()]) });
    const result = await repo.commitTurn(submission(draft));
    expect(result.replayed).toBe(false);
    expect(result.draft.turnId).toMatch(/^turn-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await rawReceipts()).toEqual([expect.objectContaining({ turnId: draft.turnId, nextTurnId: result.draft.turnId })]);
    const next = await completeDraft(repo);
    const second = await repo.commitTurn(submission(next), {});
    expect(second.draft.turnId).toMatch(/^turn-/);
    expect(second.draft.turnId).not.toBe(result.draft.turnId);
  });

  it('不传 options 时仍自己占用会话：其他会话持有时照旧报 STORY_BUSY', async () => {
    const draft = await completeDraft(repo);
    const other = reserveStageSession('save-a');
    try { await unchanged(() => repo.commitTurn(submission(draft)), 'STORY_BUSY'); }
    finally { other.release(); }
    expect((await repo.commitTurn(submission(draft))).replayed).toBe(false);
  });
});

describe('commitTurn：预生成的 nextTurnId', () => {
  it('写入回执与下一份草稿，与仓库自己生成的格式相同', async () => {
    const draft = await completeDraft(repo);
    const id = newTurnId();
    const result = await repo.commitTurn(submission(draft), { nextTurnId: id });
    expect(result.draft.turnId).toBe(id);
    expect(await rawReceipts()).toEqual([expect.objectContaining({ turnId: draft.turnId, nextTurnId: id })]);
    expect((await repo.loadDraft('save-a'))?.turnId).toBe(id);
  });

  it('格式不对（不是 turn- 加 UUID v4）：拒绝，不写入', async () => {
    const draft = await completeDraft(repo);
    for (const bad of ['turn-1', 'turn-ABCDEFAB-1234-4123-8123-123456789012', `x${newTurnId()}`, 'turn-12345678-1234-1123-8123-123456789012']) {
      await unchanged(() => repo.commitTurn(submission(draft), { nextTurnId: bad }), 'INVALID_NEXT_TURN_ID');
    }
  });

  it('与本回合或已提交的回合重复：报 DUPLICATE_TURN，不写入', async () => {
    const first = await completeDraft(repo);
    const committed = await repo.commitTurn(submission(first));
    const second = await completeDraft(repo);
    expect(second.turnId).toBe(committed.draft.turnId);
    await unchanged(() => repo.commitTurn(submission(second), { nextTurnId: second.turnId }), 'DUPLICATE_TURN');
  });

  it('重复提交同一内容（走重放分支）：返回第一次的下一回合 ID，忽略新传入的值', async () => {
    const draft = await completeDraft(repo);
    const firstId = newTurnId();
    const first = await repo.commitTurn(submission(draft), { nextTurnId: firstId });
    const replay = await repo.commitTurn(submission(draft), { nextTurnId: newTurnId() });
    expect(replay.replayed).toBe(true);
    expect(replay.draft.turnId).toBe(firstId);
    expect(first.draft.turnId).toBe(firstId);
    expect(await rawReceipts()).toHaveLength(1);
  });
});

describe('commitTurn：复用已持有的会话与锁', () => {
  it('在同一会话、同一把锁内提交：不重复占用，不报 STORY_BUSY', async () => {
    const draft = await completeDraft(repo);
    const session = reserveStageSession('save-a');
    try {
      const result = await withBrowserLock('save-a', (scope) => repo.commitTurn(submission(draft), { held: session.hold(scope), nextTurnId: newTurnId() }));
      expect(result.replayed).toBe(false);
    } finally { session.release(); }
    // 会话已释放，之后的普通提交照常
    const next = await completeDraft(repo);
    expect((await repo.commitTurn(submission(next))).replayed).toBe(false);
  });

  it('伪造的凭据（任意对象）：拒绝，不写入', async () => {
    const draft = await completeDraft(repo);
    const session = reserveStageSession('save-a');
    try {
      await withBrowserLock('save-a', async () => {
        await unchanged(() => repo.commitTurn(submission(draft), { held: {} as HeldStage }), 'LOCK_SCOPE_INVALID');
        await unchanged(() => repo.commitTurn(submission(draft), { held: { saveId: 'save-a' } as unknown as HeldStage }), 'LOCK_SCOPE_INVALID');
      });
    } finally { session.release(); }
  });

  it('失效的凭据：锁回调已结束，或会话已释放后，都不能再用', async () => {
    const draft = await completeDraft(repo);
    const session = reserveStageSession('save-a');
    let escaped: HeldStage | undefined;
    await withBrowserLock('save-a', async (scope) => { escaped = session.hold(scope); });
    try { await unchanged(() => repo.commitTurn(submission(draft), { held: escaped! }), 'LOCK_SCOPE_INVALID'); }
    finally { session.release(); }
    const again = reserveStageSession('save-a');
    try {
      await withBrowserLock('save-a', async (scope) => {
        const held = again.hold(scope);
        again.release();
        await unchanged(() => repo.commitTurn(submission(draft), { held }), 'LOCK_SCOPE_INVALID');
      });
    } finally { again.release(); }
    // 旧会话的凭据在新会话里也无效
    const old = reserveStageSession('save-a');
    let oldHeld: HeldStage | undefined;
    await withBrowserLock('save-a', async (scope) => { oldHeld = old.hold(scope); });
    old.release();
    const fresh = reserveStageSession('save-a');
    try {
      await withBrowserLock('save-a', async () => { await unchanged(() => repo.commitTurn(submission(draft), { held: oldHeld! }), 'LOCK_SCOPE_INVALID'); });
    } finally { fresh.release(); }
  });

  it('其他存档的凭据：签发时就拒绝；冒用其他存档的锁作用域也拒绝', async () => {
    const draft = await completeDraft(repo);
    const sessionB = reserveStageSession('save-b');
    try {
      await withBrowserLock('save-b', async (scopeB) => {
        const heldB = sessionB.hold(scopeB);
        await unchanged(() => repo.commitTurn(submission(draft), { held: heldB }), 'LOCK_SCOPE_INVALID');
        const sessionA = reserveStageSession('save-a');
        try { expect(() => sessionA.hold(scopeB)).toThrow(expect.objectContaining({ code: 'LOCK_SCOPE_INVALID' })); }
        finally { sessionA.release(); }
      });
    } finally { sessionB.release(); }
  });

  it('凭据只能在锁回调内签发', async () => {
    const session = reserveStageSession('save-a');
    try { expect(() => session.hold({})).toThrow(expect.objectContaining({ code: 'LOCK_SCOPE_INVALID' })); }
    finally { session.release(); }
  });
});
