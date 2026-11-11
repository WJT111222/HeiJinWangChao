import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { migrateSave } from '../services/storage/migrations';
import { composePrompt } from '../prompts/composer';
import { selectVariableDomains } from '../prompts/variableDomains';
import { selectWorldDomains } from '../prompts/worldDomains';
import { stageResponses } from '../services/ai/stageResponses';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { playerView } from '../ui/panels/playerView';
import { organizationDynamics, organizationNpcIds } from '../ui/panels/organizationView';
import { organizationArchiveState, organizationState, organizationUpdate, organizationWorld } from './fixtures/organizations';
import { legacyNpcMemories } from './fixtures/npcUnified';
import { completeDraft, submission, elapsedVariables } from './fixtures/turn';
import { sentContext } from './fixtures/contextAssertions';
import type { GameState } from '../domain/state';
import type { WorldEvent } from '../domain/events/schema';

const repos: SaveRepository[]=[];
afterEach(()=>{repos.splice(0).forEach(r=>r.close());stageResponses.clear();});
async function seed(raw:unknown,name:string,factory=new IDBFactory()) {
  const repo=await SaveRepository.open(name,factory);repos.push(repo);
  await new Promise<void>((resolve,reject)=>{const req=factory.open(name);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(raw);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  return {repo,factory,name};
}
const success=(content:string)=>Response.json({choices:[{message:{content},finish_reason:'stop'}]});

it('三轮真实Runtime：创建/推进/收购结案→组织状态与估值更新→重载→撤回；无变化不更新、不动玩家账户和NPC',async()=>{
  const state=organizationState(),a=await seed(state,'org-event-chain');
  const settings=defaultSettings();settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;
  const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='story';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'story'};
  for(const stage of ['variables','world'] as const)config.routes[stage]={mode:'independent',channelId:channel.id,modelId:stage};
  const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
  const vault=new CredentialVault(storage,storage);vault.set(channel.id,'mock-only-organizations');let round=0;const calls:string[]=[];
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
    const body=JSON.parse(String(init?.body)),stage=String(body.model);calls.push(stage);
    const context=sentContext(body.messages),current=await a.repo.load('save-a'),draft=(await a.repo.loadDraft('save-a'))!;
    if(stage==='story') {const content='<thinking>承接既有世界发展。</thinking><正文>【旁白】社区生活继续，远方企业的整合有了后续消息。</正文><短期记忆>企业整合继续发展。</短期记忆><变量规划>[]</变量规划>';return new Response(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});}
    if(stage==='variables')return success(`<thinking>落实实际耗时。</thinking><说明></说明><命令>set worldClock = "${new Date(Date.parse(current.worldClock)+60000).toISOString()}"</命令>`);
    const now=(context.SAVE_STATE as {worldClock:string}).worldClock,old=current.events.acquisition;
    const event:WorldEvent={...(old??{id:'acquisition',title:'澄川工贸业务收购',eventKind:'main',startAt:now,estimatedEndAt:new Date(Date.parse(now)+3600000).toISOString(),actorRefs:[{kind:'organization',id:'org-business'}],linkedTaskIds:[],prerequisites:[],blockers:[],visibility:'hidden',impact:'significant',backgroundText:'企业拟整合独立维修业务',goalText:'完成业务整合',sourceTurnIds:[]}),status:round===2?'resolved':'active',sourceTurnIds:[...(old?.sourceTurnIds??[]),draft.turnId],
      ...(round===2?{resolvedAt:now,resolutionText:'业务整合完成，原维修业务继续，资产与流动资金重新估计。',outcome:'success',continuation:{direction:'end',reason:'本次收购阶段结束'}}:{})};
    const world=organizationWorld(round===2?[{...organizationUpdate('org-business',{operatingStatus:'完成维修业务整合',ownershipText:'控制新业务，原主体稳定',assetsEstimate:80000000,liquidityEstimate:600000,leadership:[{position:'总经理',publicName:'沈向南'}]},current.revision),financialBasis:{at:now,note:'本轮收购结案后的现有资产与流动资金估计'}}]:[]);
    world.eventCommands.push({type:'SaveEvent',commandId:'acquisition-state',evidence:'业务整合的实际进展',event});
    return success(JSON.stringify(world));
  });
  const runner=new TurnCoordinator(a.repo,new AiClient(fetcher));let previous:GameState|undefined;let nextDraft;
  try {
    for(round=0;round<3;round++){
      const before=await a.repo.load('save-a'),initial=nextDraft??createTurnDraft(before.saveId,before.revision,'org-first','regular','继续日常');
      if(!nextDraft)await a.repo.saveDraft(initial,null);
      const result=await runner.generate({draft:initial,config,settings,vault});expect(result.status).toBe('complete');
      expect(await a.repo.load('save-a')).toEqual(before);
      expect(result.draft.world!.result.worldCommands).toHaveLength(round===2?1:0);
      const saved=await a.repo.commitTurn(submission(result.draft,''));nextDraft=saved.draft;
      expect(saved.state.npc).toEqual(state.npc);expect(saved.state.economy).toEqual(state.economy);
      if(round<2)expect(saved.state.organizations).toEqual(state.organizations);
      if(round===1)previous=saved.state;
    }
    const final=await a.repo.load('save-a');expect(final.organizations['org-business']).toMatchObject({operatingStatus:'完成维修业务整合',assetsEstimate:80000000,liquidityEstimate:600000});
    expect(final.events.acquisition).toMatchObject({status:'resolved',sourceTurnIds:['org-first',previous!.journal.at(-1)!.turnId,final.journal.at(-1)!.turnId]});
    expect(organizationDynamics(playerView(final),'org-business').endedEvents.map(e=>e.id)).toContain('acquisition');
    a.repo.close();const reopened=await SaveRepository.open(a.name,a.factory);repos.push(reopened);expect(await reopened.load('save-a')).toEqual(final);
    const undone=await reopened.undoTurn({saveId:'save-a',expectedRevision:final.revision,expectedDraft:nextDraft!,operationId:'undo-acquisition'});
    expect(undone.state.organizations).toEqual(previous!.organizations);expect(undone.state.events).toEqual(previous!.events);expect(undone.state.npc).toEqual(state.npc);
    expect(calls).toEqual(Array.from({length:3},()=>['story','variables','world']).flat());
  }finally{runner.dispose();}
});

