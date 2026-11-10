import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore as FakeStore } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { DomainCommandSchema } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { migrateSave } from '../services/storage/migrations';
import { setNpcImportance } from '../domain/npc/profiles';
import { planNpcSummary, parseNpcSummary } from '../domain/memories/npcMemory';
import { legacyNpcMemories, fullPrivateProfile } from './fixtures/npcUnified';
import { npcSummaryOutput } from './fixtures/npcMemory';
import { npcV2State } from './fixtures/npcV2';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';

const profile={detailedBackground:'从小在海边成长，后来进入设计行业。',activeGoals:['完成工作室筹备'],habits:['记录每日见闻'],offscreenTaskIds:[],relationshipNetwork:[]};
const response=(commands:string)=>`<thinking>根据所选正文及已有状态维护人物。</thinking><说明></说明><命令>\n${commands}\n</命令>`;
const line=(path:string,value:unknown)=>`set npc[scene].${path} = ${JSON.stringify(value)}`;
const input=(state:ReturnType<typeof worldState>)=>rerollStory(createTurnDraft(state.saveId,state.revision,'npc-upgrade',state.turnNumber?'regular':'opening','交谈'),
  {turnKind:state.turnNumber?'regular':'opening',narrative:'【旁白】林澄谈起自己的成长经历、工作室筹备和生活习惯，并留下了可用的电话联系方式。',summary:'与林澄深入交谈。',variableGuide:[]});
async function manage(repo:SaveRepository,npcId:string,choice:'ordinary'|'special',operationId=crypto.randomUUID()){
  const {state,draft}=await repo.loadGame('save-a');
  return repo.setNpcImportance({saveId:state.saveId,expectedRevision:state.revision,expectedManagementRevision:state.npcManagementRevision??0,
    expectedDraftRevision:draft?.draftRevision,expectedTurnId:draft?.turnId,npcId,identityKey:state.npc[npcId].identityKey,choice,operationId});
}

it('真实三标签文本→编译→模拟→候选→World→Commit升级，保留稳定身份和全部统一记忆',async()=>{
  const state=worldState(),before=structuredClone(state),draft=input(state);
  const variables=await parseTextVariables(response(line('specialProfile',profile)+'\n'+line('phoneContact',{status:'known',note:'本人给出的可用电话'})+'\n'+line('usualLocations',[{locationId:'chongqing',role:'work',knownToProtagonist:true}])+'\n'+line('relationshipNetwork',[{name:'未建档的姐姐',relationship:'家人',description:'保持联系',affinity:null}])),state,draft);
  expect(state).toEqual(before);
  const repo=await SaveRepository.open('npc-upgrade',new IDBFactory());
  try{await repo.create(state);const ready=await completeDraft(repo,{narrative:draft.story!.narrative,variables,world:worldResult()});
    parseWorld(JSON.stringify(ready.world!.result),state,ready);
    const committed=await repo.commitTurn(submission(ready,''));
    expect(committed.state.npc.scene).toMatchObject({kind:'special',identityKey:state.npc.scene.identityKey,detailedBackground:profile.detailedBackground,phoneContact:{status:'known'},usualLocations:[{role:'work'}]});
    expect(committed.state.npc.scene.memories).toEqual(state.npc.scene.memories);expect(committed.state.npc['npc-a']).toEqual(state.npc['npc-a']);
    expect(committed.state.npc.scene).not.toHaveProperty('profilePending');expect(await repo.load('save-a')).toEqual(committed.state);
    expect((await repo.commitTurn(submission(ready,''))).replayed).toBe(true);
  }finally{repo.close();}
});

it('AI没有降级命令，玩家取消后升级被拒绝，非特殊人物不等于拒绝自动升级',async()=>{
  const state=worldState();await expect(parseTextVariables(response(line('kind','ordinary')),state,input(state))).rejects.toThrow();
  const cancelled=setNpcImportance(state,'scene',state.npc.scene.identityKey,'ordinary');
  await expect(parseTextVariables(response(line('specialProfile',profile)),cancelled,input(cancelled))).rejects.toThrow();
  expect(state.npc.scene.importancePreference).toBeUndefined();
  expect(DomainCommandSchema.safeParse({type:'DemoteNpc',npcId:'scene'}).success).toBe(false);
});

