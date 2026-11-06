import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../domain/state';
import type { WorldEvent } from '../domain/events/schema';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { worldState, worldDraft, worldResult, proof } from './fixtures/world';
import { event } from './fixtures/game';

function due() {
  const state = worldState(), draft = worldDraft();
  state.events.review = {...event('review'), status:'active', actorRefs:[{kind:'npc',id:'npc-a'}],
    estimatedEndAt:'2026-10-18T08:05:00+08:00', impact:'significant',
    continuation:{direction:'protagonist',reason:'需要当面听取主角意见',entry:{channel:'电话',cue:'值班室来电，请你说明情况。'}}};
  return {state:GameStateSchema.parse(state), draft};
}
function queue(a: ReturnType<typeof due>) {
  return {...worldResult(),eventCommands:[{type:'SaveEvent',commandId:'queue-review',
    event:{...a.state.events.review,sourceTurnIds:[a.draft.turnId]},
    evidence:proof({sources:['event:review','npc:npc-a'],fact:'整理人员完成了约谈前的材料清点。',rationale:'材料已齐备，按既定电话联系方案将问题交给主角答复。'})}]};
}
describe('due continuation candidates',()=>{
  it('queues a due protagonist entry, without resolving the event or changing knowledge',()=>{
    const a=due(),before=structuredClone(a.state),result=parseWorld(JSON.stringify(queue(a)),a.state,a.draft);
    const projected=projectTurn(a.state,a.draft,result.eventCommands);
    expect(projected.events.review.protagonistEntry).toMatchObject({status:'pending',sourceTurnId:a.draft.turnId,cue:'值班室来电，请你说明情况。'});
    expect(projected.events.review.status).toBe('active');expect(projected.npc).toEqual(before.npc);
    expect(projected.protagonist).toEqual(before.protagonist);expect(a.state).toEqual(before);
  });
  it('does not queue before the actual projected deadline',()=>{
    const a=due();a.state.events.review.estimatedEndAt='2026-10-18T09:00:00+08:00';
    const result=parseWorld(JSON.stringify(queue(a)),a.state,a.draft);
    expect(projectTurn(a.state,a.draft,result.eventCommands).events.review.protagonistEntry).toBeUndefined();
  });
});

import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import { validateStoryEventInteractions, pendingEventEntries } from '../domain/events/interactions';
import { contextFor } from '../prompts/context';
import { defaultSettings } from '../ui/settings/model';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { vi } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { completeDraft, submission } from './fixtures/turn';

