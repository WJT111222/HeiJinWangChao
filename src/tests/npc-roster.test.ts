import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { DataError } from '../domain/common';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { reserveStageSession } from '../workflows/stageGuard';
import { playerView } from '../ui/panels/playerView';
import { NpcPanel, PersonMemory, PrivateProfile } from '../ui/panels/NpcPanel';
import { changeNpcImportance, canAcceptNpcView, npcManagementError } from '../ui/game/npcManagement';
import { npcRosterState } from './fixtures/npcRoster';
import { fullPrivateProfile } from './fixtures/npcUnified';
import { GameStateSchema } from '../domain/state';

async function seed(name: string, factory: IDBFactory, state: ReturnType<typeof npcRosterState>) {
  const repo = await SaveRepository.open(name, factory);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
  return repo;
}

it('实际React名录统一显示普通/特殊/初始同伴，无原始ID、分区或联系人分类', () => {
  const state = npcRosterState(), before = structuredClone(state), view = playerView(state);
  const html = renderToStaticMarkup(createElement(NpcPanel, { view }));
  for (const text of ['林澄', '许岸', '周闻', '★', '☆', '全部人物', '普通人物', '特殊人物']) expect(html).toContain(text);
  for (const text of ['普通 NPC', '特殊 NPC', '联系人', 'identityKey', 'roster-memory-', 'npcManagementRevision', 'importancePreference']) expect(html).not.toContain(text);
  expect(html).not.toContain('dormantNpcProfiles'); expect(state).toEqual(before);
});

it('七字段真实React展示保留换行/尾部空白；普通及不适用人物不显示', () => {
  const view = playerView(npcRosterState()), person = view.npc.find(n => n.id === 'special')!;
  const html = renderToStaticMarkup(createElement(PrivateProfile, { person }));
  for (const text of Object.values(fullPrivateProfile)) if (typeof text === 'string') expect(html).toContain(text);
  expect(html).toContain('是否处女'); expect(html).toContain('否');
  expect(renderToStaticMarkup(createElement(PrivateProfile, { person: view.npc[0] }))).toBe('');
  expect(renderToStaticMarkup(createElement(PrivateProfile, { person: { ...person, gender: 'male' } }))).toBe('');
  expect(renderToStaticMarkup(createElement(PrivateProfile, { person: { ...person, age: 17 } }))).toBe('');
});

it('人物记忆/总结实际React来源映射为回合与人物姓名，不展示技术来源ID', () => {
  const state = npcRosterState();
  state.retiredNpcs['retired-person'] = { id: 'retired-person', identityKey: 'retired-identity', name: '旧同事', aliases: [], retiredAt: state.worldClock, sourceTurnIds: [] };
  state.npc.special.memories[0].affectedEntityRefs.push({ kind: 'npc', id: 'retired-person' });
  state.memories.npcSummaries.special[0].affectedEntityRefs.push({ kind: 'npc', id: 'retired-person' });
  const view = playerView(GameStateSchema.parse(state)), person = view.npc.find(n => n.id === 'special')!;
  for (const memory of view.memories.filter(m => m.ownerNpcId === person.id)) {
    const html = renderToStaticMarkup(createElement(PersonMemory, { view, person, memory }));
    expect(html).toContain(memory.text); expect(html).toContain('第'); expect(html).toContain('回合');
    expect(html).toContain('许岸');
    if (memory.affectedEntityRefs.some(ref => ref.id === 'retired-person')) expect(html).toContain('旧同事');
    expect(html).not.toContain('retired-person'); expect(html).not.toContain('retired-identity');
    for (const text of ['roster-turn-', 'roster-memory-', person.identityKey, 'sourceMemoryIds']) expect(html).not.toContain(text);
  }
  expect(view.npc.find(n => n.id === 'special')!.affinity).toBeNull();
  expect(view.npc.find(n => n.id === 'person')!.phoneContact?.status).toBe('unknown');
});

it('真实Repository UI接线：完整候选保留、初始同伴休眠恢复、读取重启不丢七字段/记忆', async () => {
  const state = npcRosterState();
  const factory = new IDBFactory(), name = 'npc-roster-adapter', repo = await seed(name, factory, state);
  try {
    const initial = createTurnDraft(state.saveId, state.revision, 'roster-candidate', 'regular', '原玩家输入');
    await repo.saveDraft(initial, null);
    const selected = rerollStory(initial, { turnKind: 'regular', narrative: '【旁白】尚未提交的正文。', summary: '原摘要', variableGuide: [] });
    await repo.saveDraft(selected, initial.draftRevision);
    const ordinary = await changeNpcImportance(repo, state, selected, 'special');
    expect(ordinary.state.npc.special.kind).toBe('ordinary'); expect(ordinary.draft!.story).toEqual(selected.story);
    expect(ordinary.draft!.userInput).toBe(selected.userInput); expect(ordinary.state.worldClock).toBe(state.worldClock);
    expect(ordinary.state.memories).toEqual(state.memories); expect(ordinary.state.npc.special.memories).toEqual(state.npc.special.memories);
    expect(ordinary.state.turnNumber).toBe(state.turnNumber); expect(ordinary.state.revision).toBe(state.revision);
    const restored = await changeNpcImportance(repo, ordinary.state, ordinary.draft, 'special');
    expect(restored.state.npc.special).toMatchObject({ kind: 'special', privateProfile: fullPrivateProfile, importancePreference: 'special' });
    expect(restored.state.journal).toEqual(state.journal);
    repo.close(); const reopened = await SaveRepository.open(name, factory);
    try { expect(await reopened.loadGame(state.saveId)).toEqual({ state: restored.state, draft: restored.draft }); } finally { reopened.close(); }
  } finally { repo.close(); }
});

it('真实Repository拒绝过期界面与活动阶段，不丢草稿，不悄悄取消或重试', async () => {
  const state = npcRosterState(), repo = await seed('npc-roster-conflicts', new IDBFactory(), state);
  try {
    const draft = createTurnDraft(state.saveId, state.revision, 'pending', 'regular', '保持输入'); await repo.saveDraft(draft, null);
    const session = reserveStageSession(state.saveId);
    try { await expect(changeNpcImportance(repo, state, draft, 'person')).rejects.toMatchObject({ code: 'STORY_BUSY' }); } finally { session.release(); }
    const success = await changeNpcImportance(repo, state, draft, 'person');
    await expect(changeNpcImportance(repo, state, draft, 'person')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await repo.loadGame(state.saveId)).toEqual({ state: success.state, draft: success.draft });
    expect(success.state.npc.person).toMatchObject({ kind: 'special', profilePending: true });
  } finally { repo.close(); }
});

it('界面接收边界拒绝迟到的旧管理状态/旧候选，允许最新CAS结果', () => {
  const state = npcRosterState(), draft = createTurnDraft(state.saveId, state.revision, 'current', 'regular', '');
  const current = { state: { ...state, npcManagementRevision: 2 }, draft: { ...draft, draftRevision: 3 } };
  expect(canAcceptNpcView(current, { state, draft })).toBe(false);
  expect(canAcceptNpcView(current, { state: current.state, draft: { ...draft, draftRevision: 2 } })).toBe(false);
  expect(canAcceptNpcView(current, { state: current.state })).toBe(false);
  expect(canAcceptNpcView(current, { state: current.state, draft: { ...draft, draftRevision: 4 } })).toBe(true);
  expect(npcManagementError(new DataError('STORY_BUSY', 'private payload'))).toContain('当前回合正在生成');
  expect(npcManagementError(new Error('secret transport payload'))).not.toContain('secret');
});