it('首升待完善不编造资料，后续正常Variables补齐，不重置基础关系或认知',async()=>{
  const state=worldState(),repo=await SaveRepository.open('pending-profile',new IDBFactory());
  try{await repo.create(state);const selected=await manage(repo,'scene','special');
    expect(selected.state.npc.scene).toMatchObject({kind:'special',profilePending:true,detailedBackground:'',activeGoals:[],habits:[]});
    expect(selected.state.worldClock).toBe(state.worldClock);expect(selected.state.revision).toBe(state.revision);expect(selected.state.turnNumber).toBe(0);
    const draft=input(selected.state),result=await parseTextVariables(response(line('specialProfile',profile)),selected.state,draft);
    const ready=await completeDraft(repo,{variables:result,world:worldResult()});const saved=await repo.commitTurn(submission(ready,''));
    expect(saved.state.npc.scene).toMatchObject({kind:'special',importancePreference:'special',affinity:state.npc.scene.affinity});
    expect(saved.state.npc.scene).not.toHaveProperty('profilePending');
  }finally{repo.close();}
});

it.each(['special','initialCompanion'] as const)('%s玩家取消与恢复：七字段、原始设定、记忆及总结逐字保留',async kind=>{
  const state=migrateSave(legacyNpcMemories());if(kind==='initialCompanion')state.initialCompanionId='npc-a';
  const repo=await SaveRepository.open('roundtrip-'+kind,new IDBFactory());
  // Legacy fixture is a committed save; seed using a real IndexedDB record.
  repo.close();const factory=new IDBFactory(),name='roundtrip-record-'+kind;let store=await SaveRepository.open(name,factory);
  try{await put(factory,name,'saves',state);const before=await store.load('save-a');
    await manage(store,'npc-a','ordinary');store.close();store=await SaveRepository.open(name,factory);
    const sleeping=await store.load('save-a');expect(sleeping.npc['npc-a'].kind).toBe('ordinary');
    expect(sleeping.dormantNpcProfiles!['npc-a'].profile.privateProfile).toEqual(fullPrivateProfile);
    expect(sleeping.memories).toEqual(before.memories);expect(sleeping.npc['npc-a'].memories).toEqual(before.npc['npc-a'].memories);
    expect(sleeping.initialCompanionId).toBe(before.initialCompanionId);
    await manage(store,'npc-a','special');const restored=await store.load('save-a');
    expect(restored.npc['npc-a']).toEqual({...before.npc['npc-a'],importancePreference:'special'});expect(restored.memories).toEqual(before.memories);
    expect(restored.npc['npc-a']).toMatchObject({privateProfile:fullPrivateProfile});
  }finally{store.close();}
});

