import { writeSillyTavernEntry } from './entryFields';
import { notice } from './notices';
import { WORLDBOOK_FORMAT, isPlainObject, type ImportNotice, type WorldbookRelease } from './schema';

/** 王朝格式：版本本体原样写出，包括原始来源，可无损再导入（哈希不变）。 */
export function exportNativeText(release: WorldbookRelease): string {
  return JSON.stringify({ format: WORLDBOOK_FORMAT, ...release }, null, 2);
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  // 用 defineProperty 写入，"__proto__" 之类的键也作为普通数据键保留。
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * 酒馆世界书格式。
 * - 来源就是酒馆文件：以原文件为底，保留书级未知字段、entries 的形状（对象或数组）、键名和条目里的未知字段；
 * - 其他来源（角色卡等）：按酒馆的完整字段写出新文件，并说明哪些原始字段不会出现在酒馆格式里。
 */
export function exportSillyTavern(release: WorldbookRelease): { value: Record<string, unknown>; notices: ImportNotice[] } {
  const payload = release.source.payload;
  const fromSillyTavern = release.source.format === 'sillytavern' && isPlainObject(payload)
    && (Array.isArray(payload.entries) || isPlainObject(payload.entries));
  const container = fromSillyTavern ? payload.entries as Record<string, unknown> | unknown[] : undefined;
  const rawOf = (entry: WorldbookRelease['entries'][number]) => {
    if (!container || entry.sourceKey === null || !Object.hasOwn(container, entry.sourceKey)) return undefined;
    const raw = (container as Record<string, unknown>)[entry.sourceKey];
    return isPlainObject(raw) ? raw : undefined;
  };

  // 给没有可用原 ID 的条目分配不冲突的整数 uid。
  const taken = new Set(release.entries.map((entry) => entry.sourceUid).filter((uid) => uid !== null).map(String));
  let next = 0;
  const freshUid = () => { while (taken.has(String(next))) next++; taken.add(String(next)); return next; };

  const notices: ImportNotice[] = [];
  if (Array.isArray(container)) {
    const entries = release.entries.map((entry) => {
      const raw = rawOf(entry);
      return writeSillyTavernEntry(entry, raw, entry.sourceUid ?? (raw ? 0 : freshUid()));
    });
    return { value: { ...(payload as Record<string, unknown>), entries }, notices };
  }
  const entries: Record<string, unknown> = {};
  const usedKeys = new Set<string>();
  for (const entry of release.entries) {
    const raw = rawOf(entry);
    // 原条目保留原来的键；新条目以 uid 为键。
    let uid: number | string = raw ? entry.sourceUid ?? entry.sourceKey! : entry.sourceUid ?? freshUid();
    let key = raw ? entry.sourceKey! : String(uid);
    if (usedKeys.has(key)) { uid = freshUid(); key = String(uid); }
    usedKeys.add(key);
    setOwn(entries, key, writeSillyTavernEntry(entry, raw, uid));
  }
  if (fromSillyTavern) return { value: { ...(payload as Record<string, unknown>), entries }, notices };

  if (release.source.format === 'character-card-v2' && isPlainObject(payload)) {
    const lost = ['name', 'description', 'scan_depth', 'token_budget', 'recursive_scanning'].filter((key) => payload[key] !== undefined);
    const rows = Array.isArray(payload.entries) ? payload.entries.filter(isPlainObject) : [];
    for (const key of ['name', 'priority', 'case_sensitive']) if (rows.some((row) => row[key] !== undefined)) lost.push(`条目 ${key}`);
    if (lost.length) notices.push(notice('export_lossy', {}, { value: lost.join('、') }));
  }
  return { value: { entries }, notices };
}
