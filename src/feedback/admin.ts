import { summaryKinds } from '../domain/memories/configuration';
import { z } from 'zod';
import { categorySchema, feedbackStageSchema, feedbackAdminPath, feedbackTextLimit, statusSchema, submissionIdSchema } from '../services/feedback/contract';
import { cleanFeedbackText } from '../services/feedback/textSafety';
import { deleteFeedback, feedbackOverview, getFeedback, listFeedback, updateFeedback } from './database';
import { adminMessage, detailView, listView, overviewView } from './adminView';
import type { FeedbackEnv } from './handler';
import { BodyTooLarge, boundedText, feedbackHeaders, sameOrigin } from './http';

const challenge = { 'WWW-Authenticate': 'Basic realm="Heijin feedback admin", charset="UTF-8"' };
async function authorized(request: Request, password: string) {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ') || header.length > 512) return false;
  let supplied: Uint8Array<ArrayBuffer>;
  try { supplied = Uint8Array.from(atob(header.slice(6)), character => character.charCodeAt(0)); }
  catch { return false; }
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', supplied),
    crypto.subtle.digest('SHA-256', encoder.encode(`developer:${password}`)),
  ]);
  const expected = new Uint8Array(b);
  return new Uint8Array(a).reduce((difference, value, i) => difference | (value ^ expected[i]), 0) === 0;
}

function redirect(path: string) {
  return new Response(null, { status: 303, headers: { ...feedbackHeaders, Location: path } });
}

export async function feedbackAdmin(request: Request, env: FeedbackEnv) {
  const password = env.FEEDBACK_ADMIN_PASSWORD;
  if (!password || !/^[\x21-\x7e]{32,128}$/.test(password))
    return adminMessage('后台未启用', '请检查服务端管理凭证配置。', 503);
  if (!await authorized(request, password))
    return adminMessage('需要管理员登录', '此页面仅供开发者处理匿名反馈。', 401, challenge);
  const db = env.FEEDBACK;
  if (!db) return adminMessage('反馈暂不可用', '数据库尚未绑定。', 503);
  const { pathname, searchParams } = new URL(request.url);

  try {
    if (request.method === 'GET') {
      if (pathname === feedbackAdminPath || pathname === feedbackAdminPath + '/')
        return overviewView(await feedbackOverview(db));
      if (pathname === feedbackAdminPath + '/list') {
        const filterValue = (key: string, max: number) => (searchParams.get(key) ?? '').trim().slice(0, max);
        const requestedType = filterValue('type', 24), parsed = categorySchema.safeParse(requestedType);
        const page = Number(filterValue('page', 8));
        const filter = {
          q: filterValue('q', 150), model: filterValue('model', 200), code: filterValue('code', 64),
          stage: feedbackStageSchema.safeParse(filterValue('stage', 24)).data,
          memoryTask: z.enum(summaryKinds).safeParse(filterValue('memoryTask', 24)).data,
          type: requestedType === 'error' ? 'error' : parsed.data ?? '',
          order: searchParams.get('order') === 'oldest' ? 'oldest' as const : 'newest' as const,
          page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100_000) : 1,
        };
        const { rows, more } = await listFeedback(db, filter);
        return listView(filter, rows, more);
      }
      const id = submissionIdSchema.safeParse(pathname.slice(feedbackAdminPath.length + 1));
      const row = id.success ? await getFeedback(db, id.data) : undefined;
      return row ? detailView(row, searchParams.get('updated') === '1') : adminMessage('没有这条反馈', '记录不存在或已删除。', 404);
    }
    if (request.method !== 'POST') return adminMessage('不支持此操作', '请从反馈管理页面提交操作。', 405, { Allow: 'GET, POST' });
    if (!sameOrigin(request)) return adminMessage('操作已拒绝', '请从本站的反馈管理页面提交。', 403);
    const id = submissionIdSchema.safeParse(pathname.slice(feedbackAdminPath.length + 1));
    if (!id.success) return adminMessage('没有这条反馈', '记录不存在或已删除。', 404);
    if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
      return adminMessage('操作格式有误', '请使用反馈管理页面。', 415);
    const form = new URLSearchParams(await boundedText(request, 64 * 1024));
    if (form.get('action') === 'delete') {
      if (await deleteFeedback(db, id.data)) return redirect(feedbackAdminPath + '/list');
    } else if (form.get('action') === 'update') {
      const status = statusSchema.safeParse(form.get('status')), note = cleanFeedbackText(form.get('note') ?? '');
      if (!status.success || note.length > feedbackTextLimit)
        return adminMessage('处理信息有误', '请检查状态及备注长度。', 400);
      if (await updateFeedback(db, id.data, status.data, note.trim())) return redirect(pathname + '?updated=1');
    } else {
      return adminMessage('不支持此操作', '请从反馈管理页面提交。', 400);
    }
    return adminMessage('没有这条反馈', '记录不存在或已删除。', 404);
  } catch (error) {
    return error instanceof BodyTooLarge ? adminMessage('备注过长', '请缩短备注后重试。', 413)
      : adminMessage('反馈暂不可用', '请稍后重试。', 503);
  }
}
