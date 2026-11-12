import {afterEach,beforeEach,expect,test} from 'vitest';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {SaveRepository} from '../services/storage/saveRepository';
import {worldState} from './fixtures/world';
import {completeDraft,elapsedVariables,submission} from './fixtures/turn';
import {turnChangesPair,comparisonCheckpoint} from './fixtures/turnChanges';
import {reserveStageSession} from '../workflows/stageGuard';
import {migrateSave} from '../services/storage/migrations';
import {normalizeOpeningCity} from '../domain/openingCity';
import {GameStateSchema} from '../domain/state';
import type {GameState} from '../domain/state';
let factory:IDBFactory,repo:SaveRepository;
beforeEach(async()=>{factory=new IDBFactory();repo=await SaveRepository.open('comparison',factory);});
afterEach(()=>repo.close());
async function raw(write:(tx:IDBTransaction)=>void){await new Promise<void>((resolve,reject)=>{const q=factory.open('comparison');q.onsuccess=()=>{const db=q.result,tx=db.transaction(['saves','drafts','saveControls','turnUndo'],'readwrite');write(tx);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};q.onerror=()=>reject(q.error);});}
async function seed(){const pair=turnChangesPair(),point=comparisonCheckpoint(pair.before,pair.after);await raw(tx=>{tx.objectStore('saves').put(pair.after);tx.objectStore('drafts').put(point.draft);tx.objectStore('saveControls').put(point.control);tx.objectStore('turnUndo').put(point.snapshot);});return {...pair,...point};}
async function turn(){const game=await repo.loadGame('save-a');if(game.draft)await repo.bindTurnAction(game.draft,'继续整理资料',true,true);const draft=await completeDraft(repo,{variables:await elapsedVariables(repo,'时间经过一分钟',60)});return repo.commitTurn(submission(draft,''));}

