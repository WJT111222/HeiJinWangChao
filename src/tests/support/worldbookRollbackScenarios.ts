/**
 * 世界书阶段 C 回滚兼容性探测场景（只读调研，不修改任何正式代码）。
 *
 * “旧版客户端”= 当前 main@a820f5e 的存储代码（本分支对 src/services、src/domain/state.ts、drafts.ts、
 * turnCommit.ts、workflows、ui 没有任何改动）。每个场景先用正式代码造出真实回合、撤回点和收藏，
 * 再以“新版客户端可能写入的形式”直接改写 IndexedDB 原始记录，然后用旧版代码逐项执行
 * 列表、打开、撤回、历史预览与回溯、备份导出与解析，记录实际结果，并核对原始数据没有被改动。
 *
 * 本模块不依赖测试框架：
 * - e2e/worldbook-rollback-compat.spec.ts 在真实 Chromium + Vite 开发服务器中运行（真实 IndexedDB 与历史 Worker）；
 * - src/tests/worldbook-rollback-compat.test.ts 在正式 Vitest + fake-indexeddb 中运行。
 * 两处都直接打开数据库，不用备份导入代替。
 */
import { SaveRepository, saveDatabaseVersion } from '../../services/storage/saveRepository';
import { parseBackup, serializeBackup, backupSummary, backupVersion } from '../../services/storage/backup';
import { digestBytes } from '../../services/storage/history/codec';
import { worldState } from '../fixtures/world';
import { completeDraft, elapsedVariables, submission } from '../fixtures/turn';

export interface Observation { scenario: string; operation: string; result: string; expected: string; pass: boolean }

/** 新版客户端在“扩展 GameState”方案下会写入的字段（结构与方案一致）。 */
const WORLDBOOK = {
  revision: 1,
  bindings: [{ bookId: 'book-1', versionId: 'v1', contentHash: 'a'.repeat(64), enabled: true, boundAt: '2026-11-18T00:00:00.000Z' }],
  settings: {},
  timed: { sticky: {}, cooldown: {} },
};

