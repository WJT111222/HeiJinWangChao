import { announcement } from '../../ui/notices/announcement';
import { announcementMaxBytes, parseAnnouncement, type Announcement } from './announcement';

/**
 * 公告来源，只用于判断「是否出现了新公告」，不影响展示：
 * - kv：服务端明确标明 `X-Announcement-Source: kv`，且内容通过严格解析；
 * - builtin：服务端回退到它自己的内置公告（线上 Worker 可能与本页前端版本不同）；
 * - unknown：响应可用但没有标明来源；
 * - fallback：请求失败、超时、超长或内容不合法，使用本页内置公告。
 * 只有 kv 可以触发「当天已免打扰旧版 → 弹出新版」。
 */
export type AnnouncementSource = 'kv' | 'builtin' | 'unknown' | 'fallback';
export interface LoadedAnnouncement { announcement: Announcement; source: AnnouncementSource }
const fallback: LoadedAnnouncement = { announcement, source: 'fallback' };

// Best effort only. Never await this before starting the game or opening a notice.
export async function loadAnnouncement(fetcher: typeof fetch = fetch): Promise<Announcement> {
  return (await loadAnnouncementWithSource(fetcher)).announcement;
}

export async function loadAnnouncementWithSource(fetcher: typeof fetch = fetch): Promise<LoadedAnnouncement> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetcher('/api/announcement', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !response.body) return fallback;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > announcementMaxBytes) { await reader.cancel(); return fallback; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = parseAnnouncement(new TextDecoder().decode(bytes));
    if (!parsed) return fallback;
    const header = response.headers.get('X-Announcement-Source');
    return { announcement: parsed, source: header === 'kv' || header === 'builtin' ? header : 'unknown' };
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}

// One safe request per page lifetime, including React StrictMode remounts.
// A reload starts fresh; neither payload nor request is persisted in a save.
let pending: Promise<LoadedAnnouncement> | undefined;
export function currentAnnouncementWithSource() { return pending ??= loadAnnouncementWithSource(); }
export function currentAnnouncement() { return currentAnnouncementWithSource().then(loaded => loaded.announcement); }
