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
it('同一World先建地点再建主子事件：入场可用新地点，未创建地点仍拒绝',()=>{
  const now='2027-01-02T00:00:00+08:00',a=stageContext(now);
  const before=structuredClone(a.state);
  const main={...a.state.events['main-stage'],id:'new-parent',title:'新的会面主事件',
    status:'active' as const,startAt:now,estimatedEndAt:'2027-01-10T00:00:00+08:00',
    sourceTurnIds:[a.draft.turnId]};
  const sub={...subStage('new-meeting',now,'2027-01-02T02:00:00+08:00'),
    parentEventId:main.id,locationId:'new-teahouse',sourceTurnIds:[a.draft.turnId],
    continuation:{direction:'protagonist' as const,reason:'玩家可以自主决定是否见面',
      entry:{channel:'当面约定',cue:'受邀前往新茶楼见面',locationId:'new-teahouse'}}};
  a.response.worldCommands=[{type:'CreateLocation',commandId:'new-teahouse-location',
    evidence:'会面地点在本次正文中首次出现',
    location:{id:'new-teahouse',name:'新茶楼',parentId:'chongqing'}}];
  a.response.eventCommands=[stageCommand(main),stageCommand(sub)];
  const result=parse(a);
  expect(result.eventCommands[1]).toMatchObject({event:{protagonistEntry:{status:'pending',locationId:'new-teahouse'}}});
  const after=projectTurn(a.state,a.draft,[...result.worldCommands,...result.eventCommands]);
  expect(after.locations['new-teahouse']?.name).toBe('新茶楼');
  expect(after.events['new-meeting'].protagonistEntry).toMatchObject({status:'pending',locationId:'new-teahouse'});
  expect(a.state).toEqual(before);
  a.response.worldCommands=[];
  expect(()=>parse(a)).toThrow(expect.objectContaining({details:expect.objectContaining({
    worldRule:'event_continuation',fieldPath:'eventCommands.1'})}));
});
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
  const terminal={...endStage(old),continuation:{direction:'protagonist' as const,reason:'原邀请仍需处理',entry:{channel:old.protagonistEntry!.channel,cue:old.protagonistEntry!.cue}}},next={...event('interaction-next'),startAt:old.fixedEndAt!,estimatedEndAt:old.fixedEndAt,sourceTurnIds:['stage-current'],predecessorEventIds:[old.id],continuation:{direction:'protagonist' as const,reason:'下一幕由玩家回应',entry:{channel:'电话',cue:'请说明材料情况'}}};
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

it.each(['success','failure','changed','cancelled'] as const)('%s阶段结束后未呈现旧入场可自然结束，不迫使更换剧情结局',outcome=>{
  const a=stageContext(),old=a.state.events['stage-one'];old.sourceTurnIds=['stage-current'];
  old.protagonistEntry={id:'cancel-entry',sourceTurnId:'stage-current',queuedAt:stageStart,channel:'电话',cue:'待讨论事项',status:'pending'};
  a.response.eventCommands=[stageCommand(endStage(old,outcome)), {...clean(old.id),expectedStatus:outcome==='cancelled'?'cancelled':'resolved'}];
  const next=apply(a);expect(next.events[old.id]).toBeUndefined();expect(next.retiredEvents[old.id].detail?.outcome).toBe(outcome);
  expect(Object.values(next.events).some(e=>e.protagonistEntry)).toBe(false);expect(next.protagonist).toEqual(a.state.protagonist);
});

