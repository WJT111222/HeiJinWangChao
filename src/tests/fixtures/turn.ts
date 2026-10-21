import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { worldDraft, worldResult, worldNarrative } from './world';

export async function completeDraft(
  repo: SaveRepository,
  options: {
    variables?: NonNullable<TurnDraft['variables']>['result'];
    world?: NonNullable<TurnDraft['world']>['result'];
    narrative?: string;
    summary?: string;
  } = {},
) {
  const state = await repo.load('save-a');
  const existing = await repo.loadDraft(state.saveId);
  const initial =
    existing ??
    createTurnDraft(
      state.saveId,
      state.revision,
      `initial-${state.saveId}`,
      state.turnNumber ? 'regular' : 'opening',
      '',
    );
  if (!existing) await repo.saveDraft(initial, null);
  const selected = await repo.saveDraft(
    rerollStory(initial, {
      turnKind: initial.turnKind,
      narrative: options.narrative ?? worldNarrative,
      summary: options.summary ?? '已完成用餐',
      variableGuide: [],
    }),
    initial.draftRevision,
  );
  const variables = await repo.saveDraft(
    TurnDraftSchema.parse({
      ...selected,
      draftRevision: selected.draftRevision + 1,
      variables: {
        storyRevision: selected.storyRevision,
        candidateRevision: 1,
        requestRevision: selected.stageRequestRevisions.variables,
        validation: 'validated',
        result: options.variables ?? worldDraft().variables!.result,
      },
      stageStatus: { ...selected.stageStatus, variables: 'ready' },
    }),
    selected.draftRevision,
  );
  return repo.saveDraft(
    TurnDraftSchema.parse({
      ...variables,
      draftRevision: variables.draftRevision + 1,
      world: {
        storyRevision: selected.storyRevision,
        candidateRevision: 1,
        requestRevision: variables.stageRequestRevisions.world,
        basedOnVariableRevision: 1,
        validation: 'validated',
        result: options.world ?? worldResult(),
      },
      stageStatus: { ...variables.stageStatus, world: 'ready' },
    }),
    variables.draftRevision,
  );
}
export const submission = (draft: TurnDraft, nextAction = '去社区诊所咨询') => ({
  draft,
  nextAction,
  useVariableStage: true,
  useWorldStage: true,
});