function queuedState() {
  const a=due(),result=parseWorld(JSON.stringify(queue(a)),a.state,a.draft);
  const state=projectTurn(a.state,a.draft,result.eventCommands);
  // A real journal is supplied by commit tests below; pure projection state keeps its formal revision.
  return {...a,state};
}
function selected(a: ReturnType<typeof queuedState>,action:'presented'|'declined'|'left'|'interrupted'|'invalidated'='presented') {
  const entry=a.state.events.review.protagonistEntry!;
  const text=action==='presented'?entry.cue:'主角明确拒绝本次约谈，调查仍由原单位负责。';
  const story={turnKind:'opening' as const,narrative:text,summary:text,variableGuide:[{group:'event' as const,observedFact:'本幕实际行为',textEvidence:text,
    eventInteraction:{eventId:'review',entryId:entry.id,action}}]};
  const draft=rerollStory(createTurnDraft(a.state.saveId,a.state.revision,`receipt-turn-${a.state.revision}`,'opening',''),story);
  return TurnDraftSchema.parse({...draft,variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{commands:[],rejectedSuggestions:[],unresolved:[]}},stageStatus:{...draft.stageStatus,variables:'ready'}});
}
describe('Story receipts are atomic projections, not early consumption',()=>{
  it('exposes only the external cue; no hidden background, goals, other NPC knowledge or event result',()=>{
    const {state}=queuedState();state.events.review.backgroundText='绝密调查线索';
    const ctx=contextFor({state,stage:'story',mode:'regular',settings:defaultSettings(),userInput:'继续'});
    expect(ctx.EVENT_ENTRIES).toEqual(pendingEventEntries(state));
    expect(JSON.stringify(ctx)).not.toContain('绝密调查线索');
    expect(state.events.review.protagonistEntry?.status).toBe('pending');
  });
  it.each(['presented','declined','invalidated','interrupted'] as const)('%s updates the same entry but never cancels the event or spreads NPC memories',action=>{
    const a=queuedState(),before=structuredClone(a.state),draft=selected(a,action);
    const after=projectTurn(a.state,draft);
    expect(after.events.review.protagonistEntry).toMatchObject({status:action,handledTurnId:draft.turnId});
    expect(after.events.review.status).toBe('active');expect(after.npc).toEqual(before.npc);expect(a.state).toEqual(before);
    expect(pendingEventEntries(after)).toEqual([]);
  });
  it('later exit updates the already presented entry instead of replaying or cancelling the event',()=>{
    const a=queuedState(),first=projectTurn(a.state,selected(a));
    const next={...a,state:first},draft=selected(next,'left');
    const after=projectTurn(first,draft);expect(after.events.review.protagonistEntry?.status).toBe('left');expect(after.events.review.status).toBe('active');
  });
  it.each(['omitted','wrong-id','replayed'] as const)('rejects %s receipt through the real projection path',kind=>{
    const a=queuedState(),draft=selected(a);
    if(kind==='omitted')draft.story!.variableGuide=[];
    if(kind==='analysis-only')draft.story!.narrative='主角继续休息，没有来电。';
    if(kind==='wrong-id')draft.story!.variableGuide[0].eventInteraction!.entryId='invented';
    if(kind==='replayed')a.state=projectTurn(a.state,draft);
    expect(()=>projectTurn(a.state,draft)).toThrow();
  });
  it('keeps original pending entries on Roll/candidate-only work; no request or database mutation',()=>{
    const a=queuedState(),draft=selected(a),before=structuredClone(a.state);
    projectTurn(a.state,draft);
    const rolled=rerollStory(draft,{...draft.story!,narrative:'改写正文',variableGuide:[]});
    expect(rolled.variables).toBeUndefined();expect(rolled.world).toBeUndefined();
    expect(a.state).toEqual(before);expect(pendingEventEntries(a.state)).toHaveLength(1);
    expect(()=>validateStoryEventInteractions(a.state,rolled.story!)).toThrow();
  });
  it('order is deterministic and every pending entry must receive an actual narrative receipt',()=>{
    const a=queuedState();a.state.events.second={...a.state.events.review,id:'second'};
    expect(pendingEventEntries(a.state).map(e=>e.eventId)).toEqual(['review','second']);
    expect(()=>projectTurn(a.state,selected(a))).toThrow();
  });
  it('legacy events with no continuation/entry remain unchanged and acquire no invented knowledge',()=>{
    const state=worldState();state.events.legacy=event('legacy');
    const parsed=GameStateSchema.parse(state);expect(parsed.events.legacy.continuation).toBeUndefined();
    expect(pendingEventEntries(parsed)).toEqual([]);expect(parsed.events.legacy.protagonistKnowledge).toBeUndefined();
  });
  it('a pending protagonist event cannot be prematurely resolved even with a completion decision',()=>{
    const a=queuedState();a.draft=createTurnDraft(a.state.saveId,a.state.revision,'invalid-finish','opening','');
    // Selected Story must first handle the pending cue; direct forged World candidate still cannot bypass it.
    a.draft=selected(a);
    const response=queue(a);const c=response.eventCommands[0];
    c.event={...c.event,status:'resolved',resolvedAt:a.state.worldClock,resolutionText:'材料处理结束。',outcome:'success'};
    expect(()=>parseWorld(JSON.stringify(response),a.state,a.draft)).toThrow();
  });
});

