import { DeferredEventIdsSchema, UpdateSettlementSchema } from './updateSettlement';
import { z } from 'zod';
import { CountSchema, IdSchema, TextSchema, requireData } from './common';
import { STORY_CONTINUATION_LIMIT, STORY_PARTIAL_MAX_CHARS } from './storyContinuation';
import { DomainCommandSchema, fingerprint } from './commands';
import { StorySchema } from './state';
import { LegacyNotificationRecoverySchema, recoveryMatchesDraft } from './events/legacyNotification';

export const VariableResultSchema = z.strictObject({
  commands: z.array(DomainCommandSchema),
  rejectedSuggestions: z.array(z.strictObject({ reason: TextSchema, reference: z.string().optional() })),
  unresolved: z.array(TextSchema),
  settlement: UpdateSettlementSchema.optional(),
});
export const WorldResultSchema = z.strictObject({
  worldCommands: z.array(DomainCommandSchema), taskCommands: z.array(DomainCommandSchema),
  eventCommands: z.array(DomainCommandSchema),
  visibleHooks: z.array(z.strictObject({ text: TextSchema, revealAfter: z.string().optional() })),
  unresolved: z.array(TextSchema),
  settlement: UpdateSettlementSchema.optional(),
  deferredEvents: DeferredEventIdsSchema.optional(),
});
const candidateBase = {
  storyRevision: CountSchema, candidateRevision: CountSchema.refine((n) => n > 0),
  requestRevision: CountSchema.default(0),
  validation: z.enum(['preview', 'validated']),
};
const StageSchema = z.enum(['entities', 'variables', 'world']);
const RequestedStagesSchema = z.array(StageSchema).refine((stages) => new Set(stages).size === stages.length, '补算阶段重复');
export type DraftStage = z.infer<typeof StageSchema>;
export const candidateStages = StageSchema.options;
export const stageSwitch = { entities: 'useEntityStage', variables: 'useVariableStage', world: 'useWorldStage' } as const;
const candidateStatus = z.enum(['pending', 'preview', 'ready', 'failed', 'skipped']);
const draftSchema = z.strictObject({
  saveId: IdSchema, turnId: IdSchema, baseSaveRevision: CountSchema, draftRevision: CountSchema,
  storyRevision: CountSchema, turnKind: z.enum(['opening', 'regular']), userInput: z.string(),
  useEntityStage: z.boolean(), useVariableStage: z.boolean(), useWorldStage: z.boolean(), story: StorySchema.optional(),
  // 执行尝试与正文版本独立。默认 0 兼容本 PR 先前保存的草稿，不改变已有正文/候选。
  executionRevision: CountSchema.default(0),
  requestedStages: RequestedStagesSchema.default([]),
  stageRequestRevisions: z.strictObject({ entities: CountSchema, variables: CountSchema, world: CountSchema })
    .default({ entities: 0, variables: 0, world: 0 }),
  entities: z.strictObject({ ...candidateBase, validation: z.literal('structural'), contactedNpcIds: z.array(IdSchema), result: VariableResultSchema }).optional(),
  variables: z.strictObject({ ...candidateBase, basedOnEntityRevision: CountSchema.optional(), result: VariableResultSchema }).optional(),
  world: z.strictObject({ ...candidateBase, basedOnEntityRevision: CountSchema.optional(), basedOnVariableRevision: CountSchema.optional(), result: WorldResultSchema }).optional(),
  stageStatus: z.strictObject({
    story: z.enum(['pending', 'ready', 'failed']),
    entities: candidateStatus, variables: candidateStatus,
    world: z.enum(['pending', 'preview', 'ready', 'failed', 'skipped']),
  }),
  legacyNotificationRecovery: LegacyNotificationRecoverySchema.optional(),
  failures: z.array(z.strictObject({
    stage: z.enum(['story', 'entities', 'variables', 'world']), attempt: CountSchema,
    storyRevision: CountSchema, errorCode: TextSchema, retryable: z.boolean(),
  })),
  // 正文被截断时已收到的原始输出（已隐藏凭证），供玩家点「续写正文」从断点接着写。可选字段：旧草稿没有它照常可用。
  storyPartial: z.strictObject({
    text: z.string().min(1).max(STORY_PARTIAL_MAX_CHARS),
    storyRevision: CountSchema,
    continuations: z.number().int().min(0).max(STORY_CONTINUATION_LIMIT),
  }).optional(),
}).superRefine((draft, ctx) => {
  function check(ok: unknown, message: string) { if (!ok) ctx.addIssue({ code: 'custom', message }); }
  if (draft.legacyNotificationRecovery) check(
    draft.turnKind === 'regular' && draft.stageStatus.story === 'ready' && draft.useVariableStage && draft.useWorldStage
      && recoveryMatchesDraft(draft.legacyNotificationRecovery,draft), '旧通知恢复授权引用过期的正文或回合');
  if (draft.storyPartial) {
    check(!draft.story, '已有完整正文时不能保留截断正文');
    check(draft.storyPartial.storyRevision === draft.storyRevision, '截断正文引用旧正文版本');
  }
  if (draft.story) check(draft.story.turnKind === draft.turnKind, '正文回合类型不符');
  check(draft.stageStatus.story !== 'ready' || draft.story, '正文未完成');
  for (const stage of candidateStages) {
    const enabled = draft[stageSwitch[stage]];
    const candidate = draft[stage];
    // 新尝试可以保留先前已验证的候选供复用；正式结算仅应用本次启用路径。
    check(enabled ? draft.stageStatus[stage] !== 'skipped' : draft.stageStatus[stage] === 'skipped' && !candidate, '运行开关与阶段状态不符');
    if (draft.requestedStages.includes(stage)) check(enabled, '补算阶段必须启用');
    check(draft.stageRequestRevisions[stage] <= draft.executionRevision, '阶段请求版本超前');
    if (candidate) {
      check(draft.story && candidate.storyRevision === draft.storyRevision, '候选引用旧正文');
      check(candidate.requestRevision === draft.stageRequestRevisions[stage], '候选引用过期阶段请求');
      check(['preview', 'ready'].includes(draft.stageStatus[stage]), '失败或待执行阶段不能保留候选');
      if (draft.stageStatus[stage] === 'ready') check(candidate.validation === (stage === 'entities' ? 'structural' : 'validated'), '阶段尚未通过校验');
    } else check(!['ready', 'preview'].includes(draft.stageStatus[stage]), '阶段缺少候选');
  }
  if (draft.variables) check(draft.variables.basedOnEntityRevision === draft.entities?.candidateRevision, '现场候选引用过期实体');
  if (draft.world) {
    check(draft.world.basedOnEntityRevision === draft.entities?.candidateRevision, '场外候选引用过期实体');
    check(draft.world.basedOnVariableRevision === draft.variables?.candidateRevision, '世界候选依赖已失效变量');
    if (draft.useVariableStage && draft.variables?.validation !== 'validated') {
      check(draft.world.validation === 'preview' && draft.stageStatus.world === 'preview', '缺失变量时世界只能预览');
    }
  }
});
// 旧候选属于不同权限协议。保留所选正文、续写断点、回合身份及正式版本。
export const TurnDraftSchema = z.preprocess(raw => {
  if (!raw || typeof raw !== 'object' || 'useEntityStage' in raw || !('useVariableStage' in raw) ||
      !('useWorldStage' in raw) || !('stageStatus' in raw) || !raw.stageStatus || typeof raw.stageStatus !== 'object' ||
      !('story' in raw.stageStatus)) return raw;
  const initial = raw.useVariableStage ? 'pending' : 'skipped';
  return { ...raw, useEntityStage: raw.useVariableStage, variables: undefined, world: undefined, requestedStages: [],
    stageRequestRevisions: { entities: 0, variables: 0, world: 0 },
    stageStatus: { story: raw.stageStatus.story, entities: initial, variables: initial, world: raw.useWorldStage ? 'pending' : 'skipped' },
    failures: 'failures' in raw && Array.isArray(raw.failures) ? raw.failures.filter(f => f?.stage === 'story') : [] };
}, draftSchema);
export type TurnDraft = z.infer<typeof TurnDraftSchema>;