async function put(factory:IDBFactory,name:string,table:string,value:unknown){
  await new Promise<void>((resolve,reject)=>{const open=factory.open(name);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(table,'readwrite');tx.objectStore(table).put(value);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
}

it('管理操作保留已生成Story及候选，旧请求CAS失败；合法新基线重验仍能结算',async()=>{
  const repo=await SaveRepository.open('management-draft',new IDBFactory());
  try{await repo.create(worldState());const ready=await completeDraft(repo,{variables:{commands:[],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
    const next=await manage(repo,'scene','special');expect(next.draft).toEqual({...ready,draftRevision:ready.draftRevision+1});
    await expect(repo.commitTurn(submission(ready,''))).rejects.toThrow();
    await expect(repo.saveDraft({...ready,draftRevision:ready.draftRevision+1},ready.draftRevision)).rejects.toThrow();
    expect((await repo.commitTurn(submission(next.draft!,''))).state.npc.scene).toMatchObject({kind:'special',profilePending:true});
    await manage(repo,'scene','ordinary');const replay=await repo.commitTurn(submission(next.draft!,''));
    expect(replay.replayed).toBe(true);expect(replay.state.npc.scene.importancePreference).toBe('ordinary');
  }finally{repo.close();}
});

it('跨标签玩家操作有独立CAS，重复回执不增加计数，非法身份失败原子保留全部存储',async()=>{
  const factory=new IDBFactory(),repo=await SaveRepository.open('management-cas',factory),other=await SaveRepository.open('management-cas',factory);
  try{await repo.create(worldState());const state=await repo.load('save-a');
    const request={saveId:'save-a',expectedRevision:0,expectedManagementRevision:0,npcId:'scene',identityKey:state.npc.scene.identityKey,choice:'special' as const,operationId:'once'};
    await repo.setNpcImportance(request);expect((await other.setNpcImportance(request)).replayed).toBe(true);
    await expect(other.setNpcImportance({...request,operationId:'race'})).rejects.toThrow();
    const before=await repo.exportRaw('save-a');await expect(repo.setNpcImportance({...request,expectedManagementRevision:1,identityKey:'wrong',operationId:'bad'})).rejects.toThrow();
    expect(await repo.exportRaw('save-a')).toEqual(before);expect((await repo.load('save-a')).npcManagementRevision).toBe(1);
  }finally{repo.close();other.close();}
});

it('管理后迟到NPC总结受epoch拒绝，玩家原记忆不变，未清除费用尝试记录',async()=>{
  const factory=new IDBFactory(),repo=await SaveRepository.open('management-summary',factory);
  try{await put(factory,'management-summary','saves',migrateSave(legacyNpcMemories(7,false)));
    const context=await repo.loadMemoryContext('save-a'),batch=planNpcSummary(context.state,'npc-a')!;
    const result=parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)),batch,'late');
    await manage(repo,'npc-a','ordinary');const before=await repo.load('save-a');
    await expect(repo.saveNpcSummary(batch,result,context.lineage)).rejects.toThrow(/时间线已改变/);expect(await repo.load('save-a')).toEqual(before);
  }finally{repo.close();}
});

it('管理不清除撤回链，撤回保留当前玩家选择，只使用恢复点的专属资料',async()=>{
  const repo=await SaveRepository.open('management-undo',new IDBFactory());
  try{await repo.create(worldState());await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'第一轮',60),world:worldResult()}),''));
    const committed=await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'第二轮',60),world:worldResult()}),''));
    const next=await manage(repo,'npc-a','ordinary');expect((await repo.undoStatus('save-a')).available).toBe(1);
    const undone=await repo.undoTurn({saveId:'save-a',expectedRevision:committed.state.revision,expectedDraft:next.draft,operationId:'undo'});
    expect(undone.state.npc['npc-a'].kind).toBe('ordinary');expect(undone.state.npc['npc-a'].importancePreference).toBe('ordinary');expect(undone.state.npcManagementRevision).toBe(1);
    expect((await repo.undoStatus('save-a')).available).toBe(0);
  }finally{repo.close();}
});

it('Variables新增电话、地点、专属属性及关系网；无效引用/越界数值整批拒绝',async()=>{
  const state=worldState(),draft=input(state);
  for(const [path,value] of [['usualLocations',[{locationId:'missing',role:'home',knownToProtagonist:false}]],['phoneContact',{status:'guessed'}],['relationshipNetwork',[{name:'朋友',relationship:'友人',description:'旧识',npcId:'missing'}]],['relationshipNetwork',[{name:'朋友',relationship:'友人',description:'旧识',affinity:101}]]] as const)
    await expect(parseTextVariables(response(line('specialProfile',profile)+'\n'+line(path,value)),state,draft)).rejects.toThrow();
  const result=await parseTextVariables(response(line('specialProfile',profile)+'\n'+line('habits',['观察晨间人流'])+'\n'+line('detailedBackground','经历补充')+'\n'+line('usualLocations',[{locationId:'chongqing',role:'home',knownToProtagonist:false}])),state,draft);
  expect(result.commands.some(c=>c.type==='UpdateNpc'&&c.changes.usualLocations?.[0].knownToProtagonist===false)).toBe(true);
  expect(state.npc.scene.phoneContact).toBeUndefined();
});

it('新能力不扩大World权限，不允许World升级或填写新的Variables字段',()=>{
  const state=worldState(),draft=worldDraft();
  for(const c of [{type:'PromoteNpc',commandId:'p',evidence:'无',npcId:'npc-a',identityKey:state.npc['npc-a'].identityKey,expectedRevision:0,profile},
    {type:'UpdateNpc',commandId:'u',evidence:'无',npcId:'npc-a',expectedRevision:0,changes:{phoneContact:{status:'known'}}}])
    expect(()=>parseWorld(JSON.stringify(worldResult([c as never])),state,draft)).toThrow();
});

