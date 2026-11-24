import { summaryNames } from '../domain/memories/configuration';
import { memoryFailureReasons, memoryRecordCodes } from '../domain/memories/diagnostics';
import { aiErrorCodes } from '../services/ai/errors';
import { feedbackAdminPath, feedbackCategories, feedbackErrorStages } from '../services/feedback/contract';
import type { FeedbackDatabase } from './database';

const sender = 'feedback@heijinwangchao.de5.net';
const subject = '【黑金王朝】玩家反馈简报';
const interval = 12 * 60 * 60 * 1000;
// Longer than Cloudflare's 15-minute Cron invocation wall-time limit.
const leaseDuration = 20 * 60 * 1000;
const stages = feedbackErrorStages;
const codes = [...aiErrorCodes, ...memoryRecordCodes, 'TURN_TIME_REQUIRED', 'MISSING_SUMMARY', 'REVISION_CONFLICT', 'DRAFT_CONFLICT'];
const memoryTasks = Object.keys(summaryNames), memoryReasons = Object.keys(memoryFailureReasons);
// Only exact public model IDs may appear in email. Private routes and unfamiliar IDs share a bucket.
const publicModels = [
  'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro',
  'glm-4.5', 'glm-4.5-air', 'glm-4.6', 'glm-4.7', 'glm-5',
  'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.1', 'gpt-5.2',
  'gemini-2.5-flash', 'gemini-2.5-pro', 'claude-sonnet-4-5', 'claude-opus-4-5',
];
const unknown = '其他或未提供';

type Mail = { from: string; to: string; subject: string; text: string };
export interface FeedbackDigestEnv {
  FEEDBACK?: FeedbackDatabase;
  FEEDBACK_EMAIL?: { send(message: Mail): Promise<unknown> };
  FEEDBACK_DIGEST_ENABLED?: string;
  FEEDBACK_DIGEST_TO?: string;
}

type Dimension = 'total' | 'category' | 'stage' | 'code' | 'model' | 'build' | 'memory_task' | 'memory_reason';
interface CountRow {
  dimension: Dimension;
  label: string;
  reports: number;
  logs: number;
}

async function collect(db: FeedbackDatabase, start: number, end: number) {
  // Project only counts and allowlisted labels from one snapshot.
  // Bind each allowlist as one JSON array so it can grow within D1's 100-parameter limit.
  const { results } = await db.prepare(`
    WITH receipts AS (
      SELECT id, kind, category, json_extract(payload, '$.build') AS build,
        CASE WHEN kind = 'error' AND json_type(payload, '$.errors') = 'array'
          THEN json_extract(payload, '$.errors') END AS errors
      FROM feedback WHERE created_at >= ? AND created_at < ?
    ), builds AS (
      SELECT CASE
        WHEN length(build) = 40 AND build NOT GLOB '*[^0-9a-f]*' THEN substr(build, 1, 12)
        WHEN build IN ('development', 'unavailable') THEN build
        ELSE '未记录'
      END AS label, count(*) AS reports
      FROM receipts GROUP BY label
    ), ranked_builds AS (
      SELECT label, reports, row_number() OVER (ORDER BY reports DESC, label ASC) AS rank FROM builds
    ), entries AS (
      SELECT r.id, log.value AS data
      FROM receipts AS r, json_each(r.errors) AS log
      WHERE log.type = 'object'
    ), labels AS (
      SELECT id,
        CASE WHEN data ->> '$.stage' IN (SELECT value FROM json_each(?)) THEN data ->> '$.stage' ELSE ? END AS stage,
        CASE WHEN data ->> '$.code' IN (SELECT value FROM json_each(?)) THEN data ->> '$.code' ELSE ? END AS code,
        CASE WHEN data ->> '$.model' IN (SELECT value FROM json_each(?)) THEN data ->> '$.model' ELSE ? END AS model,
        CASE WHEN data ->> '$.stage' = 'memory' AND data ->> '$.memory.task' IN (SELECT value FROM json_each(?)) THEN data ->> '$.memory.task' END AS memory_task,
        CASE WHEN data ->> '$.stage' = 'memory' AND data ->> '$.memory.reason' IN (SELECT value FROM json_each(?)) THEN data ->> '$.memory.reason' END AS memory_reason
      FROM entries
    ), totals AS (
      SELECT 'all' AS label, count(*) AS reports, 0 AS logs FROM receipts
      UNION ALL SELECT 'error', count(*), (SELECT count(*) FROM labels) FROM receipts WHERE kind = 'error'
    ), log_dimensions(dimension) AS (VALUES ('stage'), ('code'), ('model'), ('memory_task'), ('memory_reason')),
    log_groups AS (
      SELECT dimension, CASE dimension WHEN 'stage' THEN stage WHEN 'code' THEN code WHEN 'memory_task' THEN memory_task WHEN 'memory_reason' THEN memory_reason ELSE model END AS label,
        count(DISTINCT id) AS reports, count(*) AS logs
      FROM labels CROSS JOIN log_dimensions WHERE label IS NOT NULL GROUP BY dimension, label
    )
    SELECT 'total' AS dimension, label, reports, logs FROM totals
    UNION ALL SELECT 'category', category, count(*), 0 FROM receipts WHERE kind = 'suggestion' GROUP BY category
    UNION ALL SELECT 'build', CASE WHEN rank <= 15 THEN label ELSE '其余构建' END AS bucket, sum(reports), 0
      FROM ranked_builds GROUP BY bucket
    UNION ALL SELECT dimension, label, reports, logs FROM log_groups
  `).bind(start, end, JSON.stringify(Object.keys(stages)), unknown, JSON.stringify(codes), unknown,
    JSON.stringify(publicModels), unknown, JSON.stringify(memoryTasks), JSON.stringify(memoryReasons)).all<CountRow>();
  return results;
}

