import { BookCache, bookStore } from './bookCache';
import { oracleStore, createOracleStore, readSheet, writeSheet, rememberPaper, consumeOracleNote } from './oracleNotes';
import { validatePendingChat } from '../../domain/phone';
import { PhoneOperation, isPrivate, freezeChat, restoreChat } from '../../domain/phoneChat';
import { withWorldbookLibrary, restoreWorldview, worldviewDigest, missingWorldview, storySourceHash, type StoryWorldview } from '../worldbook/mainWorldview';
import { HistoryRepository } from './history/repository';
import { clearManualHistory, historyStores } from './history/model';
import { setNpcImportance } from '../../domain/npc/profiles';
import { timelineStores, newSaveControl, readControl, writeControl, controlInstance, clearUndoRecords, recordUndo, inspectUndo, restoreSnapshot, assertMemoryLineage, readTurnComparison, SnapshotSchema } from './turnUndo';
import type { MemoryLineage, UndoStatus, TurnComparison } from './turnUndo';
import { request, transaction } from './idb';
import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { commitCommands, fingerprint } from '../../domain/commands';
import { z } from 'zod';
import type { DomainCommand } from '../../domain/commands';
import { validateVariableEdit } from '../../domain/playerVariables';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { normalizeOpeningCity } from '../../domain/openingCity';
import { TurnDraftSchema, validateDraftUpdate, createTurnDraft, rerollStory } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { LegacyNotificationSelection } from '../../domain/events/legacyNotification';
import { authorizeLegacyNotificationRecovery, validateRecoveredStory } from '../../domain/legacyNotificationRecovery';
import { migrateSave } from './migrations';
import { TurnSubmissionSchema, settleTurn, awaitingPlayerAction, rebindableAfterStoryStop } from '../../domain/turnCommit';
import type { TurnSubmission } from '../../domain/turnCommit';
import { validateTurnCandidates } from '../validation/turnCommit';
import { attachFailureDiagnostic } from '../ai/failureDiagnostic';
import { reserveStageSession, withBrowserLock } from '../../workflows/stageGuard';
import { applyCompression, CompressionBatchSchema } from '../../domain/memories/compression';
import type { CompressionBatch } from '../../domain/memories/compression';
import { applyNpcSummary, NpcMemoryBatchSchema } from '../../domain/memories/npcMemory';
import type { NpcMemoryBatch } from '../../domain/memories/npcMemory';
import { NpcSummarySchema, MemoryEntrySchema } from '../../domain/memories/schema';
import { unreadableSaveSummary } from './saveManagement';
import type { RawSaveExport, RawSaveRecord, SaveSummary } from './saveManagement';
import { advanceTheaterVersion, clearTheaters, createTheaterStores, createTheaterVersionStore, exportTheaters,
  notifyTheaterChange, putTheater, TheaterRepository, theaterStores, theaterVersionStore } from './theaters';
import { notifyImages, imageTimelineChange, ImageLibrary, imageStores, checkImageStores, clearImages, exportImages, parseImages, restoreImages } from '../images/library';
import type { PortableImages } from '../images/library';
import { parseTheaters } from '../../domain/theater/record';
import type { TheaterRecord } from '../../domain/theater/record';
import { backupSummary, compatibleDraft, maxBackupBytes } from './backup';
import type { BackupEntry } from './backup';

/** Storage connection boundary, independent of GameState/backup format versions.
 * V7 tracks theater collection changes independently of the main revision.
 * V6 adds independent theater metadata and body stores.
 * V5 adds separate history metadata/payload stores, preserving all V4 records.
 * Versionchange closes older clients before history writes become available.
 * V4 closes deployed V3 clients via their existing versionchange handler before
 * imports become available. Old V3 code cannot reopen and bypass instance CAS.
 * That V4 upgrade required no store, index or saved payload changes. */
// V10 closes older writers before they encounter populated phone conversations in a V11 save.
// V11 closes V10 writers before private-chat drafts and undo snapshots are saved.
// V12 separates local literary notes by save.
// V13 isolates older writers before group operations enter drafts and undo snapshots.
export const saveDatabaseVersion = 13;

declare const confirmationBrand: unique symbol;
/**
 * compareBackup 给出的一次性确认凭据。只在内存中传递：本身是空的冻结对象，
 * 不含也不暴露任何存档内容（JSON 序列化结果为 {}）；导入时消耗，不能重复使用。
 */
export interface BackupImportConfirmation { readonly [confirmationBrand]: true }

/**
 * 导入前与本机的比较结果（UI 合约）。
 * - new：本机没有该 saveId 的存档记录。
 * - same：正式存档完全相同（整份数据逐项比较，含记忆、NPC 管理等不推进回合版本的内容），
 *   且未结算草稿及备份中明确提供的小剧场也相同。导入只会清掉本机撤回与提交回执，UI 应显示「已是最新」。
 * - overwrite：本机存档可读取，正式存档、草稿或小剧场有差异。
 * - overwrite-unreadable：本机同 ID 记录存在但无法读取。
 * - overwrite-orphaned：本机没有正式存档，但留有同 ID 的草稿、回执、撤回或控制记录；导入会清除它们，
 *   因此同样需要明确覆盖，不能当作新建。
 * 每种结果都附带 confirmation：它同时绑定本机快照与当时比较的备份内容；导入时备份内容必须与确认时完全一致，
 * 并在写事务内按它重新核对本机全部相关记录。
 */
