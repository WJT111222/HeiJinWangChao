import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { completeDraft, submission } from './fixtures/turn';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { protagonistKnownEvent } from '../domain/events/knowledge';
import { original, originalSchoolContext } from './fixtures/worldSchoolOriginalContext';

// Explicit synthetic Story, NOT the user's unavailable Story/save. Quotes below are test premises.
function groundedContext() {
  const a = originalSchoolContext();
  a.draft.story!.narrative += '\n' + original.eventCommands.flatMap(c => [c.event.title, c.event.backgroundText, c.event.goalText]).join('\n');
  return a;
}
describe('World scene record and learned future arrangements', () => {
  it('records the complete original response in a grounded synthetic scene without modifying actors', () => {
    const {state, draft} = groundedContext(), before = structuredClone(state);
    const result = parseWorld(JSON.stringify(original), state, draft);
    const after = projectTurn(state, draft, [...result.worldCommands, ...result.taskCommands, ...result.eventCommands]);
    expect(after.events.event_extortion_at_school_38th.status).toBe('active');
    expect(after.npc).toEqual(state.npc); expect(after.protagonist).toEqual(state.protagonist);
    expect(after.events.event_supervision_inspection_38th.status).toBe('scheduled');
    const known = protagonistKnownEvent(after.events.event_supervision_inspection_38th);
    expect(JSON.stringify(known)).toContain('市纪检与督导组按计划将于上午');
    expect(JSON.stringify(known)).not.toContain('2026-10-20T11:00');
    expect(result.futureEvents[0]).toEqual(after.events.event_supervision_inspection_38th);
    expect(state).toEqual(before);
  });
  it('saves nonempty candidates then commits and reloads the same scene event exactly once', async () => {
    const {state, draft} = groundedContext();
    const repo = await SaveRepository.open('scene-record-commit', new IDBFactory());
    try {
      await repo.create(state);
      await repo.saveDraft(createTurnDraft(state.saveId, state.revision, draft.turnId, draft.turnKind, ''), null);
      const result = parseWorld(JSON.stringify(original), state, draft);
      const ready = await completeDraft(repo, {narrative: draft.story!.narrative, variables: draft.variables!.result, world: result});
      expect((await repo.loadGame(state.saveId)).state).toEqual(state);
      const saved = await repo.commitTurn(submission(ready, '继续处理纠纷'));
      expect(saved.state.events.event_extortion_at_school_38th.actorRefs).toEqual(original.eventCommands[0].event.actorRefs);
      expect(saved.state.events.event_supervision_inspection_38th.status).toBe('scheduled');
      expect((await repo.commitTurn(submission(ready, '继续处理纠纷'))).replayed).toBe(true);
      expect(await repo.load(state.saveId)).toEqual(saved.state);
    } finally { repo.close(); }
  });
  it.each(['title', 'backgroundText', 'goalText', 'resolutionText'] as const)('rejects invented scene action hidden in %s', field => {
    const {state, draft, response} = groundedContext();
    const command = response.eventCommands[0];
    if (command.type !== 'SaveEvent') throw Error('fixture');
    command.event[field] = '主角答应付款，刘成福殴打主角。';
    expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow();
  });
  it('a plan with no actual notice cannot grant protagonist knowledge', () => {
    const {state,draft,response} = groundedContext();
    draft.story!.narrative = draft.story!.narrative.replace(JSON.parse(response.eventCommands[1].evidence).fact, '');
    expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'player_knowledge'})}));
  });
  it('mere actor references do not authorize autonomous scene event records', () => {
    const {state,draft,response} = groundedContext();
    response.eventCommands[0].evidence = JSON.stringify({...JSON.parse(response.eventCommands[0].evidence),kind:'derived'});
    expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow();
  });
  it('scene record authority never grants UpdateNpc authority', () => {
    const {state,draft,response} = groundedContext();
    response.worldCommands.push({type:'UpdateNpc',commandId:'scene-change',npcId:'npc_liu_san',expectedRevision:state.revision,changes:{healthText:'受伤'},evidence:response.eventCommands[0].evidence});
    expect(() => parseWorld(JSON.stringify(response),state,draft)).toThrow();
  });
});
