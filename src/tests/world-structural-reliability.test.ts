import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { teahouse } from './fixtures/teahouse';
import { AiError } from '../services/ai/errors';
import { commitCommands } from '../domain/commands';
import { WorldResultSchema } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { contextFor } from '../prompts/context';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { worldProjectionError } from '../services/validation/worldProjectionDiagnostics';
import { z } from 'zod';
function failure(fn:()=>unknown) { try {fn();} catch(e) {expect(e).toBeInstanceOf(AiError);return e as AiError;}throw Error('expected rejection'); }
const parse = (a:ReturnType<typeof teahouse>)=>parseWorld(JSON.stringify(a.response),a.state,a.draft);
describe('World结构稳定性失败复现',()=>{
 it('合成展览筹备World在合法离场上下文中通过',()=>{const a=teahouse();expect(()=>parse(a)).not.toThrow();});
 it('隔离关联问题：本轮开始已离场，单侧关联应确定性补全',()=>{
  const a=teahouse();a.state.npc.npc_fixture_lin.onScene=false;
  const r=parse(a),p=projectTurn(a.state,a.draft,[...r.worldCommands,...r.taskCommands,...r.eventCommands]);
  expect(p.tasks.task_fixture_fetch_materials.linkedEventId).toBe('event_fixture_exhibition');
 });
 it('隔离离场问题：没有关联事件的合法后台任务也能启动',()=>{
  const a=teahouse();a.response.eventCommands=[];expect(()=>parse(a)).not.toThrow();
 });
 it('不存在的父地点定位到CreateLocation，而非根Schema',()=>{
  const a=teahouse();a.response.taskCommands=[];a.response.eventCommands=[];
  a.response.worldCommands[0].location!.parentId='missing-private-name';
  const e=failure(()=>parse(a));expect(e.details).toMatchObject({worldRule:'location_reference',commandType:'CreateLocation',commandIndex:0,fieldPath:'worldCommands.0.location.parentId'});
  expect(JSON.stringify(e.details)).not.toContain('missing-private-name');
 });
 it('重复实体ID定位实际创建命令',()=>{
  const a=teahouse();a.response.taskCommands=[];a.response.eventCommands=[];a.response.worldCommands[0].location!.id='loc_fixture_teahouse';
  expect(failure(()=>parse(a)).details).toMatchObject({worldRule:'entity_id',commandType:'CreateLocation',commandIndex:0});
 });
});