export function createTurnDraft(saveId: string, baseSaveRevision: number, turnId: string,
  turnKind: 'opening' | 'regular', userInput: string, useVariableStage = true, useWorldStage = true, useEntityStage = useVariableStage): TurnDraft {
  return TurnDraftSchema.parse({
    saveId, baseSaveRevision, turnId, turnKind, userInput, useEntityStage, useVariableStage, useWorldStage,
    draftRevision: 0, storyRevision: 0, failures: [],
    stageStatus: { story: 'pending', entities: useEntityStage ? 'pending' : 'skipped', variables: useVariableStage ? 'pending' : 'skipped', world: useWorldStage ? 'pending' : 'skipped' },
  });
}

export function rerollStory(draft: TurnDraft, story: z.infer<typeof StorySchema>): TurnDraft {
  const next = { ...draft };
  delete next.legacyNotificationRecovery;
  return TurnDraftSchema.parse({ ...next, draftRevision: draft.draftRevision + 1, storyRevision: draft.storyRevision + 1,
    story, entities: undefined, variables: undefined, world: undefined, storyPartial: undefined,
    stageStatus: { story: 'ready', entities: draft.useEntityStage ? 'pending' : 'skipped', variables: draft.useVariableStage ? 'pending' : 'skipped', world: draft.useWorldStage ? 'pending' : 'skipped' },
  });
}

