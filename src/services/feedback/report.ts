import { PRODUCT_VERSION } from '../../app/product';
import type { RuntimeLogEntry } from '../../ui/game/runtimeLog';
import { splitLeadingThink } from '../ai/compat';
import { isOpenAiCompatible } from '../ai/configuration';
import { browserCredentials } from '../ai/credentials';
import { requestInspections } from '../ai/inspection';
import { safeStreamResponseText, stageResponses } from '../ai/stageResponses';
import type { StageResponse } from '../ai/stageResponses';
import { feedbackAttachmentLimit, feedbackAttachmentTotal, feedbackTextLimit } from './contract';
import type { FeedbackCategory, FeedbackReport } from './contract';
import { cleanFeedbackText, containsPrivateDump } from './textSafety';

type LinkedResponse = Pick<StageResponse, 'id' | 'protocol'> & { model?: string };
const links = new WeakMap<RuntimeLogEntry, LinkedResponse>();

/** Attach only a response produced after the matching stage started. Keep IDs in memory. */
export class FeedbackCorrelation {
  private starts = new Map<string, Set<string>>();

  record(entry: RuntimeLogEntry, saveId: string, turnId?: string) {
    if (!turnId || !entry.scope || !['story', 'variables', 'world'].includes(entry.stage)) return;
    const key = `${entry.scope.turnRef}:${entry.stage}`;
    const records = stageResponses.getSnapshot().filter(record =>
      record.saveId === saveId && record.turnId === turnId && record.stage === entry.stage);
    if (entry.kind === 'started') {
      if (this.starts.size >= 12) this.starts.delete(this.starts.keys().next().value!);
      this.starts.set(key, new Set(records.map(record => record.id)));
      return;
    }
    const before = this.starts.get(key);
    this.starts.delete(key);
    if (!before || entry.kind !== 'failed') return;
    const candidate = records.find(record => !before.has(record.id));
    if (!candidate || candidate.status !== 'failed' || candidate.error?.code !== entry.code) return;
    const request = requestInspections.getSnapshot().find(item => item.scope?.responseId === candidate.id);
    links.set(entry, { id: candidate.id, protocol: candidate.protocol ?? request?.route.protocol, model: request?.route.model });
  }
}

function runtimeInfo(userAgent = globalThis.navigator?.userAgent ?? '') {
  const browser = /Edg(?:e|A|iOS)?\//i.test(userAgent) ? 'edge' : /(?:Firefox|FxiOS)\//i.test(userAgent) ? 'firefox'
    : /(?:Chrome|CriOS)\//i.test(userAgent) ? 'chrome' : /Safari\//i.test(userAgent) ? 'safari' : 'other';
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent) ? 'tablet'
    : /iPhone|Mobile/i.test(userAgent) ? 'phone' : /Windows|Macintosh|Linux|CrOS/i.test(userAgent) ? 'desktop' : 'other';
  return { version: PRODUCT_VERSION, build: import.meta.env.VITE_FEEDBACK_BUILD, browser, device } as const;
}

function textSanitizer(extraIds: readonly string[] = []) {
  const requests = requestInspections.getSnapshot();
  const secrets = browserCredentials();
  const ids = [...new Set([...extraIds, ...requests.flatMap(record => [record.scope?.saveId, record.id, record.scope?.responseId])]
    .filter((id): id is string => Boolean(id)))].filter(id => id.length >= 6);
  const promptParts = requests.flatMap(record => record.messages)
    .filter(message => message.content.trim().length >= 64)
    .map(message => message.content.trim());
  return (text: string) => {
    if (containsPrivateDump(text) || promptParts.some(part => text.includes(part))) return undefined;
    let safe = cleanFeedbackText(safeStreamResponseText(text, secrets));
    for (const id of ids) safe = safe.replaceAll(id, '[本地标识已隐藏]');
    return safe;
  };
}

export function suggestionPayload(category: FeedbackCategory, text: string) {
  const safe = textSanitizer()(text) ?? '[请求或存档内容已隐藏]';
  return { ...runtimeInfo(), kind: 'suggestion', category, text: safe.trim().slice(0, feedbackTextLimit) } as const;
}

