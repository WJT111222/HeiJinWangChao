import { setNpcImportance } from '../../domain/npc/profiles';
import { timelineStores, newSaveControl, readControl, writeControl, controlInstance, clearUndoRecords, recordUndo, inspectUndo, restoreSnapshot, assertMemoryLineage, readTurnComparison } from './turnUndo';
import type { MemoryLineage, UndoStatus, TurnComparison } from './turnUndo';
import { request, transaction } from './idb';
import { CountSchema, DataError, IdSchema, requireData } from '../../domain/common';
import { commitCommands, fingerprint } from '../../domain/commands';
import { z } from 'zod';
import type { DomainCommand } from '../../domain/commands';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { normalizeOpeningCity } from '../../domain/openingCity';
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
import { backupSummary, compatibleDraft } from './backup';
import type { BackupEntry } from './backup';

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
 *   且未结算草稿也相同。导入只会清掉本机撤回与提交回执，UI 应显示「已是最新」。
 * - overwrite：本机存档可读取，但正式存档或草稿至少一项不同；differences 指明哪一项。
 * - overwrite-unreadable：本机同 ID 记录存在但无法读取。
 * - overwrite-orphaned：本机没有正式存档，但留有同 ID 的草稿、回执、撤回或控制记录；导入会清除它们，
 *   因此同样需要明确覆盖，不能当作新建。
 * 每种结果都附带 confirmation：它同时绑定本机快照与当时比较的备份内容；导入时备份内容必须与确认时完全一致，
 * 并在写事务内按它重新核对本机全部相关记录。
 */
export type BackupComparison =
  | { kind: 'new'; confirmation: BackupImportConfirmation }
  | { kind: 'same'; local: BackupEntry['summary']; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite'; local: BackupEntry['summary']; differences: { state: boolean; draft: boolean }; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite-unreadable'; confirmation: BackupImportConfirmation }
  | { kind: 'overwrite-orphaned'; records: { drafts: number; turnReceipts: number; turnUndo: number; saveControls: number }; confirmation: BackupImportConfirmation };

/** 某个存储键在五个时间线仓库中的全部原始记录，按真实主键读取，不解析、不迁移。 */
interface LocalSnapshot {
  saves: RawSaveRecord[];
  drafts: RawSaveRecord[];
  turnReceipts: RawSaveRecord[];
  turnUndo: RawSaveRecord[];
  saveControls: RawSaveRecord[];
}
const snapshotStores = ['saves', 'drafts', 'turnReceipts', 'turnUndo', 'saveControls'] as const;
const confirmations = new WeakMap<BackupImportConfirmation, { repository: SaveRepository; saveId: string; incoming: string; snapshot: LocalSnapshot }>();
const emptySnapshot = (snapshot: LocalSnapshot) => snapshotStores.every((name) => snapshot[name].length === 0);
/** 备份条目的确定性内容指纹：规范化后的正式存档与兼容草稿（同步计算，可在事务外比较）。 */
const incomingFingerprint = (state: GameState, draft: TurnDraft | undefined) => fingerprint({ state, draft: draft ?? null });
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
export interface TurnUndoRequest { saveId: string; expectedRevision: number; expectedDraft?: TurnDraft; operationId: string }


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
  if (raw.schemaVersion !== state.schemaVersion || raw.openingCityId === undefined)
    await request(store.put(state));
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

