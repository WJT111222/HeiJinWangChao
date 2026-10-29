import { z } from 'zod';
import { CountSchema, IdSchema, TextSchema, requireData } from './common';
import { DomainCommandSchema, fingerprint } from './commands';
import { StorySchema } from './state';
import { StoredWorldEventSchema } from './events/schema';

export const VariableResultSchema = z.strictObject({
  commands: z.array(DomainCommandSchema),
  rejectedSuggestions: z.array(z.strictObject({ reason: TextSchema, reference: z.string().optional() })),
  unresolved: z.array(TextSchema),
});
export const WorldResultSchema = z.strictObject({
  worldCommands: z.array(DomainCommandSchema), taskCommands: z.array(DomainCommandSchema),
  eventCommands: z.array(DomainCommandSchema), futureEvents: z.array(StoredWorldEventSchema),
  visibleHooks: z.array(z.strictObject({ text: TextSchema, revealAfter: z.string().optional() })),
  timelineCandidates: z.array(IdSchema), unresolved: z.array(TextSchema),
});
const candidateBase = {
  storyRevision: CountSchema, candidateRevision: CountSchema.refine((n) => n > 0),
  requestRevision: CountSchema.default(0),
  validation: z.enum(['preview', 'validated']),
};
const StageSchema = z.enum(['variables', 'world']);
const RequestedStagesSchema = z.array(StageSchema).refine((stages) => new Set(stages).size === stages.length, '补算阶段重复');
export type DraftStage = z.infer<typeof StageSchema>;
export const TurnDraftSchema = z.strictObject({
  saveId: IdSchema, turnId: IdSchema, baseSaveRevision: CountSchema, draftRevision: CountSchema,
  storyRevision: CountSchema, turnKind: z.enum(['opening', 'regular']), userInput: z.string(),
  useVariableStage: z.boolean(), useWorldStage: z.boolean(), story: StorySchema.optional(),
  // 执行尝试与正文版本独立。默认 0 兼容本 PR 先前保存的草稿，不改变已有正文/候选。
  executionRevision: CountSchema.default(0),
  requestedStages: RequestedStagesSchema.default([]),
  stageRequestRevisions: z.strictObject({ variables: CountSchema, world: CountSchema })
    .default({ variables: 0, world: 0 }),
  variables: z.strictObject({ ...candidateBase, result: VariableResultSchema }).optional(),
  world: z.strictObject({ ...candidateBase, basedOnVariableRevision: CountSchema.optional(), result: WorldResultSchema }).optional(),
  stageStatus: z.strictObject({
    story: z.enum(['pending', 'ready', 'failed']),
    variables: z.enum(['pending', 'preview', 'ready', 'failed', 'skipped']),
    world: z.enum(['pending', 'preview', 'ready', 'failed', 'skipped']),
  }),
  failures: z.array(z.strictObject({
    stage: z.enum(['story', 'variables', 'world']), attempt: CountSchema,
    storyRevision: CountSchema, errorCode: TextSchema, retryable: z.boolean(),
  })),
}).superRefine((draft, ctx) => {
  function check(ok: unknown, message: string) { if (!ok) ctx.addIssue({ code: 'custom', message }); }
  if (draft.story) check(draft.story.turnKind === draft.turnKind, '正文回合类型不符');
  check(draft.stageStatus.story !== 'ready' || draft.story, '正文未完成');
  for (const stage of ['variables', 'world'] as const) {
    const enabled = stage === 'variables' ? draft.useVariableStage : draft.useWorldStage;
    const candidate = draft[stage];
    // 新尝试可以复用先前已验证的候选；关闭阶段只阻止本次新请求。
    const reused = candidate?.validation === 'validated' && draft.stageStatus[stage] === 'ready';
    check(enabled ? draft.stageStatus[stage] !== 'skipped' : draft.stageStatus[stage] === 'skipped' || reused, '运行开关与阶段状态不符');
    if (draft.requestedStages.includes(stage)) check(enabled, '补算阶段必须启用');
    check(draft.stageRequestRevisions[stage] <= draft.executionRevision, '阶段请求版本超前');
    if (candidate) {
      check(draft.story && candidate.storyRevision === draft.storyRevision, '候选引用旧正文');
      check(candidate.requestRevision === draft.stageRequestRevisions[stage], '候选引用过期阶段请求');
      check(['preview', 'ready'].includes(draft.stageStatus[stage]), '失败或待执行阶段不能保留候选');
      if (draft.stageStatus[stage] === 'ready') check(candidate.validation === 'validated', '阶段尚未通过校验');
    } else check(!['ready', 'preview'].includes(draft.stageStatus[stage]), '阶段缺少候选');
  }
  if (draft.world) {
    check(draft.world.basedOnVariableRevision === draft.variables?.candidateRevision, '世界候选依赖已失效变量');
    if (!draft.variables || draft.variables.validation !== 'validated') {
      check(draft.world.validation === 'preview' && draft.stageStatus.world === 'preview', '缺失变量时世界只能预览');
    }
  }
});
export type TurnDraft = z.infer<typeof TurnDraftSchema>;

export function createTurnDraft(saveId: string, baseSaveRevision: number, turnId: string,
  turnKind: 'opening' | 'regular', userInput: string, useVariableStage = true, useWorldStage = true): TurnDraft {
  return TurnDraftSchema.parse({
    saveId, baseSaveRevision, turnId, turnKind, userInput, useVariableStage, useWorldStage,
    draftRevision: 0, storyRevision: 0, failures: [],
    stageStatus: { story: 'pending', variables: useVariableStage ? 'pending' : 'skipped', world: useWorldStage ? 'pending' : 'skipped' },
  });
}

