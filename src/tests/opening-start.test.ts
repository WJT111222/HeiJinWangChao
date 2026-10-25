import { describe, expect, it } from 'vitest';
import { authorizeOpening } from '../ui/game/openingStart';
import { createTurnDraft } from '../domain/drafts';
import { worldState } from './fixtures/world';

function setup() {
  const state = worldState();
  const draft = createTurnDraft(state.saveId, state.revision, `opening-${state.saveId}`, 'opening', '观察周围');
  return { state, draft, authorization: authorizeOpening(state) };
}
describe('创角确认的临时单次开局授权', () => {
  it('同一授权仅首次匹配可消费，不能因重复调用或重新挂载复用', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim(state, draft)).toBe(true);
    expect(authorization.claim(state, draft)).toBe(false);
  });
  it('离开游戏撤销后不能因返回或配置更改再启动', () => {
    const { state, draft, authorization } = setup(); authorization.revoke();
    expect(authorization.claim(state, draft)).toBe(false);
  });
  it('其他存档不能领取授权，错误加载后原存档也需主动恢复', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim({ ...state, saveId: 'other' }, draft)).toBe(false);
    expect(authorization.claim(state, draft)).toBe(false);
  });
  it('正式版本发生变化时不能启动', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim({ ...state, revision: state.revision + 1 }, draft)).toBe(false);
  });
  it('草稿不同、缺失或已经改动时不能自动补发', () => {
    for (const change of ['missing', 'turn', 'revision', 'base', 'failed'] as const) {
      const { state, draft, authorization } = setup();
      const next = change === 'missing' ? undefined : { ...draft,
        ...(change === 'turn' ? { turnId: 'another' } : change === 'revision' ? { draftRevision: 1 }
          : change === 'base' ? { baseSaveRevision: 1 } : { stageStatus: { ...draft.stageStatus, story: 'failed' as const } }) };
      expect(authorization.claim(state, next)).toBe(false);
    }
  });
  it('已经开始过或已正式提交的回合不能自动启动', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim({ ...state, turnNumber: 1 }, draft)).toBe(false);
  });
  it('普通回合不能冒用创角授权', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim(state, { ...draft, turnKind: 'regular' })).toBe(false);
  });
  it('没有正文的已失败/取消尝试也不会重新获得收费授权', () => {
    const { state, draft, authorization } = setup();
    expect(authorization.claim(state, { ...draft, storyRevision: 1 })).toBe(false);
  });
});
