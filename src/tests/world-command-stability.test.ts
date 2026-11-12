import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { createTurnDraft } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { completeDraft, submission } from './fixtures/turn';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { AiError } from '../services/ai/errors';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { selectWorldDomains } from '../prompts/worldDomains';
import { defaultSettings } from '../ui/settings/model';
import { DomainCommandSchema } from '../domain/commands';
import { worldState, worldDraft, worldResult, npcUpdate, actionTime, projectedTime } from './fixtures/world';
import { event, task, gameTime } from './fixtures/game';
import { worldNpcCreation, worldNpcCommands } from './fixtures/worldNpcCreation';
import { sentContext } from './fixtures/contextAssertions';
import { array, record } from '../services/ai/protocols';

const empty = (): ReturnType<typeof worldResult> => ({...worldResult(), visibleHooks:[], unresolved:[]});
function fixture() {
 const state=worldState(),draft=worldDraft();
 return {state,draft,result:empty()};
}
const parse=(a:ReturnType<typeof fixture>)=>parseWorld(JSON.stringify(a.result),a.state,a.draft);
function eventFixture() {
 const a=fixture();
 // A real earlier committed source, not a fabricated source ID.
 a.state.turnNumber=1;a.state.revision=1;a.draft.baseSaveRevision=1;
 a.state.journal=[{turnId:'prior-turn',revision:1,story:{turnKind:'opening',narrative:'曾安排远程协调。',summary:'协调安排',variableGuide:[]},relatedActorRefs:[]}];
 const prior={...event('coordination'),eventKind:'main' as const,status:'active' as const,estimatedEndAt:'2026-10-19T08:00:00+08:00',sourceTurnIds:['prior-turn']};
 a.state.events[prior.id]=prior;
 a.result.eventCommands=[{type:'SaveEvent',commandId:'update-coordination',evidence:'本轮协调进展',event:{...prior,title:'远程协调进展',sourceTurnIds:['prior-turn',a.draft.turnId]}}];
 return a;
}
it('顶层activeGoals通过，changes内同名字段拒绝；候选不修改正式世界',()=>{
 const a=fixture(),before=structuredClone(a.state),c={...npcUpdate(),activeGoals:['完成诊室整理']};a.result.worldCommands=[c];
 const p=projectTurn(a.state,a.draft,worldNpcCommands(parse(a)));
 expect(p.npc['npc-a']).toMatchObject({healthText:'稍感疲倦',activeGoals:c.activeGoals});expect(a.state).toEqual(before);
 delete (c as {activeGoals?:string[]}).activeGoals;Object.assign(c.changes,{activeGoals:['完成诊室整理']});
 expect(()=>parse(a)).toThrow(expect.objectContaining({code:'schema_fields',details:expect.objectContaining({commandType:'UpdateNpc',fieldPath:'worldCommands.0.changes'})}));expect(a.state).toEqual(before);
});
it.each([gameTime,actionTime,projectedTime])('记忆窗口含两个端点：%s',at=>{
 const a=worldNpcCreation();const c=a.result.worldCommands.find(c=>c.type==='RecordNpcMemory')!;
 if(c.type!=='RecordNpcMemory')throw Error();c.memory.createdAtGameTime=at;
 expect(()=>parse(a)).not.toThrow();
});
it.each(['2026-10-18T07:59:59+08:00','2026-10-18T08:10:01+08:00'])('窗口外记忆%s准确诊断且无状态写入',at=>{
 const a=worldNpcCreation(),before=structuredClone(a.state),c=a.result.worldCommands.find(c=>c.type==='RecordNpcMemory')!;
 if(c.type!=='RecordNpcMemory')throw Error();c.memory.createdAtGameTime=at;
 expect(()=>parse(a)).toThrow(expect.objectContaining({code:'time_data',details:expect.objectContaining({worldRule:'memory_time_window',fieldPath:'worldCommands.2.memory.createdAtGameTime',commandIndex:2,commandType:'RecordNpcMemory'})}));expect(a.state).toEqual(before);
});
it.each(['due','condition','missing','blank','early-result'] as const)('SaveTask结束条件与活动成果：%s',kind=>{
 const a=fixture(),t={...task(),actorRef:{kind:'npc' as const,id:'npc-a'},status:'active' as const};
 if(kind!=='due')delete t.dueAt;
 if(kind==='condition')t.completionCondition='完成资料核对';
 if(kind==='blank')t.completionCondition='   ';
 if(kind==='early-result'){t.completionCondition='完成资料核对';t.resolution={at:actionTime,outcome:'success',result:'已完成',reason:'实际执行',sourceTurnId:a.draft.turnId};}
 a.result.taskCommands=[{type:'SaveTask',commandId:'save-duty',evidence:'场外整理',task:t}];
 if(kind==='due'||kind==='condition')expect(()=>parse(a)).not.toThrow();
 else expect(()=>parse(a)).toThrow(expect.objectContaining({details:expect.objectContaining({commandType:'SaveTask',...(kind==='early-result'?{worldRule:'task_state',fieldPath:'taskCommands.0.task.resolution'}:{worldRule:'task_plan',fieldPath:'taskCommands.0.task'})})}));
});
it('SaveEvent保留旧来源并增加当前回合通过，原正式状态不变',()=>{
 const a=eventFixture(),before=structuredClone(a.state),p=projectTurn(a.state,a.draft,worldNpcCommands(parse(a)));
 expect(p.events.coordination.sourceTurnIds).toEqual(['prior-turn',a.draft.turnId]);expect(a.state).toEqual(before);
});
it.each(['missing-current','missing-prior','unknown-turn'] as const)('SaveEvent来源回合错误：%s',fault=>{
 const a=eventFixture(),c=a.result.eventCommands[0];if(c.type!=='SaveEvent')throw Error();
 c.event.sourceTurnIds=fault==='missing-current'?['prior-turn']:fault==='missing-prior'?[a.draft.turnId]:['prior-turn',a.draft.turnId,'invented-turn'];
 expect(()=>parse(a)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'event_sources',fieldPath:'eventCommands.0.event.sourceTurnIds',commandType:'SaveEvent',commandIndex:0})}));
});
it.each(['startAt','completionCondition'] as const)('SaveEvent不可变字段：%s',field=>{
 const a=eventFixture(),c=a.result.eventCommands[0];if(c.type!=='SaveEvent')throw Error();
 c.event[field]=field==='startAt'?actionTime:'新的完成条件';
 expect(()=>parse(a)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'event_immutable',fieldPath:`eventCommands.0.event.${field}`})}));
});
it.each(['kind','parent','fixed-end','terminal'] as const)('既有主子身份和终态不能改写：%s',fault=>{
 const a=worldNpcCreation();const p=projectTurn(a.state,a.draft,worldNpcCommands(parse(a)));
 const next=worldDraft();next.baseSaveRevision=p.revision;next.variables!.result.commands=[];
 const prior=structuredClone(p.events['remote-sub']);delete prior.protagonistEntry;
 if(fault==='terminal')Object.assign(prior,{status:'resolved',resolvedAt:prior.fixedEndAt,resolutionText:'已结束',outcome:'success',continuation:{direction:'end',reason:'结束'}});
 p.events[prior.id]=prior;p.worldClock='2026-10-18T10:00:00+08:00';
 const changed={...prior,status:'resolved' as const,resolvedAt:prior.fixedEndAt,resolutionText:'已完成工作',outcome:'success' as const,continuation:{direction:'end' as const,reason:'结束'}};
 if(fault==='kind')Object.assign(changed,{eventKind:'main',parentEventId:undefined,fixedEndAt:undefined,estimatedEndAt:prior.fixedEndAt});
 if(fault==='parent')changed.parentEventId='different-main';
 if(fault==='fixed-end')changed.fixedEndAt=changed.resolvedAt='2026-10-18T09:30:00+08:00';
 const output=empty();output.eventCommands=[{type:'SaveEvent',commandId:'change-event',evidence:'测试不可变字段',event:changed}];
 GameStateSchema.parse(p);expect(()=>parseWorld(JSON.stringify(output),p,next)).toThrow(expect.objectContaining({details:expect.objectContaining({commandType:'SaveEvent'})}));
});
it.each(['scene','revision','duplicate-npc','duplicate-org','duplicate-event'] as const)('权限/版本/重复创建仍拒绝：%s',fault=>{
 const a=worldNpcCreation();
 if(fault==='scene'||fault==='revision'){a.result=empty();a.result.worldCommands=[{...npcUpdate(),...(fault==='scene'?{npcId:'scene'}:{expectedRevision:999})}];}
 if(fault==='duplicate-npc')a.state.npc[a.person.id]={...a.state.npc['npc-a'],id:a.person.id,identityKey:a.person.identityKey};
 if(fault==='duplicate-org'){const c=a.result.worldCommands.find(c=>c.type==='CreateOrganization')!;if(c.type==='CreateOrganization')a.state.organizations[c.organization.id]={...structuredClone(c.organization),keyNpcIds:[]};}
 if(fault==='duplicate-event'){const c=a.result.eventCommands[0];if(c.type==='SaveEvent')a.result.eventCommands.push({...structuredClone(c),commandId:'duplicate',event:{...c.event,id:'another-event'}});}
 GameStateSchema.parse(a.state);const before=structuredClone(a.state);expect(()=>parse(a)).toThrow();expect(a.state).toEqual(before);
});
it('空World在无到期事项时合法，到期小事件仍不可省略',()=>{
 const a=fixture();expect(parse(a)).toEqual(empty());
 const b=worldNpcCreation(),p=projectTurn(b.state,b.draft,worldNpcCommands(parse(b))),d=worldDraft();
 d.baseSaveRevision=p.revision;d.variables!.result.commands=[{type:'SetWorldClock',commandId:'advance',evidence:'经过一小时',worldClock:'2026-10-18T09:10:00+08:00'}];
 expect(()=>parseWorld(JSON.stringify(empty()),p,d)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:'stage_due'})}));
});
it.each(['opening','regular'] as const)('%s真实messages的层级示例、时间和状态规则均可见',async mode=>{
 const a=worldNpcCreation();a.draft.turnKind=mode;a.draft.story!.turnKind=mode;
 const prompt=await composePrompt({...a,stage:'world',mode,settings:defaultSettings(),userInput:'继续',domains:selectWorldDomains(a.state,a.draft).domains}),text=prompt.messages.map(m=>m.content).join('\n');
 const context=sentContext(prompt.messages),catalog=record(context.COMMAND_CATALOG),guides=record(catalog.commandGuides);
 const example=record(record(guides.UpdateNpc).example);expect(DomainCommandSchema.safeParse(example).success).toBe(true);
 expect(example.activeGoals).toEqual(['当前行动目标']);expect(record(example.changes)).not.toHaveProperty('activeGoals');
 // Rebind placeholders to actual context, then validate the visible example through the real path.
 a.result=empty();a.result.worldCommands=[DomainCommandSchema.parse({...example,npcId:'npc-a',expectedRevision:context.BASE_SAVE_REVISION})];expect(()=>parse(a)).not.toThrow();
 const update=array(record(catalog.schema).oneOf).map(record).find(s=>record(record(s.properties).type).const==='UpdateNpc')!;
 expect(record(update.properties)).toHaveProperty('activeGoals');expect(record(record(record(update.properties).changes).properties)).not.toHaveProperty('activeGoals');
 for(const token of ['activeGoals 是命令顶层字段','TIME_WINDOW.from ≤ memory.createdAtGameTime ≤ TIME_WINDOW.to','历史事件发生时间','dueAt 或非空 completionCondition','sourceTurnIds','TURN_CONTEXT.turnId','fixedEndAt','结构自检','到期事项'])expect(text).toContain(token);
 expect(context.TIME_WINDOW).toEqual({from:gameTime,to:projectedTime});expect(context.BASE_SAVE_REVISION).toBe(a.state.revision);
 expect(text).not.toContain('NPC_KNOWLEDGE每项');
});

