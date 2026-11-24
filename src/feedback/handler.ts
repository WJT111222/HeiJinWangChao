import { feedbackBytes, feedbackSubmissionSchema } from '../services/feedback/contract';
import { cleanFeedbackText } from '../services/feedback/textSafety';
import { insertFeedback } from './database';
import type { FeedbackDatabase } from './database';
import { BodyTooLarge, boundedText, feedbackJson, sameOrigin } from './http';

export interface FeedbackEnv {
  FEEDBACK?: FeedbackDatabase;
  FEEDBACK_ADMIN_PASSWORD?: string;
}

export async function receiveFeedback(request: Request, env: FeedbackEnv) {
  if (request.method !== 'POST') return feedbackJson({ error: 'method' }, 405, { Allow: 'POST' });
  if (!sameOrigin(request)) return feedbackJson({ error: 'origin' }, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? ''))
    return feedbackJson({ error: 'format' }, 415);
  if (!env.FEEDBACK) return feedbackJson({ error: 'unavailable' }, 503);
  let raw: unknown;
  try {
    raw = JSON.parse(await boundedText(request, feedbackBytes));
  } catch (error) {
    return error instanceof BodyTooLarge ? feedbackJson({ error: 'size' }, 413) : feedbackJson({ error: 'invalid' }, 400);
  }
  const checked = feedbackSubmissionSchema.safeParse(raw);
  if (!checked.success) return feedbackJson({ error: 'invalid' }, 400);
  const { submissionId, feedback } = checked.data;
  const texts = [feedback.text];
  if (feedback.kind === 'error') {
    for (const log of feedback.errors) texts.push(...Object.values(log).filter(value => typeof value === 'string'));
    for (const item of feedback.attachments ?? []) texts.push(item.content, item.reasoning);
  }
  if (texts.some(text => text && cleanFeedbackText(text) !== text)) return feedbackJson({ error: 'sensitive_text' }, 422);
  try {
    const accepted = await insertFeedback(env.FEEDBACK, submissionId, feedback);
    if (accepted.kind === 'limited') return feedbackJson({ error: 'rate' }, 429, { 'Retry-After': '60' });
    if (accepted.kind === 'conflict') return feedbackJson({ error: 'conflict' }, 409);
    return feedbackJson({ id: accepted.id }, accepted.kind === 'created' ? 201 : 200);
  } catch {
    // Feedback, upstream metadata and request headers never enter Worker logs.
    return feedbackJson({ error: 'unavailable' }, 503);
  }
}
