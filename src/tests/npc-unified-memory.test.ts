import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { GameStateSchema } from '../domain/state';
import { hibernateNpcProfile, restoreNpcProfile } from '../domain/npc/profiles';
import { DomainCommandSchema, commitCommands, fingerprint } from '../domain/commands';
import { npcSummaryCandidates, planNpcSummary, applyNpcSummary, parseNpcSummary } from '../domain/memories/npcMemory';
import { composePrompt } from '../prompts/composer';
import { commandCatalog } from '../services/validation/commandCatalog';
import { defaultSettings } from '../ui/settings/model';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { parseVariables, parseWorld } from '../services/validation/aiOutputs';
import { projectTurn } from '../domain/turnProjection';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { legacyNpcMemories, fullPrivateProfile } from './fixtures/npcUnified';
import { npcSummaryOutput } from './fixtures/npcMemory';
import { worldDraft, worldState, worldResult } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';

it.each([6, 7] as const)('V%s两层原文、来源与总结无损整合，不猜造认知、不改变世界历史', version => {
  const raw = legacyNpcMemories(version), before = structuredClone(raw), person = raw.npc['npc-a'];
  if (person.kind !== 'special') throw Error();
  const expected = [...person.memories, ...person.longTermMemories];
  const result = migrateSave(raw);
  expect(result.npc['npc-a'].memories).toEqual(expected);
  expect(result.npc['npc-a']).toMatchObject({ longTermMemories: [], privateProfile: fullPrivateProfile });
  expect(result.npc['npc-a'].memories.find(m => m.id === 'npc-a-memory-21')!.knowledgeKind).toBeUndefined();
  expect(result.memories).toEqual(raw.memories); expect(result.journal).toEqual(raw.journal);
  expect(result.worldClock).toBe(raw.worldClock); expect(result.turnNumber).toBe(raw.turnNumber); expect(raw).toEqual(before);
  expect(npcSummaryCandidates(result, 'npc-a')).toHaveLength(6);
  expect(migrateSave(result)).toEqual(result); expect(result.schemaVersion).toBe(9);
});

it('含真实来源的总结和全部原文随特殊身份降级/恢复保留；香闺七字段逐字往返', () => {
  const state = migrateSave(legacyNpcMemories()), original = structuredClone(state), person = state.npc['npc-a'];
  const sleeping = hibernateNpcProfile(state, person.id, person.identityKey);
  expect(sleeping.npc['npc-a'].kind).toBe('ordinary'); expect(sleeping.npc['npc-a'].memories).toEqual(person.memories);
  expect(sleeping.memories).toEqual(state.memories);
  expect(sleeping.dormantNpcProfiles!['npc-a'].profile.privateProfile).toEqual(fullPrivateProfile);
  expect(sleeping.dormantNpcProfiles!['npc-a'].profile.longTermMemories).toEqual([]);
  expect(npcSummaryCandidates(sleeping, 'npc-a')).toEqual(npcSummaryCandidates(state, 'npc-a'));
  const restored = restoreNpcProfile(sleeping, person.id, person.identityKey);
  expect(restored.npc).toEqual(state.npc); expect(restored.memories).toEqual(state.memories); expect(state).toEqual(original);
});

it('降级后的普通人物可继续记录和总结；重复恢复不复制来源或重新总结', () => {
  const state = migrateSave(legacyNpcMemories(7, false)), id = 'npc-a', identity = state.npc[id].identityKey;
  const sleeping = hibernateNpcProfile(state, id, identity), batch = planNpcSummary(sleeping, id)!;
  expect(batch.entries).toHaveLength(15);
  const summarized = applyNpcSummary(sleeping, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'normal-summary'));
  const restored = restoreNpcProfile(summarized, id, identity), again = hibernateNpcProfile(restored, id, identity);
  expect(again.npc[id].memories).toEqual(sleeping.npc[id].memories); expect(again.memories).toEqual(summarized.memories);
  expect(planNpcSummary(again, id)).toBeUndefined();
  expect(() => applyNpcSummary(again, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'duplicate'))).toThrow();
});

it('无可靠来源的旧总结保守保留，身份切换不擅自启用付费重做', () => {
  const raw = legacyNpcMemories(), summary = raw.memories.npcSummaries['npc-a'][0]; delete summary.npcProvenance;
  const state = migrateSave(raw), sleeping = hibernateNpcProfile(state, 'npc-a', state.npc['npc-a'].identityKey);
  expect(sleeping.memories.npcSummaries).toEqual(raw.memories.npcSummaries);
  expect(planNpcSummary(sleeping, 'npc-a')).toBeUndefined();
  expect(restoreNpcProfile(sleeping, 'npc-a', state.npc['npc-a'].identityKey).memories).toEqual(state.memories);
});

