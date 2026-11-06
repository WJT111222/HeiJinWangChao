import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GameStateSchema } from '../domain/state';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import type { DomainCommand } from '../domain/commands';
import { projectTurn, preparedVariableCommands } from '../domain/turnProjection';
import { parseTextVariables, parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { orderWorldCommands } from '../services/validation/worldDependencies';
import { SaveRepository } from '../services/storage/saveRepository';
import { VariableStage } from '../workflows/variableStage';
import { WorldStage } from '../workflows/worldStage';
import { AiError } from '../services/ai/errors';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { defaultSettings } from '../ui/settings/model';
import { event, task } from './fixtures/game';
import { worldState, worldResult, proof } from './fixtures/world';
import { completeDraft, submission } from './fixtures/turn';
import { variableTextEnvelope } from './fixtures/variableReply';

const repos: SaveRepository[] = [], stages: Array<VariableStage|WorldStage> = [];
afterEach(()=>{stages.splice(0).forEach(s=>s.dispose());repos.splice(0).forEach(r=>r.close());vi.restoreAllMocks();});
const end='2026-10-18T08:10:00+08:00';
const scenarios=[
  {entry:'presented',status:'cancelled',action:'left',text:'林舟结束参与并离开，双方当场撤销了这次约谈。'},
  {entry:'presented',status:'cancelled',action:'interrupted',text:'停电使约谈实际终止，林舟停止参与。'},
  {entry:'presented',status:'resolved',action:'left',text:'双方完成核对并当场解决争议，林舟结束参与后离开。'},
  {entry:'pending',status:'cancelled',action:'invalidated',text:'主持人当场撤销约谈，未发出的入场通知随之失效。'},
  {entry:'pending',status:'resolved',action:'invalidated',text:'林舟当面提供了凭据，争议当场解决，原约谈无需举行。'},
] as const;
function formalState() {
  const state=worldState();state.revision=1;state.turnNumber=1;
  state.journal=[{turnId:'previous',revision:1,story:{turnKind:'opening',narrative:'主角在办公室等候。',summary:'在办公室等候。',variableGuide:[]},relatedActorRefs:[]}];
  return state;
}
function scene(entry:'pending'|'presented',text:string,action:'left'|'interrupted'|'invalidated') {
  const state=formalState();
  state.events.meeting={...event('meeting'),status:'active',estimatedEndAt:'2026-10-18T09:00:00+08:00',sourceTurnIds:['previous'],
    continuation:{direction:'protagonist',reason:'需要当面核对',entry:{channel:'来访',cue:'请来办公室核对材料。'}},
    protagonistEntry:{id:'meeting-entry',sourceTurnId:'previous',queuedAt:state.worldClock,channel:'来访',cue:'请来办公室核对材料。',status:entry,
      ...(entry==='presented'?{handledTurnId:'previous',textEvidence:'主角已经来到办公室。'}:{})}};
  const draft=rerollStory(createTurnDraft(state.saveId,state.revision,'current','regular','处理约谈'),{turnKind:'regular',narrative:text,summary:text,
    variableGuide:[{group:'event',observedFact:text,textEvidence:text,eventInteraction:{eventId:'meeting',entryId:'meeting-entry',action}}]});
  return {state:GameStateSchema.parse(state),draft};
}
function textFor(status:'resolved'|'cancelled',text:string) {
  const delta=status==='resolved'?{status,resolvedAt:end,resolutionText:text,outcome:'success'}:{status,resolvedAt:end,resolutionText:text,outcome:'cancelled'};
  return variableTextEnvelope(`<命令>set worldClock = ${JSON.stringify(end)}\nset events[meeting].sceneState = ${JSON.stringify(delta)}</命令>`);
}
function route(reply:()=>string,world:()=>unknown=()=>worldResult()) {
  const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='variables';
  config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'variables'};
  config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};
  const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
  const vault=new CredentialVault(storage,storage);vault.set(channel.id,'composition-mock-key');
  const settings=defaultSettings(),calls:string[]=[];
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{const stage=JSON.parse(String(init?.body)).model;calls.push(stage);
    return Response.json({choices:[{message:{content:stage==='world'?JSON.stringify(world()):reply()},finish_reason:'stop'}]});});
  return {config,vault,settings,client:new AiClient(fetcher),calls};
}
async function repoFor(a:{state:ReturnType<typeof formalState>;draft:TurnDraft}) {
  const repo=await SaveRepository.open('handoff-composition',new IDBFactory());repos.push(repo);
  // Establish real journal/revision through normal transactions; create() is only for new saves.
  await repo.create(worldState());
  await repo.saveDraft(createTurnDraft('save-a',0,'previous','opening',''),null);
  const prior=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
  const committed=await repo.commitTurn(submission(prior,''));
  const commands:DomainCommand[]=[...Object.values(a.state.tasks).map(task=>({type:'SaveTask' as const,commandId:`seed-task:${task.id}`,task,evidence:'测试夹具中的既有正式任务'})),
    ...Object.values(a.state.events).map(event=>({type:'SaveEvent' as const,commandId:`seed-event:${event.id}`,event,evidence:'测试夹具中的既有正式事件'}))];
  await repo.save('save-a',committed.state.revision,'seed-domain',commands);
  await repo.deleteDraft('save-a',committed.draft.draftRevision);
  a.state=await repo.load('save-a');a.draft={...a.draft,baseSaveRevision:a.state.revision};
  const initial=createTurnDraft(a.state.saveId,a.state.revision,a.draft.turnId,a.draft.turnKind,a.draft.userInput);
  const variables=a.draft.variables;
  await repo.saveDraft(initial,null);a.draft=await repo.saveDraft(rerollStory(initial,a.draft.story!),initial.draftRevision);
  if(variables)a.draft=await repo.saveDraft(TurnDraftSchema.parse({...a.draft,draftRevision:a.draft.draftRevision+1,variables,stageStatus:{...a.draft.stageStatus,variables:'ready'}}),a.draft.draftRevision);
  return repo;
}
async function runWorld(repo:SaveRepository,draft:TurnDraft,r:ReturnType<typeof route>) {
  const stage=new WorldStage(repo,r.client);stages.push(stage);return stage.generate({...r,draft});
}
async function runVariables(repo:SaveRepository,draft:TurnDraft,r:ReturnType<typeof route>) {
  const stage=new VariableStage(repo,r.client);stages.push(stage);return stage.generate({...r,draft});
}