it.each([6,7,8] as const)('V%s存档保留身份/原始记忆/初始同伴，迁移不自动声明玩家选择',version=>{
  const raw=version===8?{...migrateSave(legacyNpcMemories()),schemaVersion:8}:legacyNpcMemories(version);
  const before=structuredClone(raw),state=migrateSave(raw);expect(state.schemaVersion).toBe(9);expect(raw).toEqual(before);
  expect(state.npc['npc-a'].memories).toHaveLength(21);expect(state.npc['npc-a'].importancePreference).toBeUndefined();expect(state.npcManagementRevision).toBeUndefined();
});

it('真实Composer三阶段隔离休眠七字段，Variables接收玩家选择与待完善标记',async()=>{
  const state=npcV2State();state.npc.special={...state.npc.special,kind:'special',detailedBackground:'隐藏背景',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[],privateProfile:fullPrivateProfile};
  const sleeping=setNpcImportance(state,'special',state.npc.special.identityKey,'ordinary');const pending=setNpcImportance(sleeping,'person',state.npc.person.identityKey,'special');
  const draft=rerollStory(createTurnDraft(state.saveId,state.revision,'read','opening','继续'),{turnKind:'opening',narrative:'【旁白】继续交谈。',summary:'交谈',variableGuide:[]});
  for(const stage of ['story','variables','world'] as const){const request=await composePrompt({stage,mode:'opening',state:pending,draft,settings:defaultSettings(),userInput:'继续'}),text=JSON.stringify(request.messages);
    for(const value of Object.values(fullPrivateProfile))if(typeof value==='string')expect(text).not.toContain(value.trim());expect(text).not.toContain('隐藏背景');
    if(stage==='variables')expect(request.context.NPC_IMPORTANCE).toEqual(expect.arrayContaining([expect.objectContaining({npcId:'person',playerPreference:'special',profilePending:true}),expect.objectContaining({npcId:'special',playerPreference:'ordinary',canRestoreProfile:true})]));
  }
});

it('正常AI首次普通/特殊建档、稳定ID重复拒绝，同批新建可升级',async()=>{
  const state=worldState(),draft=input(state),base={...state.npc.scene,id:undefined,name:'沈岚',identityKey:'new-shen',onScene:true};delete base.id;
  for(const kind of ['ordinary','special'] as const){const value={...base,kind,...(kind==='special'?{detailedBackground:profile.detailedBackground,activeGoals:profile.activeGoals,habits:profile.habits,offscreenTaskIds:[]}:{})};
    const result=await parseTextVariables(response('set npc[new-shen] = '+JSON.stringify(value)),state,draft);expect(result.commands[0].type).toBe('CreateNpc');
    await expect(parseTextVariables(response('set npc[duplicate] = '+JSON.stringify({...value,identityKey:state.npc.scene.identityKey})),state,draft)).rejects.toThrow();
  }
  const result=await parseTextVariables(response('set npc[new-shen] = '+JSON.stringify(base)+'\nset npc[new-shen].specialProfile = '+JSON.stringify(profile)),state,draft);
  expect(result.commands.at(-1)?.type).toBe('PromoteNpc');
});


it('故障注入：管理写control失败，正式档案、草稿、epoch和撤回链全部原子回滚',async()=>{
 const factory=new IDBFactory(),repo=await SaveRepository.open('management-abort',factory);
 try{await repo.create(worldState());await completeDraft(repo);const before=await repo.exportRaw('save-a');
  const original=FakeStore.prototype.put;
  vi.spyOn(FakeStore.prototype,'put').mockImplementation(function(this:InstanceType<typeof FakeStore>,...args:Parameters<typeof original>){
    if(this.name==='saveControls')throw new DOMException('mock quota','QuotaExceededError');return original.apply(this,args);
  });
  await expect(manage(repo,'scene','special')).rejects.toThrow();vi.restoreAllMocks();expect(await repo.exportRaw('save-a')).toEqual(before);
 }finally{vi.restoreAllMocks();repo.close();}
});