it.each(['same-id', 'other-owner', 'public-id', 'missing-source'] as const)('旧记忆%s歧义安全拒绝，原输入不变', issue => {
  const raw = legacyNpcMemories(), owner = raw.npc['npc-a']; if (owner.kind !== 'special') throw Error();
  if (issue === 'same-id') owner.longTermMemories[0].id = owner.memories[0].id;
  if (issue === 'other-owner') raw.npc['npc-b'].memories[0].id = owner.memories[0].id;
  if (issue === 'public-id') raw.memories.short.push({id:owner.memories[0].id,text:'公开记忆',sourceTurnIds:[],affectedEntityRefs:[],visibility:'player_known',createdAtGameTime:raw.worldClock});
  if (issue === 'missing-source') owner.longTermMemories = owner.longTermMemories.filter(m => m.id !== raw.memories.npcSummaries['npc-a'][0].npcProvenance!.sourceMemoryIds[1]);
  const before = structuredClone(raw); expect(() => migrateSave(raw)).toThrow(); expect(raw).toEqual(before);
});

it('旧V7休眠长期经历归还所属人物统一记忆，专属原文仍留休眠，不授予其他人知识', () => {
  const raw = legacyNpcMemories(7, false), person = raw.npc['npc-a']; if (person.kind !== 'special') throw Error();
  const { detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds, privateProfile, ...base } = person;
  raw.npc['npc-a'] = { ...base, kind:'ordinary' };
  raw.dormantNpcProfiles = { 'npc-a': { id:'npc-a', identityKey:person.identityKey, profile:{ detailedBackground, activeGoals, habits, longTermMemories, offscreenTaskIds, privateProfile } } };
  const next = migrateSave(raw);
  expect(next.npc['npc-a'].memories).toHaveLength(21); expect(next.npc['npc-b']).toEqual(raw.npc['npc-b']);
  expect(next.npc['npc-a'].knownInformation).toEqual(raw.npc['npc-a'].knownInformation);
  expect(next.dormantNpcProfiles!['npc-a'].profile.privateProfile).toEqual(fullPrivateProfile);
  expect(next.dormantNpcProfiles!['npc-a'].profile.longTermMemories).toEqual([]);
});

it.each(['ordinary', 'special'] as const)('%s实际文本→命令→模拟→正式重验只写统一人物记忆，可空命令且不强制记录', async kind => {
  const state = worldState();
  if (kind === 'ordinary') state.npc['npc-a'] = { ...state.npc.scene, id:'npc-a', identityKey:'identity-npc-a' };
  state.npc['npc-a'].onScene = true;
  expect(GameStateSchema.safeParse(state)).toMatchObject({ success:true });
  const draft = worldDraft(true, 'opening'); draft.story!.narrative = '【旁白】主角与同事共同确认了下一次见面的安排。';
  const ast = parseVariableText('<命令>\npush npc[npc-a].memories = {"text":"共同确认见面安排","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}\n</命令>');
  if (!ast.ok) throw Error();
  const plan = await compileVariableCommands(ast.value, state, { draft, expectedRevision:0 }); if (!plan.ok) throw Error(JSON.stringify(plan.error));
  const checked = parseVariables(JSON.stringify({commands:plan.value.commands,rejectedSuggestions:[],unresolved:[]}), state,draft);
  const next = await simulateVariablePlan(plan.value, state, { draft,expectedRevision:0 }); if (!next.ok) throw Error(JSON.stringify(next.error));
  expect(next.value.npc['npc-a'].memories).toHaveLength(1); expect(state.npc['npc-a'].memories).toEqual([]);
  expect(checked.commands[0].type).toBe('RecordNpcMemory'); expect(next.value.npc.scene.memories).toEqual([]);
  expect(parseVariables(JSON.stringify({commands:[],rejectedSuggestions:[],unresolved:[]}),state,draft).commands).toEqual([]);
});

