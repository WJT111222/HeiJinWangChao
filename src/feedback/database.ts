import { feedbackSchema } from '../services/feedback/contract';
import type { FeedbackPayload, FeedbackStatus } from '../services/feedback/contract';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface FeedbackDatabase { prepare(sql: string): Statement }
interface Receipt { id: string; digest: string }
const minute = 60_000;
export const feedbackPerMinute = 30;

async function digest(text: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(data)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function insertFeedback(db: FeedbackDatabase, submissionId: string, feedback: FeedbackPayload) {
  const payload = JSON.stringify(feedback);
  const hash = await digest(payload);
  const id = crypto.randomUUID();
  // D1 timestamps the receipt in the write statement, so preparation time does not backdate an insert past a digest cutoff.
  const result = await db.prepare(`
    WITH receipt(now_ms) AS (SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER))
    INSERT INTO feedback (id, submission_id, digest, created_at, kind, category, payload)
    SELECT ?, ?, ?, now_ms, ?, ?, ? FROM receipt
    WHERE NOT EXISTS (SELECT 1 FROM feedback WHERE submission_id = ?)
      AND (SELECT count(*) FROM feedback WHERE created_at >= now_ms - ?) < ?
  `).bind(id, submissionId, hash, feedback.kind, feedback.kind === 'suggestion' ? feedback.category : null,
    payload, submissionId, minute, feedbackPerMinute).run();
  if (result.meta.changes === 1) return { kind: 'created' as const, id };
  const prior = await db.prepare('SELECT id, digest FROM feedback WHERE submission_id = ?')
    .bind(submissionId).first<Receipt>();
  if (prior?.digest === hash) return { kind: 'duplicate' as const, id: prior.id };
  return { kind: prior ? 'conflict' as const : 'limited' as const };
}

interface RecordRow { id: string; created_at: number; status: FeedbackStatus; note: string; payload: string }
export async function getFeedback(db: FeedbackDatabase, id: string) {
  const row = await db.prepare('SELECT id, created_at, status, note, payload FROM feedback WHERE id = ?').bind(id).first<RecordRow>();
  if (!row) return;
  return { ...row, payload: feedbackSchema.parse(JSON.parse(row.payload)) };
}
export async function updateFeedback(db: FeedbackDatabase, id: string, status: FeedbackStatus, note: string) {
  return (await db.prepare('UPDATE feedback SET status = ?, note = ? WHERE id = ?').bind(status, note, id).run()).meta.changes > 0;
}
export async function deleteFeedback(db: FeedbackDatabase, id: string) {
  return (await db.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run()).meta.changes > 0;
}

export interface FeedbackFilters {
  q: string; type: string; model: string; code: string; order: 'newest' | 'oldest'; page: number;
}
export interface ListRow {
  id: string; created_at: number; status: FeedbackStatus; kind: 'suggestion' | 'error';
  category: string | null; excerpt: string | null;
}
export const pageSize = 25;
export async function listFeedback(db: FeedbackDatabase, filter: FeedbackFilters) {
  const conditions: string[] = [];
  const params: SqlValue[] = [];
  if (filter.type === 'error') conditions.push("kind = 'error'");
  else if (filter.type) { conditions.push('category = ?'); params.push(filter.type); }
  if (filter.q) {
    conditions.push("instr(lower(coalesce(json_extract(payload, '$.text'), '')), lower(?)) > 0");
    params.push(filter.q);
  }
  for (const [field, value] of [['model', filter.model], ['code', filter.code]] as const) {
    if (!value) continue;
    conditions.push(`EXISTS (SELECT 1 FROM json_each(payload, '$.errors') WHERE json_extract(value, '$.${field}') = ?)`);
    params.push(value);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const order = filter.order === 'oldest' ? 'ASC' : 'DESC';
  const { results } = await db.prepare(`
    SELECT id, created_at, status, kind, category, substr(json_extract(payload, '$.text'), 1, 120) AS excerpt
    FROM feedback ${where} ORDER BY created_at ${order}, id ${order} LIMIT ? OFFSET ?
  `).bind(...params, pageSize + 1, (filter.page - 1) * pageSize).all<ListRow>();
  return { rows: results.slice(0, pageSize), more: results.length > pageSize };
}

export async function feedbackOverview(db: FeedbackDatabase) {
  const counts = db.prepare('SELECT status, count(*) AS count FROM feedback GROUP BY status')
    .all<{ status: FeedbackStatus; count: number }>();
  const recent = listFeedback(db, { type: '', q: '', model: '', code: '', order: 'newest', page: 1 });
  const stats = Promise.all((['code', 'model', 'stage'] as const).map(async field => {
    const { results } = await db.prepare(`
      SELECT json_extract(err.value, '$.${field}') AS label, count(*) AS count
      FROM feedback, json_each(feedback.payload, '$.errors') AS err
      WHERE label IS NOT NULL GROUP BY label ORDER BY count DESC, label ASC LIMIT 10
    `).all<{ label: string; count: number }>();
    return results;
  }));
  const [totals, newest, groups] = await Promise.all([counts, recent, stats]);
  return { totals: totals.results, newest: newest.rows.slice(0, 5), groups };
}