describe('R1 actual Variables simulation, candidate persistence and atomic terminal feedback',()=>{
  it.each(scenarios)('$entry + $status + $action composes one final event update, saves and commits/reloads exactly once',async s=>{
    const a=scene(s.entry,s.text,s.action),repo=await repoFor(a),before=structuredClone(a.state),r=route(()=>textFor(s.status,s.text));
    const variables=await runVariables(repo,a.draft,r);
    expect(variables.variables?.validation).toBe('validated');expect(await repo.load('save-a')).toEqual(before);
    expect(()=>parseVariables(JSON.stringify(variables.variables!.result),a.state,variables)).not.toThrow();
    // Exercise the shared production projection before inspecting its command shape.
    projectTurn(a.state,variables);
    const commands=preparedVariableCommands(a.state,variables,variables.variables!.result.commands);
    const events=commands.filter(c=>c.type==='SaveEvent');expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({commandId:'text-v1:s1:c2',event:{status:s.status,protagonistEntry:{status:s.action},resolutionText:s.text}});
    const ready=await runWorld(repo,variables,r);expect(await repo.loadDraft('save-a')).toEqual(ready);
    const projected=projectTurn(a.state,ready);expect(projected.events.meeting.protagonistEntry?.status).toBe(s.action);
    const saved=await repo.commitTurn(submission(ready,''));
    expect(saved.state.events.meeting).toEqual(projected.events.meeting);expect(saved.state.npc).toEqual(before.npc);
    expect(await repo.load('save-a')).toEqual(saved.state);expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);
    expect(saved.state.appliedCommands.filter(c=>c.turnId===ready.turnId)).toHaveLength(2);
    expect(r.calls).toEqual(['variables','world']);
  });
  it('terminal event and receipt roll back together, persisted candidates recover without regeneration',async()=>{
    const s=scenarios[3],a=scene(s.entry,s.text,s.action),repo=await repoFor(a),r=route(()=>textFor(s.status,s.text));
    const ready=await runWorld(repo,await runVariables(repo,a.draft,r),r),before=await repo.loadGame('save-a'),put=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw Error('mock rollback');return put.apply(this,args);});
    await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();spy.mockRestore();expect(await repo.loadGame('save-a')).toEqual(before);
    const loaded=await repo.loadDraft('save-a');if(!loaded)throw Error('missing persisted candidates');
    const saved=await repo.commitTurn(submission(loaded,''));expect(saved.state.events.meeting).toMatchObject({status:'cancelled',protagonistEntry:{status:'invalidated'}});
    expect((await repo.commitTurn(submission(loaded,''))).replayed).toBe(true);expect(r.calls).toHaveLength(2);
  });
  it.each(['missing','duplicate','forged'] as const)('rejects %s receipt before accepting a variable candidate',async kind=>{
    const s=scenarios[3],a=scene(s.entry,s.text,s.action),guides=a.draft.story!.variableGuide;
    if(kind==='missing')a.draft.story!.variableGuide=[];
    if(kind==='duplicate')guides.push(structuredClone(guides[0]));
    if(kind==='forged')guides[0].eventInteraction!.entryId='wrong-entry';
    await expect(parseTextVariables(textFor(s.status,s.text),a.state,a.draft)).rejects.toThrow();
    expect(a.state.events.meeting.protagonistEntry?.status).toBe('pending');
  });
  it('a historical terminal event remains immutable, even when a new Story fabricates an exit receipt',async()=>{
    const s=scenarios[0],a=scene(s.entry,s.text,s.action);a.state.events.meeting={...a.state.events.meeting,status:'cancelled',resolvedAt:a.state.worldClock,resolutionText:'上回合已正式取消。'};
    await expect(parseTextVariables(textFor(s.status,s.text),a.state,a.draft)).rejects.toThrow();
  });
});