it.each(['ordinary','special'] as const)('%s旧layer命令和已应用回执保持指纹；长期别名实际也只写memories', kind => {
  const state = worldState(), time = state.worldClock;
  if (kind === 'ordinary') state.npc['npc-a'] = { ...state.npc.scene, id:'npc-a', identityKey:'identity-npc-a' };
  const command = DomainCommandSchema.parse({type:'RecordNpcMemory',commandId:'legacy-layer',expectedRevision:0,npcId:'npc-a',evidence:'旧候选',layer:'longTerm',addToKnownInformation:false,knowledgeKind:'observed',
    memory:{id:'legacy-new',text:'旧层命令的一次经历',knowledgeSource:'亲历',visibility:'npc_private',createdAtGameTime:time,sourceTurnIds:['turn-a'],affectedEntityRefs:[{kind:'npc',id:'npc-a'}]} });
  const before = fingerprint(command), next = commitCommands(state,'turn-a',0,[command]);
  expect(next.npc['npc-a'].memories).toHaveLength(1);
  if(kind === 'special') expect(next.npc['npc-a']).toMatchObject({longTermMemories:[]});
  expect(next.appliedCommands[0].fingerprint).toBe(before);
  expect(commitCommands(next,'turn-a',0,[command])).toEqual(next);
});

it('最终请求目录不要求长期层；原始记忆仍读全，休眠香闺资料不泄漏', async () => {
  const state = migrateSave(legacyNpcMemories()), sleeping = hibernateNpcProfile(state,'npc-a',state.npc['npc-a'].identityKey);
  for (const stage of ['story','variables','world'] as const) {
    const draft = worldDraft(); draft.baseSaveRevision = sleeping.revision; draft.userInput='找npc-a核对原始经历';
    const request = await composePrompt({stage,mode:'regular',state:sleeping,draft,settings:defaultSettings(),userInput:draft.userInput});
    const text = JSON.stringify(request.messages);
    expect(text).not.toContain(fullPrivateProfile.firstExperienceText.trim());
    expect(text).toContain('原始文本'); expect(text).not.toContain('push npc[lin].longTermMemories');
    expect(text).not.toContain('push npc[id].longTermMemories');
    expect(text).not.toContain('特殊人物另有longTermMemories');
  }
  expect(textVariableCatalog().entries.some(e => e.path === 'npc[id].longTermMemories')).toBe(false);
  const catalog = commandCatalog('world');
  const schema = catalog.schema.oneOf.find(s => s.properties?.type && typeof s.properties.type === 'object' && s.properties.type.const === 'RecordNpcMemory')!;
  expect(schema.properties).not.toHaveProperty('layer');
});

it('V8正式存储、回合快照、撤回及重开保留统一记忆与香闺全部字段', async () => {
  const repo = await SaveRepository.open('unified', new IDBFactory());
  try {
    const seed = worldState(); seed.npc['npc-a'] = { ...seed.npc['npc-a'], kind:'special', detailedBackground:'独立背景',activeGoals:[],habits:[],longTermMemories:[],offscreenTaskIds:[],age:30,gender:'female',privateProfile:fullPrivateProfile };
    await repo.create(hibernateNpcProfile(seed,'npc-a',seed.npc['npc-a'].identityKey));
    const first = await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'日常',60),world:worldResult()}),''));
    const second = await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'日常',60),world:worldResult()}),''));
    const restored = await repo.undoTurn({saveId:'save-a',expectedRevision:second.state.revision,expectedDraft:second.draft,operationId:'undo'});
    expect(restored.state.npc).toEqual(first.state.npc); expect(restored.state.dormantNpcProfiles).toEqual(first.state.dormantNpcProfiles);
    expect(restoreNpcProfile(await repo.load('save-a'),'npc-a',seed.npc['npc-a'].identityKey).npc['npc-a']).toMatchObject({privateProfile:fullPrivateProfile});
  } finally { repo.close(); }
});

async function rawStore(factory: IDBFactory, name: string, table: string, action: (store: IDBObjectStore) => IDBRequest) {
  return new Promise<unknown>((resolve,reject) => {
    const open = factory.open(name); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(table,'readwrite'), request = action(tx.objectStore(table)); let value:unknown;
      request.onsuccess = () => { value=request.result; };
      tx.oncomplete = () => { db.close();resolve(value); }; tx.onabort=()=>{db.close();reject(tx.error);};
    };
  });
}

