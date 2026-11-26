import { createTurnDraft } from '../../domain/drafts';
import { defaultSettings } from '../../ui/settings/model';

/** For suites exercising the scene/world runners independently of NPC generation. */
export function sceneWorldSettings() {
  const settings = defaultSettings();
  settings.runtime.useEntityStage = false;
  return settings;
}
export function sceneWorldDraft(...args: Parameters<typeof createTurnDraft>) {
  return createTurnDraft(args[0], args[1], args[2], args[3], args[4], args[5], args[6], false);
}

import { z } from 'zod';
import { TurnDraftSchema, VariableResultSchema } from '../../domain/drafts';
import { commandsForPhase } from '../../domain/stageCommands';

/** Port a hand-authored whole-turn fixture into separate candidates, keeping its command IDs. */
export function stagedFixture(raw: unknown) {
  const input = z.looseObject({
    useEntityStage:z.boolean(), turnKind:z.enum(['opening','regular']), storyRevision:z.number(),
    stageRequestRevisions:z.looseObject({entities:z.number()}).optional(),
    stageStatus:z.looseObject({}), variables:z.looseObject({candidateRevision:z.number(),result:VariableResultSchema}).optional(),
    world:z.looseObject({}).optional(),
  }).parse(raw);
  if (!input.useEntityStage || !input.variables || input.entities) return TurnDraftSchema.parse(raw);
  const types=new Set(commandsForPhase('entities',input.turnKind));
  const commands=input.variables.result.commands.filter(c=>types.has(c.type));
  const contacts=commands.flatMap(c=>c.type==='CreateNpc' ? [c.npc.id] : 'npcId' in c ? [c.npcId] : []);
  const revision=input.variables.candidateRevision;
  return TurnDraftSchema.parse({...input,
    entities:{storyRevision:input.storyRevision,candidateRevision:revision,requestRevision:input.stageRequestRevisions?.entities??0,
      validation:'structural',contactedNpcIds:[...new Set(contacts)],result:{commands,unresolved:[],rejectedSuggestions:[]}},
    variables:{...input.variables,basedOnEntityRevision:revision,result:{...input.variables.result,
      commands:input.variables.result.commands.filter(c=>!types.has(c.type))}},
    ...(input.world ? {world:{...input.world,basedOnEntityRevision:revision}} : {}),
    stageStatus:{...input.stageStatus,entities:'ready'},
  });
}

/** Install each synthesized upstream candidate under its own draft CAS revision. */
export async function persistSceneFixture(repo: import('../../services/storage/saveRepository').SaveRepository, fixture: import('../../domain/drafts').TurnDraft) {
  const story = await repo.loadDraft(fixture.saveId);
  if (!story) throw Error('missing fixture story');
  const upstream = fixture.entities ? await repo.saveDraft({
    ...story, entities:fixture.entities, draftRevision:story.draftRevision+1, stageStatus:{...story.stageStatus,entities:'ready'},
  },story.draftRevision) : story;
  return repo.saveDraft({...fixture, draftRevision:upstream.draftRevision+1},upstream.draftRevision);
}