function dependencies(kind:'task'|'event') {
  const state=formalState();
  if(kind==='task')state.tasks.prep={...task('prep'),actorRef:{kind:'npc',id:'npc-a'},status:'active',dueAt:'2026-10-18T08:04:00+08:00',goal:'核对材料'};
  else state.events.prep={...event('prep'),actorRefs:[{kind:'npc',id:'npc-a'}],status:'active',estimatedEndAt:'2026-10-18T08:04:00+08:00',sourceTurnIds:['previous'],continuation:{direction:'end',reason:'清点结束不需续篇'}};
  state.events.review={...event('review'),actorRefs:[{kind:'npc',id:'npc-a'}],status:'active',estimatedEndAt:'2026-10-18T08:05:00+08:00',sourceTurnIds:['previous'],prerequisites:[`${kind}:prep`],
    continuation:{direction:'protagonist',reason:'材料齐备后听取当事人意见',entry:{channel:'电话',cue:'接待处来电，请说明情况。'}}};
  const draft=rerollStory(createTurnDraft(state.saveId,state.revision,'current','regular','继续等候'),{turnKind:'regular',narrative:'林舟在办公室等候。',summary:'在办公室等候。',variableGuide:[]});
  const withVars=TurnDraftSchema.parse({...draft,variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:{commands:[{type:'SetWorldClock',commandId:'clock',worldClock:end,evidence:'本回合时间'}],rejectedSuggestions:[],unresolved:[]}},stageStatus:{...draft.stageStatus,variables:'ready'}});
  const text='同事已经核对完材料并封存了清单。',at='2026-10-18T08:04:00+08:00';
  const finish:DomainCommand=kind==='task'?{type:'SaveTask',commandId:'finish-prep',task:{...state.tasks.prep,status:'completed',resolution:{at,outcome:'success',result:text,reason:'核对流程实际完成',sourceTurnId:draft.turnId,resultKnowledge:{facts:[text],reported:[],suspected:[]}}},
    evidence:proof({sources:['task:prep','npc:npc-a'],at,fact:text,decision:{targetId:'prep',status:'completed',reason:'核对流程已经实际完成',result:text,conditionsSatisfied:true,continues:false,resultKnowledge:{facts:[text],reported:[],suspected:[]}}})}
    :{type:'SaveEvent',commandId:'finish-prep',event:{...state.events.prep,status:'resolved',resolvedAt:at,resolutionText:text},
      evidence:proof({sources:['event:prep','npc:npc-a'],at,fact:text,decision:{targetId:'prep',status:'resolved',reason:'清点流程已经实际完成',result:text,conditionsSatisfied:true,continues:false,resultKnowledge:{facts:[text],reported:[],suspected:[]}}})};
  const queue:DomainCommand={type:'SaveEvent',commandId:'queue-review',event:{...state.events.review,sourceTurnIds:['previous','current']},
    evidence:proof({sources:['event:review','npc:npc-a'],at:'2026-10-18T08:06:00+08:00',fact:'材料已经齐备，接待人员整理了沟通问题。'})};
  if(finish.type==='SaveEvent')finish.event.sourceTurnIds=['previous','current'];
  const response={...worldResult(),taskCommands:kind==='task'?[finish]:[],eventCommands:kind==='task'?[queue]:[queue,finish]};
  return {state:GameStateSchema.parse(state),draft:withVars,finish,queue,response};
}
describe('R2 parseWorld reads only previously validated causal prerequisite results',()=>{
  it.each(['task','event'] as const)('completes a %s prerequisite and queues the dependent event, persists/reloads/replays',async kind=>{
    const a=dependencies(kind),repo=await repoFor(a),before=structuredClone(a.state);
    expect(orderWorldCommands([...a.response.taskCommands,...a.response.eventCommands]).map(c=>c.commandId)).toEqual(['finish-prep','queue-review']);
    let normalized:ReturnType<typeof parseWorld>;
    try {normalized=parseWorld(JSON.stringify(a.response),a.state,a.draft);}catch(error){
      if(error instanceof AiError)throw new Error(`R2 parseWorld rejected: ${error.code}/${error.details?.worldRule}`,{cause:error});throw error;
    }
    const r=route(()=>'',()=>a.response),ready=await runWorld(repo,a.draft,r);
    expect(ready.world!.result).toEqual(normalized);expect(await repo.load('save-a')).toEqual(before);
    const saved=await repo.commitTurn(submission(ready,''));expect(saved.state.events.review.protagonistEntry?.status).toBe('pending');
    expect(kind==='task'?saved.state.tasks.prep.status:saved.state.events.prep.status).toBe(kind==='task'?'completed':'resolved');
    expect(await repo.load('save-a')).toEqual(saved.state);expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);expect(r.calls).toEqual(['world']);
  });
  it.each(['task','event'] as const)('same %s batch produces the same candidates regardless of raw command order',kind=>{
    const a=dependencies(kind),reverse={eventCommands:[...a.response.eventCommands].reverse(),taskCommands:[...a.response.taskCommands].reverse(),
      worldCommands:a.response.worldCommands,futureEvents:a.response.futureEvents,visibleHooks:a.response.visibleHooks,timelineCandidates:a.response.timelineCandidates,unresolved:a.response.unresolved};
    expect(JSON.stringify(reverse)).not.toBe(JSON.stringify(a.response));
    const one=parseWorld(JSON.stringify(a.response),a.state,a.draft),two=parseWorld(JSON.stringify(reverse),a.state,a.draft);
    const first=projectTurn(a.state,a.draft,[...one.taskCommands,...one.eventCommands]),second=projectTurn(a.state,a.draft,[...two.taskCommands,...two.eventCommands]);
    expect(first.events).toEqual(second.events);expect(first.tasks).toEqual(second.tasks);
  });
  it.each(['unfinished','cancelled','missing','invalid-prior','time-order','cycle','late-failure'] as const)('rejects %s without mutating the formal state',mode=>{
    const a=dependencies('task'),before=structuredClone(a.state);
    if(mode==='unfinished')a.response.taskCommands=[];
    if(mode==='missing' && a.queue.type==='SaveEvent')a.queue.event.prerequisites=['task:missing'];
    if(mode==='cancelled' && a.finish.type==='SaveTask'){
      a.finish.task.status='cancelled';const p=JSON.parse(a.finish.evidence);p.decision.status='cancelled';p.decision.failure=true;p.fact='资料保管部门撤回了材料，本次核对任务已正式取消。';p.decision.reason='材料撤回使本次核对实际终止';p.decision.result=p.fact;p.decision.resultKnowledge={facts:[p.fact],reported:[],suspected:[]};a.finish.evidence=JSON.stringify(p);
    }
    if(mode==='invalid-prior' && a.finish.type==='SaveTask') delete a.finish.task.resolution;
    if(mode==='time-order' && a.finish.type==='SaveTask')a.finish.task.resolution!.at='2026-10-18T08:11:00+08:00';
    if(mode==='cycle' && a.finish.type==='SaveTask')a.finish.task.prerequisites=['event:review'];
    if(mode==='late-failure')a.response.worldCommands.push({type:'UpdateNpc',commandId:'illegal-scene',npcId:'scene',expectedRevision:1,changes:{onScene:true},evidence:proof({at:'2026-10-18T08:09:00+08:00'})});
    expect(()=>parseWorld(JSON.stringify(a.response),a.state,a.draft)).toThrow();expect(a.state).toEqual(before);
  });
});