it.each([false,true])('真实WorldStage→Mock→候选→Commit/拒绝：越界=%s，单次请求',async invalid=>{
 const a=worldNpcCreation(),factory=new IDBFactory(),name=`contract-${invalid}`,repo=await SaveRepository.open(name,factory);
 const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='mock-world';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock-world'};
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}},vault=new CredentialVault(storage,storage);vault.set(channel.id,'mock-contract-key');
 a.result.worldCommands.push({...npcUpdate(),activeGoals:['核对新的工作安排']});
 if(invalid){const c=a.result.worldCommands.find(c=>c.type==='RecordNpcMemory');if(c?.type==='RecordNpcMemory')c.memory.createdAtGameTime='2026-10-18T08:10:01+08:00';}
 const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));const context=sentContext(body.messages);
  expect(record(record(context.COMMAND_CATALOG).commandGuides)).toHaveProperty('UpdateNpc');
  expect(JSON.stringify(body.messages)).toContain('结构自检');
  return Response.json({choices:[{message:{content:JSON.stringify(a.result)},finish_reason:'stop'}]});
 });
 const stage=new WorldStage(repo,new AiClient(fetcher));
 try{
  await repo.create(a.state);await repo.saveDraft(createTurnDraft(a.state.saveId,0,a.draft.turnId,'opening',''),null);
  const upstream=await completeDraft(repo,{variables:a.draft.variables!.result});
  if(invalid){
   await expect(stage.generate({draft:upstream,settings:defaultSettings(),config,vault})).rejects.toMatchObject({details:{worldRule:'memory_time_window'}});
   expect((await repo.loadDraft(a.state.saveId))?.story).toEqual(upstream.story);expect(await repo.load(a.state.saveId)).toEqual(a.state);
  }else{
   const ready=await stage.generate({draft:upstream,settings:defaultSettings(),config,vault});expect(ready.world?.validation).toBe('validated');
   expect(await repo.load(a.state.saveId)).toEqual(a.state);
   const committed=await repo.commitTurn(submission(ready,''));expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);
   expect(committed.state.npc['npc-a']).toMatchObject({activeGoals:['核对新的工作安排']});
   expect(committed.state.npc[a.person.id].memories[0].text).toContain('自己在远方收到工作安排');
   repo.close();const reopened=await SaveRepository.open(name,factory);try{expect(await reopened.load(a.state.saveId)).toEqual(committed.state);}finally{reopened.close();}
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
 }finally{stage.dispose();repo.close();}
});
it('新增诊断走原安全日志：保留命令定位，不携带记忆正文或堆栈',()=>{
 const a=worldNpcCreation(),c=a.result.worldCommands.find(c=>c.type==='RecordNpcMemory');if(c?.type!=='RecordNpcMemory')throw Error();
 c.memory.createdAtGameTime='2026-10-18T08:10:01+08:00';c.memory.text='不应出现在运行日志的合成私人内容';
 try{parse(a);throw Error('应拒绝');}catch(e){expect(e).toBeInstanceOf(AiError);const log=runtimeLogEvent(1,'world','failed',e);
 expect(log).toMatchObject({worldRule:'memory_time_window',fieldPath:'worldCommands.2.memory.createdAtGameTime',commandIndex:3});
 expect(JSON.stringify(log)).not.toContain(c.memory.text);expect(log).not.toHaveProperty('stack');}
});
