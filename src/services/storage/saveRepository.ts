import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { commitCommands, fingerprint } from '../../domain/commands';
import { z } from 'zod';
import type { DomainCommand } from '../../domain/commands';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { TurnDraftSchema, validateDraftUpdate, createTurnDraft } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { migrateSave } from './migrations';
import { TurnSubmissionSchema, settleTurn, awaitingPlayerAction } from '../../domain/turnCommit';
import type { TurnSubmission } from '../../domain/turnCommit';
import { validateTurnCandidates } from '../validation/turnCommit';
import { reserveStageSession, withBrowserLock } from '../../workflows/stageGuard';
import { applyCompression, CompressionBatchSchema } from '../../domain/memories/compression';
import type { CompressionBatch } from '../../domain/memories/compression';
import { applyNpcSummary, NpcMemoryBatchSchema } from '../../domain/memories/npcMemory';
import type { NpcMemoryBatch } from '../../domain/memories/npcMemory';
import { NpcSummarySchema, MemoryEntrySchema } from '../../domain/memories/schema';
import { unreadableSaveSummary } from './saveManagement';
import type { RawSaveExport, RawSaveRecord, SaveSummary } from './saveManagement';

const ReceiptSchema = z.strictObject({
  saveId: IdSchema,
  turnId: IdSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  revision: CountSchema,
  nextTurnId: IdSchema,
});
export interface TurnCommitResult {
  state: GameState;
  draft: TurnDraft;
  replayed: boolean;
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

async function transaction<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const tx = database.transaction(stores, mode);
  const abort = () => { try { tx.abort(); } catch { /* 已提交或中止。 */ } };
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DataError('TRANSACTION_ABORTED', '事务已回滚'));
    tx.onerror = () => { /* onabort 统一报告，禁止提前把 request 成功当作提交成功。 */ };
  });
  // 及时安装拒绝处理；work 中仅等待同一事务的 IDB 请求，不能等待网络或定时器。
  void done.catch(() => undefined);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* 已经完成或中止。 */ }
    await done.catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function readState(raw: unknown, saveId: string): GameState {
  requireData(raw !== undefined, 'NOT_FOUND', '存档不存在');
  const state = migrateSave(raw);
  requireData(state.saveId === saveId, 'CORRUPT_SAVE', '存档主键与内容不一致');
  return state;
}

function listRecord(key: IDBValidKey, raw: unknown): SaveSummary {
  try {
    requireData(typeof key === 'string', 'CORRUPT_SAVE', '存档主键不是有效 ID');
    const { saveId, title, revision, schemaVersion, updatedAt } = readState(raw, key as string);
    return { status: 'readable', storageKey: key, saveId, title, revision, schemaVersion, updatedAt };
  } catch {
    // Only classify per-record parsing failures. IDB requests/transactions stay outside
    // this catch, so a storage failure can never masquerade as a broken save or empty list.
    return unreadableSaveSummary(key, raw);
  }
}

async function rawRecords(store: IDBObjectStore | IDBIndex, key?: IDBValidKey): Promise<RawSaveRecord[]> {
  const keys = await request(store.getAllKeys(key));
  const values = await request<unknown[]>(store.getAll(key));
  return keys.map((key, index) => ({ key, value: values[index] }));
}

async function deleteRecords(tx: IDBTransaction, key: IDBValidKey): Promise<void> {
  await request(tx.objectStore('drafts').delete(key));
  const receipts = tx.objectStore('turnReceipts');
  const keys = await request(receipts.index('saveId').getAllKeys(key));
  for (const receiptKey of keys) await request(receipts.delete(receiptKey));
  await request(tx.objectStore('saves').delete(key));
}

export class SaveRepository {
  private constructor(private readonly database: IDBDatabase) {}

