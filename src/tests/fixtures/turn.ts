import { commandsForPhase } from '../../domain/stageCommands';
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
  const selected = await repo.saveDraft(
    rerollStory(initial, {
      turnKind: initial.turnKind,
      narrative: options.narrative ?? worldNarrative,
      summary: options.summary ?? '已完成用餐',
      variableGuide: options.variableGuide ?? [],
      ...(options.actionOptions ? { actionOptions: options.actionOptions } : {}),
    }),
    initial.draftRevision,
  );
  const result = options.variables ?? worldDraft().variables!.result;
  const entityTypes = new Set(commandsForPhase('entities', selected.turnKind));
  const entityCommands = result.commands.filter(c => entityTypes.has(c.type));
  const contactedNpcIds = [...new Set(entityCommands.flatMap(c => c.type === 'CreateNpc' ? [c.npc.id] : 'npcId' in c ? [c.npcId] : []))];
  const entities = selected.useEntityStage ? await repo.saveDraft(TurnDraftSchema.parse({ ...selected,
    draftRevision: selected.draftRevision + 1,
    entities: { storyRevision: selected.storyRevision, requestRevision: selected.stageRequestRevisions.entities, candidateRevision: 1,
      validation: 'structural', contactedNpcIds, result: { commands: entityCommands, unresolved: [], rejectedSuggestions: [] } },
    stageStatus: { ...selected.stageStatus, entities: 'ready' },
  }), selected.draftRevision) : selected;
  const variables = await repo.saveDraft(
    TurnDraftSchema.parse({
      ...entities,
      draftRevision: entities.draftRevision + 1,
      variables: {
        basedOnEntityRevision: entities.entities?.candidateRevision,
        storyRevision: selected.storyRevision,
        candidateRevision: 1,
        requestRevision: selected.stageRequestRevisions.variables,
        validation: 'validated',
        result: { ...result, commands: result.commands.filter(c => !entityTypes.has(c.type)) },
      },
      stageStatus: { ...entities.stageStatus, variables: 'ready' },
    }),
    entities.draftRevision,
  );
  return repo.saveDraft(
    TurnDraftSchema.parse({
      ...variables,
      draftRevision: variables.draftRevision + 1,
      world: {
        storyRevision: selected.storyRevision,
        candidateRevision: 1,
        requestRevision: variables.stageRequestRevisions.world,
        basedOnVariableRevision: 1, basedOnEntityRevision: entities.entities?.candidateRevision,
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
