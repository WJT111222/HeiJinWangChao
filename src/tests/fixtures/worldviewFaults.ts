import { WorldbookLibrary, WORLDBOOK_LIBRARY_DB } from '../../services/storage/worldbookLibrary';
import { request, transaction } from '../../services/storage/idb';

// Fault injection is restricted to the independent snapshot store in isolated browser contexts.
export async function snapshots(
  op: 'read' | 'lose' | 'restore',
  records: { key: IDBValidKey; value: unknown }[] = [],
) {
  const db = await request(indexedDB.open(WORLDBOOK_LIBRARY_DB));
  try {
    return await transaction(db, ['turnWorldviews'], op === 'read' ? 'readonly' : 'readwrite', async (tx) => {
      const store = tx.objectStore('turnWorldviews');
      if (op === 'lose') await request(store.clear());
      if (op === 'restore') for (const { key, value } of records) await request(store.put(value, key));
      const keys = await request(store.getAllKeys());
      return Promise.all(keys.map(async (key) => ({ key, value: await request(store.get(key)) })));
    });
  } finally {
    db.close();
  }
}
export async function officialOnly() {
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw Error('书库打开失败');
  const lib = opened.library;
  try {
    const selected = await lib.enabledBooks();
    if (!selected.ok) throw Error('读取失败');
    for (const { ref } of selected.books) if (!(await lib.deleteBook(ref.bookId)).ok) throw Error('删除失败');
    if (!(await lib.setOfficial()).ok) throw Error('恢复官方开关失败');
  } finally {
    lib.close();
  }
}