async function rawStore(factory:IDBFactory,name:string,table:string,operation:(store:IDBObjectStore)=>IDBRequest) {
  return new Promise<unknown>((resolve,reject)=>{const req=factory.open(name);req.onerror=()=>reject(req.error);req.onsuccess=()=>{
    const db=req.result,tx=db.transaction(table,'readwrite'),request=operation(tx.objectStore(table));let value:unknown;
    request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=()=>{db.close();reject(tx.error);};
  };});
}
it.each([6,7,8,9] as const)('V%s旧组织/文字关系/原记忆无损读取，不猜管理层和组织ID，刷新后仍原样',async version=>{
  const old=legacyNpcMemories(version===6?6:7),raw=version<8?{...old,schemaVersion:version}:{...migrateSave(old),schemaVersion:version};
  if(version===6)delete raw.dormantNpcProfiles;
  raw.organizations=organizationState().organizations;
  for(const org of Object.values(raw.organizations)){delete org.leadership;delete org.relations;org.keyNpcIds=[];if(org.kind==='business')org.businessRelations=['旧合作对象：尚无结构化身份'];}
  const original=structuredClone(raw),a=await seed(raw,`org-legacy-${version}`),state=await a.repo.load('save-a');
  expect(state.organizations).toEqual(raw.organizations);expect(raw).toEqual(original);
  expect(state.npc).toEqual(migrateSave(original).npc);expect(state.memories).toEqual(original.memories);
  a.repo.close();const again=await SaveRepository.open(a.name,a.factory);repos.push(again);expect((await again.load('save-a')).organizations).toEqual(raw.organizations);
});

