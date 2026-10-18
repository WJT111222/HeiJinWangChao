import { describe, expect, it } from 'vitest';
import { TurnDraftSchema, createTurnDraft, rerollStory, validateDraftUpdate } from '../domain/drafts';
import { commitCommands } from '../domain/commands';
import { GameTimeSchema, IdSchema } from '../domain/common';
import { game, purchase, story } from './fixtures/game';

function withCandidates() {
  const draft = rerollStory(createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入'), story);
  return TurnDraftSchema.parse({ ...draft,
    variables: { storyRevision: 1, candidateRevision: 1, validation: 'validated', result: { commands: [purchase()], rejectedSuggestions: [], unresolved: [] } },
    world: { storyRevision: 1, candidateRevision: 1, basedOnVariableRevision: 1, validation: 'validated',
      result: { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] } },
    stageStatus: { story: 'ready', variables: 'ready', world: 'ready' },
  });
}
describe('候选来源与版本控制', () => {
  it('正文重新 Roll 清除所有候选并保留旧快照和失败记录', () => {
    const old = withCandidates();
    old.failures.push({ stage: 'world', attempt: 1, storyRevision: 1, errorCode: 'PREVIOUS_TIMEOUT', retryable: true });
    const next = rerollStory(old, { ...story, narrative: '新正文' });
    expect(next.storyRevision).toBe(2);
    expect(next.variables).toBeUndefined(); expect(next.world).toBeUndefined();
    expect(next.failures).toEqual(old.failures); expect(old.variables).toBeDefined();
    expect(() => validateDraftUpdate(old, next)).not.toThrow();
  });
  it('修改变量候选必须同时清除依赖它的世界候选', () => {
    const old = withCandidates();
    const next = { ...old, draftRevision: old.draftRevision + 1,
      variables: { ...old.variables!, candidateRevision: 2 } };
    expect(() => validateDraftUpdate(old, next)).toThrow('世界候选必须失效');
    const invalidated = TurnDraftSchema.parse({ ...next, world: undefined, stageStatus: { ...next.stageStatus, world: 'pending' } });
    expect(() => validateDraftUpdate(old, invalidated)).not.toThrow();
  });
  it('世界候选不能绑定旧变量版本', () => {
    const draft = withCandidates();
    expect(TurnDraftSchema.safeParse({ ...draft, world: { ...draft.world, basedOnVariableRevision: 0 } }).success).toBe(false);
  });
  it('同正文版本不能偷换正文或改变本次运行开关', () => {
    const old = withCandidates();
    expect(() => validateDraftUpdate(old, { ...old, draftRevision: old.draftRevision + 1,
      story: { ...story, narrative: '偷换正文' } })).toThrow('新版本');
    expect(() => validateDraftUpdate(old, { ...old, draftRevision: old.draftRevision + 1, useWorldStage: false })).toThrow('运行配置');
  });
  it('失败、跳过或未验证的候选不能冒充 ready', () => {
    const draft = withCandidates();
    expect(TurnDraftSchema.safeParse({ ...draft, stageStatus: { ...draft.stageStatus, variables: 'failed' } }).success).toBe(false);
    expect(TurnDraftSchema.safeParse({ ...draft, useVariableStage: false }).success).toBe(false);
    expect(TurnDraftSchema.safeParse({ ...draft, variables: { ...draft.variables, validation: 'preview' } }).success).toBe(false);
  });
  it('空操作不推进版本，部分重放只执行新命令', () => {
    const state = game(); expect(commitCommands(state, 'turn-a', 0, [])).toEqual(state);
    const once = commitCommands(state, 'turn-a', 0, [purchase()]);
    const twice = commitCommands(once, 'turn-a', 1, [purchase(), purchase('second', 1000, 'second-shirt')]);
    expect(twice.economy.cash).toBe(6500); expect(twice.appliedCommands).toHaveLength(2);
  });
  it.each(['2026-02-30T12:00:00+08:00', '2026-10-18T12:00:00', 'yesterday'])('拒绝无效或无时区时间 %s', (time) => {
    expect(GameTimeSchema.safeParse(time).success).toBe(false);
  });
  it.each(['__proto__', 'constructor', 'prototype', 'bad/id'])('拒绝不安全的实体键 %s', (id) => {
    expect(IdSchema.safeParse(id).success).toBe(false);
  });
});
