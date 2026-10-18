import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { commitCommands } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { TurnDraftSchema, validateDraftUpdate } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { migrateSave } from './migrations';

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

async function transaction<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = database.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DataError('TRANSACTION_ABORTED', '事务已回滚'));
    tx.onerror = () => { /* onabort 统一报告，禁止提前把 request 成功当作提交成功。 */ };
  });
  // 及时安装拒绝处理；work 中仅等待同一事务的 IDB 请求，不能等待网络或定时器。
  void done.catch(() => undefined);
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* 已经完成或中止。 */ }
    await done.catch(() => undefined);
    throw error;
  }
}

function readState(raw: unknown, saveId: string): GameState {
  requireData(raw !== undefined, 'NOT_FOUND', '存档不存在');
  const state = migrateSave(raw);
  requireData(state.saveId === saveId, 'CORRUPT_SAVE', '存档主键与内容不一致');
  return state;
}

export class SaveRepository {
  private constructor(private readonly database: IDBDatabase) {}

  static open(name = 'heijinwangchao', factory: IDBFactory = globalThis.indexedDB): Promise<SaveRepository> {
    if (!factory) return Promise.reject(new DataError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB'));
    return new Promise((resolve, reject) => {
      // IndexedDB 结构版本独立于每个存档的 schemaVersion。
      const operation = factory.open(name, 1);
      operation.onupgradeneeded = () => {
        operation.result.createObjectStore('saves', { keyPath: 'saveId' });
        operation.result.createObjectStore('drafts', { keyPath: 'saveId' });
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

  async list(): Promise<Array<Pick<GameState, 'saveId' | 'title' | 'revision' | 'schemaVersion' | 'updatedAt'>>> {
    return transaction(this.database, ['saves'], 'readonly', async (tx) => {
      const raw: unknown[] = await request(tx.objectStore('saves').getAll());
      return raw.map((record) => {
        const { saveId, title, revision, schemaVersion, updatedAt } = migrateSave(record);
        return { saveId, title, revision, schemaVersion, updatedAt };
      });
    });
  }

  // 正式状态唯一写入入口：从数据库当前快照计算，拒绝任意覆盖客户端旧副本。
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

  async delete(saveId: string, expectedRevision: number): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    return transaction(this.database, ['saves', 'drafts'], 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = readState(await request(store.get(saveId)), saveId);
      requireData(current.revision === expectedRevision, 'REVISION_CONFLICT', '删除时存档版本已变化');
      await request(tx.objectStore('drafts').delete(saveId));
      await request(store.delete(saveId));
    });
  }

  async saveDraft(draft: TurnDraft, expectedDraftRevision: number | null): Promise<TurnDraft> {
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
    });
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