it('升级后香闺七字段经原Variables路径提交，已有初次经历不可覆盖',async()=>{
 const repo=await SaveRepository.open('promote-private',new IDBFactory());
 try{const state=worldState();await repo.create(state);
  const variables=await parseTextVariables(response(line('specialProfile',profile)+'\n'+line('gender','female')+'\n'+line('privateProfile',fullPrivateProfile)+'\n'+line('privateProfile',{firstExperienceTarget:'不能覆盖',firstExperienceTime:'不能覆盖',firstExperienceText:'不能覆盖'})),state,input(state));
  const saved=await repo.commitTurn(submission(await completeDraft(repo,{variables,world:worldResult()}),''));
  expect(saved.state.npc.scene).toMatchObject({privateProfile:fullPrivateProfile});
  const slept=await manage(repo,'scene','ordinary');expect(slept.state.dormantNpcProfiles!.scene.profile.privateProfile).toEqual(fullPrivateProfile);
  const restored=await manage(repo,'scene','special');expect(restored.state.npc.scene).toMatchObject({privateProfile:fullPrivateProfile});
 }finally{repo.close();}
});

it.each(['没有姓名的过路人递来纸巾。','店员完成一次结账，随后主角离开。'])('临时互动Mock不建档，仍可记录主角已发生变化：%s',async narrative=>{
 const state=worldState(),draft=input(state);draft.story!.narrative='【旁白】'+narrative;
 const result=await parseTextVariables(response('set protagonist.emotionText = "感谢对方的帮助"'),state,draft);
 expect(result.commands).toHaveLength(1);expect(result.commands[0].type).toBe('UpdateProtagonist');expect(Object.keys(state.npc)).toEqual(Object.keys(worldState().npc));
 const request=await composePrompt({stage:'variables',mode:'opening',state,draft,settings:defaultSettings(),userInput:'继续'}),text=request.messages.map(m=>m.content).join('\n');
 expect(text).toContain('不编造无名路人姓名');expect(text).toContain('事件追踪价值');
});

it.each([false,true])('玩家管理不受在场/好感/电话条件限制，在场=%s',async onScene=>{
 const repo=await SaveRepository.open('manual-no-threshold-'+onScene,new IDBFactory());
 try{const state=worldState();state.npc.scene.onScene=onScene;state.npc.scene.affinity=-100;state.npc.scene.phoneContact={status:'unknown'};await repo.create(state);
  const next=await manage(repo,'scene','special');expect(next.state.npc.scene).toMatchObject({kind:'special',affinity:-100,phoneContact:{status:'unknown'},onScene});
 }finally{repo.close();}
});


it('已保存的AI升级候选不能越过玩家取消，失败Commit不改变任何正式数据',async()=>{
 const repo=await SaveRepository.open('blocked-old-promotion',new IDBFactory());
 try{const state=worldState();await repo.create(state);const vars=await parseTextVariables(response(line('specialProfile',profile)),state,input(state));
  await completeDraft(repo,{variables:vars,world:worldResult()});const managed=await manage(repo,'scene','ordinary'),before=await repo.exportRaw('save-a');
  await expect(repo.commitTurn(submission(managed.draft!,''))).rejects.toThrow();expect(await repo.exportRaw('save-a')).toEqual(before);
  expect((await repo.loadDraft('save-a'))!.story).toEqual(managed.draft!.story);
 }finally{repo.close();}
});

it('V8旧完整快照按需恢复为V9，不清除已有撤回链',async()=>{
 const factory=new IDBFactory(),name='v8-undo',repo=await SaveRepository.open(name,factory);
 try{await repo.create(worldState());
  await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'一',60),world:worldResult()}),''));
  const latest=await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'二',60),world:worldResult()}),''));
  const exported=await repo.exportRaw('save-a'),record=exported.records.turnUndo![0].value as {stateJSON:string};
  const old=JSON.parse(record.stateJSON);old.schemaVersion=8;record.stateJSON=JSON.stringify(old);await put(factory,name,'turnUndo',record);
  expect((await repo.undoStatus('save-a')).available).toBe(1);
  const result=await repo.undoTurn({saveId:'save-a',expectedRevision:latest.state.revision,expectedDraft:latest.draft,operationId:'v8-undo'});
  expect(result.state.schemaVersion).toBe(9);expect(result.state.npc).toEqual(old.npc);expect((await repo.undoStatus('save-a')).available).toBe(0);
 }finally{repo.close();}
});