it('Repository冲突和非法关系提交失败不写一半；已有撤回点包含完整新字段',async()=>{
  const state=organizationState(),a=await seed(state,'org-atomic');
  const first=await a.repo.commitTurn(submission(await completeDraft(a.repo,{variables:await elapsedVariables(a.repo,'继续活动',60),world:organizationWorld([organizationUpdate()])}),''));
  const candidate=await completeDraft(a.repo,{variables:await elapsedVariables(a.repo,'继续活动',60),world:organizationWorld([organizationUpdate('org-business',{relations:[{organizationId:'missing',relation:'合作',description:'非法目标'}]},first.state.revision)])});
  await expect(a.repo.commitTurn(submission(candidate,''))).rejects.toThrow();expect(await a.repo.load('save-a')).toEqual(first.state);
  await expect(a.repo.commitTurn({...submission(candidate,''),draft:{...candidate,baseSaveRevision:0}})).rejects.toThrow();expect(await a.repo.load('save-a')).toEqual(first.state);
  const undone=await a.repo.undoTurn({saveId:'save-a',expectedRevision:first.state.revision,expectedDraft:candidate,operationId:'undo-first'});
  expect(undone.state.organizations).toEqual(state.organizations);expect(undone.state.npc).toEqual(state.npc);
});

it.each(['opening','regular'] as const)('%s最终Variables/World messages加载四类更新协议，旧禁用说明退出，新关系不强制',async mode=>{
  const state=organizationState(),settings=defaultSettings(),draft=rerollStory(createTurnDraft(state.saveId,state.revision,'prompt-org',mode,'继续'),{turnKind:mode,narrative:'【旁白】组织保持原状。',summary:'无组织变化',variableGuide:[]});
  for(const stage of ['variables','world'] as const){
    const domains=stage==='variables'?selectVariableDomains(state,draft).domains:selectWorldDomains(state,draft).domains;
    const output=await composePrompt({state,draft,settings,stage,mode,domains,userInput:draft.userInput}),text=output.messages.map(m=>m.content).join('\n');
    for(const marker of ['势力组织当前状态','financialBasis','闻所未闻','publicName','relations','不设每N回合','不强制反向'])expect(text).toContain(marker);
    expect(text).not.toContain('后台资产与组织经营变更目前不支持');expect(text).not.toContain('已有组织只支持set organizations[id].protagonistRelation');
    expect(text).toContain(stage==='variables'?'organizations[id].state':'UpdateOrganization');
  }
});

it('只读关联投影按稳定ID和真实任务状态过滤，1000组织不改世界',()=>{
  const state=organizationState(1000),before=structuredClone(state),view=playerView(state);
  expect(organizationNpcIds(view.organizations.find(o=>o.id==='org-business')!)).toEqual(['person']);
  expect(organizationNpcIds({...view.organizations[0],leadership:[{position:'顾问',publicName:state.npc.person.name}]})).toEqual([]);
  expect(organizationDynamics(view,'org-business').tasks).toEqual([]);expect(state).toEqual(before);expect(view.organizations).toHaveLength(1004);
});

it.each([6,7,8,9] as const)('V%s历史撤回快照按需恢复旧组织，不自动补齐或清空其他撤回点',async version=>{
  const old=legacyNpcMemories(version===6?6:7),raw=version<8?old:{...migrateSave(old),schemaVersion:version};
  raw.organizations=organizationState().organizations;
  for(const org of Object.values(raw.organizations)){delete org.leadership;delete org.relations;org.keyNpcIds=[];}
  const a=await seed(raw,`org-old-undo-${version}`),baseline=await a.repo.load('save-a');
  const committed=await a.repo.commitTurn(submission(await completeDraft(a.repo,{variables:await elapsedVariables(a.repo,'继续活动',60),world:organizationWorld([organizationUpdate('org-business',{leadership:[{position:'新任经理',publicName:'顾桥'}]},baseline.revision)])}),''));
  const records=await rawStore(a.factory,a.name,'turnUndo',store=>store.getAll()) as {stateJSON:string}[];
  expect(records).toHaveLength(1);records[0].stateJSON=JSON.stringify(raw);await rawStore(a.factory,a.name,'turnUndo',store=>store.put(records[0]));
  const control=await rawStore(a.factory,a.name,'saveControls',store=>store.get('save-a')) as {records:{bytes:number}[]};
  control.records[0].bytes=new TextEncoder().encode(JSON.stringify(records[0])).byteLength;await rawStore(a.factory,a.name,'saveControls',store=>store.put(control));
  a.repo.close();const reopened=await SaveRepository.open(a.name,a.factory);repos.push(reopened);
  const undone=await reopened.undoTurn({saveId:'save-a',expectedRevision:committed.state.revision,expectedDraft:committed.draft,operationId:'restore-old-org'});
  expect(undone.state.organizations).toEqual(raw.organizations);expect(undone.state.npc).toEqual(baseline.npc);expect(undone.state.memories).toEqual(baseline.memories);
  expect(undone.state.journal).toEqual(baseline.journal);expect((await reopened.exportRaw('save-a')).records.turnUndo).toHaveLength(0);
});

