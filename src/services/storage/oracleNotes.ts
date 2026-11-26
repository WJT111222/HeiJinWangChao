import { z } from 'zod';
import { IdSchema } from '../../domain/common';
import { request } from './idb';

export const oracleStore = 'oracleNotes';
const Note = z.strictObject({ id: z.uuid(), text: z.string().max(100000), once: z.boolean() });
const historyLimit = 6;
function recentPapers(history: readonly string[]) {
  return [...new Set(history.map(text => text.trim()).filter(Boolean))].slice(0, historyLimit);
}

const Sheet = z.strictObject({
  saveId: IdSchema, version: z.uuid(), note: Note.nullable(), history: z.array(Note.shape.text).transform(recentPapers),
});

export async function readSheet(tx: IDBTransaction, saveId: string) {
  const raw = await request(tx.objectStore(oracleStore).get(saveId));
  return raw === undefined ? { saveId, version: null, note: null, history: [] as string[] } : Sheet.parse(raw);
}
export function rememberPaper(history: string[], text: string) {
  return recentPapers([text, ...history]);
}
export async function writeSheet(tx: IDBTransaction, sheet: Awaited<ReturnType<typeof readSheet>>) {
  const next = Sheet.parse({ ...sheet, version: crypto.randomUUID() });
  await request(tx.objectStore(oracleStore).put(next));
  return next;
}
export async function consumeOracleNote(tx: IDBTransaction, saveId: string, id: string) {
  const sheet = await readSheet(tx, saveId);
  if (sheet.note?.id === id && sheet.note.once) await writeSheet(tx, { ...sheet, note: null });
}

// This cursor runs inside the exclusive schema upgrade. Both writes roll back on any error.
export function createOracleStore(db: IDBDatabase, tx: IDBTransaction) {
  const notes = db.createObjectStore(oracleStore, { keyPath: 'saveId' });
  const scan = tx.objectStore('saveControls').openCursor();
  scan.onsuccess = () => {
    const cursor = scan.result;
    if (!cursor) return;
    if (cursor.value && typeof cursor.value === 'object' && Object.hasOwn(cursor.value, 'oracleNote')) {
      try {
        const { oracleNote, ...control } = cursor.value;
        if (control.saveId !== cursor.primaryKey) throw new Error('纸条与存储主键不匹配');
        const note = Note.parse(oracleNote);
        notes.add(Sheet.parse({ saveId: control.saveId, version: crypto.randomUUID(), note, history: [note.text] }));
        cursor.update(control);
      } catch {
        tx.abort();
        return;
      }
    }
    cursor.continue();
  };
}