function textSummary(rows: CountRow[], start: number, end: number) {
  const beijing = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const count = (dimension: Dimension, label: string) => rows.find(row => row.dimension === dimension && row.label === label)?.reports ?? 0;
  const distribution = (dimension: Dimension, display: (label: string) => string = label => label) => {
    const lines = rows.filter(row => row.dimension === dimension).sort((a, b) =>
      b.reports - a.reports || b.logs - a.logs || a.label.localeCompare(b.label),
    ).map(row => dimension === 'build' ? `- ${display(row.label)} · ${row.reports} 份`
      : `- ${display(row.label)} · ${row.reports} 份报告 / ${row.logs} 条日志`);
    return lines.length ? lines.join('\n') : '无';
  };
  return [
    `统计范围（北京时间） ${beijing(start)} 至 ${beijing(end)}（不含结束时刻）`,
    `新增反馈 ${count('total', 'all')} 份`,
    `错误报告 ${count('total', 'error')} 份，失败日志 ${rows.find(row => row.dimension === 'total' && row.label === 'error')?.logs ?? 0} 条`,
    '', '反馈建议',
    ...Object.entries(feedbackCategories).map(([category, name]) => `- ${name} · ${count('category', category)} 份`),
    '', '失败阶段', distribution('stage', label => stages[label as keyof typeof stages] ?? unknown),
    '', '错误代码', distribution('code'),
    '', '记忆总结任务', distribution('memory_task', label => summaryNames[label as keyof typeof summaryNames]),
    '', '记忆总结原因', distribution('memory_reason', label => memoryFailureReasons[label as keyof typeof memoryFailureReasons]),
    '', '模型', distribution('model'),
    '', '构建版本（提交缩写）', distribution('build'),
    '', `管理后台 https://heijinwangchao.de5.net${feedbackAdminPath}`,
  ].join('\n');
}

export async function sendFeedbackDigest(env: FeedbackDigestEnv, end: number) {
  const { FEEDBACK: db, FEEDBACK_EMAIL: email } = env;
  const to = env.FEEDBACK_DIGEST_TO?.trim();
  if (env.FEEDBACK_DIGEST_ENABLED !== 'true' || !db || !email
    || !to || to.length > 254 || !/^[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(to)
    || !Number.isSafeInteger(end) || end <= 0 || end % interval !== 0) return;

  const lease = crypto.randomUUID();
  const now = Date.now();
  let sent = false;
  try {
    const checkpoint = await db.prepare(`
      INSERT INTO feedback_digest_checkpoint (id, through_ms, lease_id, lease_until_ms)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET lease_id = excluded.lease_id, lease_until_ms = excluded.lease_until_ms
      WHERE through_ms < ? AND (lease_id IS NULL OR lease_until_ms <= ?)
      RETURNING through_ms
    `).bind(end - interval, lease, now + leaseDuration, end, now).first<{ through_ms: number }>();
    if (!checkpoint) return;

    const rows = await collect(db, checkpoint.through_ms, end);
    if (rows.some(row => row.dimension === 'total' && row.label === 'all' && row.reports > 0)) {
      await email.send({ from: sender, to, subject, text: textSummary(rows, checkpoint.through_ms, end) });
      sent = true;
    }
    const result = await db.prepare(`
      UPDATE feedback_digest_checkpoint SET through_ms = ?, lease_id = NULL, lease_until_ms = NULL
      WHERE id = 1 AND lease_id = ?
    `).bind(end, lease).run();
    if (result.meta.changes !== 1) throw new Error();
  } catch {
    if (!sent) {
      // An expired lease is recoverable if even this cleanup write fails.
      try {
        await db.prepare(`
          UPDATE feedback_digest_checkpoint SET lease_id = NULL, lease_until_ms = NULL
          WHERE id = 1 AND lease_id = ?
        `).bind(lease).run();
      } catch { /* Keep the original failure classified without exposing either error. */ }
    }
    // Cloudflare can report a failed invocation without storing the recipient or upstream error.
    throw new Error('feedback_digest_failed');
  }
}