export function rerollStory(draft: TurnDraft, story: z.infer<typeof StorySchema>): TurnDraft {
  return TurnDraftSchema.parse({ ...draft, draftRevision: draft.draftRevision + 1, storyRevision: draft.storyRevision + 1,
    story, variables: undefined, world: undefined,
    stageStatus: { story: 'ready', variables: draft.useVariableStage ? 'pending' : 'skipped', world: draft.useWorldStage ? 'pending' : 'skipped' },
  });
}

// 显式补算的数据操作：冻结新配置、保留选定正文，不执行模型或正式提交。
export function startStageAttempt(draft: TurnDraft, stages: readonly DraftStage[], config: {
  useVariableStage?: boolean; useWorldStage?: boolean;
} = {}): TurnDraft {
  const current = TurnDraftSchema.parse(draft);
  const requestedStages = RequestedStagesSchema.min(1).parse(stages);
  requireData(current.story && current.stageStatus.story === 'ready', 'STORY_NOT_READY', '补算需要已选定的正文');
  const useVariableStage = config.useVariableStage ?? current.useVariableStage;
  const useWorldStage = config.useWorldStage ?? current.useWorldStage;
  const executionRevision = current.executionRevision + 1;
  const resetVariables = requestedStages.includes('variables')
    || (!useVariableStage && current.variables?.validation !== 'validated');
  const resetWorld = requestedStages.includes('world') || resetVariables
    || (!useWorldStage && current.world?.validation !== 'validated');
  const variables = resetVariables ? undefined : current.variables;
  const world = resetWorld ? undefined : current.world;
  return TurnDraftSchema.parse({
    ...current, draftRevision: current.draftRevision + 1, executionRevision, requestedStages,
    useVariableStage, useWorldStage, variables, world,
    stageRequestRevisions: {
      variables: resetVariables ? executionRevision : current.stageRequestRevisions.variables,
      world: resetWorld ? executionRevision : current.stageRequestRevisions.world,
    },
    stageStatus: { story: current.stageStatus.story,
      variables: variables ? current.stageStatus.variables : useVariableStage ? 'pending' : 'skipped',
      world: world ? current.stageStatus.world : useWorldStage ? 'pending' : 'skipped',
    },
  });
}

// 仅校验持久化前后的版本关系，不执行阶段、自动重试或候选提交。
export function validateDraftUpdate(old: TurnDraft, next: TurnDraft) {
  requireData(next.draftRevision === old.draftRevision + 1, 'DRAFT_CONFLICT', '草稿版本冲突');
  for (const key of ['saveId', 'turnId', 'baseSaveRevision', 'turnKind', 'userInput'] as const) {
    requireData(old[key] === next[key], 'DRAFT_CONTEXT', '同次草稿的输入不可悄然改变');
  }
  if (next.executionRevision !== old.executionRevision) {
    requireData(next.executionRevision === old.executionRevision + 1, 'ATTEMPT_CONFLICT', '执行尝试版本不连续');
    const expected = startStageAttempt(old, next.requestedStages, next);
    requireData(fingerprint(next) === fingerprint(expected), 'ATTEMPT_CONFLICT', '新执行尝试必须保留正文并按依赖清除候选');
    return;
  }
  for (const key of ['useVariableStage', 'useWorldStage', 'requestedStages', 'stageRequestRevisions'] as const) {
    requireData(fingerprint(old[key]) === fingerprint(next[key]), 'DRAFT_CONTEXT', '同次执行尝试的运行配置不可悄然改变');
  }
  requireData(next.storyRevision === old.storyRevision || next.storyRevision === old.storyRevision + 1, 'STORY_CONFLICT', '正文版本不连续');
  if (next.storyRevision === old.storyRevision) {
    requireData(fingerprint(next.story) === fingerprint(old.story), 'STORY_CONFLICT', '正文变化必须创建新版本');
    for (const stage of ['variables', 'world'] as const) {
      if (fingerprint(old[stage]) === fingerprint(next[stage])) continue;
      const enabled = stage === 'variables' ? next.useVariableStage : next.useWorldStage;
      // 清除依赖失效的世界候选允许；写回结果必须属于本次显式请求的阶段。
      if (next[stage]) requireData(enabled && (next.executionRevision === 0 || next.requestedStages.includes(stage)),
        'STALE_RESPONSE', '未请求或已被新尝试取代的阶段不能写入候选');
      if (old[stage] && !next[stage]) requireData(stage === 'world' && fingerprint(old.variables) !== fingerprint(next.variables),
        'ATTEMPT_REQUIRED', '重新生成候选需要显式创建执行尝试');
    }
    if (fingerprint(old.variables) !== fingerprint(next.variables)) {
      requireData(!next.world, 'STALE_WORLD', '变量候选变化后世界候选必须失效');
      if (old.variables && next.variables) requireData(next.variables.candidateRevision > old.variables.candidateRevision,
        'CANDIDATE_CONFLICT', '变量候选版本必须递增');
    }
    if (old.world && next.world && fingerprint(old.world) !== fingerprint(next.world)) requireData(
      next.world.candidateRevision > old.world.candidateRevision, 'CANDIDATE_CONFLICT', '世界候选版本必须递增');
  } else requireData(!next.variables && !next.world, 'STALE_CANDIDATE', '重新 Roll 必须丢弃旧候选');
}
