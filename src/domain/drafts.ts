import { z } from 'zod';
import { CountSchema, IdSchema, TextSchema, requireData } from './common';
import { DomainCommandSchema, fingerprint } from './commands';
import { StorySchema } from './state';
import { WorldEventSchema } from './events/schema';

export const VariableResultSchema = z.strictObject({
  commands: z.array(DomainCommandSchema),
  rejectedSuggestions: z.array(z.strictObject({ reason: TextSchema, reference: z.string().optional() })),
  unresolved: z.array(TextSchema),
});
export const WorldResultSchema = z.strictObject({
  worldCommands: z.array(DomainCommandSchema), taskCommands: z.array(DomainCommandSchema),
  eventCommands: z.array(DomainCommandSchema), futureEvents: z.array(WorldEventSchema),
  visibleHooks: z.array(z.strictObject({ text: TextSchema, revealAfter: z.string().optional() })),
  timelineCandidates: z.array(IdSchema), unresolved: z.array(TextSchema),
});
const candidateBase = {
  storyRevision: CountSchema, candidateRevision: CountSchema.refine((n) => n > 0),
  validation: z.enum(['preview', 'validated']),
};
export const TurnDraftSchema = z.strictObject({
  saveId: IdSchema, turnId: IdSchema, baseSaveRevision: CountSchema, draftRevision: CountSchema,
  storyRevision: CountSchema, turnKind: z.enum(['opening', 'regular']), userInput: z.string(),
  useVariableStage: z.boolean(), useWorldStage: z.boolean(), story: StorySchema.optional(),
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
    check(enabled ? draft.stageStatus[stage] !== 'skipped' : draft.stageStatus[stage] === 'skipped', '运行开关与阶段状态不符');
    if (candidate) {
      check(enabled && draft.story && candidate.storyRevision === draft.storyRevision, '候选引用旧正文或已关闭阶段');
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

// 仅校验持久化前后的版本关系，不执行阶段、自动重试或候选提交。
export function validateDraftUpdate(old: TurnDraft, next: TurnDraft) {
  requireData(next.draftRevision === old.draftRevision + 1, 'DRAFT_CONFLICT', '草稿版本冲突');
  for (const key of ['saveId', 'turnId', 'baseSaveRevision', 'turnKind', 'userInput', 'useVariableStage', 'useWorldStage'] as const) {
    requireData(old[key] === next[key], 'DRAFT_CONTEXT', '同次草稿的输入与运行配置不可悄然改变');
  }
  requireData(next.storyRevision === old.storyRevision || next.storyRevision === old.storyRevision + 1, 'STORY_CONFLICT', '正文版本不连续');
  if (next.storyRevision === old.storyRevision) {
    requireData(fingerprint(next.story) === fingerprint(old.story), 'STORY_CONFLICT', '正文变化必须创建新版本');
    if (fingerprint(old.variables) !== fingerprint(next.variables)) {
      requireData(!next.world, 'STALE_WORLD', '变量候选变化后世界候选必须失效');
      if (old.variables && next.variables) requireData(next.variables.candidateRevision > old.variables.candidateRevision,
        'CANDIDATE_CONFLICT', '变量候选版本必须递增');
    }
    if (old.world && next.world && fingerprint(old.world) !== fingerprint(next.world)) requireData(
      next.world.candidateRevision > old.world.candidateRevision, 'CANDIDATE_CONFLICT', '世界候选版本必须递增');
  } else requireData(!next.variables && !next.world, 'STALE_CANDIDATE', '重新 Roll 必须丢弃旧候选');
}