it('真实新建阶段排队入场→下一轮Story回执→文本Variables提前结案；纯场外无回执仍拒绝',async()=>{
  const {createTurnDraft,rerollStory,TurnDraftSchema}=await import('../domain/drafts');
  const {parseTextVariables}=await import('../services/validation/aiOutputs');
  const {variableTextEnvelope}=await import('./fixtures/variableReply');
  const a=stageContext('2027-01-02T00:00:00+08:00');
  const invited={...subStage('early-invited'),sourceTurnIds:['stage-current'],continuation:{direction:'protagonist' as const,reason:'现在可以电话参与',entry:{channel:'电话',cue:'请核对本阶段材料'}}};
  a.response.eventCommands=[stageCommand(invited)];const normalized=parse(a);
  const ready=TurnDraftSchema.parse({...a.draft,world:{storyRevision:1,candidateRevision:1,requestRevision:0,basedOnVariableRevision:1,validation:'validated',result:normalized},stageStatus:{...a.draft.stageStatus,world:'ready'}});
  const formal=settleTurn(a.state,ready,a.state.updatedAt),entry=formal.events[invited.id].protagonistEntry;
  expect(entry?.status).toBe('pending');
  const next=rerollStory(createTurnDraft('save-a',formal.revision,'early-next','regular','接听并结束本阶段'),{turnKind:'regular',narrative:'主角在通话中完成核对，结束本阶段。',summary:'阶段已由现场实际改变。',variableGuide:[{group:'event',observedFact:'阶段结束',textEvidence:'主角实际完成处理',eventInteraction:{eventId:invited.id,entryId:entry!.id,action:'left'}}]});
  const time='2027-01-02T01:00:00+08:00';
  const text=variableTextEnvelope(`<命令>set worldClock = ${JSON.stringify(time)}\nset events[${invited.id}].sceneState = {"status":"resolved","resolvedAt":"${time}","outcome":"changed","resolutionText":"主角在通话中实际结束了本阶段。"}</命令>`);
  const vars=await parseTextVariables(text,formal,next);
  const selected=TurnDraftSchema.parse({...next,variables:{storyRevision:1,candidateRevision:1,requestRevision:0,validation:'validated',result:vars},stageStatus:{...next.stageStatus,variables:'ready'}});
  expect(projectTurn(formal,selected).events[invited.id].resolvedAt).toBe(time);
  expect(()=>parseWorld(JSON.stringify({...a.response,eventCommands:[]}),formal,selected)).not.toThrow();
  const noReceipt={...next,story:{...next.story!,variableGuide:[]}};
  const illicit=variableTextEnvelope(`<命令>set worldClock = ${JSON.stringify(time)}\nset events[stage-one].sceneState = {"status":"resolved","resolvedAt":"${time}","outcome":"changed","resolutionText":"没有实际入场，试图修改场外阶段。"}</命令>`);
  await expect(parseTextVariables(illicit,formal,noReceipt)).rejects.toThrow();
});

it('阶段已结束仍声明protagonist承接时，必须落地为新的待入场互动，不能丢失计划',()=>{
  const a=stageContext(),source={...endStage(a.state.events['stage-one']),continuation:{direction:'protagonist' as const,reason:'后续需要玩家处理',entry:{channel:'来电',cue:'请讨论后续安排'}}};
  a.response.eventCommands=[stageCommand(source)];expect(()=>parse(a)).toThrow();
  const target={...event('new-interaction'),startAt:source.fixedEndAt!,estimatedEndAt:stageNow,sourceTurnIds:['stage-current'],predecessorEventIds:[source.id],continuation:source.continuation};
  a.response.eventCommands.push(stageCommand(target));expect(apply(a).events[target.id].protagonistEntry?.status).toBe('pending');
});

it('后台后继与待入场后继可以并存，明确前序不强迫跨组织阶段同父',()=>{
  const a=stageContext(),old=a.state.events['stage-one'];old.sourceTurnIds=['stage-current'];
  old.protagonistEntry={id:'parallel-entry',sourceTurnId:'stage-current',queuedAt:stageStart,channel:'电话',cue:'保留这次邀请',status:'pending'};
  const source={...endStage(old),continuation:{direction:'world' as const,reason:'另有后台职责',followup:'根据阶段结果继续处理'}};
  const other={...a.state.events['main-stage'],id:'other-main',title:'另一组织的独立事务',actorRefs:[{kind:'organization' as const,id:'org-stage-b'}],sourceTurnIds:['stage-current']};
  const background={...subStage('other-followup',old.fixedEndAt,'2027-05-01T00:00:00+08:00'),parentEventId:other.id,actorRefs:other.actorRefs,predecessorEventIds:[old.id],sourceTurnIds:['stage-current']};
  const interaction={...event('parallel-interaction'),startAt:old.fixedEndAt!,estimatedEndAt:stageNow,predecessorEventIds:[old.id],sourceTurnIds:['stage-current'],continuation:{direction:'protagonist' as const,reason:'原邀请由玩家继续决定',entry:{channel:'电话',cue:'保留这次邀请'}}};
  a.response.eventCommands=[source,other,background,interaction].map(stageCommand);
  const next=apply(a);expect(next.events[background.id].parentEventId).toBe(other.id);expect(next.events[interaction.id].protagonistEntry?.status).toBe('pending');
});
