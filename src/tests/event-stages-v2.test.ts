import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { stageContext, subStage, endStage, stageCommand, stageStart, stageNow } from './fixtures/eventStages';
import { parseWorld } from '../services/validation/aiOutputs';
import { worldEventSchedule } from '../domain/events/schedule';
import { projectTurn } from '../domain/turnProjection';
import { commitCommands } from '../domain/commands';
import { stageResults, validateStageSettlement } from '../domain/events/stages';
import { historicalEvent } from '../domain/events/lifecycle';
import { settleTurn } from '../domain/turnCommit';
import { GameStateSchema } from '../domain/state';
import { SaveRepository } from '../services/storage/saveRepository';
import { completeDraft, submission, elapsedVariables } from './fixtures/turn';
import { event } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
const parse=(a:ReturnType<typeof stageContext>)=>parseWorld(JSON.stringify(a.response),a.state,a.draft);
const apply=(a:ReturnType<typeof stageContext>)=>{const r=parse(a);return projectTurn(a.state,a.draft,[...r.worldCommands,...r.taskCommands,...r.eventCommands]);};
const clean=(id:string):Extract<DomainCommand,{type:'DeleteEvent'}>=>({type:'DeleteEvent',commandId:`clean:${id}`,eventId:id,expectedStatus:'resolved',reason:'保留成果后清理',evidence:'合成测试'});
it('main估期不是截止，sub恰好到期/积压才进队列，未到期不例行改写',()=>{
  const a=stageContext('2027-01-02T00:00:00+08:00');expect(worldEventSchedule(a.state,projectTurn(a.state,a.draft)).due).toEqual([]);
  expect(parse(a).eventCommands).toEqual([]);
  a.response.eventCommands=[stageCommand({...a.state.events['stage-one'],title:'例行重写',sourceTurnIds:['stage-current']})];
  expect(()=>parse(a)).toThrow();expect(()=>commitCommands(a.state,'stage-current',0,a.response.eventCommands)).toThrow();
  const b=stageContext('2027-01-03T00:00:00+08:00'),c=stageContext();
  expect(worldEventSchedule(b.state,projectTurn(b.state,b.draft)).due).toEqual([expect.objectContaining({eventId:'stage-one',fixedEndAt:'2027-01-03T00:00:00+08:00',mode:'stage_resolution'})]);
  expect(worldEventSchedule(c.state,projectTurn(c.state,c.draft)).due.some(e=>e.eventId==='main-stage')).toBe(false);
  expect(()=>parse(b)).toThrow();expect(()=>parse(c)).toThrow();
});
it.each(['success','failure','changed','cancelled'] as const)('到期%s按原fixedEndAt留存结果，不把叙事阻碍当许可',outcome=>{
  const a=stageContext(),end=endStage(a.state.events['stage-one'],outcome);a.response.eventCommands=[stageCommand(end)];
  expect(apply(a).events['stage-one']).toEqual(end);
  const wrong={...end,resolvedAt:stageNow};a.response.eventCommands=[stageCommand(wrong)];
  expect(()=>parse(a)).toThrow();expect(()=>commitCommands(a.state,'stage-current',0,[{type:'SetWorldClock',commandId:'clock',worldClock:stageNow,evidence:'测试'},stageCommand(wrong)])).toThrow();
});
it('同一World跨多个阶段结算，失败后继续、显式前序排序、并行势力独立到期',()=>{
  const a=stageContext(),one={...endStage(a.state.events['stage-one'],'failure'),continuation:{direction:'world' as const,reason:'仍有真实后续',followup:'继续核对'}};
  const two={...endStage({...subStage('stage-two',one.fixedEndAt,'2027-01-07T00:00:00+08:00'),predecessorEventIds:[one.id]}),continuation:{direction:'world' as const,reason:'需要调查',followup:'调查资料'}};
  const three=endStage({...subStage('stage-three',two.fixedEndAt,'2027-02-20T00:00:00+08:00'),predecessorEventIds:[two.id]});
  const four={...subStage('stage-four',three.fixedEndAt,'2027-05-15T00:00:00+08:00'),predecessorEventIds:[three.id],sourceTurnIds:['stage-current']};
  a.state.events.parallel={...subStage('parallel',stageStart,'2027-05-20T00:00:00+08:00'),actorRefs:[{kind:'organization',id:'org-stage-b'}]};
  a.response.eventCommands=[four,three,two,one].map(stageCommand);
  const next=apply(a);expect(next.events['stage-one'].fixedEndAt).toBe('2027-01-03T00:00:00+08:00');
  expect(next.events['stage-three'].status).toBe('resolved');expect(next.events['stage-four'].status).toBe('active');
  expect(next.events.parallel).toEqual(a.state.events.parallel);expect(next.events['main-stage']).toEqual(a.state.events['main-stage']);
  expect(worldEventSchedule(next,next).due).toEqual([]);
});
it('三并行阶段仅到期者结案；缺成果、非法前序/ID/改固定时间整批拒绝',()=>{
  const a=stageContext();a.state.events.second=subStage('second',stageStart,'2027-06-01T00:00:00+08:00');a.state.events.third=subStage('third',stageStart,'2027-07-01T00:00:00+08:00');
  a.response.eventCommands=[stageCommand(endStage(a.state.events['stage-one']))];expect(Object.values(apply(a).events).filter(e=>e.status==='active')).toHaveLength(2);
  const ended=endStage(a.state.events['stage-one']);
  for(const bad of [{...ended,outcome:undefined},{...ended,resolutionText:''},{...ended,predecessorEventIds:['missing']},{...ended,fixedEndAt:stageNow}]) {
    a.response.eventCommands=[stageCommand(bad)];expect(()=>parse(a)).toThrow();
  }
});
it('安全退役保留唯一阶段成果；主事件退役后仍能读父子及前序，历史引用不悬空',()=>{
  const a=stageContext(),one=endStage(a.state.events['stage-one']),two=endStage({...subStage('stage-two',one.fixedEndAt,'2027-02-01T00:00:00+08:00'),predecessorEventIds:[one.id]});
  const parent={...a.state.events['main-stage'],status:'resolved' as const,resolvedAt:'2027-03-01T00:00:00+08:00',resolutionText:'整体工作结束',sourceTurnIds:['stage-current']};
  a.response.eventCommands=[stageCommand(two),stageCommand(parent),stageCommand(one),clean(one.id),clean(two.id),clean(parent.id)];
  a.response.worldCommands=[{type:'RecordHistory',commandId:'history-stage',evidence:'合成史料',entry:{id:'stage-history',title:'阶段结束',summary:'保留阶段结果',knowledgeKind:'reported',eventId:one.id,actorRefs:[],relatedEntryIds:[]}}];
  const next=apply(a);expect(next.events).toEqual({});expect(stageResults(next,parent.id)).toHaveLength(2);
  expect(stageResults(next,parent.id)[0]).toMatchObject({resolutionText:one.resolutionText,resultKnowledge:one.resultKnowledge,outcome:'success'});
  expect(historicalEvent(next,one.id)?.resolvedAt).toBe(one.fixedEndAt);expect(GameStateSchema.parse(next)).toEqual(next);
  const view=stageResults(next,parent.id);view[0].resultKnowledge?.facts.push('不能修改正式成果');view[0].sourceTurnIds.push('not-formal');
  expect(next.retiredEvents[one.id].detail?.resultKnowledge).toEqual(one.resultKnowledge);expect(next.retiredEvents[one.id].sourceTurnIds).not.toContain('not-formal');
});
it('不完整旧阶段保守保留、不补造；人物知识或规划引用仍保护完整记录',()=>{
  const a=stageContext(),one=endStage(a.state.events['stage-one']);a.response.eventCommands=[stageCommand(one)];const next=apply(a);
  const npc=next.npc['npc-a'];if(npc.kind!=='special')throw Error('fixture needs special NPC');
  npc.activeGoals=[`event-plan:${one.id}`];
  expect(()=>commitCommands(next,'clean',next.revision,[clean(one.id)])).toThrow();
  const incomplete={...next.events[one.id],outcome:undefined};next.events[one.id]=incomplete;
  expect(GameStateSchema.safeParse(next).success).toBe(true);expect(()=>commitCommands(next,'clean',next.revision,[clean(one.id)])).toThrow();
});
it.each(['pending','presented'] as const)('%s到期入场移交新互动，阶段不无限延期也不替玩家回应',status=>{
  const a=stageContext(),old=a.state.events['stage-one'];
  old.protagonistEntry={id:'entry-old',sourceTurnId:'stage-current',queuedAt:stageStart,channel:'电话',cue:'请说明材料情况',status,
    ...(status==='presented'?{handledTurnId:'stage-current',textEvidence:'已接听'}:{})};old.sourceTurnIds=['stage-current'];
  const terminal=endStage(old),next={...event('interaction-next'),startAt:old.fixedEndAt!,estimatedEndAt:old.fixedEndAt,sourceTurnIds:['stage-current'],predecessorEventIds:[old.id],continuation:{direction:'protagonist' as const,reason:'下一幕由玩家回应',entry:{channel:'电话',cue:'请说明材料情况'}}};
  a.response.eventCommands=[stageCommand(next),stageCommand(terminal),clean(old.id)];const r=parse(a);const again=parseWorld(JSON.stringify(r),a.state,a.draft);expect(again).toEqual(r);
  const result=projectTurn(a.state,a.draft,r.eventCommands);expect(result.events[old.id]).toBeUndefined();
  expect(result.retiredEvents[old.id].status).toBe('resolved');expect(result.events[next.id].protagonistEntry?.status).toBe(status);
  expect(result.protagonist).toEqual(a.state.protagonist);expect(result.npc).toEqual(a.state.npc);
  a.response.eventCommands=[stageCommand(terminal)];expect(()=>parse(a)).toThrow();
});
it('World不能提前结案或伪造接听；只有合法Story/Variables现场结果可提前结束',()=>{
  const a=stageContext('2027-01-02T00:00:00+08:00'),old=a.state.events['stage-one'];
  old.actorRefs=[{kind:'protagonist',id:'hero'}];old.protagonistEntry={id:'entry-scene',sourceTurnId:'stage-current',queuedAt:stageStart,channel:'当面',cue:'核对材料',status:'pending'};old.sourceTurnIds=['stage-current'];
  const early={...endStage(old),continuation:old.continuation,resolvedAt:'2027-01-02T00:00:00+08:00'};
  a.response.eventCommands=[stageCommand(early)];expect(()=>parse(a)).toThrow();
  a.draft.story!.variableGuide=[{group:'event',observedFact:'已经处理',textEvidence:'主角当面核对，实际结束了本阶段',eventInteraction:{eventId:old.id,entryId:'entry-scene',action:'left'}}];
  a.draft.variables!.result.commands.push(stageCommand(early));a.response.eventCommands=[];
  expect(apply(a).events[old.id].resolvedAt).toBe(early.resolvedAt);
  a.response.eventCommands=[stageCommand(projectTurn(a.state,a.draft).events[old.id])];expect(()=>parse(a)).toThrow();a.response.eventCommands=[];
  a.response.worldCommands=[{type:'UpdateProtagonist',protagonistId:'hero',commandId:'world-move',expectedRevision:0,changes:{locationId:'clinic'},evidence:'伪造移动'}];expect(()=>parse(a)).toThrow();
});
it('真实纯历史回顾不结算现在到期阶段，时钟和正式状态不变',()=>{
  const a=stageContext();a.state.worldClock='2027-01-04T00:00:00+08:00';
  a.draft.userInput='切换到同事的视角，描写他昨天晚上的经历。';
  a.draft.story!.variableGuide=[{group:'time',subjectHint:'time:retrospective',observedFact:JSON.stringify({npcId:'npc-a',perspectiveRequest:'切换到同事的视角',pastRequest:'描写他昨天晚上的经历',temporalScope:'past_only',currentPlotAdvances:false})}];
  a.draft.variables!.result.commands=[];a.response.visibleHooks=[];const before=structuredClone(a.state);
  expect(parse(a).eventCommands).toEqual([]);expect(a.state).toEqual(before);expect(worldEventSchedule(a.state,a.state).due).toHaveLength(1);
  const b=stageContext();expect(()=>validateStageSettlement(b.state,projectTurn(b.state,b.draft),'stage-current')).toThrow();
});
const repos:SaveRepository[]=[];afterEach(()=>{vi.restoreAllMocks();repos.splice(0).forEach(r=>r.close());});
it('Repository候选→多阶段结案及清理→Commit/重载→重放→后续回合→撤回，不重复结果；事务故障全回滚',async()=>{
  const a=stageContext(),repo=await SaveRepository.open('stages-v2',new IDBFactory());repos.push(repo);await repo.create(a.state);
  const selected=await completeDraft(repo,{variables:a.draft.variables!.result});
  a.draft=selected;
  // completeDraft's real turn ID is authoritative for sources.
  const one={...endStage(a.state.events['stage-one']),sourceTurnIds:[selected.turnId]};
  a.response.eventCommands=[stageCommand(one),clean(one.id)];
  const normalized=parse(a),ready=await repo.saveDraft({...selected,draftRevision:selected.draftRevision+1,world:{...selected.world!,candidateRevision:selected.world!.candidateRevision+1,result:normalized}},selected.draftRevision);
  const before=await repo.loadGame('save-a'),put=IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw Error('synthetic transaction failure');return put.apply(this,args);});
  await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();vi.restoreAllMocks();expect(await repo.loadGame('save-a')).toEqual(before);
  const first=await repo.commitTurn(submission(ready,''));expect(first.state.events[one.id]).toBeUndefined();expect(stageResults(first.state,'main-stage')).toHaveLength(1);
  expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);expect((await repo.loadGame('save-a')).state).toEqual(first.state);
  const next=await completeDraft(repo,{variables:await elapsedVariables(repo,'继续生活',60)}),second=await repo.commitTurn(submission(next,''));
  const restored=await repo.undoTurn({saveId:'save-a',expectedRevision:second.state.revision,expectedDraft:second.draft,operationId:'stage-undo'});
  expect(stageResults(restored.state,'main-stage')).toEqual(stageResults(first.state,'main-stage'));
});
it.each(['opening','regular'] as const)('实际%s World请求包含分类时间与阶段成果契约',async mode=>{
  const a=stageContext();a.draft.turnKind=mode;a.draft.story!.turnKind=mode;
  const prompt=await composePrompt({stage:'world',mode,state:a.state,draft:a.draft,userInput:'',settings:defaultSettings()});
  const text=prompt.messages.map(m=>m.content).join('\n');expect(text).toContain('fixedEndAt');expect(text).toContain('EVENT_STAGE_RESULTS');
  expect(text).toContain('main的estimatedEndAt仅供参考');expect(text).toContain('sub不得修改fixedEndAt延期');
});

