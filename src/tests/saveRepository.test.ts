import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnDraftSchema, createTurnDraft, rerollStory, startStageAttempt } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { game, purchase, story } from './fixtures/game';

let factory: IDBFactory;
let repository: SaveRepository;
const name = 'm1-test';

function variableCandidate(draft: TurnDraft) {
  return { storyRevision: draft.storyRevision, candidateRevision: 1,
    requestRevision: draft.stageRequestRevisions.variables, validation: 'validated' as const,
    result: { commands: [purchase()], rejectedSuggestions: [], unresolved: [] } };
}
function worldCandidate(draft: TurnDraft) {
  return { storyRevision: draft.storyRevision, candidateRevision: 1,
    requestRevision: draft.stageRequestRevisions.world, basedOnVariableRevision: draft.variables?.candidateRevision,
    validation: 'validated' as const,
    result: { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] } };
}
async function storedCandidates(): Promise<TurnDraft> {
  const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入');
  await repository.saveDraft(initial, null);
  const selected = rerollStory(initial, story); await repository.saveDraft(selected, 0);
  const variables = { ...selected, draftRevision: 2, variables: variableCandidate(selected),
    stageStatus: { ...selected.stageStatus, variables: 'ready' as const } };
  await repository.saveDraft(variables, 1);
  const complete = { ...variables, draftRevision: 3, world: worldCandidate(variables),
    stageStatus: { ...variables.stageStatus, world: 'ready' as const } };
  return repository.saveDraft(complete, 2);
}

// 仅供测试模拟磁盘损坏/历史版本，生产代码没有裸数据覆盖入口。
async function rawStore(action: (store: IDBObjectStore) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name);
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      action(tx.objectStore('saves'));
    });
  } finally { db.close(); }
}
async function rawRead(saveId = 'save-a'): Promise<unknown> {
  let value: unknown;
  await rawStore((store) => { const read = store.get(saveId); read.onsuccess = () => { value = read.result; }; });
  return value;
}

beforeEach(async () => {
  factory = new IDBFactory(); repository = await SaveRepository.open(name, factory);
});
afterEach(() => { vi.restoreAllMocks(); repository.close(); });

