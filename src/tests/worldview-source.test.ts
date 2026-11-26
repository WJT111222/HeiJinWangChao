import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { withWorldbookLibrary } from '../services/worldbook/mainWorldview';
import { worldState } from './fixtures/world';

it('重建同一存档可得到逐字相同的草稿，旧页面身份与迟到的正文仍被拒绝', async () => {
  const repo = await SaveRepository.open('identical-import', new IDBFactory());
  const state = worldState();
  const entry = { state, draft: createTurnDraft(state.saveId, 0, 'same-turn', 'opening', '去车站') };
  const restore = async () => {
    await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    return repo.loadGame(state.saveId);
  };
  try {
    const first = await restore();
    const lease = await repo.prepareWorldview(first.draft!, false, first.instance);
    const candidate = rerollStory(first.draft!, {
      turnKind: 'opening',
      narrative: '已抵达车站。',
      summary: '到站',
      variableGuide: [],
    });
    await repo.delete(state.saveId, 0, first.instance);
    const second = await restore();
    expect(second.draft).toEqual(first.draft);
    expect(second.instance).not.toBe(first.instance);
    await expect(repo.prepareWorldview(first.draft!, false, first.instance)).rejects.toMatchObject({
      code: 'DRAFT_CONFLICT',
    });
    // Fault-inject the retired snapshot back under exactly its original key to isolate the instance CAS.
    await withWorldbookLibrary((lib) => lib.captureWorldview(state.saveId, lease.owner, lease.generation));
    await expect(
      repo.saveDraft(candidate, first.draft!.draftRevision, undefined, first.draft, lease),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadGame(state.saveId)).toEqual(second);
  } finally {
    repo.close();
  }
});

it('正文哈希检测本机候选被替换，即使回合、修订与实例都相同', async () => {
  const factory = new IDBFactory();
  const repo = await SaveRepository.open('tampered-candidate', factory);
  try {
    const state = await repo.create(worldState());
    const base = await repo.saveDraft(createTurnDraft(state.saveId, 0, 'same-turn', 'opening', '行动'), null);
    const lease = await repo.prepareWorldview(base, false);
    const saved = await repo.saveDraft(
      rerollStory(base, { turnKind: 'opening', narrative: '候选甲', summary: '摘要', variableGuide: [] }),
      0,
      undefined,
      base,
      lease,
    );
    const { request, transaction } = await import('../services/storage/idb');
    const db = await request(factory.open('tampered-candidate'));
    const altered = { ...saved, story: { ...saved.story!, narrative: '候选乙' } };
    try {
      await transaction(db, ['drafts'], 'readwrite', (tx) => request(tx.objectStore('drafts').put(altered)));
    } finally {
      db.close();
    }
    await expect(repo.prepareWorldview(altered, true)).rejects.toMatchObject({
      details: { fieldPath: 'worldbook.unbound' },
    });
    expect(await repo.load(state.saveId)).toEqual(state);
    expect(await repo.loadDraft(state.saveId)).toEqual(altered);
  } finally {
    repo.close();
  }
});

it('替换正文的临时来源只可由原仓库在同一有效草稿恢复', async () => {
  const repo = await SaveRepository.open('replacement-retry-source', new IDBFactory());
  try {
    const state = await repo.create(worldState());
    const blank = await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'replacement', 'opening', ''), null);
    const original = await repo.prepareWorldview(blank, false);
    const ready = await repo.saveDraft(rerollStory(blank, { turnKind: 'opening', narrative: '抵达码头。', summary: '到达', variableGuide: [] }),
      blank.draftRevision, undefined, blank, original);
    const pending = await repo.prepareWorldview(ready, false);
    expect(pending.generation).not.toBe(original.generation);
    expect((await repo.prepareWorldview(ready, true)).generation).toBe(original.generation);
    await expect(repo.prepareWorldview(ready, false, undefined, { ...pending })).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    const retry = await repo.prepareWorldview(ready, false, undefined, pending);
    expect(retry).toEqual(pending);
    expect(await repo.loadDraft(state.saveId)).toEqual(ready);
    await withWorldbookLibrary(lib => lib.forgetGeneration(state.saveId, pending.owner, pending.generation));
    await expect(repo.prepareWorldview(ready, false, undefined, retry)).rejects.toMatchObject({ code: 'storage' });
    expect((await repo.prepareWorldview(ready, true)).generation).toBe(original.generation);
  } finally { repo.close(); }
});