it.each([6,7] as const)('V%s实际Repository迁移、旧层候选提交、旧快照撤回和重开完整保留来源', async version => {
  const factory = new IDBFactory(), name='legacy-unified-'+version;
  let repo = await SaveRepository.open(name,factory);
  try {
    await repo.create(worldState()); const raw=legacyNpcMemories(version);
    await rawStore(factory,name,'saves',s=>s.put(raw));
    const baseline = await repo.load('save-a'); expect(baseline.npc['npc-a'].memories).toHaveLength(21);
    const next = await completeDraft(repo,{variables:{commands:[
      ...(await elapsedVariables(repo,'继续共同经历',60)).commands,
      {type:'RecordNpcMemory',commandId:'legacy-candidate',evidence:'所选正文中的共同经历',npcId:'npc-a',expectedRevision:baseline.revision,knowledgeKind:'observed',layer:'longTerm',addToKnownInformation:false,
        memory:{id:'candidate-memory',text:'本轮共同经历',knowledgeSource:'当面',visibility:'npc_private',createdAtGameTime:baseline.worldClock,sourceTurnIds:['initial-save-a'],affectedEntityRefs:[{kind:'npc',id:'npc-a'}]}}
    ],rejectedSuggestions:[],unresolved:[]},world:worldResult()});
    const committed=await repo.commitTurn(submission(next,''));
    expect(committed.state.npc['npc-a'].memories).toHaveLength(22);
    expect(committed.state.memories.npcSummaries).toEqual(raw.memories.npcSummaries);
    expect((await repo.commitTurn(submission(next,''))).replayed).toBe(true);
    const records=await rawStore(factory,name,'turnUndo',s=>s.getAll()) as {stateJSON:string}[];
    const record=records[0]; record.stateJSON=JSON.stringify(raw);
    await rawStore(factory,name,'turnUndo',s=>s.put(record));
    const control=await rawStore(factory,name,'saveControls',s=>s.get('save-a')) as {records:{bytes:number}[]};
    control.records[0].bytes=new TextEncoder().encode(JSON.stringify(record)).byteLength;
    await rawStore(factory,name,'saveControls',s=>s.put(control));
    repo.close(); repo=await SaveRepository.open(name,factory);
    const current=await repo.loadGame('save-a');
    const restored=await repo.undoTurn({saveId:'save-a',expectedRevision:current.state.revision,expectedDraft:current.draft,operationId:'legacy-undo'});
    expect(restored.state.npc).toEqual(baseline.npc); expect(restored.state.memories).toEqual(baseline.memories);
    expect(restored.state.worldClock).toBe(raw.worldClock);expect(restored.state.journal).toEqual(raw.journal);
    expect(await repo.load('save-a')).toEqual(restored.state);
  } finally { repo.close(); }
});

it('迁移冲突或来源丢失不写回正式状态、不删除旧快照或草稿', async () => {
  const factory=new IDBFactory(), name='bad-legacy',repo=await SaveRepository.open(name,factory);
  try {
    await repo.create(worldState()); const legacy=legacyNpcMemories();
    await rawStore(factory,name,'saves',s=>s.put(legacy));
    const committed=await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'日常',60),world:worldResult()}),''));
    const raw={...committed.state,schemaVersion:7},owner=raw.npc['npc-a'];if(owner.kind!=='special')throw Error();
    owner.longTermMemories=[{...owner.memories[0]}];
    await rawStore(factory,name,'saves',s=>s.put(raw));
    const records=await rawStore(factory,name,'turnUndo',s=>s.getAll()) as {stateJSON:string}[];
    records[0].stateJSON=JSON.stringify(legacy);await rawStore(factory,name,'turnUndo',s=>s.put(records[0]));
    const before=await repo.exportRaw('save-a');
    expect(before.records.turnUndo).toHaveLength(1);expect(before.records.drafts).toHaveLength(1);
    await expect(repo.loadGame('save-a')).rejects.toThrow();await expect(repo.save('save-a',raw.revision,'overwrite',[])).rejects.toThrow();
    expect(await repo.exportRaw('save-a')).toEqual(before);
  } finally {repo.close();}
});

it.each([6,7] as const)('V%s来源批次在迁移写回后仍可完成一次正常总结，取消和重复保存不改原文', async version => {
  const factory=new IDBFactory(), name='summary-migrate-'+version,repo=await SaveRepository.open(name,factory);
  try {
    await repo.create(worldState());const raw=legacyNpcMemories(version,false);
    await rawStore(factory,name,'saves',s=>s.put(raw));
    const context=await repo.loadMemoryContext('save-a'), batch=planNpcSummary(context.state,'npc-a')!;
    const outputs=parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)),batch,'from-old-sources');
    const migrated=await repo.load('save-a');
    const controller=new AbortController();controller.abort();
    await expect(repo.saveNpcSummary(batch,outputs,context.lineage,controller.signal)).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(migrated);
    const saved=await repo.saveNpcSummary(batch,outputs,context.lineage);
    expect(saved.npc).toEqual(migrated.npc);expect(saved.memories.npcSummaries['npc-a'][0].npcProvenance!.sourceMemoryIds).toEqual(batch.entries.map(e=>e.id));
    await expect(repo.saveNpcSummary(batch,outputs,context.lineage)).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(saved);
  } finally {repo.close();}
});

