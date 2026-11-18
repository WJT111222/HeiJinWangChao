import { describe, expect, it } from 'vitest';
import type { WorldbookEntry } from '../domain/worldbook/schema';
import { EMPTY_TIMED_STATE, evaluateTimed, logicalMessageCount, type TimedState } from '../domain/worldbook/timedEffects';
import { runWorldbookTrigger, type TriggerResult } from '../domain/worldbook/trigger';
import { entryFingerprint } from '../domain/worldbook/triggerSupport';

function entry(partial: Partial<WorldbookEntry>): WorldbookEntry {
  return {
    entryId: 'e', sourceUid: null, sourceKey: null, comment: '', content: '码头的设定', keys: ['码头'], secondaryKeys: [],
    selective: true, selectiveLogic: 0, constant: false, disabled: false, order: 100, position: 0, depth: 4, role: 0,
    outletName: '', probability: 100, useProbability: true, group: '', groupOverride: false, groupWeight: 100,
    useGroupScoring: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, excludeRecursion: false,
    preventRecursion: false, delayUntilRecursion: 0, sticky: null, cooldown: null, delay: null, ignoreBudget: false,
    triggers: [], inert: {}, extensions: {}, ...partial,
  };
}
function turn(entries: WorldbookEntry[], settledTurns: number, message: string, timedState: TimedState): TriggerResult {
  return runWorldbookTrigger({
    books: [{ bookId: 'book', versionId: 'v1', entries }], messages: [message], contextTokens: 100_000, storyRemainingTokens: 10_000,
    trigger: 'normal', messageCount: logicalMessageCount(settledTurns), timedState, seed: `turn-${settledTurns}`,
  });
}
const status = (r: TriggerResult) => `${r.decisions[0].status}:${r.decisions[0].reason}`;

describe('逻辑消息数', () => {
  it('每个成功结算的回合 +2，生成当前回合时算上本回合的玩家行动', () => {
    expect([0, 1, 3].map(logicalMessageCount)).toEqual([1, 3, 7]);
  });
});

describe('Sticky 与冷却跨回合推进（每回合只有正式结算才保存新状态）', () => {
  it('Sticky 4 + 冷却 2 的完整周期', () => {
    const e = [entry({ sticky: 4, cooldown: 2 })];
    let state = EMPTY_TIMED_STATE;
    const steps: string[] = [];
    // 回合 1（逻辑消息 1）：命中关键词，建立 Sticky [1, 5) 和冷却记录 [1, 3)
    let r = turn(e, 0, '去码头', state); steps.push(status(r)); state = r.nextTimedState;
    expect(state.sticky['book#e']).toMatchObject({ start: 1, end: 5, protected: false });
    // 回合 2（3）：没有关键词也因 Sticky 激活；冷却与 Sticky 同时存在时 Sticky 优先
    r = turn(e, 1, '去茶馆', state); steps.push(status(r)); state = r.nextTimedState;
    // 回合 3（5）：Sticky 到期，转入受保护的冷却 [5, 7)，有关键词也不激活
    r = turn(e, 2, '又去码头', state); steps.push(status(r)); state = r.nextTimedState;
    expect(state.cooldown['book#e']).toMatchObject({ start: 5, end: 7, protected: true });
    expect(state.sticky['book#e']).toBeUndefined();
    // 回合 4（7）：冷却到期，命中关键词重新激活
    r = turn(e, 3, '码头夜班', state); steps.push(status(r));
    expect(steps).toEqual(['activated:primary_match', 'activated:sticky', 'not_activated:cooldown', 'activated:primary_match']);
  });

  it('失败、取消、重试：不保存新状态，重跑同一回合得到完全相同的结果', () => {
    const e = [entry({ sticky: 3, probability: 50 })];
    const before = JSON.stringify(EMPTY_TIMED_STATE);
    const first = turn(e, 0, '码头', EMPTY_TIMED_STATE);
    const retry = turn(e, 0, '码头', EMPTY_TIMED_STATE);
    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    expect(JSON.stringify(EMPTY_TIMED_STATE)).toBe(before);
  });

  it('预览不修改传入的状态对象', () => {
    const e = [entry({ sticky: 4, cooldown: 2 })];
    const state = turn(e, 0, '码头', EMPTY_TIMED_STATE).nextTimedState;
    const snapshot = JSON.stringify(state);
    turn(e, 2, '码头', state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('回溯与条目变化', () => {
  const fp = (e: WorldbookEntry) => entryFingerprint('book', e);
  it('回到效果开始之前：普通记录清掉，受保护的冷却保留', () => {
    const e = entry({ sticky: 4, cooldown: 2 });
    const state: TimedState = {
      sticky: { 'book#e': { fingerprint: fp(e), start: 7, end: 11, protected: false } },
      cooldown: { 'book#e': { fingerprint: fp(e), start: 7, end: 9, protected: true } },
    };
    const result = evaluateTimed(state, [{ key: 'book#e', fingerprint: fp(e), sticky: 4, cooldown: 2, delay: null }], 5);
    expect(result.working.sticky).toEqual({});
    expect([...result.sticky]).toEqual([]);
    expect([...result.cooldown]).toEqual(['book#e']);
  });

  it('条目被修改后旧效果不再作用于它，到期后清掉；条目不再设置该效果时立即清掉', () => {
    const old = entry({ sticky: 4 });
    const state: TimedState = { sticky: { 'book#e': { fingerprint: fp(old), start: 1, end: 5, protected: false } }, cooldown: {} };
    const edited = entry({ sticky: 4, content: '改过的设定' });
    expect(status(turn([edited], 1, '茶馆', state))).toBe('not_activated:no_primary_match');
    expect(turn([edited], 1, '茶馆', state).nextTimedState.sticky['book#e']).toBeDefined();
    expect(turn([edited], 2, '茶馆', state).nextTimedState.sticky['book#e']).toBeUndefined();
    const unset = evaluateTimed(state, [{ key: 'book#e', fingerprint: fp(old), sticky: null, cooldown: null, delay: null }], 3);
    expect(unset.working.sticky).toEqual({});
  });
});

describe('延迟', () => {
  it('逻辑消息数小于延迟值时不激活', () => {
    const e = [entry({ delay: 4 })];
    expect([0, 1, 2].map((n) => status(turn(e, n, '码头', EMPTY_TIMED_STATE)))).toEqual(['not_activated:delay', 'not_activated:delay', 'activated:primary_match']);
  });
});
