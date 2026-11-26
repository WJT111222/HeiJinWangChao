import { z } from 'zod';
import { DataError, IdSchema } from '../../domain/common';
import type { GameState } from '../../domain/state';
import { readControl, SnapshotSchema } from '../storage/turnUndo';
import { migrateSave } from '../storage/migrations';
import { request, transaction } from '../storage/idb';
import { collectionSchema, emptyCollection, person, sameSubject, slotOptions, validTarget } from './model';
import type { Collection, Picture, Scope, Slot, Target } from './model';
import { checkDimensions, decode, encode } from './raster';

export const imageStores = ['imageCollections', 'imageFiles', 'imageJobs', 'imageVersions'] as const;
export const imageChange = 'heijin.images.changed.v1';
// An existing V8 may be malformed. Inspect metadata only; creation is restricted to the upgrade transaction.
export function checkImageStores(db: IDBDatabase, upgrade?: IDBTransaction) {
  function invalid(name: string): never {
    throw new DataError(
      'STORAGE_SCHEMA',
      `本地图片数据库结构异常（${name}）。原数据已保留。请关闭其他游戏页面并刷新。若仍失败，可在独立浏览器配置恢复已有备份，或保留本站数据等待结构升级。`,
    );
  }
  if (!upgrade) {
    for (const name of imageStores) if (!db.objectStoreNames.contains(name)) invalid(name);
  }
  const tx = upgrade ?? db.transaction([...imageStores], 'readonly');
  for (const name of imageStores) {
    const compound = name === 'imageJobs' || name === 'imageFiles';
    const keyPath = compound ? ['saveId', 'id'] : null;
    const store = db.objectStoreNames.contains(name)
      ? tx.objectStore(name)
      : db.createObjectStore(name, { keyPath });
    if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(keyPath)) invalid(name);
    const checkIndex = (indexName: string, path: string | string[]) => {
      if (!store.indexNames.contains(indexName)) {
        if (!upgrade) invalid(name + '.' + indexName);
        store.createIndex(indexName, path);
      } else {
        const index = store.index(indexName);
        if (index.unique || index.multiEntry || JSON.stringify(index.keyPath) !== JSON.stringify(path))
          invalid(name + '.' + indexName);
      }
    };
    if (compound) checkIndex('saveId', 'saveId');
    if (name === 'imageJobs') checkIndex('subject', ['saveId', 'target.kind', 'target.id', 'slot']);
  }
}
export const portableSchema = collectionSchema.extend({
  saveId: IdSchema,
  createdAt: z.string(),
  files: z.array(z.strictObject({ id: IdSchema, data: z.string() })),
});
export type PortableImages = z.infer<typeof portableSchema>;
export function parseImages(raw: unknown, s: Pick<GameState, 'saveId' | 'createdAt'>) {
  const p = portableSchema.parse(raw);
  const files = new Map(p.files.map((f) => [f.id, f.data])),
    ids = new Set(p.pictures.map((m) => m.id));
  if (
    p.saveId !== s.saveId ||
    p.createdAt !== s.createdAt ||
    files.size !== p.files.length ||
    ids.size !== p.pictures.length ||
    ids.size !== files.size
  )
    throw new Error('图片备份身份或资源数量无效');
  for (const m of p.pictures) {
    const data = files.get(m.id);
    if (
      !data ||
      data.length !== Math.ceil(m.bytes / 3) * 4 ||
      !slotOptions(m.target.kind).includes(m.slot) ||
      (m.album !== undefined && m.target.kind !== 'story')
    )
      throw new Error('图片关联无效');
    const bytes = decode(data);
    if (bytes.length !== m.bytes || checkDimensions(bytes) !== m.mime) throw new Error('图片资源校验失败');
  }
  if (p.anchors.some((a) => !person(a.target.kind))) throw new Error('人物锚点类型无效');
  return p;
}
async function collection(tx: IDBTransaction, id: string): Promise<Collection> {
  return (await request(tx.objectStore('imageCollections').get(id))) ?? emptyCollection();
}
export async function exportImages(
  tx: IDBTransaction,
  s: GameState,
  remainingBytes: number,
): Promise<PortableImages | undefined> {
  const data = await collection(tx, s.saveId);
  if (!(await request(tx.objectStore('imageVersions').getKey(s.saveId)))) return;
  if (data.pictures.reduce((size, picture) => size + 4 * Math.ceil(picture.bytes / 3), 0) > remainingBytes)
    throw new DataError('BACKUP_TOO_LARGE', '图片超过备份容量上限，请分别导出或选择轻量备份');
  const rows: { id: string; data: string }[] = await request(
    tx.objectStore('imageFiles').index('saveId').getAll(s.saveId),
  );
  return {
    saveId: s.saveId,
    createdAt: s.createdAt,
    ...data,
    files: rows.map(({ id, data }) => ({ id, data })),
  };
}
export async function clearImages(tx: IDBTransaction, id: IDBValidKey) {
  await request(tx.objectStore('imageCollections').delete(id));
  await request(tx.objectStore('imageVersions').delete(id));
  for (const name of ['imageFiles', 'imageJobs']) {
    const store = tx.objectStore(name);
    for (const key of await request(store.index('saveId').getAllKeys(id))) await request(store.delete(key));
  }
}
export async function restoreImages(tx: IDBTransaction, p: PortableImages) {
  await clearImages(tx, p.saveId);
  await request(tx.objectStore('imageVersions').put(crypto.randomUUID(), p.saveId));
  await request(
    tx.objectStore('imageCollections').put({ pictures: p.pictures, anchors: p.anchors }, p.saveId),
  );
  for (const f of p.files) await request(tx.objectStore('imageFiles').add({ ...f, saveId: p.saveId }));
}
export const imageTimelineChange = 'heijin.images.timeline.v1';
export function notifyImages(event = imageChange) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(event));
  try {
    localStorage.setItem(event, crypto.randomUUID());
  } catch {
    /* IDB remains authoritative. */
  }
}
export type Phase = '等待' | '提示词转换' | '图片生成' | '图片保存' | '完成' | '失败' | '取消';
export interface Job {
  id: string;
  saveId: string;
  target: Target;
  slot: Slot;
  phase: Phase;
  message: string;
  time: number;
  automatic: boolean;
  scope: Scope;
}
export const terminal = (p: Phase) => ['完成', '失败', '取消'].includes(p);
export class ImageLibrary {
  constructor(private db: IDBDatabase) {}
  async read(id: string) {
    return transaction(this.db, ['imageCollections', 'imageJobs'], 'readonly', async (tx) => ({
      library: await collection(tx, id),
      jobs: await request<Job[]>(tx.objectStore('imageJobs').index('saveId').getAll(id)),
    }));
  }
  async matchesView(scope: Scope, revision: number, turnId?: string) {
    return transaction(this.db, ['saveControls', 'saves'], 'readonly', async (tx) => {
      const control = await readControl(tx, scope.saveId);
      if (control?.instanceId !== scope.instance) return false;
      const s: GameState | undefined = await request(tx.objectStore('saves').get(scope.saveId));
      return (
        s?.createdAt === scope.createdAt && s.revision === revision && s.journal.at(-1)?.turnId === turnId
      );
    });
  }
  async file(saveId: string, id: string, expected?: Pick<Scope, 'instance'>): Promise<string | undefined> {
    return transaction(
      this.db,
      expected ? ['imageFiles', 'saveControls'] : ['imageFiles'],
      'readonly',
      async (tx) => {
        if (expected && (await readControl(tx, saveId))?.instanceId !== expected.instance) return;
        return (await request(tx.objectStore('imageFiles').get([saveId, id])))?.data;
      },
    );
  }
  // Only a snapshot from the active undo chain can supply historical appearance.
  async storyState(state: GameState, turnId: string): Promise<GameState | undefined> {
    const index = state.journal.findIndex((entry) => entry.turnId === turnId);
    if (index < 0) return;
    const entry = state.journal[index];
    if (index === state.journal.length - 1 && entry.revision === state.revision) return state;
    const next = state.journal[index + 1];
    if (!next) return;
    const record = await transaction(this.db, ['saveControls', 'turnUndo'], 'readonly', async (tx) => {
      const ctl = await readControl(tx, state.saveId);
      if (!ctl?.records.some((r) => r.turnId === next.turnId && r.beforeTurnId === turnId)) return;
      return request(tx.objectStore('turnUndo').get([state.saveId, next.turnId]));
    });
    if (!record) return;
    const raw = SnapshotSchema.parse(record);
    if (raw.saveId !== state.saveId || raw.turnId !== next.turnId || raw.beforeTurnId !== turnId) return;
    const past = migrateSave(JSON.parse(raw.stateJSON));
    if (
      past.saveId === state.saveId &&
      past.createdAt === state.createdAt &&
      past.journal.length === index + 1 &&
      past.journal.every(
        (j, i) => j.turnId === state.journal[i].turnId && j.revision === state.journal[i].revision,
      )
    )
      return past;
  }
  private async write<T>(
    scope: Scope,
    work: (tx: IDBTransaction, s: GameState, c: Collection) => Promise<T>,
    signal?: AbortSignal,
  ) {
    try {
      const result = await transaction(
        this.db,
        ['saves', 'saveControls', ...imageStores],
        'readwrite',
        async (tx) => {
          const s: GameState | undefined = await request(tx.objectStore('saves').get(scope.saveId));
          const ctl = await request(tx.objectStore('saveControls').get(scope.saveId));
          if (!s || s.createdAt !== scope.createdAt || ctl?.instanceId !== scope.instance)
            throw new Error('存档已切换或替换');
          return work(tx, s, await collection(tx, scope.saveId));
        },
        signal,
      );
      notifyImages();
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError')
        throw new DataError('IMAGE_QUOTA', '本机存储空间不足，请导出并清理图片');
      throw error;
    }
  }
  async enqueue(job: Job) {
    if ((job.automatic && job.slot === 'home') || !slotOptions(job.target.kind).includes(job.slot))
      return false;
    return this.write(job.scope, async (tx, s, c) => {
      const store = tx.objectStore('imageJobs');
      if (!validTarget(s, job.target) || (await request(store.getKey([s.saveId, job.id])))) return false;
      if (
        job.automatic &&
        c.pictures.some(
          (p) => p.slot === job.slot && sameSubject(p.target, job.target) && validTarget(s, p.target),
        )
      )
        return false;
      const matches: Job[] = await request(
        store.index('subject').getAll([s.saveId, job.target.kind, job.target.id, job.slot]),
      );
      if (
        matches.some(
          (other) =>
            other.scope.instance === job.scope.instance &&
            !terminal(other.phase) &&
            validTarget(s, other.target),
        )
      )
        return false;
      await request(store.add(job));
      return true;
    });
  }
  // A past instance may finish its own queue record after a timeline switch.
  // This transaction cannot select an image, change a gallery or recreate a deleted job.
  async finish(job: Job, phase: '取消' | '失败', message: string) {
    await transaction(this.db, ['imageJobs'], 'readwrite', async (tx) => {
      const store = tx.objectStore('imageJobs');
      const row: Job | undefined = await request(store.get([job.saveId, job.id]));
      if (
        row &&
        !terminal(row.phase) &&
        row.time === job.time &&
        row.scope.instance === job.scope.instance &&
        row.scope.createdAt === job.scope.createdAt
      )
        await request(store.put({ ...row, phase, message }));
    });
    notifyImages();
  }
  async phase(job: Job, phase: '提示词转换' | '图片生成' | '图片保存') {
    return this.write(job.scope, async (tx, s, c) => {
      const store = tx.objectStore('imageJobs'),
        existing: Job | undefined = await request(store.get([s.saveId, job.id]));
      if (!existing || existing.time !== job.time || terminal(existing.phase)) throw new Error('任务已结束');
      if (!validTarget(s, job.target)) throw new Error('来源回合或档案已失效');
      if (
        job.automatic &&
        c.pictures.some(
          (p) => p.slot === job.slot && sameSubject(p.target, job.target) && validTarget(s, p.target),
        )
      )
        throw new DOMException('已有对应图片', 'AbortError');
      await request(store.put({ ...existing, phase }));
      return { s, c };
    });
  }
  async save(scope: Scope, t: Target, slot: Slot, bytes: Uint8Array, signal?: AbortSignal, job?: Job) {
    if (!slotOptions(t.kind).includes(slot)) throw new Error('图片用途与目标不符');
    const mime = checkDimensions(bytes);
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mime }));
        bitmap.close();
      } catch {
        throw new Error('无法解码图片，资源可能已损坏');
      }
    }
    const data = encode(bytes);
    return this.write(
      scope,
      async (tx, s, c) => {
        if (!validTarget(s, t)) throw new Error('来源回合或档案已失效');
        const picture: Picture = {
          id: crypto.randomUUID(),
          target: t,
          slot,
          current: true,
          bytes: bytes.length,
          mime,
          created: new Date().toISOString(),
        };
        for (const old of c.pictures)
          if (old.slot === slot && sameSubject(old.target, t) && validTarget(s, old.target))
            old.current = false;
        c.pictures.push(picture);
        if (job) {
          const store = tx.objectStore('imageJobs'),
            live: Job | undefined = await request(store.get([s.saveId, job.id]));
          if (live?.phase !== '图片保存') throw new Error('任务已取消');
          await request(store.put({ ...live, phase: '完成' }));
        }
        await request(tx.objectStore('imageFiles').add({ saveId: s.saveId, id: picture.id, data }));
        await request(tx.objectStore('imageCollections').put(c, s.saveId));
        await request(tx.objectStore('imageVersions').put(crypto.randomUUID(), s.saveId));
      },
      signal,
    );
  }
  async edit(scope: Scope, id: string, action: 'use' | 'delete' | 'album', title?: string) {
    return this.write(scope, async (tx, s, c) => {
      const m = c.pictures.find((p) => p.id === id);
      if (!m) throw new Error('图片已删除');
      if (action === 'use') {
        if (!validTarget(s, m.target)) throw new Error('只能选择当前时间线的图片');
        for (const p of c.pictures)
          if (p.slot === m.slot && sameSubject(p.target, m.target) && validTarget(s, p.target))
            p.current = p.id === id;
      } else if (action === 'delete') {
        c.pictures = c.pictures.filter((p) => p.id !== id);
        await request(tx.objectStore('imageFiles').delete([s.saveId, id]));
      } else if (m.target.kind === 'story') m.album = title?.trim().slice(0, 256) || undefined;
      await request(tx.objectStore('imageCollections').put(c, s.saveId));
      await request(tx.objectStore('imageVersions').put(crypto.randomUUID(), s.saveId));
    });
  }
  async anchor(scope: Scope, t: Target, text: string) {
    return this.write(scope, async (tx, s, c) => {
      if (!person(t.kind) || !validTarget(s, t)) throw new Error('人物关联失效');
      c.anchors = c.anchors.filter((a) => !sameSubject(a.target, t) || !validTarget(s, a.target));
      if (text.trim()) c.anchors.push({ target: t, text: text.trim().slice(0, 4000) });
      await request(tx.objectStore('imageCollections').put(c, s.saveId));
      await request(tx.objectStore('imageVersions').put(crypto.randomUUID(), s.saveId));
    });
  }
}