test('正式写入的开局无恢复点，普通结算读取可靠前态，所有原始存储逐字不变',async()=>{
 await repo.create(worldState());const first=await turn();expect(await repo.turnComparison(first.state)).toEqual({available:false,reason:'missing'});
 const second=await turn(),before=await repo.exportRaw('save-a');const comparison=await repo.turnComparison(second.state);expect(comparison).toEqual({available:true,before:first.state});expect(await repo.exportRaw('save-a')).toEqual(before);
});
test('全状态 CAS 拒绝其他标签推进与同 revision 的总结／管理变化，不按旧视图输出',async()=>{
 const data=await seed(),old=structuredClone(data.after);
  await raw(tx=>tx.objectStore('saves').put({...data.after,protagonist:{...data.after.protagonist,emotionText:'状态更新'}}));
 expect(await repo.turnComparison(old)).toEqual({available:false,reason:'stale'});const current=await repo.load('save-a');expect((await repo.turnComparison(current)).available).toBe(true);
});
test('撤回后绑定剩余最新回合；重新结算使用新的快照和回合 ID，revision 不倒退',async()=>{
 await repo.create(worldState());const first=await turn(),second=await turn(),third=await turn();
 const undone=await repo.undoTurn({saveId:'save-a',expectedRevision:third.state.revision,expectedDraft:third.draft,operationId:'compare-undo'});
 expect(undone.state.revision).toBeGreaterThan(second.state.revision);expect(await repo.turnComparison(undone.state)).toEqual({available:true,before:first.state});
 const next=await turn();expect(next.state.journal.at(-1)?.turnId).not.toBe(third.state.journal.at(-1)?.turnId);expect(await repo.turnComparison(next.state)).toEqual({available:true,before:undone.state});
});
test('最新恢复点缺失、配额跳过和旧档不伪造可用状态',async()=>{
 const {after,control}=await seed();await raw(tx=>{tx.objectStore('turnUndo').clear();});expect((await repo.turnComparison(after)).available).toBe(false);
 await raw(tx=>{control.records=[];control.notice='quota';tx.objectStore('saveControls').put(control);});expect(await repo.turnComparison(after)).toEqual({available:false,reason:'missing'});
 await raw(tx=>tx.objectStore('saveControls').clear());expect((await repo.turnComparison(after)).available).toBe(false);
});
const failures=['snapshot-save','snapshot-turn','before-turn','before-save','createdAt','turn-number','revision','journal-content','journal-revision','scene','byte-count','control-chain','current-revision','json'] as const;
test.each(failures)('错误恢复点 %s 被拒绝且不消费／修复任何记录',async kind=>{
 const p=await seed(),snapshot={...p.snapshot};const before:GameState=structuredClone(p.before);let after=p.after;
 if(kind==='snapshot-save')snapshot.saveId='foreign';if(kind==='snapshot-turn')snapshot.turnId='wrong-turn';if(kind==='before-turn')snapshot.beforeTurnId='wrong-before';
 if(kind==='before-save')before.saveId='foreign';if(kind==='createdAt')before.createdAt='2026-01-01T00:00:00+08:00';
 if(kind==='turn-number'){before.turnNumber=1;before.journal=before.journal.slice(0,1);}
 if(kind==='revision')before.revision=after.revision;if(kind==='journal-content')before.journal[0].story.narrative='同 ID 但内容不同';if(kind==='journal-revision')before.journal[0].revision=0;
 if(kind==='scene')after=GameStateSchema.parse({...after,journal:after.journal.map((e,i)=>i===2?{...e,scene:{...e.scene!,worldClock:'2027-01-01T00:00:00+08:00'}}:e)});
 if(kind==='current-revision')after={...after,revision:after.revision+5};
 snapshot.stateJSON=kind==='json'?'not json':JSON.stringify(before);
 const control=structuredClone(p.control);control.records[0].bytes=new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
 if(kind==='byte-count')control.records[0].bytes++;if(kind==='control-chain')control.records[0].beforeTurnId='wrong-chain';
 await raw(tx=>{const store=tx.objectStore('turnUndo');store.clear();if(kind==='snapshot-save'||kind==='snapshot-turn'){
  // Out-of-line key metadata is not supported by the real store; leave the correct key missing.
  store.put(snapshot);
 }else store.put(snapshot);tx.objectStore('saveControls').put(control);tx.objectStore('saves').put(after);});
 const original=await repo.exportRaw('save-a');expect((await repo.turnComparison(after)).available).toBe(false);expect(await repo.exportRaw('save-a')).toEqual(original);
});
test('不选择孤立的更新快照，而只取正式索引与最新 journal 对应的那一条',async()=>{
 const p=await seed();await raw(tx=>tx.objectStore('turnUndo').put({...p.snapshot,turnId:'zzzz-orphan',stateJSON:'{}'}));expect(await repo.turnComparison(p.after)).toEqual({available:true,before:p.before});
});
test('读取不占用阶段锁，不影响已保留的工作流会话',async()=>{
 const p=await seed(),session=reserveStageSession('save-a');try{expect((await repo.turnComparison(p.after)).available).toBe(true);expect(()=>session.check()).not.toThrow();}finally{session.release();}
});
test('并发正式提交和只读读取只得到一致前后状态，不混读新快照与旧 state',async()=>{
 await repo.create(worldState());await turn();const state=(await turn()).state;
 const input=await repo.loadGame('save-a');await repo.bindTurnAction(input.draft!,'继续',true,true);const draft=await completeDraft(repo,{variables:await elapsedVariables(repo,'继续一分钟',60)});
 const [comparison,next]=await Promise.all([repo.turnComparison(state),repo.commitTurn(submission(draft,''))]);expect(comparison.available).toBe(true);expect(await repo.turnComparison(state)).toEqual({available:false,reason:'stale'});expect(await repo.turnComparison(next.state)).toEqual({available:true,before:state});
});
test('只读事务不能发起 put；读取异常不会作为可靠数据返回',async()=>{
 const p=await seed(),original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>){throw new Error(`unexpected put ${args.length}`);};
 try{expect((await repo.turnComparison(p.after)).available).toBe(true);}finally{IDBObjectStore.prototype.put=original;}
 repo.close();await expect(repo.turnComparison(p.after)).rejects.toBeDefined();
});

test('V8 原状态与恢复点只读迁移，不回写 Schema 或开局身份',async()=>{
 const p=await seed();
 const old=(state:GameState)=>{const {npcManagementRevision:management,openingCityId:city,...rest}=structuredClone(state);void management;void city;return {...rest,schemaVersion:8};};
 const before=old(p.before),after=old(p.after),snapshot={...p.snapshot,stateJSON:JSON.stringify(before)};p.control.records[0].bytes=new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
 await raw(tx=>{tx.objectStore('saves').put(after);tx.objectStore('turnUndo').put(snapshot);tx.objectStore('saveControls').put(p.control);});const original=await repo.exportRaw('save-a');
 const current=normalizeOpeningCity(migrateSave(after));expect(await repo.turnComparison(current)).toEqual({available:true,before:migrateSave(before)});expect(await repo.exportRaw('save-a')).toEqual(original);
});
