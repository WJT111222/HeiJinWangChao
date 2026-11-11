import { afterEach, expect,it,vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { composePrompt } from '../prompts/composer';
import { assertWorldCoverage,selectWorldDomains } from '../prompts/worldDomains';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { WorldStage } from '../workflows/worldStage';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig,newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { createTurnDraft } from '../domain/drafts';
import { stageResponses } from '../services/ai/stageResponses';
import { commandCatalog } from '../services/validation/commandCatalog';
import { record,array } from '../services/ai/protocols';
import { fullPrivateProfile } from './fixtures/npcUnified';
import { worldNpcCreation,worldNpcCommands } from './fixtures/worldNpcCreation';
import { sentContext } from './fixtures/contextAssertions';
import { completeDraft,submission } from './fixtures/turn';

const repos:SaveRepository[]=[];
afterEach(()=>{repos.splice(0).forEach(repo=>repo.close());stageResponses.clear();});
const parse=(a:ReturnType<typeof worldNpcCreation>)=>parseWorld(JSON.stringify(a.result),a.state,a.draft);

it.each([['ordinary','male'],['special','male'],['special','female']] as const)('%s/%s可合法创建并被同批任务、组织、主子事件引用，不修改原状态或替玩家入场',(kind,gender)=>{
  const a=worldNpcCreation(kind,gender),before=structuredClone(a.state),raw=structuredClone(a.result),r=parse(a),p=projectTurn(a.state,a.draft,worldNpcCommands(r));
  expect(p.npc[a.person.id]).toMatchObject({id:a.person.id,kind,gender,onScene:false,affinity:0,relationshipText:a.person.relationshipText,memories:[expect.objectContaining({id:'remote-memory'})]});
  expect(p.npc[a.person.id].affinityConfirmed).toBeUndefined();expect(p.npc[a.person.id].knownInformation).toEqual([]);
  expect(p.locations['overseas-city'].parentId).toBe('overseas-country');expect(p.organizations['remote-company'].keyNpcIds).toEqual([a.person.id]);
  expect(p.tasks['remote-duty']).toMatchObject({actorRef:{id:a.person.id},linkedEventId:'remote-main',locationId:'overseas-city'});
  expect(p.events['remote-sub']).toMatchObject({parentEventId:'remote-main',protagonistEntry:{status:'pending',locationId:'overseas-city'}});
  expect(p.protagonist).toEqual(before.protagonist);expect(p.npc.scene).toEqual(before.npc.scene);expect(p.economy).toEqual(before.economy);expect(a.state).toEqual(before);expect(a.result).toEqual(raw);
  if(gender==='female')expect(p.npc[a.person.id]).toMatchObject({privateProfile:fullPrivateProfile});else expect(p.npc[a.person.id]).not.toHaveProperty('privateProfile');
});

it.each(['confirmation','confirmation-false','male-profile','minor-profile','unknown-profile','ordinary-profile','on-scene','positive-affinity','interaction','inline-memory','missing-country','task-owner','missing-event-parent','future-memory','future-task','future-start'] as const)('%s真实解析继续拒绝，不自动清洗非法输出',fault=>{
  const a=worldNpcCreation(fault==='ordinary-profile'?'ordinary':'special'),before=structuredClone(a.state);
  if(fault==='confirmation')a.create.npc.affinityConfirmed=true;
  if(fault==='confirmation-false')Object.assign(a.create.npc,{affinityConfirmed:false});
  if(['male-profile','minor-profile','unknown-profile','ordinary-profile'].includes(fault))Object.assign(a.create.npc,{privateProfile:{...fullPrivateProfile},...(fault==='minor-profile'?{gender:'female',age:17}:fault==='unknown-profile'?{gender:'unknown'}:fault==='ordinary-profile'?{kind:'ordinary'}:{})});
  if(fault==='on-scene')a.create.npc.onScene=true;
  if(fault==='positive-affinity')a.create.npc.affinity=1;
  if(fault==='interaction')a.create.npc.lastInteractionAt=a.state.worldClock;
  if(fault==='inline-memory')a.create.npc.memories=[{id:'inline',text:'内联经历',createdAtGameTime:a.state.worldClock,sourceTurnIds:[a.draft.turnId],affectedEntityRefs:[],visibility:'npc_private',knowledgeSource:'本人'}];
  if(fault==='missing-country'){const c=a.result.worldCommands[0];if(c.type==='CreateLocation')c.location.parentId='missing-country';}
  if(fault==='task-owner'){const c=a.result.taskCommands[0];if(c.type==='SaveTask')c.task.actorRef={kind:'npc',id:'missing-owner'};}
  if(fault==='missing-event-parent'){const c=a.result.eventCommands[1];if(c.type==='SaveEvent')c.event.parentEventId='missing-main';}
  if(fault==='future-memory'){const c=a.result.worldCommands[2];if(c.type==='RecordNpcMemory')c.memory.createdAtGameTime='2099-01-01T00:00:00+08:00';}
  if(fault==='future-task'){const c=a.result.taskCommands[0];if(c.type==='SaveTask'){c.task.startAt='2099-01-01T00:00:00+08:00';c.task.dueAt='2099-01-02T00:00:00+08:00';}}
  if(fault==='future-start'){const c=a.result.eventCommands[1];if(c.type==='SaveEvent'){c.event.startAt='2099-01-01T00:00:00+08:00';c.event.fixedEndAt='2099-01-02T00:00:00+08:00';}}
  const raw=structuredClone(a.result);expect(()=>parse(a)).toThrow();expect(a.state).toEqual(before);expect(a.result).toEqual(raw);
});

it('原日志的阻断顺序：初始确认先拒绝，移除后男性档案仍拒绝；两处修正后才接受',()=>{
 const a=worldNpcCreation();a.create.npc.affinityConfirmed=true;Object.assign(a.create.npc,{privateProfile:{...fullPrivateProfile}});
 expect(()=>parse(a)).toThrow(expect.objectContaining({code:'permission',details:expect.objectContaining({worldRule:'actor_permission',fieldPath:'worldCommands.1',commandType:'CreateNpc'})}));
 delete a.create.npc.affinityConfirmed;
 expect(()=>parse(a)).toThrow(expect.objectContaining({code:'data_integrity',details:expect.objectContaining({worldRule:'domain_state',fieldPath:'worldCommands.1'})}));
 Reflect.deleteProperty(a.create.npc,'privateProfile');expect(()=>parse(a)).not.toThrow();
});

it('地理语义不是程序审批：真实存在但错误的父地点仍属于AI推理问题，不假造程序修复',()=>{
 const a=worldNpcCreation(),c=a.result.worldCommands[0];if(c.type!=='CreateLocation')throw Error();c.location.parentId='china';
 expect(()=>parse(a)).not.toThrow();
});

it.each(['opening','regular'] as const)('%s实际World messages和命令Schema明确初值、亲属区别、性别资格与海外层级',async mode=>{
 const a=worldNpcCreation();a.draft.turnKind=mode;a.draft.story!.turnKind=mode;
 const prompt=await composePrompt({...a,stage:'world',mode,settings:defaultSettings(),userInput:'继续',domains:selectWorldDomains(a.state,a.draft).domains}),text=prompt.messages.map(m=>m.content).join('\n');
 for(const marker of ['World新建NPC初值','affinityConfirmed必须省略','亲属关系','男性特殊NPC不得携带privateProfile','私密档案资格','地理从属','瑞士','苏黎世'])expect(text).toContain(marker);
 const catalog=record(sentContext(prompt.messages).COMMAND_CATALOG);expect(catalog).toEqual(commandCatalog('world'));
 const create=array(record(catalog.schema).oneOf).map(record).find(s=>record(record(s.properties).type).const==='CreateNpc')!,schema=record(record(create.properties).npc),variants=array(schema.oneOf??schema.anyOf).map(record);
 expect(variants).toHaveLength(2);
 for(const variant of variants){const properties=record(variant.properties);expect(properties).not.toHaveProperty('affinityConfirmed');expect(properties).not.toHaveProperty('lastInteractionAt');expect(record(properties.affinity).const).toBe(0);expect(record(properties.onScene).const).toBe(false);expect(record(properties.memories).maxItems).toBe(0);expect(record(properties.knownInformation).maxItems).toBe(0);}
 const special=variants.find(v=>record(record(v.properties).kind).const==='special')!;
 expect(special.allOf).toEqual([{if:{properties:{gender:{const:'female'},age:{minimum:18}},required:['gender']},else:{properties:{privateProfile:false}}}]);expect(Object.keys(record(record(record(special.properties).privateProfile).properties))).toEqual(Object.keys(fullPrivateProfile));
 // Variables and persistent creation schemas retain their existing capability.
 expect(JSON.stringify(commandCatalog('variables').schema)).toContain('affinityConfirmed');
});

it.each(['ordinary','special-male','special-female'] as const)('真实WorldStage %s候选→Commit→重载，单次Mock，无污染或重复提交',async variant=>{
 const a=worldNpcCreation(variant==='ordinary'?'ordinary':'special',variant==='special-female'?'female':'male'),factory=new IDBFactory(),name=`world-npc-${variant}`,repo=await SaveRepository.open(name,factory);repos.push(repo);
 await repo.create(a.state);const initial=createTurnDraft(a.state.saveId,0,a.draft.turnId,'opening','');await repo.saveDraft(initial,null);
 const upstream=await completeDraft(repo,{variables:a.draft.variables!.result});
 const config=defaultAiConfig(),channel=newChannel();channel.defaultModel='mock-world';config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock-world'};
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}},vault=new CredentialVault(storage,storage);vault.set(channel.id,'mock-only-world-npc');
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({choices:[{message:{content:JSON.stringify(a.result)},finish_reason:'stop'}]}));
 const stage=new WorldStage(repo,new AiClient(fetcher));let ready;try{ready=await stage.generate({draft:upstream,settings:defaultSettings(),config,vault});}finally{stage.dispose();}
 expect((await repo.loadDraft(a.state.saveId))?.world?.validation).toBe('validated');expect(await repo.load(a.state.saveId)).toEqual(a.state);
 const committed=await repo.commitTurn(submission(ready,''));expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 repo.close();const reopened=await SaveRepository.open(name,factory);repos.push(reopened);expect(await reopened.load(a.state.saveId)).toEqual(committed.state);
 expect(committed.state.npc[a.person.id].affinityConfirmed).toBeUndefined();expect(committed.state.protagonist).toEqual(a.state.protagonist);if(variant==='special-female')expect(committed.state.npc[a.person.id]).toMatchObject({privateProfile:fullPrivateProfile});
});

it('同批新人物的记忆按真实kind检查模块，不能依靠不存在的npc_undefined，也不能绕过缺失模块',()=>{
 for(const kind of ['ordinary','special'] as const){const a=worldNpcCreation(kind),domains=selectWorldDomains(a.state,a.draft).domains;
  expect(()=>assertWorldCoverage(domains,a.state,a.result.worldCommands)).not.toThrow();
  const memory=a.result.worldCommands.filter(c=>c.type==='RecordNpcMemory');
  expect(()=>assertWorldCoverage(domains.filter(d=>d!==`npc_${kind}`),a.state,a.result.worldCommands)).toThrow();
  expect(()=>assertWorldCoverage(domains,a.state,memory)).toThrow();
 }
});

it('原女性年龄未知的兼容口径不收紧，不为通过资格补造年龄',()=>{
 const a=worldNpcCreation('special','female');delete a.create.npc.age;Object.assign(a.create.npc,{privateProfile:{...fullPrivateProfile}});
 const p=projectTurn(a.state,a.draft,worldNpcCommands(parse(a)));expect(p.npc[a.person.id].age).toBeUndefined();expect(p.npc[a.person.id]).toMatchObject({privateProfile:fullPrivateProfile});
});