describe('real candidate persistence and atomic handoff receipt commit',()=>{
  it('N queues, N+1 presents once; failed transaction rolls everything back; refresh and replay do not resurrect entries',async()=>{
    const a=due(); a.draft.turnKind='opening'; a.draft.story!.turnKind='opening';
    const repo=await SaveRepository.open('handoff-commit',new IDBFactory());
    try {
      await repo.create(a.state);
      await repo.saveDraft(createTurnDraft(a.state.saveId,a.state.revision,a.draft.turnId,a.draft.turnKind,''),null);
      const normalized=parseWorld(JSON.stringify(queue(a)),a.state,a.draft);
      const ready=await completeDraft(repo,{world:normalized});
      const first=await repo.commitTurn(submission(ready,'接电话'));
      expect(pendingEventEntries(first.state)).toHaveLength(1);expect(first.draft.story).toBeUndefined();
      const entry=first.state.events.review.protagonistEntry!;
      const text=entry.cue;
      const second=await completeDraft(repo,{narrative:text,summary:'收到约谈来电，尚未接受。',
        variableGuide:[{group:'event',observedFact:'实际来电',textEvidence:text,eventInteraction:{eventId:'review',entryId:entry.id,action:'presented'}}],
        variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
      expect((await repo.load('save-a')).events.review.protagonistEntry?.status).toBe('pending');
      const put=IDBObjectStore.prototype.put;
      const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){
        if(this.name==='saves')throw Error('mock atomic rollback');return put.apply(this,args);
      });
      await expect(repo.commitTurn(submission(second,''))).rejects.toThrow();spy.mockRestore();
      expect((await repo.load('save-a')).events.review.protagonistEntry?.status).toBe('pending');
      expect(await repo.loadDraft('save-a')).toEqual(second);
      const saved=await repo.commitTurn(submission(second,''));
      expect(saved.state.events.review.protagonistEntry?.status).toBe('presented');
      expect(saved.draft.userInput).toBe('');expect(pendingEventEntries(saved.state)).toEqual([]);
      expect((await repo.commitTurn(submission(second,''))).replayed).toBe(true);
      expect(await repo.load('save-a')).toEqual(saved.state);
    } finally {vi.restoreAllMocks();repo.close();}
  });
});

describe('world continuation, closure and handoff protections',()=>{
  function finishing(direction:'world'|'end') {
    const a=due();a.state.events.review.continuation=direction==='world'
      ? {direction,reason:'整理后还需独立复核',followup:'复核材料来源'}:{direction,reason:'清点完成，无继续追踪必要'};
    const text='整理人员完成清点并封存材料。';
    const response: ReturnType<typeof worldResult>={...worldResult(),eventCommands:[{type:'SaveEvent',commandId:'finish-review',event:{...a.state.events.review,status:'resolved',resolvedAt:'2026-10-18T08:05:00+08:00',resolutionText:text,sourceTurnIds:[a.draft.turnId]},
      evidence:proof({sources:['event:review','npc:npc-a'],fact:text,decision:{targetId:'review',status:'resolved',reason:'已经完成清点，材料齐备',result:text,conditionsSatisfied:true,continues:false,resultKnowledge:{facts:[text],reported:[],suspected:[]}}})}]};
    return {...a,response};
  }
  it('normal end does not force any successor event',()=>{
    const a=finishing('end'),result=parseWorld(JSON.stringify(a.response),a.state,a.draft);
    expect(result.eventCommands).toHaveLength(1);expect(projectTurn(a.state,a.draft,result.eventCommands).events.review.status).toBe('resolved');
  });
  it('world continuation updates the predecessor and starts a real live successor within the same World batch',()=>{
    const a=finishing('world');
    const followup:WorldEvent={...event('followup'),status:'active',startAt:'2026-10-18T08:06:00+08:00',estimatedEndAt:'2026-10-18T10:00:00+08:00',
      actorRefs:[{kind:'npc',id:'npc-a'}],sourceTurnIds:[a.draft.turnId],predecessorEventIds:['review'],continuation:{direction:'end',reason:'复核之后再决定是否继续'}};
    a.response.eventCommands.push({type:'SaveEvent',commandId:'next-review',event:followup,evidence:proof({sources:['event:review','npc:npc-a'],at:followup.startAt,fact:'整理人员开始复核原始材料。'})});
    const result=parseWorld(JSON.stringify(a.response),a.state,a.draft),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events.review.status).toBe('resolved');expect(after.events.followup.predecessorEventIds).toEqual(['review']);
    expect(after.events.followup.status).toBe('active');expect(Object.keys(after.events)).toHaveLength(2);
  });
  it('world continuation cannot silently omit its planned successor',()=>{
    const a=finishing('world');expect(()=>parseWorld(JSON.stringify(a.response),a.state,a.draft)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'event_continuation'})}));
  });
  it.each(['completed-entry','invented-entry','before-deadline','blocked'] as const)('rejects %s entry metadata or conditions',kind=>{
    const a=due(),response=queue(a),c=response.eventCommands[0];
    if(kind==='before-deadline')Object.assign(c.event,{protagonistEntry:{id:`entry:0:1`,sourceTurnId:a.draft.turnId,queuedAt:'2026-10-18T08:03:00+08:00',channel:'电话',cue:'提前入场',status:'pending'}});
    if(kind==='blocked'){a.state.events.review.blockers=['missing'];c.event.blockers=['missing'];}
    if(kind==='invented-entry'||kind==='completed-entry')Object.assign(c.event,{protagonistEntry:{id:'fake',sourceTurnId:a.draft.turnId,queuedAt:'2026-10-18T08:05:00+08:00',channel:'电话',cue:'伪造内容',status:kind==='completed-entry'?'declined':'pending'}});
    expect(()=>parseWorld(JSON.stringify(response),a.state,a.draft)).toThrow();
  });
  it('closed entry never requeues from the unchanged old plan on retry',()=>{
    const a=queuedState(),draft=selected(a,'declined'),after=projectTurn(a.state,draft);
    after.journal=after.events.review.sourceTurnIds.map((turnId,index)=>({turnId,revision:index+1,story:a.draft.story!,relatedActorRefs:[]}));
    after.turnNumber=after.journal.length;
    const nextDraft=selected(a,'declined');nextDraft.turnKind='regular';nextDraft.story!.turnKind='regular';
    nextDraft.turnId='next-try';nextDraft.baseSaveRevision=after.revision;nextDraft.story!.variableGuide=[];
    const old=after.events.review;
    const candidate={...worldResult(),eventCommands:[{type:'SaveEvent',commandId:'postpone',event:{...old,estimatedEndAt:'2026-10-18T09:00:00+08:00',sourceTurnIds:[...old.sourceTurnIds,nextDraft.turnId]},
      evidence:proof({at:after.worldClock,sources:['event:review','npc:npc-a'],fact:'整理人员转去处理原有材料。'})}]};
    const result=parseWorld(JSON.stringify(candidate),after,nextDraft);
    expect(projectTurn(after,nextDraft,result.eventCommands).events.review.protagonistEntry?.status).toBe('declined');
  });
});

