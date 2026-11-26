import { createTurnDraft, rerollStory, TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { worldDraft, worldResult, worldNarrative } from './world';

/** Seed a synthetic Story as if its candidate and fixture worldview were accepted together. */
export async function saveFixtureStory(repo: SaveRepository, next: TurnDraft, revision: number) {
  const base = await repo.loadDraft(next.saveId);
  if (!base) throw Error('Missing fixture draft');
  const lease = await repo.prepareWorldview(base,false);
  return repo.saveDraft(next,revision,undefined,base,lease);
}

/** Import a historical state, then accept local fixture outputs for the business rule under test. */
export async function seedFixtureTurn(repo: SaveRepository, {state,draft}: {state:GameState; draft:TurnDraft}) {
  if (!draft.story) throw Error('Missing fixture Story');
  const initial = createTurnDraft(state.saveId,state.revision,draft.turnId,draft.turnKind,draft.userInput,
    draft.useVariableStage,draft.useWorldStage);
  const entry = {state,draft:initial};
  await repo.importBackup(entry,(await repo.compareBackup(entry)).confirmation);
  const imported = (await repo.loadDraft(state.saveId))!;
  const selected = await saveFixtureStory(repo,rerollStory(imported,draft.story),imported.draftRevision);
  if (draft.variables) await repo.saveDraft({...selected,draftRevision:selected.draftRevision+1,
    variables:{...draft.variables,storyRevision:selected.storyRevision},stageStatus:{...selected.stageStatus,variables:draft.stageStatus.variables}},selected.draftRevision);
}

export async function completeDraft(
  repo: SaveRepository,
  options: {
    variables?: NonNullable<TurnDraft['variables']>['result'];
    world?: NonNullable<TurnDraft['world']>['result'];
    narrative?: string;
    summary?: string;
    actionOptions?: string[];
    variableGuide?: NonNullable<TurnDraft['story']>['variableGuide'];
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
  const selected = await saveFixtureStory(repo,
    rerollStory(initial, {
      turnKind: initial.turnKind,
      narrative: options.narrative ?? worldNarrative,
      summary: options.summary ?? '已完成用餐',
      variableGuide: options.variableGuide ?? [],
      ...(options.actionOptions ? { actionOptions: options.actionOptions } : {}),
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

// 仅用于Mock：耗时由每个测试明确给出，不是产品中的默认步长。
export async function elapsedVariables(repo: SaveRepository, evidence: string, seconds: number) {
  const state = await repo.load('save-a');
  return { commands: [{ type: 'SetWorldClock' as const, commandId: `clock-${state.turnNumber}`,
    evidence, worldClock: new Date(Date.parse(state.worldClock) + seconds * 1000).toISOString() }],
    rejectedSuggestions: [], unresolved: [] };
}
