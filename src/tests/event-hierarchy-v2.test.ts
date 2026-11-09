import { afterEach, expect, it } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { event } from './fixtures/game';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { completeDraft, submission, elapsedVariables } from './fixtures/turn';
import { WorldEventSchema } from '../domain/events/schema';
import type { WorldEvent } from '../domain/events/schema';
import { createTurnDraft } from '../domain/drafts';
import { commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { worldEventSchedule } from '../domain/events/schedule';
import { vi } from 'vitest';
const start='2026-10-18T08:00:00+08:00', end='2026-10-18T10:00:00+08:00';
function main():WorldEvent { return {...event('main-incident'),eventKind:'main',startAt:start,estimatedEndAt:end,
  backgroundText:'合成测试的联合材料整理',goalText:'整理资料',actorRefs:[{kind:'npc',id:'npc-a'}]}; }
function sub(id='sub-one'):WorldEvent {
  const {estimatedEndAt:_estimate,...e}=main(); void _estimate;
  return {...e,id,title:id,eventKind:'sub',parentEventId:'main-incident',fixedEndAt:end};
}
const save=(e:WorldEvent):DomainCommand=>({type:'SaveEvent',commandId:`save:${e.id}`,event:e,evidence:'结构测试，不审批文字阻碍'});
const apply=(events:WorldEvent[])=>commitCommands(worldState(),'hierarchy',0,events.map(save));
it('主事件、并行小事件、旧事件共存：不按预计日期限制子事件或强制顺序',()=>{
  const a=sub(), b={...sub('sub-two'),fixedEndAt:'2026-10-19T10:00:00+08:00',actorRefs:[{kind:'protagonist' as const,id:'hero'}]};
  const result=apply([a,main(),b,event('legacy')]);
  expect(result.events[a.id]).toEqual(a); expect(result.events[b.id]).toEqual(b);
  expect(result.events.legacy.eventKind).toBeUndefined(); expect(result.schemaVersion).toBe(6);
  expect(result.events[a.id].predecessorEventIds).toBeUndefined();
});
it('不同组织各自参与不同并行小事件，真实组织ID独立验证',()=>{
  const state=worldState();
  for(const id of ['org-one','org-two'])state.organizations[id]={id,name:id,kind:'business',description:'合成组织',protagonistRelation:'无',relationHistory:[],keyNpcIds:[],currentTaskIds:[],sectors:[],businessRelations:[]};
  const values=[main(),{...sub(),actorRefs:[{kind:'organization' as const,id:'org-one'}]},
    {...sub('sub-two'),actorRefs:[{kind:'organization' as const,id:'org-two'}]}];
  expect(commitCommands(state,'org-events',0,values.map(save)).events['sub-two'].actorRefs[0].id).toBe('org-two');
  values[1].actorRefs[0].id='missing-org'; expect(()=>commitCommands(state,'bad',0,values.map(save))).toThrow();
});
it.each(['missing','legacy','sub-parent','self','no-parent','no-fixed','bad-date','reverse','before-parent','mixed-estimate','main-parent','orphan-field'] as const)('拒绝%s，原状态保持不变',fault=>{
  const m=main(), s=sub(), state=worldState(), before=structuredClone(state);
  if(fault==='missing')s.parentEventId='missing';
  if(fault==='legacy')delete m.eventKind;
  if(fault==='sub-parent')s.parentEventId='sub-two';
  if(fault==='self')s.parentEventId=s.id;
  if(fault==='no-parent')delete s.parentEventId;
  if(fault==='no-fixed')delete s.fixedEndAt;
  if(fault==='bad-date')s.fixedEndAt='not-a-date';
  if(fault==='reverse')s.fixedEndAt='2026-10-18T07:59:00+08:00';
  if(fault==='before-parent')s.startAt='2026-10-18T07:59:00+08:00';
  if(fault==='mixed-estimate')s.estimatedEndAt=end;
  if(fault==='main-parent')m.parentEventId=s.id;
  if(fault==='orphan-field')delete s.eventKind;
  expect(()=>commitCommands(state,'invalid',0,[m,s,sub('sub-two')].map(save))).toThrow();
  const raw={...state,events:Object.fromEntries([m,s,sub('sub-two')].map(e=>[e.id,e]))};
  expect(GameStateSchema.safeParse(raw).success).toBe(false); expect(state).toEqual(before);
});
it.each(['eventKind','parentEventId','fixedEndAt'] as const)('已有%s身份不可改写',key=>{
  const state=apply([main(),sub()]), s={...state.events['sub-one']};
  if(key==='eventKind')delete s.eventKind;
  if(key==='parentEventId')s.parentEventId='another-main';
  if(key==='fixedEndAt')s.fixedEndAt='2026-10-18T11:00:00+08:00';
  expect(()=>commitCommands(state,'rewrite',state.revision,[save(s)])).toThrow();
});
it('前序引用只在明确填写时校验；可引用已完成小事件，不允许悬空、活动前序或混合环',()=>{
  const first={...sub(),status:'resolved' as const,fixedEndAt:start,resolvedAt:start,resolutionText:'本阶段结束'};
  expect(apply([main(),first,{...sub('next'),predecessorEventIds:[first.id]}]).events.next.predecessorEventIds).toEqual([first.id]);
  expect(()=>apply([main(),{...sub(),predecessorEventIds:['unknown']}])).toThrow();
  expect(()=>apply([main(),sub(),{...sub('next'),predecessorEventIds:['sub-one']}])).toThrow();
  const parent={...main(),predecessorEventIds:[first.id]};
  expect(()=>apply([parent,first])).toThrow(); // parent -> predecessor child -> parent
});
it('旧V6缺规划事件读取不变；小事件时间不伪装成旧调度估计',()=>{
  const old=event('legacy');delete old.estimatedEndAt;
  const state=worldState();state.events[old.id]=old;
  expect(GameStateSchema.parse(state).events[old.id]).toEqual(old);
  expect(WorldEventSchema.safeParse(old).success).toBe(false);
  const current=apply([main(),sub()]);
  expect(current.events['sub-one'].estimatedEndAt).toBeUndefined();
  const schedule=worldEventSchedule(current,{...current,worldClock:end});
  expect(schedule.due.some(e=>e.eventId==='sub-one')).toBe(false);
  expect(schedule.unplannedLegacy).not.toContain('sub-one');
});
const clean=(id:string,status:'resolved'|'cancelled'='resolved'):DomainCommand=>({type:'DeleteEvent',commandId:`delete:${id}`,eventId:id,expectedStatus:status,reason:'无后续',evidence:'测试'});
it.each(['resolved','cancelled'] as const)('%s子事件必须保留唯一结案记录，主事件引用仍受保护',status=>{
  const m={...main(),status:'resolved' as const,resolvedAt:start,resolutionText:'结束'};
  const child={...sub(),status,resolvedAt:start,outcome:status==='resolved'?'success' as const:'cancelled' as const,
    resolutionText:'材料整理已经结束，部分问题需要主事件承接。',resultKnowledge:{facts:['本阶段材料已经整理'],reported:['负责人转述了后续安排'],suspected:[]}};
  const state=apply([m,child]),before=structuredClone(state);
  expect(()=>commitCommands(state,'remove-parent',1,[clean(m.id)])).toThrow();
  expect(()=>commitCommands(state,'remove-child',1,[clean(child.id,status)])).toThrow(expect.objectContaining({code:'EVENT_RETAINED'}));
  expect(state).toEqual(before);expect(state.events[child.id]).toEqual(child);expect(state.retiredEvents[child.id]).toBeUndefined();
});
it('无必要引用的旧V6终态事件仍可清理，主事件无引用时沿用原行为',()=>{
  for(const value of [event('legacy-cleanup'),main()]) {
    const ended={...value,status:'resolved' as const,resolvedAt:start,resolutionText:'原有清理场景'},state=apply([ended]);
    const next=commitCommands(state,'legacy-cleanup',1,[clean(ended.id)]);
    expect(next.events[ended.id]).toBeUndefined();expect(next.retiredEvents[ended.id]).toMatchObject({id:ended.id,status:'resolved'});
    expect(GameStateSchema.parse(next)).toEqual(next);
  }
});
const repos:SaveRepository[]=[];
afterEach(()=>{vi.restoreAllMocks();repos.splice(0).forEach(repo=>repo.close());});
it('World规范化候选→原子Commit→重载→下一回合快照→撤回，新增字段完整恢复',async()=>{
  const repo=await SaveRepository.open('hierarchy',new IDBFactory());repos.push(repo);await repo.create(worldState());
  await repo.saveDraft(createTurnDraft('save-a',0,'turn-a','opening',''),null);
  const draft=worldDraft(true,'opening'), response=worldResult();
  const values=[sub(),main(),{...event('legacy'),estimatedEndAt:end}].map(e=>({...e,sourceTurnIds:[draft.turnId]}));
  response.eventCommands=values.map(save) as typeof response.eventCommands;
  const normalized=parseWorld(JSON.stringify(response),worldState(),draft);
  const ready=await completeDraft(repo,{world:normalized}), before=await repo.loadGame('save-a');
  const original=IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='saves')throw Error('mock write failure');return original.apply(this,args);});
  await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();vi.restoreAllMocks();
  expect(await repo.loadGame('save-a')).toEqual(before);
  const first=await repo.commitTurn(submission(ready,''));
  expect(first.state.events['sub-one']).toMatchObject({eventKind:'sub',parentEventId:'main-incident',fixedEndAt:end});
  expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);
  expect((await repo.loadGame('save-a')).state).toEqual(first.state);
  const draft2=await completeDraft(repo,{variables:await elapsedVariables(repo,'继续整理',60)});
  const second=await repo.commitTurn(submission(draft2,''));
  const restored=await repo.undoTurn({saveId:'save-a',expectedRevision:second.state.revision,expectedDraft:second.draft,operationId:'undo-hierarchy'});
  expect(restored.state.events).toEqual(first.state.events);expect(restored.state.schemaVersion).toBe(6);
});

