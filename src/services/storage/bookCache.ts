import type { BookPost } from '../../domain/blackbook';
import { requireData } from '../../domain/common';
import { request, transaction } from './idb';

export const bookStore = 'phoneBookPosts';
const storageKey = (key: string): IDBValidKey => [JSON.parse(key)[0], key];
export interface CachedPost {
  post: BookPost;
  liked: string[];
}
export class BookCache {
  constructor(private db: IDBDatabase) {}
  async read(keys: string[]) {
    return transaction(this.db, [bookStore], 'readonly', async (tx) => {
      const store = tx.objectStore(bookStore);
      return Object.fromEntries(
        (
          await Promise.all(
            keys.map(
              async (key) =>
                [key, await request<CachedPost | undefined>(store.get(storageKey(key)))] as const,
            ),
          )
        ).flatMap(([key, entry]) => (entry ? [[key, entry] as const] : [])),
      );
    });
  }
  async fill(entries: { key: string; post: BookPost }[], signal: AbortSignal) {
    await transaction(
      this.db,
      [bookStore],
      'readwrite',
      async (tx) => {
        const store = tx.objectStore(bookStore);
        for (const entry of entries)
          if (!(await request(store.getKey(storageKey(entry.key)))))
            await request(store.add({ post: entry.post, liked: [] }, storageKey(entry.key)));
      },
      signal,
    );
  }
  async like(key: string, item: string) {
    return transaction(this.db, [bookStore], 'readwrite', async (tx) => {
      const store = tx.objectStore(bookStore);
      const record: CachedPost | undefined = await request(store.get(storageKey(key)));
      requireData(record, 'NOT_FOUND', '帖子缓存已失效');
      record.liked = record.liked.includes(item)
        ? record.liked.filter((id) => id !== item)
        : [...record.liked, item];
      await request(store.put(record, storageKey(key)));
      return record;
    });
  }
}