const taskId='task_fixture_fetch_materials', eventId='event_fixture_exhibition';
const commands=(r:ReturnType<typeof WorldResultSchema.parse>)=>[...r.worldCommands,...r.taskCommands,...r.eventCommands];
it('合成夹具明确保留修复所需的离场、后台任务和单侧关联结构',()=>{
 const a=teahouse(), task=a.response.taskCommands[0].task, event=a.response.eventCommands[0].event;
 expect([...a.response.worldCommands,...a.response.taskCommands,...a.response.eventCommands].map(c=>c.type))
  .toEqual(['CreateLocation','RecordHistory','SaveTask','SaveEvent']);
 expect(a.state.npc[task.actorRef.id].onScene).toBe(true);
 expect(a.draft.variables!.result.commands).toContainEqual(expect.objectContaining({type:'UpdateNpc',npcId:task.actorRef.id,changes:{onScene:false}}));
 expect(projectTurn(a.state,a.draft).npc[task.actorRef.id].onScene).toBe(false);
 expect(task).not.toHaveProperty('linkedEventId');expect(event.linkedTaskIds).toEqual([task.id]);
 expect(event.sourceTurnIds).toEqual([a.draft.turnId]);
});
function apply(a:ReturnType<typeof teahouse>, raw:unknown=a.response) {
 const result=parseWorld(JSON.stringify(raw),a.state,a.draft);
 return projectTurn(a.state,a.draft,commands(result));
}
describe('单一关系输入在真实领域事务中补齐反向字段',()=>{
 it('仅任务填写linkedEventId也能补齐事件；输入不变，精确命令重放不重复',()=>{
  const a=teahouse(), raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:eventId}}],
   eventCommands:[{...a.response.eventCommands[0],event:{...a.response.eventCommands[0].event,linkedTaskIds:[]}}]};
  const before=structuredClone(raw), result=parseWorld(JSON.stringify(raw),a.state,a.draft), state=projectTurn(a.state,a.draft,commands(result));
  expect(raw).toEqual(before);expect(state.events[eventId].linkedTaskIds).toEqual([taskId]);
  const replay=commitCommands(state,a.draft.turnId,a.state.revision,commands(result));expect(replay).toEqual(state);
 });
 it('双方一致不重复追加，保留原始commandId和顺序',()=>{
  const a=teahouse(), raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:eventId}}]};
  const r=parseWorld(JSON.stringify(raw),a.state,a.draft), p=projectTurn(a.state,a.draft,commands(r));
  expect(p.events[eventId].linkedTaskIds).toEqual([taskId]);
  expect(commands(r).map(c=>c.commandId)).toEqual(['cmd-fixture-workshop','cmd-fixture-history','cmd-fixture-fetch-materials','cmd-fixture-exhibition']);
 });
 it.each(['task','event'] as const)('可以只更新既有活动%s的另一侧，不要求模型重复整个对象',side=>{
  const a=teahouse();
  if(side==='task') {
   a.state.npc.npc_fixture_lin.onScene=false;
   a.state.tasks[taskId]={...a.response.taskCommands[0].task,actorRef:{kind:'npc',id:'npc_fixture_lin'},startAt:a.state.worldClock,locationId:'loc_fixture_teahouse',status:'active'};
   a.response.taskCommands=[];
  } else {
   a.state.events[eventId]={...a.response.eventCommands[0].event,status:'active',visibility:'hidden',impact:'significant',actorRefs:[],linkedTaskIds:[],continuation:undefined};
   a.response.eventCommands=[];
   const raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:eventId}}]};
   expect(apply(a,raw).events[eventId].linkedTaskIds).toEqual([taskId]);return;
  }
  expect(apply(a).tasks[taskId].linkedEventId).toBe(eventId);
 });
 it('两个事件争用同一任务，整批拒绝且输入状态不变',()=>{
  const a=teahouse(), before=structuredClone(a);
  const raw={...a.response,eventCommands:[...a.response.eventCommands,{...a.response.eventCommands[0],commandId:'other-event',event:{...a.response.eventCommands[0].event,id:'other',title:'另一个事件'}}]};
  expect(failure(()=>apply(a,raw)).details).toMatchObject({worldRule:'task_event_link',fieldPath:'eventCommands.1.event.linkedTaskIds.0',commandIndex:4,commandType:'SaveEvent'});
  expect(a).toEqual(before);
 });
 it('显式反向冲突不丢弃任何一侧',()=>{
  const a=teahouse(), raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:'other'}}]};
  expect(failure(()=>apply(a,raw)).details?.worldRule).toBe('task_event_link');
 });
 it.each(['task','event'] as const)('缺失被引用的%s时不创建实体',side=>{
  const a=teahouse(), raw=side==='task'?{...a.response,taskCommands:[]}:
   {...a.response,eventCommands:[],taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:'missing'}}]};
  expect(failure(()=>apply(a,raw)).details).toMatchObject({worldRule:'task_event_reference',commandType:side==='task'?'SaveEvent':'SaveTask'});
 });
 it.each(['task','event'] as const)('不会暗中修改既有终态%s的关联',side=>{
  const a=teahouse();
  if(side==='task') {
   a.state.tasks[taskId]={id:taskId,actorRef:{kind:'npc',id:'npc_fixture_lin'},goal:'旧任务',startAt:a.state.worldClock,status:'cancelled',prerequisites:[],blockers:[]};
   a.response.taskCommands=[];
  } else {
   a.state.events[eventId]={...a.response.eventCommands[0].event,actorRefs:[],linkedTaskIds:[],status:'cancelled',visibility:'hidden',impact:'minor',continuation:undefined};
   a.response.eventCommands=[];
   const raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,linkedEventId:eventId}}]};
   expect(failure(()=>apply(a,raw)).details?.worldRule).toBe('event_transition');return;
  }
  expect(failure(()=>apply(a)).details?.worldRule).toBe('task_state');
 });
 it('读取并不自动修复旧的损坏关系；仍保留严格双向存档约束',()=>{
  const a=teahouse(), p=apply(a);delete p.tasks[taskId].linkedEventId;
  expect(()=>GameStateSchema.parse(p)).toThrow();expect(p.tasks[taskId].linkedEventId).toBeUndefined();
 });
});
describe('离场权限与正式World请求上下文一致',()=>{
 it.each(['仍在现场','未验证离场','开局同伴'] as const)('%s不会获得后台任务权限',kind=>{
  const a=teahouse();
  if(kind==='仍在现场')a.draft.variables!.result.commands=a.draft.variables!.result.commands.filter(c=>c.type!=='UpdateNpc');
  if(kind==='未验证离场')a.draft.variables=undefined;
  if(kind==='开局同伴') {
   a.state.npc.npc_fixture_lin={...a.state.npc.npc_fixture_lin,kind:'special',detailedBackground:'同伴',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[]};
   a.state.initialCompanionId='npc_fixture_lin';
  }
  expect(failure(()=>parse(a)).details?.worldRule).toBe('actor_permission');
 });
 it('正式上下文纳入本轮合法离场NPC并保留仍在场保护，协议说明一致',async()=>{
  const a=teahouse(), input={stage:'world' as const,mode:'opening' as const,state:a.state,draft:a.draft,settings:defaultSettings(),userInput:'',domains:['npc_ordinary','npc_special']};
  const context=contextFor(input), offscreen=context.OFFSCREEN_STATE as {npcIds:string[]};
  expect(offscreen.npcIds).toContain('npc_fixture_lin');expect(offscreen.npcIds).not.toContain('npc_fixture_xu');
  expect(context.PROTECTED_SCENE).toMatchObject({sceneNpcIds:['npc_fixture_xu']});
  const prompt=await composePrompt(input), text=JSON.stringify(prompt.messages);
  expect(text).toContain('单侧关联');expect(text).toContain('Variables投影');
 });
 it('World不能覆盖本轮已写入的离场字段或操控主角',()=>{
  const a=teahouse();
  const update={type:'UpdateNpc',commandId:'repeat-leave',npcId:'npc_fixture_lin',expectedRevision:0,changes:{onScene:false},evidence:'离场'};
  expect(failure(()=>apply(a,{...a.response,worldCommands:[...a.response.worldCommands,update]})).details?.worldRule).toBe('scene_write_conflict');
  expect(()=>apply(a,{...a.response,worldCommands:[{type:'UpdateProtagonist',commandId:'move',changes:{locationId:'loc_fixture_city'},evidence:'移动'}]})).toThrow();
 });
});
describe('安全结构诊断按原输出位置归因',()=>{
 it('任务截止早于开始定位第三条命令的dueAt',()=>{
  const a=teahouse();a.response.taskCommands[0].task.dueAt='2040-04-18T08:30:00+08:00';
  const e=failure(()=>parse(a));expect(e).toMatchObject({code:'time_data',details:{worldRule:'event_time',fieldPath:'taskCommands.0.task.dueAt',commandIndex:2,commandType:'SaveTask'}});
  expect(runtimeLogEvent(1,'world','failed',e)).toMatchObject({commandIndex:3,worldRule:'event_time',fieldPath:'taskCommands.0.task.dueAt'});
 });
 it('任务字段类型错误使用跨分组序号，而不是把第三条标成第一条',()=>{
  const a=teahouse(), raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,status:123}}]};
  expect(failure(()=>apply(a,raw)).details).toMatchObject({fieldPath:'taskCommands.0.task.status',commandIndex:2,commandType:'SaveTask',worldRule:'schema'});
 });
 it.each(['地点父级循环','历史地点不存在','非法实体ID','事件时间倒置','任务未来启动','任务非法终态'] as const)('%s定位实际字段或规则',kind=>{
  const a=teahouse();let raw:unknown=a.response;let fieldPath='',worldRule='';
  if(kind==='地点父级循环'){a.response.worldCommands[0].location!.parentId='loc_fixture_workshop';fieldPath='worldCommands.0.location.parentId';worldRule='location_cycle';}
  if(kind==='历史地点不存在'){a.response.worldCommands[1].entry!.locationId='missing';fieldPath='worldCommands.1.entry.locationId';worldRule='location_reference';}
  if(kind==='非法实体ID'){a.response.worldCommands[0].location!.id='bad id';fieldPath='worldCommands.0.location.id';worldRule='schema';}
  if(kind==='事件时间倒置'){a.response.eventCommands[0].event.estimatedEndAt='2040-04-18T08:30:00+08:00';fieldPath='eventCommands.0.event.estimatedEndAt';worldRule='event_time';}
  if(kind==='任务未来启动'){a.response.taskCommands[0].task.startAt='2040-04-18T09:30:00+08:00';fieldPath='taskCommands.0.task.startAt';worldRule='task_state';}
  if(kind==='任务非法终态'){raw={...a.response,taskCommands:[{...a.response.taskCommands[0],task:{...a.response.taskCommands[0].task,status:'completed'}}]};fieldPath='taskCommands.0.task.resolution';worldRule='task_state';}
  expect(failure(()=>apply(a,raw)).details).toMatchObject({fieldPath,worldRule});
 });
 it('整批无法确定责任命令时明确state路径，不编造序号，不泄露ID或异常消息',()=>{
  const a=teahouse(), raw=WorldResultSchema.parse(a.response), e=new z.ZodError([{code:'custom',path:['tasks','SECRET_PRIVATE_ID','linkedEventId'],message:'SECRET_PRIVATE_CONTENT',params:{integrityRule:'task_event_link'}}]);
  const safe=worldProjectionError(e,raw,a.state,a.draft);
  expect(safe.details).toMatchObject({fieldPath:'state.tasks.field.linkedEventId',worldRule:'task_event_link'});
  expect(safe.details?.commandIndex).toBeUndefined();expect(safe.details?.commandType).toBeUndefined();
  expect(JSON.stringify(runtimeLogEvent(1,'world','failed',safe))).not.toContain('SECRET_PRIVATE');
 });
});
