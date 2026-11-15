import { describe, expect, it } from 'vitest';
import { awaitingPlayerAction, rebindableAfterStoryStop } from '../domain/turnCommit';
import { createTurnDraft, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { game, story } from './fixtures/game';

function regular(userInput = '去码头找老周', patch: Partial<TurnDraft> = {}) {
  const state = game(); state.turnNumber = 3; state.revision = 3;
  const draft = TurnDraftSchema.parse({ ...createTurnDraft(state.saveId, state.revision, 'turn-3', 'regular', userInput), ...patch });
  return { state, draft };
}
const failedStory = (draft: TurnDraft) => TurnDraftSchema.parse({ ...draft, draftRevision: draft.draftRevision + 1,
  stageStatus: { ...draft.stageStatus, story: 'failed' },
  failures: [{ stage: 'story', attempt: 1, storyRevision: 0, errorCode: 'auth', retryable: false }] });

describe('正文失败或取消后可重新绑定行动', () => {
  it('正文失败、尚无任何候选：可重新绑定（原行动放回输入框）', () => {
    const { state, draft } = regular();
    expect(rebindableAfterStoryStop(state, failedStory(draft))).toBe(true);
  });
  it('已绑定但正文被取消、仍待生成：同样可重新绑定', () => {
    const { state, draft } = regular();
    expect(rebindableAfterStoryStop(state, draft)).toBe(true);
  });
  it('空待输入回合仍走原来的待输入判定，不算重新绑定', () => {
    const { state, draft } = regular('');
    expect(awaitingPlayerAction(state, draft)).toBe(true);
    expect(rebindableAfterStoryStop(state, draft)).toBe(false);
  });
  it('已有正文、变量或世界候选，或已开始执行，都不能重新绑定', () => {
    const { state, draft } = regular();
    const withStory = TurnDraftSchema.parse({ ...draft, story: { ...story, turnKind: 'regular' }, storyRevision: 1, stageStatus: { ...draft.stageStatus, story: 'ready' } });
    expect(rebindableAfterStoryStop(state, withStory)).toBe(false);
    expect(rebindableAfterStoryStop(state, TurnDraftSchema.parse({ ...draft, executionRevision: 1 }))).toBe(false);
  });
  it('开局回合、草稿版本过期或第 0 回合都不能重新绑定', () => {
    const { state, draft } = regular();
    expect(rebindableAfterStoryStop(state, TurnDraftSchema.parse({ ...draft, turnKind: 'opening' }))).toBe(false);
    expect(rebindableAfterStoryStop(state, TurnDraftSchema.parse({ ...draft, baseSaveRevision: state.revision - 1 }))).toBe(false);
    expect(rebindableAfterStoryStop({ ...state, turnNumber: 0 }, draft)).toBe(false);
    expect(rebindableAfterStoryStop(state, undefined)).toBe(false);
  });
});