export type BackupComparison =
  | { kind: 'new'; confirmation: BackupImportConfirmation }
  | { kind: 'same'; local: BackupEntry['summary']; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite'; local: BackupEntry['summary']; differences: { state: boolean; draft: boolean; images?: boolean; theaters?: boolean }; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite-unreadable'; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite-orphaned'; records: { drafts: number; turnReceipts: number; turnUndo: number; saveControls: number }; confirmation: BackupImportConfirmation };

/** 某个存储键在五个时间线仓库中的全部原始记录，按真实主键读取，不解析、不迁移。 */
interface LocalSnapshot {
  saves: RawSaveRecord[];
  drafts: RawSaveRecord[];
  turnReceipts: RawSaveRecord[];
  turnUndo: RawSaveRecord[];
  saveControls: RawSaveRecord[];
  oracleNotes: RawSaveRecord[];
  theaters: RawSaveRecord[];
  imageVersions: RawSaveRecord[];
}
const snapshotStores = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls', oracleStore, 'theaters','imageVersions'] as const;
const confirmations = new WeakMap<BackupImportConfirmation, { repository: SaveRepository; saveId: string; incoming: string; images?: PortableImages; snapshot: LocalSnapshot }>();
const emptySnapshot = (snapshot: LocalSnapshot) => snapshotStores.every((name) => snapshot[name].length === 0);
/** 备份条目的确定性内容指纹：规范化后的正式存档与兼容草稿（同步计算，可在事务外比较）。 */
const incomingFingerprint = (state: GameState, draft: TurnDraft | undefined, theaters?: TheaterRecord[]) =>
  fingerprint({ state, draft: draft ?? null, theaters: theaters ?? null });
type BackupSource = Pick<BackupEntry, 'state' | 'draft' | 'theaters' | 'images'>;
const replacedMessage = '这份存档已被替换（例如在其他标签导入了备份），本次没有修改。请刷新后重新操作。';

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
export interface TurnUndoResult extends TurnCommitResult { input: string }
export interface TurnUndoRequest { saveId: string; expectedRevision: number; expectedDraft?: TurnDraft; operationId: string; chatChoice?: 'keep'|'discard' }


function readState(raw: unknown, saveId: string): GameState {
  requireData(raw !== undefined, 'NOT_FOUND', '存档不存在');
  const state = migrateSave(raw);
  requireData(state.saveId === saveId, 'CORRUPT_SAVE', '存档主键与内容不一致');
  return normalizeOpeningCity(state);
}

// Only call in the existing readwrite transaction. A later validation/CAS failure
// aborts this write too; identity normalization never increments the game revision.
async function readStoredState(tx: IDBTransaction, saveId: string): Promise<GameState> {
  const store = tx.objectStore('saves');
  const raw = await request(store.get(saveId));
  const state = readState(raw, saveId);
  if (raw.schemaVersion !== state.schemaVersion || raw.openingCityId === undefined || raw.phone?.version !== state.phone.version)
    await request(store.put(state));
  return state;
}

function listRecord(key: IDBValidKey, raw: unknown): SaveSummary {
  try {
    requireData(typeof key === 'string', 'CORRUPT_SAVE', '存档主键不是有效 ID');
    const { saveId, title, revision, turnNumber, schemaVersion, updatedAt, npcManagementRevision, openingCityId, openingCityProfile } = readState(raw, key as string);
    return { status: 'readable', storageKey: key, saveId, title, revision, turnNumber, schemaVersion, updatedAt,
      ...(npcManagementRevision === undefined ? {} : { npcManagementRevision }),
      ...(openingCityId === undefined ? {} : { openingCityId }), ...(openingCityProfile ? { openingCityProfile } : {}) };
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

async function readSnapshot(tx: IDBTransaction, key: IDBValidKey): Promise<LocalSnapshot> {
  return {
    saves: await rawRecords(tx.objectStore('saves'), key),
    drafts: await rawRecords(tx.objectStore('drafts'), key),
    turnReceipts: await rawRecords(tx.objectStore('turnReceipts').index('saveId'), key),
    turnUndo: await rawRecords(tx.objectStore('turnUndo').index('saveId'), key),
    saveControls: await rawRecords(tx.objectStore('saveControls'), key),
    oracleNotes: await rawRecords(tx.objectStore(oracleStore), key),
    imageVersions: await rawRecords(tx.objectStore('imageVersions'),key),
    theaters: await rawRecords(tx.objectStore('theaterIndex').index('saveId'), key),
  };
}

/**
 * 同步、逐项比较两份结构化克隆数据。只认识 IndexedDB 中正常存档会出现的类型；
 * 遇到无法确定相等的类型一律视为不同，宁可拒绝导入，也不把变化误判为未变。
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((value, index) => sameValue(value, other[index]));
  }
  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
  if (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) {
    const left = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const right = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array((b as ArrayBufferView).buffer, (b as ArrayBufferView).byteOffset, (b as ArrayBufferView).byteLength);
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  }
  const prototype = Object.getPrototypeOf(a);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every((key) => Object.prototype.hasOwnProperty.call(b, key)
    && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
function sameSnapshot(a: LocalSnapshot, b: LocalSnapshot): boolean {
  return snapshotStores.every((name) => a[name].length === b[name].length
    && a[name].every((record, index) => sameValue(record.key, b[name][index].key) && sameValue(record.value, b[name][index].value)));
}

/** 只读取实例身份，不严格解析整条控制记录：控制记录损坏时读档与删除仍按原行为工作（身份视为原存档）。 */
async function storedInstance(tx: IDBTransaction, key: IDBValidKey): Promise<string | null> {
  const id = ((await request(tx.objectStore('saveControls').get(key))) as { instanceId?: unknown } | null | undefined)?.instanceId;
  return typeof id === 'string' ? id : null;
}

async function deleteRecords(tx: IDBTransaction, key: IDBValidKey): Promise<void> {
  await request(tx.objectStore('drafts').delete(key));
  const receipts = tx.objectStore('turnReceipts');
  const keys = await request(receipts.index('saveId').getAllKeys(key));
  for (const receiptKey of keys) await request(receipts.delete(receiptKey));
  await clearUndoRecords(tx, key);
  await request(tx.objectStore(oracleStore).delete(key));
  await request(tx.objectStore(bookStore).delete(IDBKeyRange.bound([key],[key,[]])));
  await request(tx.objectStore('saveControls').delete(key));
  await request(tx.objectStore('saves').delete(key));
}

type OracleEditBasis = { saveId: string; instance: string | null; epoch: string; version: string | null };

export interface VariableSnapshot {
  state: GameState;
  draft?: TurnDraft;
  instance?: string;
  epoch?: string;
}

async function variableSnapshot(tx: IDBTransaction, saveId: string): Promise<VariableSnapshot> {
  const state = readState(await request(tx.objectStore('saves').get(saveId)), saveId);
  const raw: unknown = await request(tx.objectStore('drafts').get(saveId));
  const draft = raw === undefined ? undefined : TurnDraftSchema.parse(raw);
  requireData(!draft || (draft.saveId === saveId && draft.baseSaveRevision === state.revision),
    'DRAFT_CONFLICT', '当前草稿与正式存档版本不符，请先恢复草稿。');
  const control = await readControl(tx, saveId);
  return { state, draft, instance: control?.instanceId, epoch: control?.epoch };
}

async function checkStoryLease(tx: IDBTransaction, saveId: string, lease: StoryWorldview) {
  const control = await readControl(tx, saveId);
  requireData(control && lease.saveId === saveId && lease.instance === controlInstance(control) && lease.epoch === control.epoch,
    'DRAFT_CONFLICT', '正文请求所属存档实例已经变化，请重新读取。');
  return control;
}

async function checkStoryPublication(base: TurnDraft, next: TurnDraft, lease: StoryWorldview) {
  requireData(base.saveId === lease.saveId && base.turnId === lease.turnId && base.baseSaveRevision === lease.baseRevision &&
    base.storyRevision === lease.storyRevision && base.draftRevision === lease.draftRevision,
    'DRAFT_CONFLICT', '正文生成依据与草稿不符，请重新读取。');
  await restoreWorldview(base.saveId,lease.owner,lease.generation,lease.worldviewHash);
  return storySourceHash(next);
}

async function publishStoryOrigin(tx: IDBTransaction, saveId: string, lease: StoryWorldview, sourceHash: string, deliveredNoteId?: string) {
  const control = await checkStoryLease(tx, saveId, lease);
  if (deliveredNoteId) await consumeOracleNote(tx, saveId, deliveredNoteId);
  control.storyOrigin = { owner:lease.owner, generation:lease.generation, instance:lease.instance, worldviewHash:lease.worldviewHash, sourceHash };
  await writeControl(tx,control);
}

export class SaveRepository {
  private readonly pendingWorldviews = new WeakMap<StoryWorldview, string>();
  readonly history: HistoryRepository;
  readonly books: BookCache;
  readonly images: ImageLibrary;
  readonly theaters: TheaterRepository;
  private constructor(private readonly database: IDBDatabase, readonly upgradedFrom?: number) {
    this.books = new BookCache(database);
    this.images = new ImageLibrary(database);
    this.history = new HistoryRepository(database);
    this.theaters = new TheaterRepository(database, readState);
  }

  static open(name = 'heijinwangchao', factory: IDBFactory = globalThis.indexedDB, onSuperseded?: () => void): Promise<SaveRepository> {
    if (!factory) return Promise.reject(new DataError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB'));
    return new Promise((resolve, reject) => {
      // IndexedDB 结构版本独立于每个存档的 schemaVersion。
      const operation = factory.open(name, saveDatabaseVersion);
      let schemaError: DataError | undefined;
      let upgradedFrom: number | undefined;
      operation.onupgradeneeded = event => {
        upgradedFrom = event.oldVersion || undefined;
        const db = operation.result;
        const tx = operation.transaction!;
        try {
          checkImageStores(db, tx, event.oldVersion < 8);
        } catch (error) {
          if (error instanceof DataError) schemaError = error;
          try { tx.abort(); } catch { /* The upgrade was already aborted. */ }
          return;
        }
        if (!db.objectStoreNames.contains('theaterIndex')) createTheaterStores(db);
        if (!db.objectStoreNames.contains(theaterVersionStore)) createTheaterVersionStore(operation.transaction!);
        for (const name of historyStores) if (!db.objectStoreNames.contains(name))
          db.createObjectStore(name, { keyPath: ['saveId', 'id'] }).createIndex('saveId', 'saveId');
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('turnUndo'))
          db.createObjectStore('turnUndo', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
        if (!db.objectStoreNames.contains('saveControls')) db.createObjectStore('saveControls', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains(bookStore)) db.createObjectStore(bookStore);
        if (!db.objectStoreNames.contains(oracleStore)) createOracleStore(db, tx);
        if (!db.objectStoreNames.contains('turnReceipts'))
          db.createObjectStore('turnReceipts', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
      };
      operation.onerror = () => reject(schemaError ?? operation.error);
      let blocked = false;
      operation.onblocked = () => { blocked = true; reject(new DataError('STORAGE_BLOCKED', '数据库升级被其他页面阻塞，请关闭旧版游戏标签后重试。原存档未修改。')); };
      operation.onsuccess = () => {
        const db = operation.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => { db.close(); onSuperseded?.(); };
        try {
          checkImageStores(db);
          resolve(new SaveRepository(db, upgradedFrom));
        } catch (error) {
          db.close();
          reject(error);
        }
      };
    });
  }

  close(): void { this.database.close(); }

  /** Called under the workflow lock. Read the live draft and its local witness together. */
  async prepareWorldview(draft: TurnDraft, resume: boolean, expectedInstance?: string | null, pending?: StoryWorldview): Promise<StoryWorldview> {
    const hash = resume ? await storySourceHash(draft) : undefined;
    const scope = await transaction(this.database, ['saves','drafts','saveControls'], resume ? 'readonly' : 'readwrite', async tx => {
      const state = readState(await request(tx.objectStore('saves').get(draft.saveId)),draft.saveId);
      const current = TurnDraftSchema.parse(await request(tx.objectStore('drafts').get(draft.saveId)));
      requireData(state.revision === draft.baseSaveRevision && fingerprint(current) === fingerprint(draft),
        'DRAFT_CONFLICT', '草稿或存档已变化，请重新读取。');
      let control = await readControl(tx,draft.saveId);
      const instance = controlInstance(control);
      requireData(expectedInstance === undefined || expectedInstance === instance, 'DRAFT_CONFLICT',replacedMessage);
      if (resume && (!control?.storyOrigin || control.storyOrigin.owner !== this.database.name || control.storyOrigin.instance !== instance || control.storyOrigin.sourceHash !== hash))
        throw missingWorldview();
      if (!control) { control = newSaveControl(draft.saveId); await writeControl(tx, control); }
      return { saveId:draft.saveId, instance, epoch:control.epoch, origin:control.storyOrigin };
    });
    const { origin, ...identity } = scope;
    const owner = this.database.name;
    const basis = { ...identity, owner, turnId: draft.turnId, baseRevision: draft.baseSaveRevision,
      draftRevision: draft.draftRevision, storyRevision: draft.storyRevision };
    // A failed replacement leaves the published candidate and its origin intact. Its retry can
    // reuse only the uncommitted snapshot belonging to this same live draft and save instance.
    if (pending) {
      requireData(!resume && this.pendingWorldviews.get(pending) === fingerprint(draft) && Object.entries(basis).every(([key, value]) => pending[key as keyof typeof basis] === value),
        'DRAFT_CONFLICT', '重试来源已变化，请重新读取存档。');
      const worldview = await restoreWorldview(draft.saveId, owner, pending.generation, pending.worldviewHash);
      const retry = Object.freeze({ ...basis, generation: pending.generation, worldviewHash: pending.worldviewHash, worldview });
      this.pendingWorldviews.set(retry, fingerprint(draft));
      return retry;
    }
    if (resume) {
      if (!origin) throw missingWorldview();
      const worldview = await restoreWorldview(draft.saveId, owner, origin.generation, origin.worldviewHash);
      return { ...basis, worldview, generation: origin.generation, worldviewHash: origin.worldviewHash };
    }
    const generation = crypto.randomUUID();
    const worldview = await withWorldbookLibrary(lib =>
      lib.captureWorldview(draft.saveId, owner, generation, origin?.generation));
    const issued = Object.freeze({ ...basis, generation, worldview, worldviewHash: await worldviewDigest(worldview) });
    if (draft.stageStatus.story === 'ready' && draft.story) this.pendingWorldviews.set(issued, fingerprint(draft));
    return issued;
  }

  // Cleanup follows a successful formal CAS while its save lock is still held. If the library
  // is unavailable, a future capture compacts this namespace; correctness only relies on the witness.
  private async retireWorldviews(saveId: string) {
    await withWorldbookLibrary(lib => lib.forgetWorldviews(saveId,this.database.name)).catch(() => {});
  }

  /** Management CAS is separate from narrative revision: retain the entire draft,
   * increment its CAS revision, and invalidate pre-management summary/phase responses. */
  /** expectedInstance：载入时拿到的实例身份（原存档省略或 null）；存档被导入替换后，旧页面的管理操作一律拒绝。 */
  loadVariableSnapshot(saveId: string): Promise<VariableSnapshot> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves','drafts','saveControls'], 'readonly', tx => variableSnapshot(tx, saveId));
  }

  async savePlayerVariables(expected: VariableSnapshot, edited: unknown): Promise<VariableSnapshot> {
    const saveId = IdSchema.parse(expected.state.saveId);
    // Capture caller-owned editor data before the first asynchronous boundary.
    const basedOn = fingerprint(expected);
    const candidate = structuredClone(edited);
    const session = reserveStageSession(saveId);
    try {
      return await withBrowserLock(saveId, () => transaction(this.database, ['saves','drafts','saveControls'], 'readwrite', async tx => {
        session.check();
        const current = await variableSnapshot(tx, saveId);
        requireData(fingerprint(current) === basedOn, 'REVISION_CONFLICT', '存档、时间线或草稿已变化。请先保留修改，再重新读取。');
        const next = validateVariableEdit(current.state, candidate);
        if (fingerprint(current.state) === fingerprint(next)) return current;
        next.npcManagementRevision = (current.state.npcManagementRevision ?? 0) + 1;
        next.updatedAt = new Date().toISOString();
        const state = GameStateSchema.parse(next);
        const old = current.draft;
        const draft = old && TurnDraftSchema.parse({
          ...createTurnDraft(saveId, state.revision, old.turnId, old.turnKind, old.userInput, old.useVariableStage, old.useWorldStage, old.useEntityStage),
          phonePending: old.phonePending,
          phoneFreeze: old.phoneFreeze,
          draftRevision: old.draftRevision + 1,
        });
        validatePendingChat(state, draft);
        const control = await readControl(tx,saveId) ?? newSaveControl(saveId);
        delete control.storyOrigin;
        control.epoch = `epoch-${crypto.randomUUID()}`;
        delete control.lastUndo;
        delete control.lastNpcManagement;
        await request(tx.objectStore('saves').put(state));
        if (draft) await request(tx.objectStore('drafts').put(draft));
        await writeControl(tx,control);
        return {state, draft, instance:control.instanceId, epoch:control.epoch};
      }), {required:true});
    } finally {
      session.release();
    }
  }

  async setNpcImportance(input: {saveId:string;expectedRevision:number;expectedManagementRevision:number;
    expectedDraftRevision?:number;expectedTurnId?:string;npcId:string;identityKey:string;choice:'ordinary'|'special';operationId:string;
    expectedInstance?:string|null}) {
    const checked = z.strictObject({saveId:IdSchema,expectedRevision:CountSchema,expectedManagementRevision:CountSchema,
      expectedDraftRevision:CountSchema.optional(),expectedTurnId:IdSchema.optional(),npcId:IdSchema,identityKey:z.string().min(1),
      choice:z.enum(['ordinary','special']),operationId:IdSchema,expectedInstance:IdSchema.nullable().optional()}).parse(input);
    const session = reserveStageSession(checked.saveId);
    try { return await withBrowserLock(checked.saveId,()=>transaction(this.database,timelineStores,'readwrite',async tx=>{
      session.check();
      const state=await readStoredState(tx, checked.saveId);
      const raw=await request(tx.objectStore('drafts').get(checked.saveId));
      const draft=raw===undefined?undefined:TurnDraftSchema.parse(raw);
      const stored=await readControl(tx,state.saveId);
      requireData(controlInstance(stored)===(checked.expectedInstance??null),'REVISION_CONFLICT',replacedMessage);
      const control=stored??newSaveControl(state.saveId), signature=fingerprint(checked);
      const instance=control.instanceId?{instance:control.instanceId}:{};
      if(control.lastNpcManagement?.operationId===checked.operationId) {
        requireData(control.lastNpcManagement.request===signature && control.lastNpcManagement.managementRevision===(state.npcManagementRevision??0)
          && state.npc[checked.npcId]?.identityKey===checked.identityKey && state.npc[checked.npcId]?.importancePreference===checked.choice,
          'NPC_MANAGEMENT_CONFLICT','人物管理回执已被后续操作取代');
        return {state,draft,replayed:true,...instance};
      }
      requireData(state.revision===checked.expectedRevision && (state.npcManagementRevision??0)===checked.expectedManagementRevision,
        'REVISION_CONFLICT','存档或人物管理版本已改变');
      requireData(draft?.draftRevision===checked.expectedDraftRevision && draft?.turnId===checked.expectedTurnId,
        'DRAFT_CONFLICT','草稿已改变，请重新读取后管理人物');
      const next=setNpcImportance(state,checked.npcId,checked.identityKey,checked.choice);
      next.npcManagementRevision=(state.npcManagementRevision??0)+1;
      const nextDraft=draft?TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1}):undefined;
      validatePendingChat(next, nextDraft);
      control.epoch=`epoch-${crypto.randomUUID()}`;delete control.lastUndo;
      control.lastNpcManagement={operationId:checked.operationId,request:signature,managementRevision:next.npcManagementRevision};
      await request(tx.objectStore('saves').put(GameStateSchema.parse(next)));
      if(nextDraft)await request(tx.objectStore('drafts').put(nextDraft));
      await writeControl(tx,control);
      return {state:next,draft:nextDraft,replayed:false,...instance};
    })); } finally {session.release();}
  }

  async undoStatus(saveId: string): Promise<UndoStatus> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves', 'saveControls', 'turnUndo'], 'readonly', async tx =>
      inspectUndo(tx, readState(await request(tx.objectStore('saves').get(saveId)), saveId)));
  }

  /** The journal stores the narrative. Only verified records on its active undo suffix retain the exact action. */
  async recentStoryActions(expected: GameState, windowSize: number): Promise<Record<string, string>> {
    return transaction(this.database, ['saves', 'saveControls', 'turnUndo'], 'readonly', async tx => {
      const state = readState(await request(tx.objectStore('saves').get(expected.saveId)), expected.saveId);
      requireData(fingerprint(state) === fingerprint(expected), 'DRAFT_CONFLICT', '读取行动历史时存档已变化。');
      const control = await readControl(tx, state.saveId);
      const records = control?.records ?? [];
      const start = state.journal.length - records.length;
      const actions: Record<string, string> = Object.create(null);
      if (start < 1 || records.some((r, i) => r.turnId !== state.journal[start + i]?.turnId ||
        r.beforeTurnId !== state.journal[start + i - 1]?.turnId)) return actions;
      for (const descriptor of records.slice(-windowSize)) {
        const row = SnapshotSchema.safeParse(await request(tx.objectStore('turnUndo').get([state.saveId, descriptor.turnId])));
        if (row.success && row.data.saveId === state.saveId && row.data.turnId === descriptor.turnId &&
          row.data.beforeTurnId === descriptor.beforeTurnId) actions[descriptor.turnId] = row.data.input;
      }
      return actions;
    });
  }

  /** Consistent read only: use the existing migration projection, never normalize by writing.
   * IDB serializes this transaction with commits/undo; no stage session is reserved. */
  async turnComparison(expected:GameState):Promise<TurnComparison>{
    IdSchema.parse(expected.saveId);
    return transaction(this.database,['saves','drafts','saveControls','turnUndo'],'readonly',async tx=>{
      const current=readState(await request(tx.objectStore('saves').get(expected.saveId)),expected.saveId);
      if(fingerprint(current)!==fingerprint(expected))return {available:false,reason:'stale'};
      try{return await readTurnComparison(tx,current);}catch(error){
        if(error instanceof z.ZodError||error instanceof SyntaxError||error instanceof DataError)return {available:false,reason:'corrupt'};
        throw error;
      }
    });
  }

  /** Persist the editable recalled action separately from the immutable bound draft. */
  async saveUndoInput(expected: TurnDraft, input: string): Promise<void> {
    const value = z.string().max(100000).parse(input);
    return transaction(this.database, ['saves', 'drafts', 'saveControls'], 'readwrite', async tx => {
      const state = await readStoredState(tx, expected.saveId);
      const draft = TurnDraftSchema.parse(await request(tx.objectStore('drafts').get(expected.saveId)));
      requireData(fingerprint(draft) === fingerprint(expected) && awaitingPlayerAction(state, draft), 'DRAFT_CONFLICT', '输入草稿已经变化');
      const control = await readControl(tx, state.saveId);
      requireData(control?.memoryPaused, 'DRAFT_CONFLICT', '不是撤回后的待输入状态');
      control!.input = value; await writeControl(tx, control!);
    });
  }

  async undoTurn(input: TurnUndoRequest): Promise<TurnUndoResult> {
    const { saveId, expectedRevision, operationId } = input;
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision); IdSchema.parse(operationId);
    const session = reserveStageSession(saveId);
    try {
      const result = await withBrowserLock(saveId, () => transaction(this.database, timelineStores, 'readwrite', async tx => {
        session.check();
        const state = await readStoredState(tx, saveId);
        const raw: unknown = await request(tx.objectStore('drafts').get(saveId));
        const draft = raw === undefined ? undefined : TurnDraftSchema.parse(raw);
        const control = await readControl(tx, saveId);
        if (control?.lastUndo?.operationId === operationId) {
          requireData(state.revision === control.lastUndo.revision && draft?.turnId === control.lastUndo.draftTurnId,
            'REVISION_CONFLICT', '撤回结果之后已有新操作');
          return { state, draft: draft!, input: control.input, replayed: true };
        }
        requireData(state.revision === expectedRevision, 'REVISION_CONFLICT', '存档已在另一页面改变，请重新读取');
        requireData(fingerprint(draft) === fingerprint(input.expectedDraft), 'DRAFT_CONFLICT', '草稿已改变，请重新确认撤回');
        requireData(Boolean(control), 'UNDO_UNAVAILABLE', '此存档没有可靠恢复点');
        const restored = await restoreSnapshot(tx, state, control!);
        const next = createTurnDraft(saveId, restored.state.revision, `turn-${crypto.randomUUID()}`, 'regular', '',
          draft?.useVariableStage ?? true, draft?.useWorldStage ?? true, draft?.useEntityStage ?? true);
        const pending = restoreChat(restored.state, draft?.phonePending ?? [], input.chatChoice, restored.phonePending);
        if (pending.length) next.phonePending = pending;
        validatePendingChat(restored.state, next);
        // Retire receipts from the previous branch, including a predecessor receipt
        // whose next-draft ID is now obsolete. Keep the restored appliedCommands.
        const receipts = tx.objectStore('turnReceipts');
        for (const key of await request(receipts.index('saveId').getAllKeys(saveId))) await request(receipts.delete(key));
        control!.lastUndo = { operationId, revision: restored.state.revision, draftTurnId: next.turnId };
        await writeControl(tx, control!);
        await request(tx.objectStore('saves').put(restored.state));
        await request(tx.objectStore('drafts').put(next));
        return { ...restored, draft: next, replayed: false };
      }));
      if (!result.replayed) notifyImages(imageTimelineChange);
      return result;
    } finally { session.release(); }
  }

  /** Capture state and the timeline token together BEFORE starting a summary request. */
  async loadMemoryContext(saveId: string): Promise<{ state: GameState; lineage: MemoryLineage; paused: boolean }> {
    return transaction(this.database, ['saves', 'saveControls'], 'readwrite', async tx => {
      const state = await readStoredState(tx, saveId);
      let control = await readControl(tx, saveId);
      if (!control) { control = newSaveControl(saveId); await writeControl(tx, control); }
      return { state, lineage: { saveId, epoch: control.epoch }, paused: control.memoryPaused };
    });
  }

  async checkMemoryLineage(lineage: MemoryLineage): Promise<void> {
    return transaction(this.database, ['saves', 'saveControls'], 'readonly', async tx => {
      readState(await request(tx.objectStore('saves').get(lineage.saveId)), lineage.saveId);
      await assertMemoryLineage(tx, lineage.saveId, lineage);
    });
  }

  async create(state: GameState): Promise<GameState> {
    const parsed = normalizeOpeningCity(GameStateSchema.parse(state));
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
      return readStoredState(tx, saveId);
    });
  }

  /** instance：导入备份后的实例身份（原存档省略），供删除、人物管理等手动操作作为依据传回。 */
  async loadGame(saveId: string): Promise<{ state: GameState; draft?: TurnDraft; instance?: string }> {
    IdSchema.parse(saveId);
    return transaction(this.database, ['saves', 'drafts', 'saveControls'], 'readwrite', async (tx) => {
      const state = await readStoredState(tx, saveId);
      const rawDraft: unknown = await request(tx.objectStore('drafts').get(saveId));
      const draft = rawDraft === undefined ? undefined : TurnDraftSchema.parse(rawDraft);
      requireData(!draft || draft.saveId === saveId, 'CORRUPT_DRAFT', '草稿主键不符');
      const instance = await storedInstance(tx, saveId);
      return { state, draft, ...(instance ? { instance } : {}) };
    });
  }

  async saveMemoryCompression(batch: CompressionBatch, output: z.infer<typeof MemoryEntrySchema>, lineage: MemoryLineage, signal?: AbortSignal): Promise<GameState> {
    const parsed = CompressionBatchSchema.parse(batch), result = MemoryEntrySchema.parse(output);
    return transaction(this.database, ['saves', 'saveControls'], 'readwrite', async (tx) => {
      await assertMemoryLineage(tx, parsed.saveId, lineage);
      const store = tx.objectStore('saves');
      const current = await readStoredState(tx, parsed.saveId);
      // 从最新整份状态仅替换已核对的记忆批次，不提升世界版本、不写草稿。
      const next = applyCompression(current, parsed, result);
      await request(store.put(next));
      return next;
    }, signal);
  }

  async saveNpcSummary(batch: NpcMemoryBatch, output: z.infer<typeof NpcSummarySchema>[], lineage: MemoryLineage, signal?: AbortSignal): Promise<GameState> {
    const parsed = NpcMemoryBatchSchema.parse(batch), result = z.array(NpcSummarySchema).parse(output);
    return transaction(this.database, ['saves', 'saveControls'], 'readwrite', async (tx) => {
      await assertMemoryLineage(tx, parsed.saveId, lineage);
      const store = tx.objectStore('saves');
      const current = await readStoredState(tx, parsed.saveId);
      const next = GameStateSchema.parse(applyNpcSummary(current, parsed, result));
      await request(store.put(next));
      return next;
    }, signal);
  }

  async list(): Promise<SaveSummary[]> {
    return transaction(this.database, ['saves', 'saveControls', theaterVersionStore,'imageVersions'], 'readonly', async (tx) => {
      const records = await rawRecords(tx.objectStore('saves'));
      const controls = await rawRecords(tx.objectStore('saveControls'));
      const imageVersions = new Map((await rawRecords(tx.objectStore('imageVersions'))).map(({key,value})=>[key,value]));
      const theaterVersions = new Map((await rawRecords(tx.objectStore(theaterVersionStore))).map(({ key, value }) => [key, value]));
      const instances = new Map<IDBValidKey, string>();
      // 只取实例身份；控制记录损坏不应让整个列表不可用（此时删除会因身份不符被拒绝，不会误删）。
      for (const { key, value } of controls) {
        const id = (value as { instanceId?: unknown } | null)?.instanceId;
        if (typeof key === 'string' && typeof id === 'string') instances.set(key, id);
      }
      return records.map(({ key, value }) => {
        const summary = listRecord(key, value), instance = typeof key === 'string' ? instances.get(key) : undefined;
        const theaterVersion = theaterVersions.get(key), imageVersion=imageVersions.get(key);
        return summary.status === 'readable' ? { ...summary, ...(instance ? { instance } : {}),
          ...(typeof imageVersion==='string'?{imageVersion}:{}),
          ...(typeof theaterVersion === 'string' ? { theaterVersion } : {}) } : summary;
      });
    });
  }

  // Recovery export reads a consistent, raw snapshot, irrespective of save/schema version.
  // Association uses the actual save key, never a saveId recovered from untrusted contents.
  async exportRaw(storageKey: IDBValidKey): Promise<RawSaveExport> {
    requireData(storageKey !== undefined && storageKey !== null, 'INVALID_KEY', '未选择存档记录');
    return transaction(this.database, timelineStores, 'readonly', async tx => {
      const saves = await rawRecords(tx.objectStore('saves'), storageKey);
      requireData(saves.length === 1, 'NOT_FOUND', '此存档已不存在，请刷新列表。');
      const drafts = await rawRecords(tx.objectStore('drafts'), storageKey);
      const turnReceipts = await rawRecords(tx.objectStore('turnReceipts').index('saveId'), storageKey);
      return { format: 'heijin-raw-save', version: 1, records: { saves, drafts, turnReceipts,
        turnUndo: await rawRecords(tx.objectStore('turnUndo').index('saveId'), storageKey),
        saveControls: await rawRecords(tx.objectStore('saveControls'), storageKey) } };
    });
  }

  /** 备份导出：只读可读取的存档，迁移到当前版本；草稿不合法或过期就跳过，不影响导出。 */
  async exportBackup(saveIds: readonly string[], includeImages=true): Promise<BackupEntry[]> {
    requireData(saveIds.length > 0, 'INVALID_KEY', '未选择存档');
    for (const saveId of saveIds) IdSchema.parse(saveId);
    return transaction(this.database, ['saves', 'drafts', ...theaterStores, theaterVersionStore,...imageStores], 'readonly', async (tx) => {
      const entries: BackupEntry[] = [];
      let remainingBytes = maxBackupBytes;
      for (const saveId of saveIds) {
        const state = readState(await request(tx.objectStore('saves').get(saveId)), saveId);
        const { draft } = compatibleDraft(state, await request(tx.objectStore('drafts').get(saveId)), true);
        const theaterVersion = await request<string | undefined>(tx.objectStore(theaterVersionStore).get(saveId));
        const images = includeImages ? await exportImages(tx, state, remainingBytes) : undefined;
        if (images) remainingBytes -= images.files.reduce((sum, file) => sum + file.data.length, 0);
        const imageVersion=images?await request<string>(tx.objectStore('imageVersions').get(saveId)):undefined;
        entries.push({ ...(images?{images,imageVersion}:{}), summary: backupSummary(state), state, ...(draft ? { draft } : {}),
          theaters: await exportTheaters(tx, saveId), ...(theaterVersion ? { theaterVersion } : {}) });
      }
      return entries;
    });
  }

  /**
   * 导入前比较。在一个只读事务中按真实主键取得本机该存档在五个时间线仓库中的全部原始记录，
   * 生成仅供本次确认的一次性凭据；不写入、不迁移任何记录。
   */
  async compareBackup(entry: BackupSource): Promise<BackupComparison> {
    const backup = normalizeOpeningCity(GameStateSchema.parse(entry.state));
    const backupDraft = compatibleDraft(backup, entry.draft).draft;
    const theaters = entry.theaters === undefined ? undefined : parseTheaters(entry.theaters, backup.saveId);
    const images=entry.images===undefined?undefined:parseImages(entry.images,backup);
    const { snapshot, theaterDifference, imageDifference } = await transaction(this.database, [...timelineStores, oracleStore, ...theaterStores,...imageStores], 'readonly', async tx => {
      const snapshot = await readSnapshot(tx, backup.saveId);
      const theaterDifference = theaters !== undefined && fingerprint(await exportTheaters(tx, backup.saveId)) !== fingerprint(
        [...theaters].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let imageDifference = false;
      if (images) {
        const local = snapshot.imageVersions.length ? await request(tx.objectStore('imageCollections').get(backup.saveId)) : undefined;
        imageDifference = !local || fingerprint(local) !== fingerprint({pictures: images.pictures, anchors: images.anchors});
        if (!imageDifference) {
          const files = tx.objectStore('imageFiles');
          imageDifference = await request(files.index('saveId').count(backup.saveId)) !== images.files.length;
          for (const file of images.files) {
            if (imageDifference) break;
            imageDifference = (await request(files.get([backup.saveId, file.id])))?.data !== file.data;
          }
        }
      }
      return { snapshot, theaterDifference, imageDifference };
    });
    const confirmation = Object.freeze({}) as BackupImportConfirmation;
    confirmations.set(confirmation, { repository: this, saveId: backup.saveId, incoming: incomingFingerprint(backup, backupDraft, theaters), images, snapshot });
    if (!snapshot.saves.length) return emptySnapshot(snapshot) ? { kind: 'new', confirmation } : {
      kind: 'overwrite-orphaned', confirmation, records: { drafts: snapshot.drafts.length, turnReceipts: snapshot.turnReceipts.length,
        turnUndo: snapshot.turnUndo.length, saveControls: snapshot.saveControls.length } };
    let local: GameState;
    // 解析用副本：迁移与校验绝不能改动作为确认依据的原始快照。
    try { local = readState(structuredClone(snapshot.saves[0].value), backup.saveId); } catch { return { kind: 'overwrite-unreadable', confirmation }; }
    const rawDraft = snapshot.drafts[0]?.value === undefined ? undefined : structuredClone(snapshot.drafts[0].value);
    const localDraft = rawDraft === undefined ? undefined : TurnDraftSchema.safeParse(rawDraft);
    const differences = {
      ...(imageDifference ? {images:true} : {}),
      ...(theaterDifference ? { theaters: true } : {}),
      state: fingerprint(local) !== fingerprint(backup),
      draft: localDraft === undefined ? backupDraft !== undefined
        : !localDraft.success || backupDraft === undefined || fingerprint(localDraft.data) !== fingerprint(backupDraft),
    };
    const summary = backupSummary(local);
    return differences.state || differences.draft || differences.theaters || differences.images
      ? { kind: 'overwrite', local: summary, differences, confirmation }
      : { kind: 'same', local: summary, confirmation };
  }

  /**
   * 备份导入。必须带上 compareBackup 给出的凭据；凭据一次有效。
   * 本机已有记录（包括无法读取的记录）时还必须显式 overwrite: true。
   * 同页有阶段会话或其他标签持有工作流锁时拒绝；写事务内先重新读取本机全部相关原始记录，
   * 与确认时逐项比较，完全一致才清理并写入，任一变化即以 IMPORT_CONFLICT 拒绝、什么都不改。
   * 导入的草稿递增 draftRevision（与 NPC 管理相同），使此前发出的阶段响应不能再写入。
   * 写入新的实例身份，旧页面凭旧身份发起的删除与人物管理随之失效。
   */
  async importBackup(entry: BackupSource, confirmation: BackupImportConfirmation,
    options: { overwrite?: boolean } = {}): Promise<GameState> {
    return (await this.importBackupWithVersion(entry, confirmation, options)).state;
  }

  async importBackupWithVersion(entry: BackupSource, confirmation: BackupImportConfirmation,
    options: { overwrite?: boolean } = {}): Promise<{ state: GameState; theaterVersion?: string; imageVersion?: string }> {
    const state = normalizeOpeningCity(GameStateSchema.parse(entry.state));
    const { draft } = compatibleDraft(state, entry.draft);
    const theaters = entry.theaters === undefined ? undefined : parseTheaters(entry.theaters, state.saveId);
    const images=entry.images===undefined?undefined:parseImages(entry.images,state);
    const confirmed = confirmations.get(confirmation);
    confirmations.delete(confirmation);
    requireData(confirmed?.repository === this && confirmed.saveId === state.saveId
      && confirmed.incoming === incomingFingerprint(state, draft, theaters) && sameValue(confirmed.images, images),
      'IMPORT_CONFIRMATION_INVALID', '导入确认已失效或与所选备份不符，请重新选择文件导入。');
    requireData(emptySnapshot(confirmed.snapshot) || options.overwrite === true, 'SAVE_EXISTS', confirmed.snapshot.saves.length
      ? '本机已有这份存档，需要确认覆盖后才能导入。' : '本机留有这份存档的残留记录，需要确认覆盖后才能导入。');
    const session = reserveStageSession(state.saveId);
    try {
      const result = await withBrowserLock(state.saveId, async () => {
        const imported = await transaction(this.database, [...timelineStores, oracleStore, bookStore, ...theaterStores, theaterVersionStore,...imageStores], 'readwrite', async (tx) => {
          session.check();
          const current = await readSnapshot(tx, state.saveId);
          requireData(sameSnapshot(current, confirmed.snapshot), 'IMPORT_CONFLICT',
            '本机存档在确认后发生了变化，本次没有导入，本机数据保持原样。请重新选择文件导入。');
          if(images) await restoreImages(tx,images);
          else if(current.imageVersions.length) requireData((current.saves[0]?.value as {createdAt?:string})?.createdAt===state.createdAt,'IMAGE_BACKUP','此备份缺少图片，无法确认本机图片的身份。');
          if (theaters !== undefined) {
            await clearTheaters(tx, state.saveId);
            for (const entry of theaters) await putTheater(tx, entry);
          } else if (current.theaters.length) {
            const local = current.saves[0]?.value as { createdAt?: unknown } | undefined;
            requireData(local?.createdAt === state.createdAt, 'THEATER_BACKUP',
              '旧备份无法核对已有小剧场的存档身份。请先导出本机存档，再使用含小剧场的备份覆盖。');
          }
          const localRevision = (current.drafts[0]?.value as { draftRevision?: unknown } | undefined)?.draftRevision;
          const floor = Number.isSafeInteger(localRevision) && (localRevision as number) >= 0 ? localRevision as number : -1;
          await deleteRecords(tx, state.saveId);
          await request(tx.objectStore('saves').add(state));
          // 新实例身份：此前载入的旧页面凭旧身份发起的删除、人物管理都会被拒绝；新 epoch 同时使旧记忆 lineage 失效。
          await writeControl(tx, { ...newSaveControl(state.saveId), instanceId: `instance-${crypto.randomUUID()}` });
          if (draft) await request(tx.objectStore('drafts').put(TurnDraftSchema.parse({
            ...draft, draftRevision: Math.max(draft.draftRevision, floor) + 1 })));
          // Legacy files leave the local theaters untouched and cannot certify their backup.
          return { state, ...(images?{imageVersion:await request<string>(tx.objectStore('imageVersions').get(state.saveId))}:{}), theaterVersion: theaters === undefined ? undefined : await advanceTheaterVersion(tx, state.saveId) };
        });
        await this.retireWorldviews(state.saveId);
        return imported;
      });
      notifyTheaterChange();
      notifyImages(imageTimelineChange);
      return result;
    } finally { session.release(); }
  }

  // Explicit recovery action, separate from the revision-checked normal delete path.
  // Recheck within the write transaction: never delete a record that has become readable.
  async deleteUnreadable(storageKey: IDBValidKey): Promise<void> {
    requireData(storageKey !== undefined && storageKey !== null, 'INVALID_KEY', '未选择存档记录');
    await transaction(this.database, [...timelineStores, oracleStore, bookStore, ...historyStores, ...theaterStores, theaterVersionStore,...imageStores], 'readwrite', async tx => {
      const records = await rawRecords(tx.objectStore('saves'), storageKey);
      requireData(records.length === 1, 'NOT_FOUND', '此存档已不存在，请刷新列表。');
      requireData(listRecord(storageKey, records[0].value).status === 'unreadable', 'SAVE_READABLE', '此存档现在可以读取，请刷新列表后重新选择。');
      // V1 raw export does not contain binary history payloads. Until a reversible
      // rescue format exists, even orphaned/corrupt history must prevent deletion.
      // Check both indexes by the physical save key in this same write transaction;
      // neither a successful raw download nor unreadable metadata permits deletion.
      for (const name of historyStores) requireData(
        await request(tx.objectStore(name).index('saveId').count(storageKey)) === 0,
        'HISTORY_RECOVERY_REQUIRED',
        '已阻止删除：此存档仍有关联的手动历史收藏或残留载荷，原始数据导出不包含这些收藏。本次未删除任何数据，请保留本机数据并联系维护者恢复。');
      for (const name of theaterStores) requireData(await request(tx.objectStore(name).index('saveId').count(storageKey)) === 0,
        'THEATER_RECOVERY_REQUIRED', '已阻止删除：原始数据导出不包含这份存档的小剧场，请先恢复存档。');
      requireData(!await request(tx.objectStore('imageFiles').index('saveId').count(storageKey)) && !await request(tx.objectStore('imageCollections').getKey(storageKey)), 'IMAGE_RECOVERY_REQUIRED','原始数据不包含图片，请先恢复存档。');
      await clearImages(tx,storageKey);
      await request(tx.objectStore(theaterVersionStore).delete(storageKey));
      await deleteRecords(tx, storageKey);
    });
    notifyTheaterChange();
    notifyImages(imageTimelineChange);
  }

  // M1 独立领域命令兼容入口；完整回合必须走 commitTurn，不拼接 save/saveDraft。
  async save(saveId: string, expectedRevision: number, turnId: string,
    commands: readonly DomainCommand[]): Promise<GameState> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    return transaction(this.database, timelineStores, 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = await readStoredState(tx, saveId);
      const next = commitCommands(current, turnId, expectedRevision, commands);
      if (next.revision !== current.revision) {
        const control = await readControl(tx, saveId) ?? newSaveControl(saveId);
        await clearUndoRecords(tx, saveId); control.records = []; control.notice = 'legacy_write';
        delete control.storyOrigin;
        control.epoch = `epoch-${crypto.randomUUID()}`; delete control.lastUndo; control.input = '';
        await writeControl(tx, control); await request(store.put(next));
      }
      return next;
    });
  }

  // 完整回合唯一入口；摘要计算在事务外，事务中只等待同一 IDB 的请求。
  async commitTurn(input: TurnSubmission, expectedInstance?: string | null): Promise<TurnCommitResult> {
    const parsed = TurnSubmissionSchema.parse(input);
    const session = reserveStageSession(parsed.draft.saveId);
    try {
      return await withBrowserLock(parsed.draft.saveId, async () => {
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(fingerprint(Object.hasOwn(input.draft, 'useEntityStage') ? parsed :
            { ...parsed, draft: input.draft })), // Compare pre-upgrade replays against their original receipt.
        );
        const requestHash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        const sourceHash = await storySourceHash(parsed.draft);
        // Receipt replays never need a retired world's snapshot. Recheck the witness inside the write transaction.
        const origin = await transaction(this.database,['turnReceipts','saveControls'],'readonly',async tx => {
          if (await request(tx.objectStore('turnReceipts').get([parsed.draft.saveId,parsed.draft.turnId]))) return;
          return (await readControl(tx,parsed.draft.saveId))?.storyOrigin;
        });
        if (origin && origin.sourceHash === sourceHash)
          await restoreWorldview(parsed.draft.saveId,origin.owner,origin.generation,origin.worldviewHash);
        const nextTurnId = `turn-${crypto.randomUUID()}`;
        const commit = (quotaFallback: boolean) => transaction(
          this.database,
          timelineStores,
          'readwrite',
          async (tx) => {
            session.check();
            const saves = tx.objectStore('saves'),
              drafts = tx.objectStore('drafts'),
              receipts = tx.objectStore('turnReceipts');
            const state = await readStoredState(tx, parsed.draft.saveId);
            const rawDraft: unknown = await request(drafts.get(parsed.draft.saveId));
            const current = TurnDraftSchema.parse(rawDraft);
            if (expectedInstance !== undefined)
              requireData(await storedInstance(tx,state.saveId) === expectedInstance,'DRAFT_CONFLICT',replacedMessage);
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
            let next: GameState;
            try {
              validateTurnCandidates(state, current);
            } catch (error) {
              attachFailureDiagnostic(error, { phase: 'commit_validation' });
              throw error;
            }
            const control = await readControl(tx, state.saveId);
            if (!origin || origin.owner !== this.database.name || !control?.storyOrigin || controlInstance(control) !== origin.instance ||
                fingerprint(control.storyOrigin) !== fingerprint(origin) || origin.sourceHash !== sourceHash)
              throw missingWorldview();
            try {
              next = settleTurn(state, current, new Date().toISOString());
            } catch (error) {
              attachFailureDiagnostic(error, { phase: 'commit_validation' });
              throw error;
            }
            requireData(!next.journal.some((entry) => entry.turnId === nextTurnId), 'DUPLICATE_TURN', '下一回合 ID 重复');
            const draft = createTurnDraft(
              state.saveId,
              next.revision,
              nextTurnId,
              'regular',
              parsed.nextAction,
              parsed.useVariableStage,
              parsed.useWorldStage, parsed.useEntityStage ?? current.useEntityStage,
            );
            const receipt = ReceiptSchema.parse({
              saveId: state.saveId,
              turnId: current.turnId,
              requestHash,
              revision: next.revision,
              nextTurnId,
            });
            await recordUndo(tx, state, current, quotaFallback);
            await request(saves.put(next));
            await request(drafts.put(draft));
            await request(receipts.add(receipt));
            return { state: next, draft, replayed: false };
          },
        );
        let result: TurnCommitResult;
        try { result = await commit(false); } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          // The entire first transaction aborted. Revalidate everything, keep the formal
          // save first, and explicitly record that this turn has no undo point. No AI retry.
          result = await commit(true);
        }
        if (!result.replayed) await this.retireWorldviews(parsed.draft.saveId);
        return result;
      });
    } finally {
      session.release();
    }
  }

  /** expectedInstance：列表摘要里的 instance（原存档为 null）。存档被导入替换后，旧列表即使版本号相同也不能删除。 */
  async delete(saveId: string, expectedRevision: number, expectedInstance: string | null = null, expectedManagementRevision = 0): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    if (expectedInstance !== null) IdSchema.parse(expectedInstance);
    // Deletion may interrupt an active stage. Cleanup only the immutable keys observed
    // before deletion, even if another tab immediately recreates the same save.
    const keys = await withWorldbookLibrary(lib => lib.worldviewKeys(saveId, this.database.name)).catch(() => []);
    await transaction(this.database, [...timelineStores, oracleStore, bookStore, ...historyStores, ...theaterStores, theaterVersionStore,...imageStores], 'readwrite', async (tx) => {
      const current = await readStoredState(tx, saveId);
      requireData(await storedInstance(tx, saveId) === expectedInstance, 'REVISION_CONFLICT', replacedMessage);
      requireData(current.revision === expectedRevision && (current.npcManagementRevision ?? 0) === expectedManagementRevision,
        'REVISION_CONFLICT', '删除时存档版本已变化');
      await clearImages(tx,saveId);
      await clearManualHistory(tx, saveId);
      await clearTheaters(tx, saveId);
      await request(tx.objectStore(theaterVersionStore).delete(saveId));
      await deleteRecords(tx, saveId);
    });
    notifyTheaterChange();
    notifyImages(imageTimelineChange);
    if (keys.length) await withWorldbookLibrary(lib => lib.forgetWorldviewKeys(keys)).catch(() => {});
  }

  /** Called under the same execution lock as Story. The IDB CAS also rejects a replaced save or stale reply. */
  async appendPhoneExchange(state: GameState, basedOn: TurnDraft | undefined, instance: string | null, value: PhoneOperation, signal: AbortSignal) {
    const exchange = PhoneOperation.parse(value);
    return transaction(this.database, ['saves','drafts','saveControls'], 'readwrite', async tx => {
      const current = await readStoredState(tx, state.saveId);
      const store = tx.objectStore('drafts');
      const raw = await request(store.get(state.saveId));
      const draft = raw === undefined ? undefined : TurnDraftSchema.parse(raw);
      requireData(await storedInstance(tx,state.saveId) === instance && current.revision === state.revision &&
        current.npcManagementRevision === state.npcManagementRevision && fingerprint(draft) === fingerprint(basedOn),
        'DRAFT_CONFLICT','存档或待结算聊天已变化，请重新读取');
      const contacts = isPrivate(exchange) ? [exchange.reply.npcId]
        : 'invitees' in exchange.action ? exchange.action.invitees : [];
      requireData(current.turnNumber > 0 && (!draft || awaitingPlayerAction(current,draft)) &&
        contacts.every(id => current.npc[id]?.phoneContact?.status === 'known') &&
        exchange.baseTurnId === current.journal.at(-1)?.turnId && exchange.at === current.worldClock,
        'PHONE_TARGET','当前回合或号码不能发送消息');
      const next = TurnDraftSchema.parse({ ...(draft ?? createTurnDraft(state.saveId,state.revision,'turn-'+crypto.randomUUID(),'regular','')),
        draftRevision:(draft?.draftRevision ?? 0)+1, phonePending:[...(draft?.phonePending ?? []),exchange] });
      validatePendingChat(current,next);
      await request(store.put(next));
      return next;
    }, signal);
  }

  // 唯一允许绑定行动的入口：空待输入草稿，或正文失败/取消且尚无任何候选的已绑定草稿（重新绑定为全新草稿）。
  // 输入绑定后仍不可由saveDraft改写；不提升正式revision。
  async bindTurnAction(expected: TurnDraft, action: string, useVariableStage: boolean, useWorldStage: boolean, useEntityStage = expected.useEntityStage, expectedInstance?: string | null): Promise<TurnDraft> {
    const snapshot = TurnDraftSchema.parse(expected), userInput = z.string().trim().min(1).max(100000).parse(action);
    const session = reserveStageSession(snapshot.saveId);
    try {
      return await withBrowserLock(snapshot.saveId, () => transaction(this.database, ['saves', 'drafts', 'saveControls'], 'readwrite', async tx => {
        session.check();
        const state = await readStoredState(tx, snapshot.saveId);
        const store = tx.objectStore('drafts'), current = TurnDraftSchema.parse(await request(store.get(snapshot.saveId)));
        requireData(fingerprint(current) === fingerprint(snapshot), 'DRAFT_CONFLICT', '行动草稿已被其他操作更新');
        if (expectedInstance !== undefined) requireData(await storedInstance(tx,state.saveId) === expectedInstance,'DRAFT_CONFLICT',replacedMessage);
        requireData(awaitingPlayerAction(state, current) || rebindableAfterStoryStop(state, current), 'DRAFT_CONFLICT', '只能为未生成的待输入回合绑定行动');
        const next = TurnDraftSchema.parse({ ...createTurnDraft(current.saveId, state.revision, current.turnId, 'regular', userInput, useVariableStage, useWorldStage, useEntityStage), ...(current.phonePending?.length ? {phonePending:current.phonePending,phoneFreeze:freezeChat(current.phonePending)} : {}), draftRevision: current.draftRevision + 1 });
        const control = await readControl(tx, state.saveId) ?? newSaveControl(state.saveId);
        control.input = ''; control.memoryPaused = false; delete control.lastUndo; delete control.storyOrigin;
        await writeControl(tx, control);
        await request(store.put(next)); return next;
      }), { required: true });
    } finally { session.release(); }
  }

  private async oracleSnapshot(tx: IDBTransaction, saveId: string) {
    readState(await request(tx.objectStore('saves').get(saveId)), saveId);
    let control = await readControl(tx, saveId);
    if (!control) {
      control = newSaveControl(saveId);
      await writeControl(tx, control);
    }
    return { ...await readSheet(tx, saveId), instance: controlInstance(control), epoch: control.epoch };
  }

  async readOracleNote(saveId: string) {
    return transaction(this.database, ['saves', 'saveControls', oracleStore], 'readwrite', tx => this.oracleSnapshot(tx, saveId));
  }

  private async editOracleNote(saveId: string, expected: OracleEditBasis, edit: (current: Awaited<ReturnType<typeof readSheet>>) => void) {
    return transaction(this.database, ['saves', 'saveControls', oracleStore], 'readwrite', async tx => {
      const { instance, epoch, ...sheet } = await this.oracleSnapshot(tx, saveId);
      requireData(sheet.saveId === expected.saveId && instance === expected.instance && epoch === expected.epoch && sheet.version === expected.version,
        'REVISION_CONFLICT', '存档、纸条或历史已变化，请重新打开控制台后编辑。');
      edit(sheet);
      return { ...await writeSheet(tx, sheet), instance, epoch };
    });
  }

  async writeOracleNote(saveId: string, expected: OracleEditBasis, text: string, once: boolean) {
    return this.editOracleNote(saveId, expected, sheet => {
      sheet.note = text.trim() ? { id: crypto.randomUUID(), text, once } : null;
      sheet.history = rememberPaper(sheet.history, text);
    });
  }

  async clearOracleNote(saveId: string, expected: OracleEditBasis, editorText: string) {
    return this.editOracleNote(saveId, expected, sheet => {
      sheet.note = null;
      sheet.history = rememberPaper(sheet.history, editorText);
    });
  }

  async clearOracleHistory(saveId: string, expected: OracleEditBasis) {
    return this.editOracleNote(saveId, expected, sheet => { sheet.history = []; });
  }

  // StoryStage holds the browser execution lock. This transaction only replaces the
  // selected draft after the full CAS and eligibility check, and never writes GameState.
  async saveRecoveredStory(basedOn: TurnDraft, story: NonNullable<TurnDraft['story']>,
    selection: LegacyNotificationSelection, signal?: AbortSignal, lease?: StoryWorldview, writing?: TurnDraft['storyWriting'], deliveredNoteId?: string): Promise<TurnDraft> {
    const base = TurnDraftSchema.parse(basedOn);
    const hash = lease && await checkStoryPublication(base,rerollStory(base,story,writing),lease);
    return transaction(this.database, ['saves','drafts','saveControls', oracleStore], 'readwrite', async tx => {
      const state = await readStoredState(tx,base.saveId);
      const store = tx.objectStore('drafts');
      const current = TurnDraftSchema.parse(await request(store.get(base.saveId)));
      requireData(fingerprint(current) === fingerprint(base), 'DRAFT_CONFLICT', '草稿已被其他操作更新');
      const recovery = authorizeLegacyNotificationRecovery(state,current,selection);
      const replacement = rerollStory(current,story,writing);
      validateRecoveredStory(state,current.story!,replacement.story!,recovery);
      validateDraftUpdate(current,replacement);
      const next = TurnDraftSchema.parse({ ...replacement, legacyNotificationRecovery:recovery });
      if (lease && hash) await publishStoryOrigin(tx, base.saveId, lease, hash, deliveredNoteId);
      await request(store.put(next));
      return next;
    },signal);
  }

  /**
   * basedOn：调用方据以构造 next 的草稿。提供时要求库中草稿与它逐项相同，
   * 不只看 draftRevision 数字，防止时间线被替换（如导入备份）后迟到的旧响应恰好对上版本号。
   */
  async saveDraft(draft: TurnDraft, expectedDraftRevision: number | null, signal?: AbortSignal, basedOn?: TurnDraft, lease?: StoryWorldview, deliveredNoteId?: string): Promise<TurnDraft> {
    const next = TurnDraftSchema.parse(draft);
    const base = basedOn === undefined ? undefined : TurnDraftSchema.parse(basedOn);
    if (lease) requireData(lease.turnId === next.turnId && lease.baseRevision === next.baseSaveRevision,
      'DRAFT_CONFLICT', '请求来源与当前回合不符。');
    const publish = lease && base && (next.storyRevision !== base.storyRevision ||
      next.failures.length > base.failures.length && next.failures.at(-1)?.stage === 'story');
    const hash = publish ? await checkStoryPublication(base,next,lease) : undefined;
    return transaction(this.database, ['saves', 'drafts', 'saveControls', oracleStore], 'readwrite', async (tx) => {
      const current = await readStoredState(tx, next.saveId);
      requireData(current.revision === next.baseSaveRevision, 'REVISION_CONFLICT', '草稿依赖的正式版本已失效');
      const store = tx.objectStore('drafts');
      const raw: unknown = await request(store.get(next.saveId));
      if (expectedDraftRevision === null) {
        requireData(raw === undefined && next.draftRevision === 0 && next.storyRevision === 0
          && next.executionRevision === 0 && next.requestedStages.length === 0
          && next.stageRequestRevisions.variables === 0 && next.stageRequestRevisions.world === 0
          && !next.story && !next.entities && !next.variables && !next.world, 'DRAFT_CONFLICT', '初始草稿已存在或版本不为零');
      } else {
        const old = TurnDraftSchema.parse(raw);
        requireData(old.draftRevision === expectedDraftRevision, 'DRAFT_CONFLICT', '草稿已被其他操作更新');
        requireData(!base || fingerprint(old) === fingerprint(base), 'DRAFT_CONFLICT', '草稿已被其他操作更新');
        validateDraftUpdate(old, next);
      }
      if (lease) {
        if (hash) await publishStoryOrigin(tx, next.saveId, lease, hash,
          next.story && next.stageStatus.story === 'ready' && next.storyRevision !== base?.storyRevision ? deliveredNoteId : undefined);
        else {
          const control = await checkStoryLease(tx, next.saveId, lease);
          if (control.storyOrigin?.generation !== lease.generation || control.storyOrigin.worldviewHash !== lease.worldviewHash)
            throw missingWorldview();
        }
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

  async deleteDraft(saveId: string, expectedDraftRevision: number, expected?: TurnDraft, instance?: string | null): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedDraftRevision);
    return transaction(this.database, ['drafts','saveControls'], 'readwrite', async (tx) => {
      const store = tx.objectStore('drafts');
      const old = TurnDraftSchema.parse(await request(store.get(saveId)));
      requireData(old.draftRevision === expectedDraftRevision && (!expected || fingerprint(expected) === fingerprint(old)) && (instance === undefined || await storedInstance(tx,saveId) === instance), 'DRAFT_CONFLICT', '草稿版本冲突');
      const control = await readControl(tx, saveId);
      if (control) {
        delete control.storyOrigin;
        control.epoch = `epoch-${crypto.randomUUID()}`;
        await writeControl(tx, control);
      }
      if (old.phonePending?.length || (expected && old.turnKind === 'regular')) {
        const reset = createTurnDraft(saveId,old.baseSaveRevision,'turn-'+crypto.randomUUID(),'regular','',old.useVariableStage,old.useWorldStage,old.useEntityStage);
        await request(store.put({ ...reset, draftRevision:old.draftRevision+1, phonePending:old.phonePending }));
      } else await request(store.delete(saveId));
    });
  }
}
