import { announcement } from '../../ui/notices/announcement';
import { announcementMaxBytes, parseAnnouncement, type Announcement } from './announcement';

// Best effort only. Never await this before starting the game or opening a notice.
export async function loadAnnouncement(fetcher: typeof fetch = fetch): Promise<Announcement> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetcher('/api/announcement', { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !response.body) return announcement;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > announcementMaxBytes) { await reader.cancel(); return announcement; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseAnnouncement(new TextDecoder().decode(bytes)) ?? announcement;
  } catch { return announcement; }
  finally { clearTimeout(timer); }
}

// One safe request per page lifetime, including React StrictMode remounts.
// A reload starts fresh; neither payload nor request is persisted in a save.
let pending: Promise<Announcement> | undefined;
export function currentAnnouncement() { return pending ??= loadAnnouncement(); }
