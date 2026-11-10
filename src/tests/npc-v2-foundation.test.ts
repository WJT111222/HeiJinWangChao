import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { GameStateSchema } from '../domain/state';
import { NpcSchema } from '../domain/npc/schema';
import { hibernateNpcProfile, restoreNpcProfile } from '../domain/npc/profiles';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { migrateSave } from '../services/storage/migrations';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseWorld } from '../services/validation/aiOutputs';
import { npcV2State } from './fixtures/npcV2';
import { worldDraft, worldResult, worldState } from './fixtures/world';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { planNpcSummary, parseNpcSummary, applyNpcSummary, npcKnowledgeContext } from '../domain/memories/npcMemory';
import { npc } from './fixtures/game';
import { createTurnDraft, rerollStory } from '../domain/drafts';

async function rawAccess(factory: IDBFactory, name: string, store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) {
  const open = factory.open(name);
  return new Promise<unknown>((resolve, reject) => {
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(store, mode), operation = action(tx.objectStore(store));
      let result: unknown; operation.onsuccess = () => { result = operation.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
const retirement = (state: ReturnType<typeof npcV2State>) => DomainCommandSchema.parse({
  type: 'RetireNpc', commandId: 'old-retirement', npcId: 'person', expectedIdentityKey: state.npc.person.identityKey,
  reason: '旧版清理提案', evidence: '只用于测试旧候选拦截', retainMemoryIds: [],
});

describe('NPC V2第一批：人物基础与内部休眠', () => {
  it('两种NPC均保存独立电话状态和多个常驻地点，当前位置和联系人登记不变', () => {
    const state = npcV2State();
    expect(GameStateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(state.npc.person.locationId).toBe('chongqing');
    expect(state.npc.person.usualLocations?.[0].knownToProtagonist).toBe(false);
    expect(state.contactNpcIds).toEqual([]);
    for (const status of ['unknown', 'known', 'invalid'] as const)
      expect(NpcSchema.parse({ ...state.npc.person, phoneContact: { status } }).phoneContact?.status).toBe(status);
  });
  it.each(['missing', 'kind', 'known'])('常驻地点%s不合法时拒绝', issue => {
    const state = npcV2State(), place = state.npc.person.usualLocations![0];
    const broken = issue === 'missing' ? { ...place, locationId: 'absent' } : issue === 'kind' ? { ...place, role: 'invalid' } : { ...place, knownToProtagonist: 'yes' };
    expect(GameStateSchema.safeParse({ ...state, npc: { ...state.npc, person: { ...state.npc.person, usualLocations: [broken] } } }).success).toBe(false);
  });
  it('人物关系网具有方向性，未知好感和未建档姓名不创建NPC', () => {
    const state = npcV2State(), person = state.npc.special;
    if (person.kind !== 'special') throw Error();
    expect(person.relationshipNetwork?.[0].affinity).toBe(-12);
    expect(person.relationshipNetwork?.[1].affinity).toBeNull();
    expect(state.npc.person.kind).toBe('ordinary'); expect(Object.keys(state.npc)).toHaveLength(2);
    delete person.relationshipNetwork![1].affinity;
    expect(GameStateSchema.parse(state).npc.person.affinity).toBe(30);
  });
  it.each(['missing', 'self', 'high', 'low'])('人物关系网%s违反引用或数值结构时拒绝', issue => {
    const state = npcV2State(), person = state.npc.special;
    if (person.kind !== 'special') throw Error();
    Object.assign(person.relationshipNetwork![0], issue === 'missing' ? { npcId: 'absent' } : issue === 'self' ? { npcId: 'special' } : { affinity: issue === 'high' ? 101 : -101 });
    expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
  it('ID/identityKey在休眠、普通身份变更和恢复中稳定，基础资料与公共世界不丢失', () => {
    const before = npcV2State(), archived = hibernateNpcProfile(before, 'special', before.npc.special.identityKey);
    expect(before.npc.special.kind).toBe('special'); expect(before.dormantNpcProfiles).toBeUndefined();
    expect(archived.npc.special).toMatchObject({ kind: 'ordinary', id: 'special', identityKey: before.npc.special.identityKey, phoneContact: before.npc.special.phoneContact });
    expect(archived.dormantNpcProfiles?.special.profile.relationshipNetwork).toEqual(before.npc.special.kind === 'special' ? before.npc.special.relationshipNetwork : []);
    archived.npc.special.name = '许岸新名'; archived.npc.special.locationId = 'office';
    const restored = restoreNpcProfile(archived, 'special', before.npc.special.identityKey);
    expect(restored.npc.special).toEqual({ ...before.npc.special, name: '许岸新名', locationId: 'office' });
    expect(restored.dormantNpcProfiles).toEqual({});
    for (const key of ['memories', 'tasks', 'events', 'timeline', 'contactNpcIds', 'contactReviewNpcIds', 'retiredNpcs'] as const)
      expect(restored[key]).toEqual(before[key]);
  });
  it('身份冲突、重复身份与休眠档案双重权威拒绝', () => {
    const state = npcV2State();
    expect(() => hibernateNpcProfile(state, 'special', 'wrong')).toThrow();
    expect(GameStateSchema.safeParse({ ...state, npc: { ...state.npc, duplicate: { ...state.npc.person, id: 'duplicate' } } }).success).toBe(false);
    const sleeping = hibernateNpcProfile(state, 'special', state.npc.special.identityKey);
    expect(() => restoreNpcProfile(sleeping, 'special', 'wrong')).toThrow();
    expect(GameStateSchema.safeParse({ ...sleeping, npc: state.npc }).success).toBe(false);
    sleeping.dormantNpcProfiles!.special.identityKey = 'wrong';
    expect(GameStateSchema.safeParse(sleeping).success).toBe(false);
  });
  it('初始同伴仍不开放降级，已有记忆与总结的非同伴可安全休眠', () => {
    const state = npcV2State(); state.initialCompanionId = 'special';
    expect(() => hibernateNpcProfile(state, 'special', state.npc.special.identityKey)).toThrow();
    const memorized = npcMemoryState(21, true), before = structuredClone(memorized);
    const sleeping = hibernateNpcProfile(memorized, 'npc-a', memorized.npc['npc-a'].identityKey);
    expect(sleeping.npc['npc-a'].memories).toEqual(memorized.npc['npc-a'].memories); expect(memorized).toEqual(before);
  });
  it('V8拒绝把新的原始记忆写回休眠专属层，原记录不会部分变化', () => {
    const state = npcV2State(), sleeping = hibernateNpcProfile(state, 'special', state.npc.special.identityKey);
    const source = npcMemoryState(21, true).npc['npc-a'].memories[0];
    sleeping.dormantNpcProfiles!.special.profile.longTermMemories = [{ ...source, affectedEntityRefs:[{kind:'npc',id:'special'}] }];
    expect(GameStateSchema.safeParse(sleeping).success).toBe(false);
  });
  it('安全休眠后基础记忆与带来源的正常总结仍可维护，恢复不改原始来源', () => {
    const state = npcMemoryState(21, false);
    state.npc['npc-a'] = { ...state.npc['npc-a'], kind:'special', detailedBackground:'独立专属资料', activeGoals:[], habits:[], longTermMemories:[], offscreenTaskIds:[] };
    const sleeping = hibernateNpcProfile(state,'npc-a',state.npc['npc-a'].identityKey);
    const batch = planNpcSummary(sleeping,'npc-a')!;
    expect(batch.entries).toHaveLength(15);
    const summarized = applyNpcSummary(sleeping,batch,parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)),batch,'after-sleep'));
    const restored = restoreNpcProfile(summarized,'npc-a',state.npc['npc-a'].identityKey);
    expect(restored.npc['npc-a'].memories).toEqual(state.npc['npc-a'].memories);
    expect(restored.memories).toEqual(summarized.memories);
    summarized.memories.npcSummaries['npc-a'][0].npcProvenance = undefined;
    expect(GameStateSchema.safeParse(summarized).success).toBe(true);
    expect(planNpcSummary(summarized,'npc-a')).toBeUndefined();
  });
  it.each(['opening', 'regular'] as const)('%s实际Composer三阶段均排除休眠原文，保留完整普通资料/统一记忆和公共任务历史', async mode => {
    const state = npcV2State(), sleeping = hibernateNpcProfile(state, 'special', state.npc.special.identityKey);
    sleeping.npc.special.memories = [{ id: 'archived-long', text: '统一记忆仍可读取-E1',
      sourceTurnIds: [], affectedEntityRefs: [{kind:'npc',id:'special'}], visibility:'npc_private', knowledgeSource:'旧档原始来源', createdAtGameTime:state.worldClock }];
    const draft = worldDraft(true, mode);
    const profileText = JSON.stringify(sleeping.dormantNpcProfiles);
    for (const stage of ['story', 'variables', 'world'] as const) {
      const request = await composePrompt({ state: sleeping, draft, mode, stage, userInput: '继续日常', settings: defaultSettings() });
      const all = request.messages.map(m => m.content).join('\n');
      for (const secret of ['专属经历封存标记-A7', '专属目标封存标记-B8', '专属习惯封存标记-C9', '专属私密封存标记-D0']) expect(all).not.toContain(secret);
      expect(all).toContain('统一记忆仍可读取-E1'); expect(all).not.toContain('dormantNpcProfiles'); expect(all).toContain('许岸'); expect(all).toContain('工作室电话转接');
      expect(request.context.SAVE_STATE).toMatchObject({ npc: { special: { kind: 'ordinary' } } });
    }
    expect(JSON.stringify(sleeping.dormantNpcProfiles)).toBe(profileText);
    expect(JSON.stringify(npcKnowledgeContext(sleeping, 'special'))).toContain('统一记忆仍可读取-E1');
  });
});

describe('V6 → V7与永久人物保留', () => {
  it('旧V6、联系人、初始同伴、原记忆与总结仅升版本，不猜造电话或住所', () => {
    let state = npcMemoryState(21, true);
    const batch = planNpcSummary(state, 'npc-a')!;
    state = applyNpcSummary(state, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'legacy-summary'));
    state.initialCompanionId = 'npc-a'; state.contactNpcIds = ['npc-a']; state.contactReviewNpcIds = ['npc-b'];
    const raw = { ...state, schemaVersion: 6 }, before = structuredClone(raw), next = migrateSave(raw);
    expect(next).toEqual({ ...raw, schemaVersion: 8 }); expect(raw).toEqual(before);
    expect(next.memories.npcSummaries['npc-a'][0].npcProvenance?.sourceMemoryIds).toHaveLength(15);
    for (const person of Object.values(next.npc)) { expect(person.phoneContact).toBeUndefined(); expect(person.usualLocations).toBeUndefined(); }
  });
  it('新回合RetireNpc不能删除任何正式人物，包括无职责离场非联系人', () => {
    const state = npcV2State(), before = structuredClone(state), command = retirement(state);
    expect(() => commitCommands(state, 'retire', 0, [command])).toThrow(/永久保留/);
    expect(() => parseWorld(JSON.stringify(worldResult([command])), state, worldDraft())).toThrow();
    expect(state).toEqual(before);
    expect(DomainCommandSchema.parse(command)).toEqual(command); // legacy draft remains inspectable
  });
  it('旧历史身份和组织/资产/任务/事件引用保留；RegisterContact不设置电话号码', () => {
    const state = npcV2State(); state.retiredNpcs.legacy = { id: 'legacy', identityKey: 'old-identity', name: '历史人物', aliases: [], retiredAt: state.worldClock, sourceTurnIds: [] };
    const command = { type: 'RegisterContact' as const, commandId: 'register', npcId: 'person', reason: '兼容登记', evidence: '旧格式联系登记' };
    const next = commitCommands(state, 'register', 0, [command]);
    expect(next.retiredNpcs).toEqual(state.retiredNpcs); expect(next.contactNpcIds).toContain('person');
    expect(next.npc.person.phoneContact).toEqual({ status: 'unknown' });
    expect(next.npc.person.usualLocations).toEqual(state.npc.person.usualLocations);
  });
  it('保持现有AI创建命令协议，不提前开放V2字段写入或身份切换命令', () => {
    const state = npcV2State();
    expect(DomainCommandSchema.safeParse({ type: 'CreateNpc', commandId: 'create', evidence: '候选', npc: state.npc.person }).success).toBe(false);
    expect(DomainCommandSchema.safeParse({ type: 'ChangeNpcKind', npcId: 'person', kind: 'special' }).success).toBe(false);
  });
  it('未来版本与损坏V6拒绝迁移，不修改原文', () => {
    for (const raw of [{ ...npcV2State(), schemaVersion: 9 }, { ...worldState(), schemaVersion: 6, unknown: true }, { ...worldState(), schemaVersion: 6, npc: { bad: npc() } }]) {
      const before = structuredClone(raw); expect(() => migrateSave(raw)).toThrow(); expect(raw).toEqual(before);
    }
  });
  it('Repository新字段/休眠档案Commit、原子失败、重开和撤回完整保存', async () => {
    const factory = new IDBFactory(), name = 'npc-v2', repo = await SaveRepository.open(name, factory);
    const initial = npcV2State(), sleeping = hibernateNpcProfile(initial, 'special', initial.npc.special.identityKey);
    await repo.create(sleeping);
    const first = await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '一次日常', 60), world: worldResult() }), ''));
    const second = await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '第二次日常', 60), world: worldResult() }), ''));
    expect(second.state.dormantNpcProfiles).toEqual(sleeping.dormantNpcProfiles);
    const bad = retirement(second.state);
    await expect(repo.save('save-a', second.state.revision, 'invalid', [bad])).rejects.toThrow();
    expect(await repo.load('save-a')).toEqual(second.state);
    repo.close();
    const reopened = await SaveRepository.open(name, factory);
    try {
      const current = await reopened.loadGame('save-a');
      const restored = await reopened.undoTurn({ saveId: 'save-a', expectedRevision: current.state.revision, expectedDraft: current.draft, operationId: 'undo' });
      expect(restored.state.npc).toEqual(first.state.npc); expect(restored.state.dormantNpcProfiles).toEqual(first.state.dormantNpcProfiles);
      expect(restored.state.worldClock).toBe(first.state.worldClock); expect((await reopened.undoStatus('save-a')).available).toBe(0);
      expect(await reopened.load('save-a')).toEqual(restored.state);
    } finally { reopened.close(); }
  });
  it('旧V6撤回快照按需读取迁移，保留索引/容量元数据，消费前不重写原记录', async () => {
    const factory = new IDBFactory(), name = 'legacy-undo', repo = await SaveRepository.open(name, factory);
    try {
      await repo.create(worldState());
      const first = await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '开局', 60) }), ''));
      const second = await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '下一轮', 60) }), ''));
      const records = await rawAccess(factory, name, 'turnUndo', 'readonly', s => s.getAll()) as { stateJSON: string }[];
      const record = records[0], oldState = JSON.parse(record.stateJSON); oldState.schemaVersion = 6; record.stateJSON = JSON.stringify(oldState);
      await rawAccess(factory, name, 'turnUndo', 'readwrite', s => s.put(record));
      const control = await rawAccess(factory, name, 'saveControls', 'readonly', s => s.get('save-a'));
      expect((await repo.undoStatus('save-a')).available).toBe(1);
      expect(await rawAccess(factory, name, 'turnUndo', 'readonly', s => s.getAll())).toEqual([record]);
      expect(await rawAccess(factory, name, 'saveControls', 'readonly', s => s.get('save-a'))).toEqual(control);
      const current = await repo.loadGame('save-a');
      const restored = await repo.undoTurn({ saveId: 'save-a', expectedRevision: second.state.revision, expectedDraft: current.draft, operationId: 'legacy-undo' });
      expect(restored.state.schemaVersion).toBe(8); expect(restored.state.npc).toEqual(first.state.npc);
      expect(restored.state.journal).toEqual(first.state.journal); expect(restored.state.worldClock).toBe(first.state.worldClock);
    } finally { repo.close(); }
  });
  it('合法V6迁移仅更改版本，损坏和未来版本失败不覆盖原记录', async () => {
    const factory = new IDBFactory(), name = 'raw-legacy', repo = await SaveRepository.open(name, factory);
    try {
      const raw = { ...worldState(), schemaVersion: 6 };
      await rawAccess(factory, name, 'saves', 'readwrite', s => s.put(raw));
      expect((await repo.load('save-a')).schemaVersion).toBe(8);
      expect(await rawAccess(factory, name, 'saves', 'readonly', s => s.get('save-a'))).toEqual({ ...raw, schemaVersion: 8 });
      for (const broken of [{ ...raw, schemaVersion: 9 }, { ...raw, npc: { bad: npc() } }]) {
        await rawAccess(factory, name, 'saves', 'readwrite', s => s.put(broken));
        await expect(repo.load('save-a')).rejects.toThrow();
        await expect(repo.save('save-a', 0, 'overwrite', [])).rejects.toThrow();
        expect(await rawAccess(factory, name, 'saves', 'readonly', s => s.get('save-a'))).toEqual(broken);
      }
    } finally { repo.close(); }
  });
  it('休眠资料不进入任何现有记忆维护请求', async () => {
    const original = npcV2State(), sleeping = hibernateNpcProfile(original, 'special', original.npc.special.identityKey);
    const draft = rerollStory(createTurnDraft('save-a', 0, 'memory', 'regular', ''), { turnKind: 'regular', narrative: '普通日常', summary: '', variableGuide: [] });
    const request = await composePrompt({ stage: 'memory', memoryTask: 'memory.short_to_medium', state: sleeping, draft, mode: 'regular', userInput: '', settings: defaultSettings() });
    expect(JSON.stringify(request.messages)).not.toContain('封存标记');
    expect(JSON.stringify(request.context)).not.toContain('dormantNpcProfiles');
    const npcRequest = await composePrompt({ stage: 'memory', memoryTask: 'memory.npc_summarize', npcId:'special',
      npcSummaryThreshold:defaultSettings().memory.summaries.npc.threshold, state:sleeping, mode:'regular', userInput:'', settings:defaultSettings() });
    expect(JSON.stringify(npcRequest.messages)).not.toContain('封存标记');
    expect(JSON.stringify(npcRequest.context)).not.toContain('dormantNpcProfiles');
  });
});