// 显式补算的数据操作：冻结新配置、保留选定正文，不执行模型或正式提交。
export function startStageAttempt(draft: TurnDraft, stages: readonly DraftStage[], config: {
  useEntityStage?: boolean; useVariableStage?: boolean; useWorldStage?: boolean;
} = {}): TurnDraft {
  const current = TurnDraftSchema.parse(draft);
  const requestedStages = RequestedStagesSchema.min(1).parse(stages);
  requireData(current.story && current.stageStatus.story === 'ready', 'STORY_NOT_READY', '补算需要已选定的正文');
  return resetStageCandidates(current, config, requestedStages);
}

type StageConfig = Partial<Pick<TurnDraft, 'useEntityStage' | 'useVariableStage' | 'useWorldStage'>>;

function resetStageCandidates(current: TurnDraft, config: StageConfig, requested: DraftStage[]) {
  const next = structuredClone(current);
  next.draftRevision++;
  if (current.story) next.executionRevision++;
  let reset = false;
  for (const stage of candidateStages) {
    const key = stageSwitch[stage];
    const enabled = config[key] ?? current[key];
    reset ||= requested.includes(stage) || enabled !== current[key];
    next[key] = enabled;
    if (reset) {
      delete next[stage];
      next.stageStatus[stage] = enabled ? 'pending' : 'skipped';
      next.stageRequestRevisions[stage] = next.executionRevision;
    }
  }
  next.requestedStages = requested.length ? requested : candidateStages.filter(stage =>
    Boolean(next.story && next[stageSwitch[stage]] && !next[stage]));
  return TurnDraftSchema.parse(next);
}

export function configureTurnStages(draft: TurnDraft, config: StageConfig): TurnDraft {
  const current = TurnDraftSchema.parse(draft);
  requireData(!current.legacyNotificationRecovery || candidateStages.every(stage => config[stageSwitch[stage]] ?? current[stageSwitch[stage]]),
    'LEGACY_RECOVERY_STAGES', '结算旧通知需要启用所有阶段。');
  if (!candidateStages.some(stage => config[stageSwitch[stage]] !== undefined && config[stageSwitch[stage]] !== current[stageSwitch[stage]])) return current;
  return resetStageCandidates(current, config, []);
}