describe('R1/R2 replay, permissions and transaction boundaries',()=>{
  it.each(['protagonistEntry','protagonistKnowledge'] as const)('raw model %s tampering cannot be hidden by the program merge',async field=>{
    const s=scenarios[0],a=scene(s.entry,s.text,s.action),before=structuredClone(a.state);
    const result=await parseTextVariables(textFor(s.status,s.text),a.state,a.draft),command=result.commands.find(c=>c.type==='SaveEvent');
    if(!command || command.type!=='SaveEvent')throw Error('missing real compiled command');
    if(field==='protagonistEntry')command.event.protagonistEntry={...command.event.protagonistEntry!,status:'left',handledTurnId:'current',textEvidence:'模型伪造处理'};
    else command.event.protagonistKnowledge={worldUpdateTurnId:'current',title:'模型伪造知情',notice:'尚未获知的秘密',knowledgeKind:'observed'};
    expect(()=>parseVariables(JSON.stringify(result),a.state,a.draft)).toThrow();expect(a.state).toEqual(before);
  });
  it('a changed formal revision prevents a ready terminal-feedback candidate from writing',async()=>{
    const s=scenarios[3],a=scene(s.entry,s.text,s.action),repo=await repoFor(a),r=route(()=>textFor(s.status,s.text));
    const ready=await runWorld(repo,await runVariables(repo,a.draft,r),r);
    const updated=await repo.save('save-a',a.state.revision,'another-tab',[{type:'SetWorldClock',commandId:'other-clock',worldClock:'2026-10-18T08:01:00+08:00',evidence:'另一标签的合法操作'}]);
    await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();expect(await repo.load('save-a')).toEqual(updated);
    expect(updated.events.meeting).toMatchObject({status:'active',protagonistEntry:{status:'pending'}});
  });
  it('late World failure, manual recovery, write rollback and replay preserve both prerequisite and handoff atomically',async()=>{
    const a=dependencies('task'),repo=await repoFor(a),before=structuredClone(a.state);let bad=true;
    const r=route(()=>'',()=>bad?{...a.response,worldCommands:[{type:'UpdateNpc',commandId:'illegal-late',npcId:'scene',expectedRevision:a.state.revision,changes:{onScene:true},evidence:proof({at:'2026-10-18T08:09:00+08:00'})}]}:a.response);
    await expect(runWorld(repo,a.draft,r)).rejects.toThrow();expect(await repo.load('save-a')).toEqual(before);
    const failed=await repo.loadDraft('save-a');if(!failed)throw Error('missing failed World draft');
    expect(failed.stageStatus.world).toBe('failed');expect(failed.variables).toEqual(a.draft.variables);
    bad=false;const ready=await runWorld(repo,failed,r),snapshot=await repo.loadGame('save-a'),put=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw Error('mock World transaction rollback');return put.apply(this,args);});
    await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();spy.mockRestore();expect(await repo.loadGame('save-a')).toEqual(snapshot);
    const reloaded=await repo.loadDraft('save-a');if(!reloaded)throw Error('missing candidates after refresh');
    const saved=await repo.commitTurn(submission(reloaded,''));expect(saved.state.tasks.prep.status).toBe('completed');expect(saved.state.events.review.protagonistEntry?.status).toBe('pending');
    expect((await repo.commitTurn(submission(reloaded,''))).replayed).toBe(true);expect(r.calls).toEqual(['world','world']);
  });
  it('queues at the projected clock, never at an obsolete evidence timestamp before the prerequisite',()=>{
    const a=dependencies('event'),p=JSON.parse(a.queue.evidence);p.at='2026-10-18T08:03:00+08:00';a.queue.evidence=JSON.stringify(p);
    a.state.events.review.estimatedEndAt='2026-10-18T08:02:00+08:00';
    if(a.queue.type==='SaveEvent')a.queue.event.estimatedEndAt=a.state.events.review.estimatedEndAt;
    const result=parseWorld(JSON.stringify(a.response),a.state,a.draft);
    expect(result.eventCommands.find(c=>c.type==='SaveEvent'&&c.event.id==='review')).toMatchObject({event:{protagonistEntry:{queuedAt:end}}});
  });
});
