import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { worldState, worldDraft, worldResult, projectedTime } from './fixtures/world';
import { event, task, gameTime } from './fixtures/game';
import type { DomainCommand } from '../domain/commands';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { completeDraft, submission } from './fixtures/turn';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';

/** Entirely fictional: no original player response, save or credentials. */
function proposed(existing=false) {
  const state=worldState(),draft=worldDraft(),locationId=existing?'chongqing':'loc-qinghuai-tea';
  const main={...event('tea-main'),eventKind:'main' as const,title:'青槐茶社的资料整理',status:'active' as const,
    estimatedEndAt:'2026-11-01T08:00:00+08:00',actorRefs:[{kind:'npc' as const,id:'npc-a'}],locationId,sourceTurnIds:[draft.turnId]};
  const {estimatedEndAt:_estimate,...base}=main;void _estimate;
  const sub={...base,id:'tea-sub',eventKind:'sub' as const,parentEventId:main.id,title:'第一批资料核对',
    fixedEndAt:'2026-10-19T08:00:00+08:00',linkedTaskIds:['tea-task'],
    continuation:{direction:'protagonist' as const,reason:'保留下一次由玩家回应的机会',entry:{channel:'茶社来电',cue:'请问是否方便听取资料情况？',locationId}}};
  const result=worldResult(existing?[]:[{type:'CreateLocation',commandId:'create-tea-location',evidence:'后台新设的合成茶社',location:{id:locationId,name:'青槐茶社',parentId:'chongqing'}}]);
  result.taskCommands=[{type:'SaveTask',commandId:'save-tea-task',evidence:'离场工作人员独立核对资料',task:{...task('tea-task'),actorRef:{kind:'npc',id:'npc-a'},status:'active',dueAt:'2026-10-19T08:00:00+08:00',locationId,linkedEventId:sub.id}}];
  result.eventCommands=[{type:'SaveEvent',commandId:'save-tea-main',event:main,evidence:'后台资料整理已开始'},{type:'SaveEvent',commandId:'save-tea-sub',event:sub,evidence:'后台阶段正在执行，邀请仍待玩家回应'}];
  return {state,draft,result,sub,locationId};
}
const commands=(r:ReturnType<typeof worldResult>)=>[...r.worldCommands,...r.taskCommands,...r.eventCommands];
it('同轮新茶社→任务→主子事件及入场引用通过真实parseWorld，候选不改正式世界',()=>{
  const a=proposed(),before=structuredClone(a.state),raw=structuredClone(a.result),r=parseWorld(JSON.stringify(a.result),a.state,a.draft),p=projectTurn(a.state,a.draft,commands(r));
  expect(p.locations[a.locationId]).toMatchObject({name:'青槐茶社',parentId:'chongqing'});
  expect(p.tasks['tea-task']).toMatchObject({locationId:a.locationId,linkedEventId:'tea-sub'});
  expect(p.events['tea-sub']).toMatchObject({parentEventId:'tea-main',fixedEndAt:a.sub.fixedEndAt,protagonistEntry:{status:'pending',locationId:a.locationId,queuedAt:projectedTime}});
  expect(p.events['tea-main'].eventKind).toBe('main');expect(p.protagonist).toEqual(before.protagonist);expect(p.npc).toEqual(before.npc);
  expect(p.events['tea-sub'].protagonistKnowledge).toBeUndefined();expect(a.state).toEqual(before);expect(a.result).toEqual(raw);
});
it('正式世界已有地点仍可用，不依赖CreateLocation',()=>{
  const a=proposed(true),r=parseWorld(JSON.stringify(a.result),a.state,a.draft);
  expect(projectTurn(a.state,a.draft,commands(r)).events['tea-sub'].protagonistEntry?.locationId).toBe('chongqing');
});
it.each(['missing-location','invalid-parent','missing-main','invalid-time','forged-entry','duplicate-id'] as const)('%s继续拒绝，原状态及候选输入不变',kind=>{
  const a=proposed();
  if(kind==='missing-location')a.result.worldCommands=[];
  if(kind==='invalid-parent')(a.result.worldCommands[0] as Extract<DomainCommand,{type:'CreateLocation'}>).location.parentId='missing-parent';
  if(kind==='missing-main')a.sub.parentEventId='missing-main';
  if(kind==='invalid-time')a.sub.startAt='2026-10-19T09:00:00+08:00';
  if(kind==='forged-entry')Object.assign(a.sub,{protagonistEntry:{id:'forged',sourceTurnId:a.draft.turnId,queuedAt:gameTime,channel:'茶社来电',cue:'伪造玩家同意',status:'presented',handledTurnId:a.draft.turnId,textEvidence:'伪造主角回应'}});
  if(kind==='duplicate-id')a.state.locations[a.locationId]={id:a.locationId,name:'已存在的另一地点',parentId:'chongqing'};
  const before=structuredClone(a.state),raw=structuredClone(a.result);
  const rules={ 'missing-location':'event_continuation','invalid-parent':'location_reference','missing-main':'domain_state','invalid-time':'event_time','forged-entry':'event_entry','duplicate-id':'entity_id' };
  expect(()=>parseWorld(JSON.stringify(a.result),a.state,a.draft)).toThrow(expect.objectContaining({details:expect.objectContaining({worldRule:rules[kind]})}));
  expect(a.state).toEqual(before);expect(a.result).toEqual(raw);
});
it('新增地点入场经真实WorldStage候选保存、Commit、重载及重复提交，单次Mock请求',async()=>{
  const a=proposed(),repo=await SaveRepository.open('world-new-entry-location',new IDBFactory());
  try {
    await repo.create(a.state);await repo.saveDraft(createTurnDraft('save-a',0,a.draft.turnId,'opening',''),null);
    const upstream=await completeDraft(repo,{variables:a.draft.variables!.result});
    const cfg=defaultAiConfig(),ch=newChannel();ch.baseUrl='https://world-entry.mock.invalid/v1';ch.defaultModel='mock-world';cfg.channels=[ch];cfg.routes.story={channelId:ch.id,modelId:'mock-world'};
    const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}},vault=new CredentialVault(storage,storage);vault.set(ch.id,'local-fixture-only');
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({choices:[{message:{content:JSON.stringify(a.result)},finish_reason:'stop'}]}));
    const stage=new WorldStage(repo,new AiClient(fetcher));let ready;try{ready=await stage.generate({draft:upstream,settings:defaultSettings(),config:cfg,vault});}finally{stage.dispose();}
    expect(await repo.load('save-a')).toEqual(a.state);expect((await repo.loadDraft('save-a'))?.world?.validation).toBe('validated');
    const saved=await repo.commitTurn(submission(ready,''));expect(saved.state.events['tea-sub'].protagonistEntry).toMatchObject({status:'pending',locationId:a.locationId});
    expect(saved.state.locations[a.locationId].name).toBe('青槐茶社');expect(saved.state.events['tea-sub'].parentEventId).toBe('tea-main');expect(saved.state.tasks['tea-task'].locationId).toBe(a.locationId);
    expect(saved.state.protagonist).toEqual(a.state.protagonist);expect((await repo.loadGame('save-a')).state).toEqual(saved.state);expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {repo.close();}
});