it('领域最终结算不信任validated标签，遗漏到期阶段仍拒绝',()=>{
  const a=stageContext();const forged={...a.draft,world:{storyRevision:1,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated' as const,result:a.response},stageStatus:{...a.draft.stageStatus,world:'ready' as const}};
  expect(()=>settleTurn(a.state,forged,a.state.updatedAt)).toThrow(expect.objectContaining({code:'STAGE_DUE'}));
});

it('真实WorldStage单次Mock失败保留上游，手动重试后按原候选提交，Roll使结果失效',async()=>{
  const {WorldStage}=await import('../workflows/worldStage'),{AiClient}=await import('../services/ai/client');
  const {defaultAiConfig,newChannel}=await import('../services/ai/configuration'),{CredentialVault}=await import('../services/ai/credentials');
  const {rerollStory}=await import('../domain/drafts');
  const a=stageContext(),repo=await SaveRepository.open('stage-runtime',new IDBFactory());repos.push(repo);await repo.create(a.state);
  const selected=await completeDraft(repo,{variables:a.draft.variables!.result}),source=endStage(a.state.events['stage-one']);source.sourceTurnIds=[selected.turnId];
  let invalid=true;
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({choices:[{message:{content:JSON.stringify({...a.response,eventCommands:[stageCommand({...source,...(invalid?{outcome:undefined}:{})})]})},finish_reason:'stop'}]}));
  const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='stage-mock';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'stage-mock'};
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  const vault=new CredentialVault(storage,storage);vault.set(channel.id,'stage-test-only');
  const stage=new WorldStage(repo,new AiClient(fetcher)),options={config,vault,settings:defaultSettings()};
  try {
    await expect(stage.generate({...options,draft:selected})).rejects.toThrow();const failed=await repo.loadDraft('save-a');
    expect(failed?.story).toEqual(selected.story);expect(failed?.variables).toEqual(selected.variables);expect(await repo.load('save-a')).toEqual(a.state);
    invalid=false;const ready=await stage.generate({...options,draft:failed!});expect(fetcher).toHaveBeenCalledTimes(2);
    const rolled=rerollStory(ready,ready.story!);expect(rolled.world).toBeUndefined();expect(()=>settleTurn(a.state,rolled,a.state.updatedAt)).toThrow();
    const saved=await repo.commitTurn(submission(ready,''));expect(saved.state.events['stage-one'].resolvedAt).toBe(source.fixedEndAt);
    expect((await repo.loadGame('save-a')).state).toEqual(saved.state);expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {stage.dispose();}
});
it('同轮主事件实际结案、阶段紧凑化和重大纪事按主事件开始定位；错误时间拒绝',async()=>{
  const {chronicle,historyCommand}=await import('./fixtures/historyV2');
  const a=stageContext(),one=endStage(a.state.events['stage-one']),parent={...a.state.events['main-stage'],status:'resolved' as const,resolvedAt:stageNow,resolutionText:'整体事务结束',sourceTurnIds:['stage-current']};
  const record=historyCommand('main-chronicle',{...chronicle('main-milestone',{precision:'instant',at:stageStart}),category:'world',scope:'organization',scopeText:'合成资料部门',basis:'event_result',endTime:{precision:'instant',at:stageNow}});
  record.entry.eventId=parent.id;record.entry.chronicle!.process=['首阶段结束，其余安排另行处理。'];
  a.response.worldCommands=[record];a.response.eventCommands=[stageCommand(parent),stageCommand(one),clean(one.id),clean(parent.id)];
  const next=apply(a);expect(next.timeline[0].chronicle?.time).toEqual({precision:'instant',at:stageStart});expect(next.events).toEqual({});
  record.entry.chronicle!.time={precision:'instant',at:stageNow};expect(()=>parse(a)).toThrow();
});

it('到期取消尚未呈现的入场可自然结束，不强造后继，不代表玩家拒绝',()=>{
  const a=stageContext(),old=a.state.events['stage-one'];old.sourceTurnIds=['stage-current'];
  old.protagonistEntry={id:'cancel-entry',sourceTurnId:'stage-current',queuedAt:stageStart,channel:'电话',cue:'待讨论事项',status:'pending'};
  a.response.eventCommands=[stageCommand(endStage(old,'cancelled')), {...clean(old.id),expectedStatus:'cancelled'}];
  const next=apply(a);expect(next.events[old.id]).toBeUndefined();expect(next.retiredEvents[old.id].detail?.outcome).toBe('cancelled');
  expect(Object.values(next.events).some(e=>e.protagonistEntry)).toBe(false);expect(next.protagonist).toEqual(a.state.protagonist);
});