import { worldEventSchedule } from '../domain/events/schedule';
import { safeAiError } from '../services/ai/errors';

describe('protected scene planning and safe entry diagnostics',()=>{
  it('a protected existing scene event can queue its own administrative handoff without acting for participants',()=>{
    const a=due();a.state.events.review.actorRefs=[{kind:'protagonist',id:'hero'},{kind:'npc',id:'scene'}];
    const plan=worldEventSchedule(a.state,projectTurn(a.state,a.draft));
    expect(plan.due).toEqual([expect.objectContaining({eventId:'review',mode:'protagonist_handoff'})]);
    const result=parseWorld(JSON.stringify(queue(a)),a.state,a.draft),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events.review.protagonistEntry?.status).toBe('pending');expect(after.npc).toEqual(a.state.npc);expect(after.protagonist).toEqual(a.state.protagonist);
  });
  it('scene event status can change without executing participant actions',()=>{
    const a=due();a.state.events.review.actorRefs=[{kind:'protagonist',id:'hero'},{kind:'npc',id:'scene'}];
    const response=queue(a);response.eventCommands[0].event.status='blocked';
    const result=parseWorld(JSON.stringify(response),a.state,a.draft),after=projectTurn(a.state,a.draft,result.eventCommands);
    expect(after.events.review.status).toBe('blocked');expect(after.protagonist).toEqual(a.state.protagonist);expect(after.npc).toEqual(a.state.npc);
  });
  it('missing narrative receipts return a fixed actionable error without echoing hidden cues',()=>{
    const a=queuedState();let failure:unknown;
    try{validateStoryEventInteractions(a.state,{turnKind:'regular',narrative:'继续休息',summary:'休息',variableGuide:[]});}catch(error){failure=error;}
    const safe=safeAiError(failure);expect(safe.code).toBe('event_entry');expect(JSON.stringify(safe)).not.toContain(a.state.events.review.protagonistEntry!.cue);
  });
});

it('a completed event does not keep requesting player exit feedback for a historically presented entry',()=>{
  const a=queuedState(),after=projectTurn(a.state,selected(a));
  after.events.review={...after.events.review,status:'resolved',resolvedAt:after.worldClock,resolutionText:'调查已经依法结束。'};
  const context=contextFor({state:after,stage:'story',mode:'regular',settings:defaultSettings(),userInput:'继续生活'});
  expect(context.EVENT_PARTICIPATION).toEqual([]);expect(context.EVENT_ENTRIES).toEqual([]);
});