// 仅校验持久化前后的版本关系，不执行阶段、自动重试或候选提交。
export function validateDraftUpdate(old: TurnDraft, next: TurnDraft) {
  requireData(next.draftRevision === old.draftRevision + 1, 'DRAFT_CONFLICT', '草稿版本冲突');
  for (const key of ['saveId', 'turnId', 'baseSaveRevision', 'turnKind', 'userInput'] as const) {
    requireData(old[key] === next[key], 'DRAFT_CONTEXT', '同次草稿的输入不可悄然改变');
  }
  requireData(fingerprint(next.legacyNotificationRecovery) === fingerprint(
    next.storyRevision === old.storyRevision ? old.legacyNotificationRecovery : undefined),
  'DRAFT_CONTEXT', '只能通过明确确认的旧通知恢复创建授权');
  if ((old.useEntityStage !== next.useEntityStage || old.useVariableStage !== next.useVariableStage || old.useWorldStage !== next.useWorldStage)
    && fingerprint(next) === fingerprint(configureTurnStages(old, next))) return;
  if (next.executionRevision !== old.executionRevision) {
    requireData(next.executionRevision === old.executionRevision + 1, 'ATTEMPT_CONFLICT', '执行尝试版本不连续');
    const expected = startStageAttempt(old, next.requestedStages, next);
    requireData(fingerprint(next) === fingerprint(expected), 'ATTEMPT_CONFLICT', '新执行尝试必须保留正文并按依赖清除候选');
    return;
  }
  for (const key of ['useEntityStage', 'useVariableStage', 'useWorldStage', 'requestedStages', 'stageRequestRevisions'] as const) {
    requireData(fingerprint(old[key]) === fingerprint(next[key]), 'DRAFT_CONTEXT', '同次执行尝试的运行配置不可悄然改变');
  }
  requireData(next.storyRevision === old.storyRevision || next.storyRevision === old.storyRevision + 1, 'STORY_CONFLICT', '正文版本不连续');
  if (next.storyRevision === old.storyRevision) {
    requireData(fingerprint(next.story) === fingerprint(old.story), 'STORY_CONFLICT', '正文变化必须创建新版本');
    for (const stage of candidateStages) {
      if (fingerprint(old[stage]) === fingerprint(next[stage])) continue;
      const enabled = next[stageSwitch[stage]];
      // 清除依赖失效的世界候选允许；写回结果必须属于本次显式请求的阶段。
      if (next[stage]) requireData(enabled && (next.executionRevision === 0 || next.requestedStages.includes(stage)),
        'STALE_RESPONSE', '未请求或已被新尝试取代的阶段不能写入候选');
      if (old[stage] && !next[stage]) requireData(stage === 'world' && fingerprint(old.variables) !== fingerprint(next.variables),
        'ATTEMPT_REQUIRED', '重新生成候选需要显式创建执行尝试');
    }
    if (fingerprint(old.entities) !== fingerprint(next.entities)) {
      requireData(!next.variables && !next.world, 'STALE_CANDIDATE', '实体候选变化后需要重算后段');
      if (old.entities && next.entities) requireData(next.entities.candidateRevision > old.entities.candidateRevision,
        'CANDIDATE_CONFLICT', '实体候选版本必须递增');
    }
    if (fingerprint(old.variables) !== fingerprint(next.variables)) {
      requireData(!next.world, 'STALE_WORLD', '变量候选变化后世界候选必须失效');
      if (old.variables && next.variables) requireData(next.variables.candidateRevision > old.variables.candidateRevision,
        'CANDIDATE_CONFLICT', '变量候选版本必须递增');
    }
    if (old.world && next.world && fingerprint(old.world) !== fingerprint(next.world)) requireData(
      next.world.candidateRevision > old.world.candidateRevision, 'CANDIDATE_CONFLICT', '世界候选版本必须递增');
  } else requireData(!next.entities && !next.variables && !next.world, 'STALE_CANDIDATE', '重新 Roll 必须丢弃旧候选');
}
