import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TurnDraftSchema, rerollStory } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { reserveStageSession } from '../workflows/stageGuard';
import { completeDraft } from './fixtures/turn';
import { worldState, worldNarrative } from './fixtures/world';

let repo: SaveRepository;
beforeEach(async () => {
  repo = await SaveRepository.open('pr158-repository-acceptance', new IDBFactory());
  await repo.create(worldState());
  await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
});
afterEach(() => { repo.close(); vi.unstubAllGlobals(); });
async function stopped() {
  const waiting = (await repo.loadDraft('save-a'))!;
  const bound = await repo.bindTurnAction(waiting, '隔离测试原行动', true, true);
  return repo.saveDraft(TurnDraftSchema.parse({ ...bound, draftRevision: bound.draftRevision + 1,
    stageStatus: { ...bound.stageStatus, story: 'failed' },
    failures: [{ stage: 'story', attempt: 1, storyRevision: 0, errorCode: 'auth', retryable: false }],
  }), bound.draftRevision, undefined, bound);
}

describe('PR158 真仓库边界验收', () => {
  it('过期正式基线与旧草稿拒绝且无写入；新绑定后迟到旧正文不能复活', async () => {
    const failed = await stopped(), before = await repo.loadGame('save-a');
    const staleBase = TurnDraftSchema.parse({ ...failed, baseSaveRevision: failed.baseSaveRevision - 1 });
    await expect(repo.bindTurnAction(staleBase, '不能提交的行动', true, true)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadGame('save-a')).toEqual(before);
    const rebound = await repo.bindTurnAction(failed, '重新填写的行动', true, true);
    expect(rebound).toMatchObject({ userInput: '重新填写的行动', failures: [], storyRevision: 0, executionRevision: 0 });
    const current = await repo.loadGame('save-a');
    expect(current.state).toEqual(before.state);
    await expect(repo.bindTurnAction(failed, '重复使用旧草稿', true, true)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(repo.saveDraft(rerollStory(failed, { turnKind: 'regular', narrative: worldNarrative,
      summary: '隔离的迟到结果', variableGuide: [] }), failed.draftRevision, undefined, failed))
      .rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadGame('save-a')).toEqual(current);
  });
  it('同页工作流会话仍运行时拒绝重新绑定并保留正式状态和草稿', async () => {
    const failed = await stopped(), before = await repo.loadGame('save-a');
    const session = reserveStageSession('save-a');
    try {
      await expect(repo.bindTurnAction(failed, '不应覆盖活动请求', true, true)).rejects.toMatchObject({ code: 'STORY_BUSY' });
      expect(await repo.loadGame('save-a')).toEqual(before);
    } finally { session.release(); }
  });
  it('Web Lock 被其他页面占用时，仓库在事务写入前拒绝', async () => {
    const failed = await stopped(), before = await repo.loadGame('save-a');
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null));
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(repo.bindTurnAction(failed, '不应覆盖他页请求', true, true)).rejects.toMatchObject({ code: 'STORY_BUSY' });
    expect(request).toHaveBeenCalledWith('heijin.turn:save-a', { ifAvailable: true }, expect.any(Function));
    expect(await repo.loadGame('save-a')).toEqual(before);
  });
});