function logData(entry: RuntimeLogEntry, ref: number, sanitize: ReturnType<typeof textSanitizer>): FeedbackReport['errors'][number] {
  const link = links.get(entry);
  const safe = (value?: string) => value && sanitize(value) === value ? value : undefined;
  return {
    ref, time: entry.timestamp, stage: entry.stage, code: safe(entry.code) ?? 'unknown',
    model: safe(link?.model),
    protocol: link?.protocol, httpStatus: entry.httpStatus,
    fieldPath: safe(entry.fieldPath)?.slice(0, 160),
    commandIndex: entry.commandIndex,
    commandType: safe(entry.commandType),
    relatedCommandIndices: entry.relatedCommandIndices,
    valuePath: safe(entry.valuePath)?.slice(0, 160),
    expectedType: safe(entry.expectedType), actualType: safe(entry.actualType),
    validationRule: safe(entry.validationRule), storyRule: safe(entry.storyRule),
    storyTag: entry.storyTag, storyIssue: safe(entry.storyIssue), guideIndex: entry.guideIndex,
    actualCount: entry.actualCount, minimumCount: entry.minimumCount, maximumCount: entry.maximumCount,
    worldRule: safe(entry.worldRule), domainRule: safe(entry.domainRule), variableStep: safe(entry.variableStep),
  };
}

export function prepareErrorPayload(
  entries: readonly RuntimeLogEntry[], responses: readonly StageResponse[],
  include: { content: boolean; reasoning: boolean },
) {
  const errors = entries.filter(entry => entry.kind === 'failed');
  const ids = [
    ...errors.flatMap(entry => [entry.scope?.saveRef, entry.scope?.turnRef, entry.relatedNpcId]),
    ...responses.flatMap(record => [record.saveId, record.turnId, record.id]),
  ].filter((id): id is string => Boolean(id));
  const sanitize = textSanitizer(ids);
  const responseRefs = new Map<string, number>();
  errors.forEach((entry, i) => {
    const link = links.get(entry);
    if (link) responseRefs.set(link.id, i + 1);
  });
  const retained = responses.filter(response => response.status === 'failed' && responseRefs.has(response.id)).slice(0, 6);
  const values = retained.flatMap(response => {
    if (!include.content && !include.reasoning) return [];
    const inline = response.protocol && isOpenAiCompatible(response.protocol) && /^\s*<think>/.test(response.text ?? '')
      ? splitLeadingThink(response.text!) : undefined;
    const text = inline?.content ?? response.text;
    const thoughts = response.nativeReasoning || (response.stage === 'story' ? inline?.reasoning : undefined);
    const content = include.content && text ? sanitize(text) : undefined;
    const reasoning = include.reasoning && thoughts ? sanitize(thoughts) : undefined;
    return content || reasoning ? [{ ref: responseRefs.get(response.id)!, content, reasoning, truncated: response.truncated }] : [];
  });
  const fieldCount = values.reduce((sum, value) => sum + Number(Boolean(value.content)) + Number(Boolean(value.reasoning)), 0);
  const limit = Math.min(feedbackAttachmentLimit, Math.floor(feedbackAttachmentTotal / Math.max(fieldCount, 1)));
  const attachments = values.map(value => {
    const bound = (text?: string) => text?.slice(0, limit);
    return {
      errorRef: value.ref, content: bound(value.content), reasoning: bound(value.reasoning),
      truncated: value.truncated || (value.content?.length ?? 0) > limit || (value.reasoning?.length ?? 0) > limit ? true as const : undefined,
    };
  });
  const payload: Omit<FeedbackReport, 'text'> = {
    ...runtimeInfo(), kind: 'error',
    errors: errors.map((entry, i) => logData(entry, i + 1, sanitize)),
    ...(attachments.length ? { attachments } : {}),
  };
  return (note: string): FeedbackReport => {
    const text = (sanitize(note) ?? '[请求或存档内容已隐藏]').trim().slice(0, feedbackTextLimit);
    return text ? { ...payload, text } : payload;
  };
}