async function readSnapshot(tx: IDBTransaction, key: IDBValidKey): Promise<LocalSnapshot> {
  return {
    saves: await rawRecords(tx.objectStore('saves'), key),
    drafts: await rawRecords(tx.objectStore('drafts'), key),
    turnReceipts: await rawRecords(tx.objectStore('turnReceipts').index('saveId'), key),
    turnUndo: await rawRecords(tx.objectStore('turnUndo').index('saveId'), key),
    saveControls: await rawRecords(tx.objectStore('saveControls'), key),
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
  await request(tx.objectStore('saveControls').delete(key));
  await request(tx.objectStore('saves').delete(key));
}

export class SaveRepository {
  private constructor(private readonly database: IDBDatabase) {}

  static open(name = 'heijinwangchao', factory: IDBFactory = globalThis.indexedDB): Promise<SaveRepository> {
    if (!factory) return Promise.reject(new DataError('STORAGE_UNAVAILABLE', '当前环境不支持 IndexedDB'));
    return new Promise((resolve, reject) => {
      // IndexedDB 结构版本独立于每个存档的 schemaVersion。
      const operation = factory.open(name, 3);
      operation.onupgradeneeded = () => {
        const db = operation.result;
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'saveId' });
        if (!db.objectStoreNames.contains('turnUndo'))
          db.createObjectStore('turnUndo', { keyPath: ['saveId', 'turnId'] }).createIndex('saveId', 'saveId');
        if (!db.objectStoreNames.contains('saveControls')) db.createObjectStore('saveControls', { keyPath: 'saveId' });
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

  /** Management CAS is separate from narrative revision: retain the entire draft,
   * increment its CAS revision, and invalidate pre-management summary/phase responses. */
  /** expectedInstance：载入时拿到的实例身份（原存档省略或 null）；存档被导入替换后，旧页面的管理操作一律拒绝。 */
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
      return await withBrowserLock(saveId, () => transaction(this.database, timelineStores, 'readwrite', async tx => {
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
          draft?.useVariableStage ?? true, draft?.useWorldStage ?? true);
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
    return transaction(this.database, ['saves', 'saveControls'], 'readonly', async (tx) => {
      const records = await rawRecords(tx.objectStore('saves'));
      const controls = await rawRecords(tx.objectStore('saveControls'));
      const instances = new Map<IDBValidKey, string>();
      // 只取实例身份；控制记录损坏不应让整个列表不可用（此时删除会因身份不符被拒绝，不会误删）。
      for (const { key, value } of controls) {
        const id = (value as { instanceId?: unknown } | null)?.instanceId;
        if (typeof key === 'string' && typeof id === 'string') instances.set(key, id);
      }
      return records.map(({ key, value }) => {
        const summary = listRecord(key, value), instance = typeof key === 'string' ? instances.get(key) : undefined;
        return summary.status === 'readable' && instance ? { ...summary, instance } : summary;
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
  async exportBackup(saveIds: readonly string[]): Promise<BackupEntry[]> {
    requireData(saveIds.length > 0, 'INVALID_KEY', '未选择存档');
    for (const saveId of saveIds) IdSchema.parse(saveId);
    return transaction(this.database, ['saves', 'drafts'], 'readonly', async (tx) => {
      const entries: BackupEntry[] = [];
      for (const saveId of saveIds) {
        const state = readState(await request(tx.objectStore('saves').get(saveId)), saveId);
        const { draft } = compatibleDraft(state, await request(tx.objectStore('drafts').get(saveId)));
        entries.push({ summary: backupSummary(state), state, ...(draft ? { draft } : {}) });
      }
      return entries;
    });
  }

  /**
   * 导入前比较。在一个只读事务中按真实主键取得本机该存档在五个时间线仓库中的全部原始记录，
   * 生成仅供本次确认的一次性凭据；不写入、不迁移任何记录。
   */
  async compareBackup(entry: { state: GameState; draft?: TurnDraft }): Promise<BackupComparison> {
    const backup = normalizeOpeningCity(GameStateSchema.parse(entry.state));
    const backupDraft = compatibleDraft(backup, entry.draft).draft;
    const snapshot = await transaction(this.database, timelineStores, 'readonly', (tx) => readSnapshot(tx, backup.saveId));
    const confirmation = Object.freeze({}) as BackupImportConfirmation;
    confirmations.set(confirmation, { repository: this, saveId: backup.saveId, incoming: incomingFingerprint(backup, backupDraft), snapshot });
    if (!snapshot.saves.length) return emptySnapshot(snapshot) ? { kind: 'new', confirmation } : {
      kind: 'overwrite-orphaned', confirmation, records: { drafts: snapshot.drafts.length, turnReceipts: snapshot.turnReceipts.length,
        turnUndo: snapshot.turnUndo.length, saveControls: snapshot.saveControls.length } };
    let local: GameState;
    // 解析用副本：迁移与校验绝不能改动作为确认依据的原始快照。
    try { local = readState(structuredClone(snapshot.saves[0].value), backup.saveId); } catch { return { kind: 'overwrite-unreadable', confirmation }; }
    const rawDraft = snapshot.drafts[0]?.value === undefined ? undefined : structuredClone(snapshot.drafts[0].value);
    const localDraft = rawDraft === undefined ? undefined : TurnDraftSchema.safeParse(rawDraft);
    const differences = {
      state: fingerprint(local) !== fingerprint(backup),
      draft: localDraft === undefined ? backupDraft !== undefined
        : !localDraft.success || backupDraft === undefined || fingerprint(localDraft.data) !== fingerprint(backupDraft),
    };
    const summary = backupSummary(local);
    return differences.state || differences.draft
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
  async importBackup(entry: { state: GameState; draft?: TurnDraft }, confirmation: BackupImportConfirmation,
    options: { overwrite?: boolean } = {}): Promise<GameState> {
    const state = normalizeOpeningCity(GameStateSchema.parse(entry.state));
    const { draft } = compatibleDraft(state, entry.draft);
    const confirmed = confirmations.get(confirmation);
    confirmations.delete(confirmation);
    requireData(confirmed?.repository === this && confirmed.saveId === state.saveId
      && confirmed.incoming === incomingFingerprint(state, draft),
      'IMPORT_CONFIRMATION_INVALID', '导入确认已失效或与所选备份不符，请重新选择文件导入。');
    requireData(emptySnapshot(confirmed.snapshot) || options.overwrite === true, 'SAVE_EXISTS', confirmed.snapshot.saves.length
      ? '本机已有这份存档，需要确认覆盖后才能导入。' : '本机留有这份存档的残留记录，需要确认覆盖后才能导入。');
    const session = reserveStageSession(state.saveId);
    try {
      return await withBrowserLock(state.saveId, () => transaction(this.database, timelineStores, 'readwrite', async (tx) => {
        session.check();
        const current = await readSnapshot(tx, state.saveId);
        requireData(sameSnapshot(current, confirmed.snapshot), 'IMPORT_CONFLICT',
          '本机存档在确认后发生了变化，本次没有导入，本机数据保持原样。请重新选择文件导入。');
        const localRevision = (current.drafts[0]?.value as { draftRevision?: unknown } | undefined)?.draftRevision;
        const floor = Number.isSafeInteger(localRevision) && (localRevision as number) >= 0 ? localRevision as number : -1;
        await deleteRecords(tx, state.saveId);
        await request(tx.objectStore('saves').add(state));
        // 新实例身份：此前载入的旧页面凭旧身份发起的删除、人物管理都会被拒绝；新 epoch 同时使旧记忆 lineage 失效。
        await writeControl(tx, { ...newSaveControl(state.saveId), instanceId: `instance-${crypto.randomUUID()}` });
        if (draft) await request(tx.objectStore('drafts').put(TurnDraftSchema.parse({
          ...draft, draftRevision: Math.max(draft.draftRevision, floor) + 1 })));
        return state;
      }));
    } finally { session.release(); }
  }

  // Explicit recovery action, separate from the revision-checked normal delete path.
  // Recheck within the write transaction: never delete a record that has become readable.
  async deleteUnreadable(storageKey: IDBValidKey): Promise<void> {
    requireData(storageKey !== undefined && storageKey !== null, 'INVALID_KEY', '未选择存档记录');
    return transaction(this.database, timelineStores, 'readwrite', async tx => {
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
    return transaction(this.database, timelineStores, 'readwrite', async (tx) => {
      const store = tx.objectStore('saves');
      const current = await readStoredState(tx, saveId);
      const next = commitCommands(current, turnId, expectedRevision, commands);
      if (next.revision !== current.revision) {
        const control = await readControl(tx, saveId) ?? newSaveControl(saveId);
        await clearUndoRecords(tx, saveId); control.records = []; control.notice = 'legacy_write';
        control.epoch = `epoch-${crypto.randomUUID()}`; delete control.lastUndo; control.input = '';
        await writeControl(tx, control); await request(store.put(next));
      }
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
            await recordUndo(tx, state, current, quotaFallback);
            await request(saves.put(next));
            await request(drafts.put(draft));
            await request(receipts.add(receipt));
            return { state: next, draft, replayed: false };
          },
        );
        try { return await commit(false); } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          // The entire first transaction aborted. Revalidate everything, keep the formal
          // save first, and explicitly record that this turn has no undo point. No AI retry.
          return commit(true);
        }
      });
    } finally {
      session.release();
    }
  }

  /** expectedInstance：列表摘要里的 instance（原存档为 null）。存档被导入替换后，旧列表即使版本号相同也不能删除。 */
  async delete(saveId: string, expectedRevision: number, expectedInstance: string | null = null): Promise<void> {
    IdSchema.parse(saveId); CountSchema.parse(expectedRevision);
    if (expectedInstance !== null) IdSchema.parse(expectedInstance);
    return transaction(this.database, timelineStores, 'readwrite', async (tx) => {
      const current = await readStoredState(tx, saveId);
      requireData(await storedInstance(tx, saveId) === expectedInstance, 'REVISION_CONFLICT', replacedMessage);
      requireData(current.revision === expectedRevision, 'REVISION_CONFLICT', '删除时存档版本已变化');
      await deleteRecords(tx, saveId);
    });
  }

  // 唯一允许绑定空待输入草稿的入口。输入绑定后仍不可由saveDraft改写；不提升正式revision。
  async bindTurnAction(expected: TurnDraft, action: string, useVariableStage: boolean, useWorldStage: boolean): Promise<TurnDraft> {
    const snapshot = TurnDraftSchema.parse(expected), userInput = z.string().trim().min(1).max(100000).parse(action);
    const session = reserveStageSession(snapshot.saveId);
    try {
      return await withBrowserLock(snapshot.saveId, () => transaction(this.database, ['saves', 'drafts', 'saveControls'], 'readwrite', async tx => {
        session.check();
        const state = await readStoredState(tx, snapshot.saveId);
        const store = tx.objectStore('drafts'), current = TurnDraftSchema.parse(await request(store.get(snapshot.saveId)));
        requireData(fingerprint(current) === fingerprint(snapshot), 'DRAFT_CONFLICT', '行动草稿已被其他操作更新');
        requireData(awaitingPlayerAction(state, current), 'DRAFT_CONFLICT', '只能为未生成的待输入回合绑定行动');
        const next = TurnDraftSchema.parse({ ...createTurnDraft(current.saveId, state.revision, current.turnId, 'regular', userInput, useVariableStage, useWorldStage), draftRevision: current.draftRevision + 1 });
        const control = await readControl(tx, state.saveId) ?? newSaveControl(state.saveId);
        control.input = ''; control.memoryPaused = false; delete control.lastUndo;
        await writeControl(tx, control);
        await request(store.put(next)); return next;
      }));
    } finally { session.release(); }
  }

  /**
   * basedOn：调用方据以构造 next 的草稿。提供时要求库中草稿与它逐项相同，
   * 不只看 draftRevision 数字，防止时间线被替换（如导入备份）后迟到的旧响应恰好对上版本号。
   */
  async saveDraft(draft: TurnDraft, expectedDraftRevision: number | null, signal?: AbortSignal, basedOn?: TurnDraft): Promise<TurnDraft> {
    const next = TurnDraftSchema.parse(draft);
    const base = basedOn === undefined ? undefined : TurnDraftSchema.parse(basedOn);
    return transaction(this.database, ['saves', 'drafts'], 'readwrite', async (tx) => {
      const current = await readStoredState(tx, next.saveId);
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
        requireData(!base || fingerprint(old) === fingerprint(base), 'DRAFT_CONFLICT', '草稿已被其他操作更新');
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
