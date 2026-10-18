import { describe, expect, it } from 'vitest';
import { TurnDraftSchema, createTurnDraft, rerollStory, startStageAttempt, validateDraftUpdate } from '../domain/drafts';
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
    expect(() => validateDraftUpdate(draft, { ...draft, draftRevision: draft.draftRevision + 1, useVariableStage: false })).toThrow('运行配置');
    expect(TurnDraftSchema.safeParse({ ...draft, variables: { ...draft.variables, validation: 'preview' } }).success).toBe(false);
  });
  it('两个阶段关闭反复 Roll 后，显式补算可重新开启并保留选定正文及版本', () => {
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入', false, false);
    const selected = rerollStory(rerollStory(initial, story), { ...story, narrative: '满意的正文' });
    const attempt = startStageAttempt(selected, ['variables', 'world'], { useVariableStage: true, useWorldStage: true });
    expect(attempt.story).toEqual(selected.story); expect(attempt.storyRevision).toBe(2);
    expect(attempt.executionRevision).toBe(1); expect(attempt.stageStatus).toEqual({ story: 'ready', variables: 'pending', world: 'pending' });
    expect(() => validateDraftUpdate(selected, attempt)).not.toThrow();
    expect(selected.useVariableStage).toBe(false); expect(selected.useWorldStage).toBe(false);
    expect(selected.executionRevision).toBe(0);
  });
  it('仅补算变量保留正文，独立关闭世界并清除旧变量/世界候选', () => {
    const selected = withCandidates();
    const attempt = startStageAttempt(selected, ['variables'], { useVariableStage: true, useWorldStage: false });
    expect(attempt.story).toEqual(selected.story); expect(attempt.storyRevision).toBe(selected.storyRevision);
    expect(attempt.variables).toBeUndefined(); expect(attempt.world).toBeUndefined();
    expect(attempt.stageStatus.variables).toBe('pending'); expect(attempt.stageStatus.world).toBe('skipped');
    expect(attempt.stageRequestRevisions.world).toBeGreaterThan(selected.stageRequestRevisions.world);
    expect(() => validateDraftUpdate(selected, attempt)).not.toThrow();
    // 原来的请求快照及配置不变；旧世界响应无法匹配新请求版本。
    expect(selected.useWorldStage).toBe(true); expect(selected.world).toBeDefined();
    expect(TurnDraftSchema.safeParse({ ...attempt, world: selected.world, stageStatus: { ...attempt.stageStatus, world: 'ready' } }).success).toBe(false);
  });
  it('仅补算世界可复用已验证变量，即使本次变量开关关闭也不要求重算', () => {
    const selected = withCandidates();
    const attempt = startStageAttempt(selected, ['world'], { useVariableStage: false, useWorldStage: true });
    expect(attempt.story).toEqual(selected.story); expect(attempt.storyRevision).toBe(selected.storyRevision);
    expect(attempt.variables).toEqual(selected.variables); expect(attempt.world).toBeUndefined();
    expect(attempt.stageRequestRevisions.variables).toBe(selected.stageRequestRevisions.variables);
    expect(() => validateDraftUpdate(selected, attempt)).not.toThrow();
    const result = TurnDraftSchema.parse({ ...attempt, draftRevision: attempt.draftRevision + 1,
      world: { ...selected.world, requestRevision: attempt.stageRequestRevisions.world },
      stageStatus: { ...attempt.stageStatus, world: 'ready' } });
    expect(() => validateDraftUpdate(attempt, result)).not.toThrow();
  });
  it('仅开启世界且没有可复用变量时，补算结果仍只能预览', () => {
    const selected = rerollStory(createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入', false, false), story);
    const attempt = startStageAttempt(selected, ['world'], { useWorldStage: true });
    const result = { ...withCandidates().world, basedOnVariableRevision: undefined, requestRevision: attempt.stageRequestRevisions.world };
    expect(TurnDraftSchema.safeParse({ ...attempt, world: result, stageStatus: { ...attempt.stageStatus, world: 'ready' } }).success).toBe(false);
    expect(TurnDraftSchema.safeParse({ ...attempt, world: { ...result, validation: 'preview' }, stageStatus: { ...attempt.stageStatus, world: 'preview' } }).success).toBe(true);
  });
  it('相同配置重新请求也创建新执行版本，旧响应即使重新读取草稿后回写仍被拒绝', () => {
    const first = startStageAttempt(withCandidates(), ['world']);
    const second = startStageAttempt(first, ['world']);
    expect(second.storyRevision).toBe(first.storyRevision);
    const late = { ...second, draftRevision: second.draftRevision + 1,
      world: { ...withCandidates().world, requestRevision: first.stageRequestRevisions.world },
      stageStatus: { ...second.stageStatus, world: 'ready' } };
    expect(TurnDraftSchema.safeParse(late).success).toBe(false);
    const current = TurnDraftSchema.parse({ ...late, world: { ...late.world, requestRevision: second.stageRequestRevisions.world } });
    expect(() => validateDraftUpdate(second, current)).not.toThrow();
  });
  it('新执行尝试不能同时偷换正文或夹带候选结果', () => {
    const selected = withCandidates();
    const attempt = startStageAttempt(selected, ['world']);
    expect(() => validateDraftUpdate(selected, { ...attempt, story: { ...story, narrative: '被偷换' } })).toThrow('保留正文');
    expect(() => validateDraftUpdate(selected, { ...attempt, world: { ...selected.world!, requestRevision: attempt.stageRequestRevisions.world },
      stageStatus: { ...attempt.stageStatus, world: 'ready' } })).toThrow('按依赖清除候选');
  });
  it('未选择的阶段不能借新执行尝试写入旧请求结果', () => {
    const selected = withCandidates();
    const attempt = startStageAttempt(selected, ['world']);
    const late = { ...attempt, draftRevision: attempt.draftRevision + 1,
      variables: { ...selected.variables!, candidateRevision: 2 }, world: undefined };
    expect(() => validateDraftUpdate(attempt, late)).toThrow('未请求');
  });
  it('没有选定正文、空阶段列表或请求关闭阶段时不能开始补算', () => {
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入', false, false);
    expect(() => startStageAttempt(initial, ['variables'], { useVariableStage: true })).toThrow('已选定');
    const selected = rerollStory(initial, story);
    expect(() => startStageAttempt(selected, [])).toThrow();
    expect(() => startStageAttempt(selected, ['variables'])).toThrow('必须启用');
  });
  it('旧版草稿的新增版本字段默认为零，保留原有正文与候选', () => {
    const legacy: Record<string, unknown> = { ...withCandidates() };
    delete legacy.executionRevision; delete legacy.requestedStages; delete legacy.stageRequestRevisions;
    for (const stage of ['variables', 'world']) {
      const candidate = { ...legacy[stage] as Record<string, unknown> };
      delete candidate.requestRevision; legacy[stage] = candidate;
    }
    const parsed = TurnDraftSchema.parse(legacy);
    expect(parsed).toEqual(withCandidates());
    expect(() => startStageAttempt(parsed, ['world'])).not.toThrow();
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