it('事件失败不强制改变组织；终态旧任务ID不会展示为当前任务，后续职责继续存在',()=>{
  const state=organizationArchiveState(),draft=rerollStory(createTurnDraft(state.saveId,state.revision,'failure-turn','regular','继续'),{turnKind:'regular',narrative:'【旁白】远方的整合没有成功，原业务继续。',summary:'整合失败',variableGuide:[]});
  const result=organizationWorld();result.eventCommands=[{type:'SaveEvent',commandId:'failure',evidence:'本轮整合终止',event:{...state.events['org-active'],status:'resolved',outcome:'failure',resolvedAt:state.worldClock,resolutionText:'未能完成整合，原业务继续。',sourceTurnIds:[...state.events['org-active'].sourceTurnIds,draft.turnId],continuation:{direction:'end',reason:'此次尝试结束'}}}];
  const parsed=parseWorld(JSON.stringify(result),state,draft),projected=projectTurn(state,draft,[...parsed.worldCommands,...parsed.eventCommands]);
  expect(projected.organizations).toEqual(state.organizations);
  const dynamics=organizationDynamics(playerView(projected),'org-business');expect(dynamics.currentEvents).toEqual([]);expect(dynamics.endedEvents).toHaveLength(2);
  expect(dynamics.tasks.map(t=>t.id)).toEqual(['org-work']);expect(projected.tasks['org-finished'].status).toBe('completed');
});

it('10/100/1000组织可重复只读测量：最终messages、状态容量及投影开销，未截断实体',async()=>{
  const results=[];
  for(const count of [10,100,1000]){
    const state=organizationArchiveState(count-4),before=JSON.stringify(state),draft=rerollStory(createTurnDraft(state.saveId,state.revision,'benchmark-org','regular','继续'),{turnKind:'regular',narrative:'【旁白】社区和企业保持日常状态。',summary:'没有新的组织变化',variableGuide:[]}),settings=defaultSettings();
    const started=performance.now();organizationDynamics(playerView(state),'org-business');const viewMs=performance.now()-started;
    for(const stage of ['story','variables','world'] as const){
      const domains=stage==='variables'?selectVariableDomains(state,draft).domains:stage==='world'?selectWorldDomains(state,draft).domains:[];
      const start=performance.now(),prompt=await composePrompt({state,draft,settings,stage,mode:'regular',userInput:draft.userInput,domains}),composeMs=performance.now()-start;
      const context=sentContext(prompt.messages);expect(Object.keys((context.SAVE_STATE as {organizations:object}).organizations)).toHaveLength(count);
      results.push({count,stage,stateBytes:new TextEncoder().encode(before).byteLength,characters:prompt.messages.reduce((sum,m)=>sum+Array.from(m.content).length,0),bytes:prompt.messages.reduce((sum,m)=>sum+new TextEncoder().encode(m.content).byteLength,0),composeMs:Number(composeMs.toFixed(2)),viewMs:Number(viewMs.toFixed(2))});
    }
    expect(JSON.stringify(state)).toBe(before);
  }
  if(process.env.ORG_BENCHMARK_OUTPUT)await writeFile(process.env.ORG_BENCHMARK_OUTPUT,JSON.stringify(results,null,2)+'\n');
});