it('从旧长期来源启动的迟到总结不能越过持久epoch污染撤回后的时间线', async () => {
  const factory=new IDBFactory(), name='late-old-summary',repo=await SaveRepository.open(name,factory);
  try {
    await repo.create(worldState()); await rawStore(factory,name,'saves',s=>s.put(legacyNpcMemories(7,false)));
    const context=await repo.loadMemoryContext('save-a'), batch=planNpcSummary(context.state,'npc-a')!;
    const outputs=parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)),batch,'late');
    const committed=await repo.commitTurn(submission(await completeDraft(repo,{variables:await elapsedVariables(repo,'日常',60),world:worldResult()}),''));
    const restored=await repo.undoTurn({saveId:'save-a',expectedRevision:committed.state.revision,expectedDraft:committed.draft,operationId:'undo-old-summary'});
    await expect(repo.saveNpcSummary(batch,outputs,context.lineage)).rejects.toThrow(/时间线已改变/);
    expect(await repo.load('save-a')).toEqual(restored.state);
  } finally {repo.close();}
});

it.each(['ordinary','special'] as const)('%s场外World新记忆省略层参数，仍独立记录指定人物', kind => {
  const state=worldState(); if(kind==='ordinary')state.npc['npc-a']={...state.npc.scene,id:'npc-a',identityKey:'identity-npc-a',onScene:false};
  const draft=worldDraft(), memory={id:'world-memory',text:'场外的实际经历',knowledgeSource:'亲历',knowledgeKind:'observed' as const,visibility:'npc_private' as const,createdAtGameTime:state.worldClock,sourceTurnIds:[draft.turnId],affectedEntityRefs:[{kind:'npc' as const,id:'npc-a'}]};
  const result=parseWorld(JSON.stringify(worldResult([{type:'RecordNpcMemory',commandId:'world-record',expectedRevision:0,npcId:'npc-a',memory,knowledgeKind:'observed',addToKnownInformation:false,evidence:'后台经历'}])),state,draft);
  const projected=projectTurn(state,draft,result.worldCommands);
  expect(projected.npc['npc-a'].memories).toEqual([memory]);expect(projected.npc.scene.memories).toEqual([]);
});

it('原Variables私密档案七字段入口经编译、候选重验、原子Commit及重载完整保留', async () => {
  const state=worldState(), person=state.npc['npc-a'];if(person.kind!=='special')throw Error();
  person.gender='female';person.age=30;person.onScene=true;
  const draft=worldDraft(true,'opening');draft.story!.narrative='【旁白】人物提供了自己的档案资料。';
  const ast=parseVariableText('<命令>\nset npc[npc-a].privateProfile = '+JSON.stringify(fullPrivateProfile)+'\n</命令>');if(!ast.ok)throw Error();
  const plan=await compileVariableCommands(ast.value,state,{draft,expectedRevision:0});if(!plan.ok)throw Error(JSON.stringify(plan.error));
  const variables=parseVariables(JSON.stringify({commands:plan.value.commands,rejectedSuggestions:[],unresolved:[]}),state,draft);
  const factory=new IDBFactory(), name='seven-fields',repo=await SaveRepository.open(name,factory);
  try {
    await repo.create(state);
    const ready=await completeDraft(repo,{variables,world:worldResult(),narrative:draft.story!.narrative});
    const committed=await repo.commitTurn(submission(ready,''));
    expect(committed.state.npc['npc-a']).toMatchObject({privateProfile:fullPrivateProfile});
    const sleeping=hibernateNpcProfile(committed.state,'npc-a',person.identityKey);
    expect(restoreNpcProfile(sleeping,'npc-a',person.identityKey).npc['npc-a']).toMatchObject({privateProfile:fullPrivateProfile});
    expect((await repo.load('save-a')).npc['npc-a']).toMatchObject({privateProfile:fullPrivateProfile});
  } finally {repo.close();}
});