it('主事件预计时间可独立调整，不覆盖子事件固定时间',()=>{
  const state=apply([main(),sub()]), updated={...state.events['main-incident'],estimatedEndAt:'2026-10-20T10:00:00+08:00'};
  const next=commitCommands(state,'adjust-estimate',1,[save(updated)]);
  expect(next.events['sub-one'].fixedEndAt).toBe(end);expect(next.events['sub-one'].estimatedEndAt).toBeUndefined();
});
it('合法旧World候选保留原结构，无分类默认值或自动转型',()=>{
  const state=worldState(),draft=worldDraft(true,'opening'),old={...event('legacy-only'),estimatedEndAt:end};
  const r=worldResult();r.eventCommands=[save(old)];
  const accepted=parseWorld(JSON.stringify(r),state,draft);
  expect(accepted.eventCommands[0]).toEqual(save(old));
  expect(Object.hasOwn((accepted.eventCommands[0] as Extract<DomainCommand,{type:'SaveEvent'}>).event,'eventKind')).toBe(false);
});

it('Repository中同批先改时钟再清理子事件失败，正式数据与草稿均不改变',async()=>{
  const repo=await SaveRepository.open('hierarchy-cleanup',new IDBFactory());repos.push(repo);
  const state=worldState();
  state.events={parent:{...main(),id:'parent'},child:{...sub(),id:'child',parentEventId:'parent',status:'resolved',resolvedAt:start,outcome:'success',resolutionText:'阶段成果完整保留'}};
  await repo.create(state);const before=await repo.loadGame('save-a');
  await expect(repo.save('save-a',0,'bad-cleanup',[
    {type:'SetWorldClock',commandId:'advance-before-cleanup',worldClock:end,evidence:'合成测试'},clean('child'),
  ])).rejects.toMatchObject({code:'EVENT_RETAINED'});
  expect(await repo.loadGame('save-a')).toEqual(before);
  expect((await repo.exportRaw('save-a')).records.turnReceipts).toHaveLength(0);
});