describe('IndexedDB 正式存档', () => {
  it('创建、关闭重开、读取、列出和删除存档', async () => {
    const created = await repository.create(game());
    repository.close(); repository = await SaveRepository.open(name, factory);
    expect(await repository.load('save-a')).toEqual(created);
    expect(await repository.list()).toEqual([expect.objectContaining({ saveId: 'save-a', revision: 0 })]);
    await repository.delete('save-a', 0);
    await expect(repository.load('save-a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await repository.list()).toEqual([]);
  });
  it('不能覆盖同 ID 已有存档', async () => {
    await repository.create(game());
    await expect(repository.create(game())).rejects.toMatchObject({ code: 'DUPLICATE_SAVE' });
  });
  it('房产、房贷、其他资产及未定收入独立明细可完整读回', async () => {
    const state = game();
    state.economy.debts.mortgage = { id: 'mortgage', creditor: '银行', principal: 10000000, outstanding: 8000000,
      status: 'active', repaymentTerms: '按月偿还', collateralAssetIds: ['home'], autoPaymentAuthorized: false, source: '购房贷款合同' };
    state.economy.properties.home = { id: 'home', kind: 'property', name: '住宅', locationId: 'chongqing',
      ownerRef: { kind: 'protagonist', id: 'hero' }, estimatedValue: null, ownershipText: '本人所有',
      mortgageDebtId: 'mortgage', source: '既有产权', statusText: '自住' };
    state.economy.otherAssets.deposit = { id: 'deposit', kind: 'other', name: '保证金权益', category: '保证金',
      ownerRef: { kind: 'protagonist', id: 'hero' }, estimatedValue: 100000, details: '合同终止后返还', source: '合同', statusText: '待返还' };
    state.economy.incomes.nextSalary = { id: 'nextSalary', source: '下月工资', amount: null, status: 'expected', account: 'onlineBalance', scheduleText: '金额未确定' };
    const before = await repository.create(state);
    expect(await repository.load('save-a')).toEqual(before);
    expect((await repository.load('save-a')).economy.cash).toBe(10000);
  });
  it('不同存档独立使用相同实体/命令 ID，状态与草稿互不污染', async () => {
    await repository.create(game()); await repository.create(game('save-b'));
    await repository.save('save-a', 0, 'turn-a', [purchase()]);
    await repository.saveDraft(createTurnDraft('save-a', 1, 'turn-a', 'regular', '输入'), null);
    expect((await repository.load('save-b')).economy.cash).toBe(10000);
    expect(await repository.loadDraft('save-b')).toBeUndefined();
    expect((await repository.save('save-b', 0, 'turn-a', [purchase()])).economy.cash).toBe(7500);
  });
  it('调用方修改读回对象不会修改数据库', async () => {
    const created = await repository.create(game()); created.economy.cash = 0;
    const read = await repository.load('save-a'); read.items.fake = { id: 'fake', name: '假物品', category: 'other', quantity: 1, conditionText: '' };
    expect((await repository.load('save-a')).items).toEqual({});
    expect((await repository.load('save-a')).economy.cash).toBe(10000);
  });
  it('多对象命令批次失败整体回滚，包括之前的合法购买和幂等凭据', async () => {
    const before = await repository.create(game());
    await expect(repository.save('save-a', 0, 'turn-a', [purchase(), purchase('buy2', 99999, 'shirt2')])).rejects.toThrow();
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('写入已排队后 IndexedDB 中止事务，正式快照仍然完整保留', async () => {
    const before = await repository.create(game());
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const result = original.apply(this, args);
      if (this.name === 'saves') this.transaction.abort();
      return result;
    });
    await expect(repository.save('save-a', 0, 'turn-a', [purchase()])).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('并发重复提交只扣款一次，重开数据库后仍幂等', async () => {
    await repository.create(game());
    const second = await SaveRepository.open(name, factory);
    try {
      const results = await Promise.all([
        repository.save('save-a', 0, 'turn-a', [purchase()]), second.save('save-a', 0, 'turn-a', [purchase()]),
      ]);
      expect(results.map((s) => s.economy.cash)).toEqual([7500, 7500]);
    } finally { second.close(); }
    repository.close(); repository = await SaveRepository.open(name, factory);
    expect((await repository.save('save-a', 0, 'turn-a', [purchase()])).revision).toBe(1);
  });
  it('两个不同并发写入只能有一个匹配 revision，不会丢失更新', async () => {
    await repository.create(game());
    const results = await Promise.allSettled([
      repository.save('save-a', 0, 'turn-a', [purchase()]),
      repository.save('save-a', 0, 'turn-b', [purchase('other', 1000, 'other-shirt')]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await repository.load('save-a')).revision).toBe(1);
  });
  it('重用命令 ID 改变金额会失败，删除也检查 revision', async () => {
    await repository.create(game()); await repository.save('save-a', 0, 'turn-a', [purchase()]);
    await expect(repository.save('save-a', 1, 'turn-a', [purchase('buy-shirt', 500)])).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    await expect(repository.delete('save-a', 0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await repository.load('save-a')).economy.cash).toBe(7500);
  });
  it('删除存档与草稿在同一事务中，第二步失败也恢复已删除草稿', async () => {
    await repository.create(game()); await repository.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入'), null);
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'saves') throw new Error('模拟存档删除失败');
      return original.call(this, key);
    });
    await expect(repository.delete('save-a', 0)).rejects.toThrow('模拟');
    vi.restoreAllMocks(); expect(await repository.loadDraft('save-a')).toBeDefined();
    expect((await repository.load('save-a')).revision).toBe(0);
    await repository.delete('save-a', 0); expect(await repository.loadDraft('save-a')).toBeUndefined();
  });
});

describe('草稿、候选与失败恢复数据', () => {
  it('双阶段关闭反复 Roll 后开启补算，正文和正式存档保持不变，关闭重开可恢复新尝试', async () => {
    const before = await repository.create(game());
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入', false, false);
    await repository.saveDraft(initial, null);
    const first = rerollStory(initial, story); await repository.saveDraft(first, 0);
    const selected = rerollStory(first, { ...story, narrative: '选定正文' }); await repository.saveDraft(selected, 1);
    const attempt = startStageAttempt(selected, ['variables', 'world'], { useVariableStage: true, useWorldStage: true });
    await repository.saveDraft(attempt, 2);
    const variables = { ...attempt, draftRevision: 4, variables: variableCandidate(attempt),
      stageStatus: { ...attempt.stageStatus, variables: 'ready' as const } };
    await repository.saveDraft(variables, 3);
    const complete = { ...variables, draftRevision: 5, world: worldCandidate(variables),
      stageStatus: { ...variables.stageStatus, world: 'ready' as const } };
    await repository.saveDraft(complete, 4);
    repository.close(); repository = await SaveRepository.open(name, factory);
    expect(await repository.loadDraft('save-a')).toEqual(complete);
    expect(complete.story).toEqual(selected.story); expect(complete.storyRevision).toBe(selected.storyRevision);
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('仅补算变量清除旧世界依赖，变量结果写入草稿后不直接扣款', async () => {
    const before = await repository.create(game());
    const selected = await storedCandidates();
    const attempt = startStageAttempt(selected, ['variables'], { useWorldStage: false });
    await repository.saveDraft(attempt, selected.draftRevision);
    const result = { ...attempt, draftRevision: attempt.draftRevision + 1, variables: variableCandidate(attempt),
      stageStatus: { ...attempt.stageStatus, variables: 'ready' as const } };
    await repository.saveDraft(result, attempt.draftRevision);
    expect((await repository.loadDraft('save-a'))?.world).toBeUndefined();
    expect(result.storyRevision).toBe(selected.storyRevision); expect(result.story).toEqual(selected.story);
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('仅补算动态世界复用既有变量候选，采用独立的新开关配置', async () => {
    const before = await repository.create(game());
    const selected = await storedCandidates();
    const attempt = startStageAttempt(selected, ['world'], { useVariableStage: false, useWorldStage: true });
    await repository.saveDraft(attempt, selected.draftRevision);
    const result = { ...attempt, draftRevision: attempt.draftRevision + 1, world: worldCandidate(attempt),
      stageStatus: { ...attempt.stageStatus, world: 'ready' as const } };
    await repository.saveDraft(result, attempt.draftRevision);
    expect(result.variables).toEqual(selected.variables); expect(result.storyRevision).toBe(selected.storyRevision);
    expect(result.useVariableStage).toBe(false); expect(selected.useVariableStage).toBe(true);
    expect(await repository.load('save-a')).toEqual(before);
  });
  it.each(['variables', 'world'] as const)('%s 旧请求迟到时，无论使用旧草稿还是合并到最新草稿都不能覆盖新候选', async (stage) => {
    await repository.create(game());
    const selected = await storedCandidates();
    const first = startStageAttempt(selected, [stage]); await repository.saveDraft(first, selected.draftRevision);
    const second = startStageAttempt(first, [stage]); await repository.saveDraft(second, first.draftRevision);
    const fresh = stage === 'variables' ? variableCandidate(second) : worldCandidate(second);
    const complete = TurnDraftSchema.parse({ ...second, draftRevision: second.draftRevision + 1,
      [stage]: fresh, stageStatus: { ...second.stageStatus, [stage]: 'ready' } });
    await repository.saveDraft(complete, second.draftRevision);
    const late = stage === 'variables' ? variableCandidate(first) : worldCandidate(first);
    await expect(repository.saveDraft(TurnDraftSchema.parse({ ...first, draftRevision: first.draftRevision + 1,
      [stage]: late, stageStatus: { ...first.stageStatus, [stage]: 'ready' } }), first.draftRevision))
      .rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(repository.saveDraft({ ...complete, draftRevision: complete.draftRevision + 1, [stage]: late }, complete.draftRevision))
      .rejects.toThrow('过期阶段请求');
    expect((await repository.loadDraft('save-a'))?.[stage]).toEqual(fresh);
  });
  it('草稿、候选、失败信息可重开恢复，且完全不改变正式状态', async () => {
    const before = await repository.create(game());
    let draft = createTurnDraft('save-a', 0, 'turn-a', 'regular', '买衣服');
    await repository.saveDraft(draft, null);
    draft = rerollStory(draft, story); await repository.saveDraft(draft, 0);
    draft = { ...draft, draftRevision: 2,
      variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result: { commands: [purchase()], rejectedSuggestions: [], unresolved: [] } },
      stageStatus: { story: 'ready', variables: 'ready', world: 'failed' },
      failures: [{ stage: 'world', attempt: 3, storyRevision: 1, errorCode: 'TIMEOUT', retryable: true }],
    };
    await repository.saveDraft(draft, 1);
    repository.close(); repository = await SaveRepository.open(name, factory);
    expect(await repository.loadDraft('save-a')).toEqual(draft);
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('重新 Roll 使旧变量和世界候选失效，迟到的旧响应不能写入', async () => {
    await repository.create(game());
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入');
    await repository.saveDraft(initial, null);
    const first = rerollStory(initial, story); await repository.saveDraft(first, 0);
    const second = rerollStory(first, { ...story, narrative: '第二版正文' }); await repository.saveDraft(second, 1);
    expect((await repository.loadDraft('save-a'))?.variables).toBeUndefined();
    await expect(repository.saveDraft({ ...first, draftRevision: 2 }, 1)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    await expect(repository.saveDraft({ ...second, draftRevision: 3, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result: { commands: [purchase()], rejectedSuggestions: [], unresolved: [] } }, stageStatus: { ...second.stageStatus, variables: 'ready' } }, 2)).rejects.toThrow();
  });
  it.each([[false, false], [false, true], [true, false]])('运行开关 variables=%s world=%s 被保存，未执行阶段不会产生副作用', async (variables, world) => {
    const before = await repository.create(game());
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'opening', '输入', variables, world);
    await repository.saveDraft(initial, null);
    const next = rerollStory(initial, { ...story, turnKind: 'opening' }); await repository.saveDraft(next, 0);
    expect((await repository.loadDraft('save-a'))?.useVariableStage).toBe(variables);
    expect(await repository.load('save-a')).toEqual(before);
  });
  it('变量缺失时世界结果只能作为预览，不能标记已确认', async () => {
    await repository.create(game());
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入', false, true);
    await repository.saveDraft(initial, null);
    const first = rerollStory(initial, story); await repository.saveDraft(first, 0);
    const preview = { ...first, draftRevision: 2, world: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'preview' as const,
      result: { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] } },
      stageStatus: { ...first.stageStatus, world: 'preview' as const } };
    await repository.saveDraft(preview, 1);
    await expect(repository.saveDraft({ ...preview, draftRevision: 3, world: { ...preview.world, validation: 'validated' }, stageStatus: { ...preview.stageStatus, world: 'ready' } }, 2)).rejects.toThrow();
  });
  it('正式 revision 推进后，过期草稿可以读取但不能继续写入', async () => {
    await repository.create(game());
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '输入'); await repository.saveDraft(initial, null);
    await repository.save('save-a', 0, 'turn-b', [purchase()]);
    expect(await repository.loadDraft('save-a')).toEqual(initial);
    await expect(repository.saveDraft(rerollStory(initial, story), 0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
});

describe('版本迁移与损坏处理', () => {
  it('V1 整体迁移到 V3，保留余额、revision、原文、命令凭据且迁移幂等', async () => {
    await repository.create(game());
    const current = await repository.save('save-a', 0, 'turn-a', [purchase()]);
    current.journal = [{ turnId: 'turn-a', revision: 1, story, relatedActorRefs: [] }];
    current.turnNumber = 1;
    const legacy = { ...current, schemaVersion: 1 }; Reflect.deleteProperty(legacy, 'retiredEvents');
    Reflect.deleteProperty(legacy, 'contactNpcIds'); Reflect.deleteProperty(legacy, 'retiredNpcs'); Reflect.deleteProperty(legacy, 'contactReviewNpcIds');
    Reflect.deleteProperty(legacy, 'weatherText'); Reflect.deleteProperty(legacy, 'environmentText');
    await rawStore((store) => { store.put(legacy); });
    const migrated = await repository.load('save-a');
    expect(migrated).toEqual(current); expect(await rawRead()).toEqual(current);
    expect(await repository.load('save-a')).toEqual(migrated);
    expect((await repository.save('save-a', 0, 'turn-a', [purchase()])).economy.cash).toBe(7500);
  });
  it.each([
    { schemaVersion: 2, saveId: 'save-a' },
    { ...game(), economy: { ...game().economy, cash: -1 } },
    { ...game(), protagonist: { ...game().protagonist, locationId: 'missing' } },
    { ...game(), schemaVersion: 99 },
    { ...game(), schemaVersion: 0 },
    { ...game(), schemaVersion: undefined },
  ])('损坏或不支持的数据不会被默认值覆盖', async (raw) => {
    await rawStore((store) => { store.put(raw); });
    await expect(repository.load('save-a')).rejects.toThrow();
    await expect(repository.save('save-a', 0, 'turn-a', [purchase()])).rejects.toThrow();
    expect(await rawRead()).toEqual(raw);
  });
  it('旧版结构合法但引用损坏时迁移失败并保留原数据', async () => {
    const raw = { ...game(), schemaVersion: 1, initialCompanionId: 'missing' }; Reflect.deleteProperty(raw, 'retiredEvents');
    Reflect.deleteProperty(raw, 'weatherText'); Reflect.deleteProperty(raw, 'environmentText');
    await rawStore((store) => { store.put(raw); });
    await expect(repository.load('save-a')).rejects.toMatchObject({ code: 'CORRUPT_SAVE' });
    expect(await rawRead()).toEqual(raw);
  });
});