export async function runRollbackScenarios(factory: IDBFactory, prefix: string): Promise<Observation[]> {
  const observations: Observation[] = [];
  let counter = 0, name = '', repo: SaveRepository | undefined;

  const check = (scenario: string, operation: string, result: string, expected?: RegExp) => {
    observations.push({ scenario, operation, result, expected: expected ? expected.source : '（记录）', pass: expected ? expected.test(result) : true });
    return result;
  };
  const fresh = async () => {
    repo?.close();
    name = `${prefix}-${++counter}`;
    repo = await SaveRepository.open(name, factory);
    await repo.create(worldState());
    return repo;
  };
  const reopen = async () => { repo!.close(); repo = await SaveRepository.open(name, factory); };
  const turn = async (action: string) => {
    const game = await repo!.loadGame('save-a');
    if (game.draft && !game.draft.userInput) await repo!.bindTurnAction(game.draft, action, true, true);
    return repo!.commitTurn(submission(await completeDraft(repo!, { variables: await elapsedVariables(repo!, '时间经过', 60) }), ''));
  };
  const turns = async (n: number) => { for (let i = 0; i < n; i++) await turn(`行动 ${i}`); };
  const outcome = async (work: () => Promise<unknown>) => {
    try { await work(); return '成功'; } catch (error) {
      const code = (error as { code?: string }).code;
      return `失败：${code ?? (error as Error).name}（${String((error as Error).message ?? '').slice(0, 50)}）`;
    }
  };

  // 原始读写（绕过所有校验），模拟新版客户端写入。
  const rawDb = (dbName = name, version?: number, upgrade?: (db: IDBDatabase) => void) => new Promise<IDBDatabase>((resolve, reject) => {
    const open = version === undefined ? factory.open(dbName) : factory.open(dbName, version);
    if (upgrade) open.onupgradeneeded = () => upgrade(open.result);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const rawTx = async <T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>, dbName = name): Promise<T> => {
    const db = await rawDb(dbName);
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = work(tx.objectStore(store));
        let result: T;
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  };
  const rawGet = (store: string, key: IDBValidKey) => rawTx<unknown>(store, 'readonly', (s) => s.get(key));
  const rawAll = (store: string, dbName = name) => rawTx<unknown[]>(store, 'readonly', (s) => s.getAll(), dbName);
  const rawPut = (store: string, value: unknown, dbName = name) => rawTx<IDBValidKey>(store, 'readwrite', (s) => s.put(value), dbName);
  /** 与该存档相关的全部原始记录（含历史收藏载荷摘要），用于证明旧版操作没有改动数据。 */
  const snapshot = async () => {
    const out: Record<string, string> = {};
    for (const store of ['saves', 'drafts', 'turnUndo', 'saveControls', 'turnReceipts', 'historyMetadata']) out[store] = JSON.stringify(await rawAll(store));
    const payloads = await rawAll('historyPayloads') as Array<{ id: string; payload: { digest: string; rawBytes: number } }>;
    out.historyPayloads = JSON.stringify(payloads.map((p) => [p.id, p.payload.digest, p.payload.rawBytes]));
    return JSON.stringify(out);
  };
  const unchanged = async (scenario: string, before: string) =>
    check(scenario, '旧版操作后原始数据', (await snapshot()) === before ? '未改动' : '被改动', /^未改动$/);

  try {
    // ── 基线 ────────────────────────────────────────────────
    {
      const s = '基线：普通存档';
      await fresh(); await turns(3);
      check(s, '存档列表', (await repo!.list())[0].status, /^readable$/);
      check(s, '打开存档', await outcome(() => repo!.loadGame('save-a')), /^成功$/);
      let historyId = '';
      check(s, '新建命名收藏', await outcome(async () => { historyId = (await repo!.history.create('save-a', '基线收藏')).id; }), /^成功$/);
      const game = await repo!.loadGame('save-a');
      check(s, '撤回一回合', await outcome(() => repo!.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: 'u1' })), /^成功$/);
      check(s, '回溯到命名收藏', await outcome(async () => {
        const preview = await repo!.history.preview('save-a', { kind: 'manual', id: historyId });
        await repo!.history.restore(preview.confirmation, '换个选择', true, true);
      }), /^成功$/);
      const parsed = await parseBackup(await serializeBackup(await repo!.exportBackup(['save-a']), 'main'));
      check(s, '备份导出并解析', parsed.entries[0].ok ? '成功' : '失败', /^成功$/);
    }

    // ── 方案：扩展 GameState ─────────────────────────────────
    {
      const s = 'GameState 方案：当前存档带 worldbook 字段';
      await fresh(); await turns(2);
      const state = await repo!.load('save-a');
      await rawPut('saves', { ...state, worldbook: WORLDBOOK });
      await reopen();
      const before = await snapshot();
      const listed = (await repo!.list())[0] as { status: string; reason?: string };
      check(s, '存档列表', `${listed.status}${listed.reason ? `（${listed.reason}）` : ''}`, /^unreadable/);
      check(s, '打开存档', await outcome(() => repo!.loadGame('save-a')), /^失败：CORRUPT_SAVE/);
      check(s, '查看撤回状态', await outcome(() => repo!.undoStatus('save-a')), /^失败/);
      check(s, '历史收藏列表', await outcome(() => repo!.history.list('save-a')), /^失败/);
      check(s, '新建命名收藏', await outcome(() => repo!.history.create('save-a', 'x')), /^失败/);
      check(s, '备份导出', await outcome(() => repo!.exportBackup(['save-a'])), /^失败/);
      check(s, '原始数据导出（排查用）', await outcome(() => repo!.exportRaw('save-a')), /^成功$/);
      await unchanged(s, before);
      check(s, '风险', '旧版界面对“无法读取的存档”提供显式删除；玩家误点会永久删除这份存档');
    }
    {
      const s = 'GameState 方案：撤回点快照带字段（当前存档不带）';
      await fresh(); await turns(3);
      const available = (await repo!.undoStatus('save-a')).available;
      // 取最新的撤回点：按撤回索引里的顺序，而不是按主键（回合 ID 是随机 UUID）。
      const control = await rawGet('saveControls', 'save-a') as { records: Array<{ turnId: string }> };
      const last = await rawGet('turnUndo', ['save-a', control.records.at(-1)!.turnId]) as { stateJSON: string };
      await rawPut('turnUndo', { ...last, stateJSON: JSON.stringify({ ...JSON.parse(last.stateJSON), worldbook: WORLDBOOK }) });
      await reopen();
      const before = await snapshot();
      check(s, '打开存档', await outcome(() => repo!.loadGame('save-a')), /^成功$/);
      check(s, '撤回状态（可撤回回合数）', String((await repo!.undoStatus('save-a')).available), new RegExp(`^${available}$`));
      const game = await repo!.loadGame('save-a');
      check(s, '撤回一回合', await outcome(() => repo!.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: 'u' })), /^失败/);
      const nodes = (await repo!.history.list('save-a')).nodes.filter((n) => n.kind === 'automatic');
      check(s, '自动历史节点列表', `${nodes.length} 个`, new RegExp(`^${available} 个$`));
      check(s, '预览最新的自动节点', await outcome(() => repo!.history.preview('save-a', nodes.at(-1)!)), /^失败/);
      check(s, '预览更早的自动节点', await outcome(async () => { const p = await repo!.history.preview('save-a', nodes[0]); repo!.history.release(p.confirmation); }), /^成功$/);
      await unchanged(s, before);
    }
    {
      const s = 'GameState 方案：命名收藏元数据带 worldbookRefs';
      await fresh(); await turns(2);
      const meta = await repo!.history.create('save-a', '有引用的收藏');
      const stored = await rawGet('historyMetadata', ['save-a', meta.id]) as Record<string, unknown>;
      await rawPut('historyMetadata', { ...stored, worldbookRefs: [{ bookId: 'book-1', versionId: 'v1', contentHash: 'a'.repeat(64) }] });
      await reopen();
      const before = await snapshot();
      const node = (await repo!.history.list('save-a')).nodes.find((n) => n.id === meta.id)!;
      check(s, '收藏列表', node.name, /^无法读取的历史收藏$/);
      check(s, '预览收藏', await outcome(() => repo!.history.preview('save-a', { kind: 'manual', id: meta.id })), /^失败/);
      await unchanged(s, before);
    }
    {
      const s = 'GameState 方案：命名收藏载荷里的存档带字段';
      await fresh(); await turns(2);
      const meta = await repo!.history.create('save-a', '载荷带字段');
      const state = await repo!.load('save-a');
      const bytes = new TextEncoder().encode(JSON.stringify({ ...state, worldbook: WORLDBOOK }));
      const digest = await digestBytes(bytes);
      const stored = await rawGet('historyMetadata', ['save-a', meta.id]) as Record<string, unknown>;
      await rawPut('historyMetadata', { ...stored, rawBytes: bytes.byteLength, digest, encoding: 'json', bytes: bytes.byteLength });
      await rawPut('historyPayloads', { saveId: 'save-a', id: meta.id, payload: { version: 1, encoding: 'json', rawBytes: bytes.byteLength, digest, data: bytes.buffer } });
      await reopen();
      const before = await snapshot();
      const node = (await repo!.history.list('save-a')).nodes.find((n) => n.id === meta.id)!;
      check(s, '收藏列表', node.error ? `异常：${node.error}` : '正常显示', /^正常显示$/);
      check(s, '预览 / 回溯', await outcome(() => repo!.history.preview('save-a', { kind: 'manual', id: meta.id })), /^失败/);
      await unchanged(s, before);
    }
    {
      const s = 'GameState 方案：草稿带冻结快照字段';
      await fresh(); await turns(1);
      const draft = await rawGet('drafts', 'save-a') as Record<string, unknown>;
      await rawPut('drafts', { ...draft, worldbook: { revision: 1, seed: 's' } });
      await reopen();
      const before = await snapshot();
      check(s, '读取草稿', await outcome(() => repo!.loadDraft('save-a')), /^失败：CORRUPT_DRAFT/);
      check(s, '打开存档', await outcome(() => repo!.loadGame('save-a')));
      await unchanged(s, before);
    }

    // ── 备份格式边界 ─────────────────────────────────────────
    {
      await fresh(); await turns(1);
      const state = await repo!.load('save-a');
      const latest = JSON.parse(await serializeBackup([{ summary: backupSummary(state), state }], 'new'));
      const v1 = { ...latest, version: 1 };
      check('备份：未来版本文件', '当前版解析', await outcome(() => parseBackup(JSON.stringify({ ...v1, version: backupVersion + 1, worldbooks: [] }))), /^失败：BACKUP_FUTURE/);
      const withField = { ...v1, saves: [{ ...v1.saves[0], state: { ...state, worldbook: WORLDBOOK } }] };
      delete withField.checksum;
      const parsed = await parseBackup(JSON.stringify(withField));
      check('备份：第 1 版文件、存档带字段', '旧版解析', parsed.entries[0].ok ? '可导入' : `该份不可导入（${parsed.entries[0].error}）`, /^该份不可导入/);
      check('备份：第 1 版文件、附加未知顶层字段', '旧版解析', await outcome(() => parseBackup(JSON.stringify({ ...v1, worldbooks: [] }))));
    }

    // ── 方案：附属状态 ───────────────────────────────────────
    {
      const s = '附属状态放主库新表（主库升到第 6 版）';
      await fresh(); await turns(1);
      repo!.close(); repo = undefined;
      const upgraded = await rawDb(name, saveDatabaseVersion + 1, (db) => { db.createObjectStore('worldbookBindings', { keyPath: 'saveId' }); });
      upgraded.close();
      check(s, '旧版打开数据库', await outcome(async () => { repo = await SaveRepository.open(name, factory); }), /^失败/);
      const saves = await rawAll('saves');
      check(s, '原有存档数据', saves.length === 1 ? '仍在，但旧版无法读取任何存档' : '丢失', /^仍在/);
    }
    {
      const s = '附属状态放独立数据库';
      await fresh(); await turns(3);
      const sidecarName = `${name}-worldbooks`;
      const head = (await repo!.load('save-a')).journal.at(-1)!.turnId;
      const sidecar = await rawDb(sidecarName, 1, (db) => { db.createObjectStore('saveState', { keyPath: ['saveId', 'headTurnId', 'seq'] }); });
      sidecar.close();
      await rawPut('saveState', { saveId: 'save-a', headTurnId: head, seq: 1, state: WORLDBOOK }, sidecarName);
      const sidecarBefore = JSON.stringify(await rawAll('saveState', sidecarName));
      await reopen();
      check(s, '存档列表', (await repo!.list())[0].status, /^readable$/);
      check(s, '打开存档', await outcome(() => repo!.loadGame('save-a')), /^成功$/);
      await turn('旧版继续玩');
      const afterTurn = (await repo!.load('save-a')).journal.at(-1)!.turnId;
      check(s, '旧版推进一回合后，时间线头', afterTurn === head ? '未变' : '变为附属库中没有记录的新回合', /^变为附属库中没有记录的新回合$/);
      let game = await repo!.loadGame('save-a');
      check(s, '旧版撤回', await outcome(() => repo!.undoTurn({ saveId: 'save-a', expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: 'u' })), /^成功$/);
      const afterUndo = (await repo!.load('save-a')).journal.at(-1)!.turnId;
      check(s, '旧版撤回后，时间线头', afterUndo === head ? '回到附属库已有记录的回合' : '其他', /^回到附属库已有记录的回合$/);
      check(s, '旧版新建命名收藏', await outcome(() => repo!.history.create('save-a', '旧版收藏')), /^成功$/);
      const nodes = (await repo!.history.list('save-a')).nodes.filter((n) => n.kind === 'automatic');
      check(s, '旧版回溯到更早的自动节点', await outcome(async () => {
        const preview = await repo!.history.preview('save-a', nodes[0]);
        await repo!.history.restore(preview.confirmation, '回到过去', true, true);
      }), /^成功$/);
      game = await repo!.loadGame('save-a');
      check(s, '回溯后，时间线头', game.state.journal.at(-1)!.turnId === head ? '与记录相同' : '为更早的回合（附属库中没有该头的记录）');
      const exported = JSON.parse(await serializeBackup(await repo!.exportBackup(['save-a']), 'main'));
      check(s, '旧版导出备份', `第 ${exported.version} 版，不含世界书数据（旧版不知道附属库）`);
      check(s, '附属库记录', JSON.stringify(await rawAll('saveState', sidecarName)) === sidecarBefore ? '未被旧版改动' : '被改动', /^未被旧版改动$/);
    }
  } catch (error) {
    check('运行', '场景执行', `中断：${(error as Error).name} ${(error as Error).message}`, /^不应中断$/);
  } finally {
    repo?.close();
  }
  return observations;
}