  static open(name = 'heijinwangchao', factory: IDBFactory = globalThis.indexedDB): Promise<SaveRepository> {
    if (!factory) return Promise.reject(new DataError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB'));
    return new Promise((resolve, reject) => {
      // IndexedDB 结构版本独立于每个存档的 schemaVersion。
      const operation = factory.open(name, 2);
      operation.onupgradeneeded = () => {
        const db = operation.result;
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('turnReceipts'))
          db.createObjectStore('turnReceipts', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
      };
      operation.onerror = () => reject(operation.error);
      let blocked = false;
      operation.onblocked = () => { blocked = true; reject(new DataError('STORAGE_BLOCKED', '数据库升级被其他页面阻塞')); };
      operation.onsuccess = () => {
        const db = operation.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(new SaveRepository(db));
      };
    });
  }

  close(): void { this.database.close(); }

  async create(state: GameState): Promise<GameState> {
    const parsed = GameStateSchema.parse(state);
    requireData(parsed.revision === 0 && parsed.turnNumber === 0 && parsed.journal.length === 0
      && parsed.appliedCommands.length === 0, 'INITIAL_VERSION', '新存档必须从未提交状态创建');
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      requireData(await request(store.get(parsed.saveId)) === undefined, 'DUPLICATE_SAVE', '存档已存在');
      await request(store.add(parsed));
      return parsed;
    });
  }

  async load(saveId: string): Promise<GameState> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const raw: unknown = await request(store.get(saveId));
      const state = readState(raw, saveId);
      // 校验全部成功之后，才将旧版整体替换；不改变游戏 revision 或 worldClock。
      if ((raw as { schemaVersion: number }).schemaVersion !== state.schemaVersion) await request(store.put(state));
      return state;
    });
  }

  async loadGame(saveId: string): Promise<{ state: GameState; draft?: TurnDraft }> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves', 'drafts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const raw: unknown = await request(store.get(saveId));
      const state = readState(raw, saveId);
      const rawDraft: unknown = await request(tx.objectStore('drafts').get(saveId));
      const draft = rawDraft === undefined ? undefined : TurnDraftSchema.parse(rawDraft);
      requireData(!draft || draft.saveId === saveId, 'CORRUPT_DRAFT', '草稿主键不符');
      if (z.object({ schemaVersion: z.number() }).parse(raw).schemaVersion !== state.schemaVersion)
        await request(store.put(state));
      return { state, draft };
    });
  }

  async saveMemoryCompression(batch: CompressionBatch, output: z.infer<typeof MemoryEntrySchema>, signal?: AbortSignal): Promise<GameState> {
    const parsed = CompressionBatchSchema.parse(batch), result = MemoryEntrySchema.parse(output);
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = readState(await request(store.get(parsed.saveId)), parsed.saveId);
      // 从最新整份状态仅替换已核对的记忆批次，不提升世界版本、不写草稿。
      const next = applyCompression(current, parsed, result);
      await request(store.put(next));
      return next;
    }, signal);
  }

  async saveNpcSummary(batch: NpcMemoryBatch, output: z.infer<typeof NpcSummarySchema>[], signal?: AbortSignal): Promise<GameState> {
    const parsed = NpcMemoryBatchSchema.parse(batch), result = z.array(NpcSummarySchema).parse(output);
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = readState(await request(store.get(parsed.saveId)), parsed.saveId);
      const next = GameStateSchema.parse(applyNpcSummary(current, parsed, result));
      await request(store.put(next));
      return next;
    }, signal);
  }

  async list(): Promise<SaveSummary[]> {
    return transaction(this.database, ['saves'], 'readonly', async (tx) => {
      const records = await rawRecords(tx.objectStore('saves'));
      return records.map(({ key, value }) => listRecord(key, value));
    });
  }

  // Recovery export reads a consistent, raw snapshot, irrespective of save/schema version.
  // Association uses the actual save key, never a saveId recovered from untrusted contents.
  async exportRaw(storageKey: IDBValidKey): Promise<RawSaveExport> {
    requireData(storageKey !== undefined && storageKey !== null, 'INVALID_KEY', '未选择存档记录');
    return transaction(this.database, ['saves', 'drafts', 'turnReceipts'], 'readonly', async tx => {
      const saves = await rawRecords(tx.objectStore('saves'), storageKey);
      requireData(saves.length === 1, 'NOT_FOUND', '此存档已不存在，请刷新列表。');
      const drafts = await rawRecords(tx.objectStore('drafts'), storageKey);
      const turnReceipts = await rawRecords(tx.objectStore('turnReceipts').index('saveId'), storageKey);
      return { format: 'heijin-raw-save', version: 1, records: { saves, drafts, turnReceipts } };
    });
  }

  // Explicit recovery action, separate from the revision-checked normal delete path.
  // Recheck within the write transaction: never delete a record that has become readable.
  async deleteUnreadable(storageKey: IDBValidKey): Promise<void> {
    requireData(storageKey !== undefined && storageKey !== null, 'INVALID_KEY', '未选择存档记录');
    return transaction(this.database, ['saves', 'drafts', 'turnReceipts'], 'readwrite', async tx => {
      const records = await rawRecords(tx.objectStore('saves'), storageKey);
      requireData(records.length === 1, 'NOT_FOUND', '此存档已不存在，请刷新列表。');
      requireData(listRecord(storageKey, records[0].value).status === 'unreadable', 'SAVE_READABLE', '此存档现在可以读取，请刷新列表后重新选择。');
      await deleteRecords(tx, storageKey);
    });
  }

  // M1 独立领域命令兼容入口；完整回合必须走 commitTurn，不拼接 save/saveDraft。
  async save(saveId: string, expectedRevision: number, turnId: string,
    commands: readonly DomainCommand[]): Promise<GameState> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    return transaction(this.database, ['saves'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = readState(await request(store.get(saveId)), saveId);
      const next = commitCommands(current, turnId, expectedRevision, commands);
      if (next.revision !== current.revision) await request(store.put(next));
      return next;
    });
  }

  // 完整回合唯一入口；摘要计算在事务外，事务中只等待同一 IDB 的请求。
  async commitTurn(input: TurnSubmission): Promise<TurnCommitResult> {
    const parsed = TurnSubmissionSchema.parse(input);
    const session = reserveStageSession(parsed.draft.saveId);
    try {
      return await withBrowserLock(parsed.draft.saveId, async () => {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(fingerprint(parsed)),
        );
        const requestHash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const nextTurnId = `turn-${crypto.randomUUID()}`;
        return transaction(
          this.database,
          ['saves', 'drafts', 'turnReceipts'],
          'readwrite',
          async (tx) => {
            session.check();
            const saves = tx.objectStore('saves'),
              drafts = tx.objectStore('drafts'),
              receipts = tx.objectStore('turnReceipts');
            const state = readState(
              await request(saves.get(parsed.draft.saveId)),
              parsed.draft.saveId,
            );
            const rawDraft: unknown = await request(drafts.get(parsed.draft.saveId));
            const current = TurnDraftSchema.parse(rawDraft);
            const prior: unknown = await request(receipts.get([state.saveId, parsed.draft.turnId]));
            if (prior !== undefined) {
              const receipt = ReceiptSchema.parse(prior);
              requireData(
                receipt.requestHash === requestHash,
                'TURN_CONFLICT',
                '相同回合的提交内容不同',
              );
              requireData(
                state.journal.some(
                  (entry) => entry.turnId === receipt.turnId && entry.revision === receipt.revision,
                ) &&
                  (current.turnId === receipt.nextTurnId || state.journal.some((entry) => entry.turnId === receipt.nextTurnId)) &&
                  current.saveId === state.saveId &&
                  current.baseSaveRevision === state.revision &&
                  !state.journal.some((entry) => entry.turnId === current.turnId),
                'CORRUPT_RECEIPT',
                '提交回执与存档不一致',
              );
              return { state, draft: current, replayed: true };
            }
            requireData(
              current.saveId === state.saveId && fingerprint(current) === fingerprint(parsed.draft),
              'DRAFT_CONFLICT',
              '草稿已变化，请重新读取',
            );
            requireData(
              state.revision === current.baseSaveRevision,
              'REVISION_CONFLICT',
              '正式版本已改变',
            );
            validateTurnCandidates(state, current);
            const next = settleTurn(state, current, new Date().toISOString());
            requireData(!next.journal.some((entry) => entry.turnId === nextTurnId), 'DUPLICATE_TURN', '下一回合 ID 重复');
            const draft = createTurnDraft(
              state.saveId,
              next.revision,
              nextTurnId,
              'regular',
              parsed.nextAction,
              parsed.useVariableStage,
              parsed.useWorldStage,
            );
            const receipt = ReceiptSchema.parse({
              saveId: state.saveId,
              turnId: current.turnId,
              requestHash,
              revision: next.revision,
              nextTurnId,
            });
            await request(saves.put(next));
            await request(drafts.put(draft));
            await request(receipts.add(receipt));
            return { state: next, draft, replayed: false };
          },
        );
      });
    } finally {
      session.release();
    }
  }

  async delete(saveId: string, expectedRevision: number): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    return transaction(this.database, ['saves', 'drafts', 'turnReceipts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = readState(await request(store.get(saveId)), saveId);
      requireData(current.revision === expectedRevision, 'REVISION_CONFLICT', '删除时存档版本已变化');
      await deleteRecords(tx, saveId);
    });
  }

  // 唯一允许绑定空待输入草稿的入口。输入绑定后仍不可由saveDraft改写；不提升正式revision。
  async bindTurnAction(expected: TurnDraft, action: string, useVariableStage: boolean, useWorldStage: boolean): Promise<TurnDraft> {
    const snapshot = TurnDraftSchema.parse(expected), userInput = z.string().trim().min(1).max(100000).parse(action);
    const session = reserveStageSession(snapshot.saveId);
    try {
      return await withBrowserLock(snapshot.saveId, () => transaction(this.database, ['saves', 'drafts'], 'readwrite', async tx => {
        session.check();
        const state = readState(await request(tx.objectStore('saves').get(snapshot.saveId)), snapshot.saveId);
        const store = tx.objectStore('drafts'), current = TurnDraftSchema.parse(await request(store.get(snapshot.saveId)));
        requireData(fingerprint(current) === fingerprint(snapshot), 'DRAFT_CONFLICT', '行动草稿已被其他操作更新');
        requireData(awaitingPlayerAction(state, current), 'DRAFT_CONFLICT', '只能为未生成的待输入回合绑定行动');
        const next = TurnDraftSchema.parse({ ...createTurnDraft(current.saveId, state.revision, current.turnId, 'regular', userInput, useVariableStage, useWorldStage), draftRevision: current.draftRevision + 1 });
        await request(store.put(next)); return next;
      }));
    } finally { session.release(); }
  }

  async saveDraft(draft: TurnDraft, expectedDraftRevision: number | null, signal?: AbortSignal): Promise<TurnDraft> {
    const next = TurnDraftSchema.parse(draft);
    return transaction(this.database, ['saves', 'drafts'], 'readwrite', async (tx) => {
      const current = readState(await request(tx.objectStore('saves').get(next.saveId)), next.saveId);
      requireData(current.revision === next.baseSaveRevision, 'REVISION_CONFLICT', '草稿依赖的正式版本已失效');
      const store = tx.objectStore('drafts');
      const raw: unknown = await request(store.get(next.saveId));
      if (expectedDraftRevision === null) {
        requireData(raw === undefined && next.draftRevision === 0 && next.storyRevision === 0
          && next.executionRevision === 0 && next.requestedStages.length === 0
          && next.stageRequestRevisions.variables === 0 && next.stageRequestRevisions.world === 0
          && !next.story && !next.variables && !next.world, 'DRAFT_CONFLICT', '初始草稿已存在或版本不为零');
      } else {
        const old = TurnDraftSchema.parse(raw);
        requireData(old.draftRevision === expectedDraftRevision, 'DRAFT_CONFLICT', '草稿已被其他操作更新');
        validateDraftUpdate(old, next);
      }
      await request(store.put(next));
      return next;
    }, signal);
  }

  async loadDraft(saveId: string): Promise<TurnDraft | undefined> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['drafts'], 'readonly', async (tx) => {
      const raw: unknown = await request(tx.objectStore('drafts').get(saveId));
      if (raw === undefined) return undefined;
      const parsed = TurnDraftSchema.safeParse(raw);
      if (!parsed.success || parsed.data.saveId !== saveId) throw new DataError('CORRUPT_DRAFT', '草稿数据损坏，原始数据已保留');
      // 即使正式状态已推进，仍可读取过期草稿供恢复检查，但无法再写入或提交。
      return parsed.data;
    });
  }

  async deleteDraft(saveId: string, expectedDraftRevision: number): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedDraftRevision);
    return transaction(this.database, ['drafts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('drafts');
      const old = TurnDraftSchema.parse(await request(store.get(saveId)));
      requireData(old.draftRevision === expectedDraftRevision, 'DRAFT_CONFLICT', '草稿版本冲突');
      await request(store.delete(saveId));
    });
  }
}
