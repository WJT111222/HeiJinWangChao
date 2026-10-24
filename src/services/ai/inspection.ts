import type { ModuleRecord } from '../../prompts/composer';
import type { AiMessage, Usage } from './protocols';
import { record, array, string } from './protocols';
import type { RequestSnapshot } from './snapshot';
import { freeze, secretFor } from './snapshot';
import { browserCredentials } from './credentials';
import { contextStatistics } from '../../prompts/statistics';

export interface InspectionScope {
  kind: 'stage' | 'memory';
  memoryTask?: string;
  mode: 'opening' | 'regular';
  saveId: string;
  revision: number;
  storyRevision?: number;
  modules: ModuleRecord[];
}
// 不保留请求头、URL、供应商响应正文、推理或凭证对象。
export interface RequestInspection {
  id: string;
  createdAt: string;
  stage: RequestSnapshot['stage'];
  route: {
    channelId: string;
    channelName: string;
    protocol: RequestSnapshot['channel']['protocol'];
    model: string;
  };
  scope?: InspectionScope;
  status: 'pending' | 'received' | 'failed';
  errorCode?: string;
  body: Record<string, unknown>;
  messages: AiMessage[];
  outputTokenLimit?: number;
  statistics: ReturnType<typeof contextStatistics>;
}
export function redactInspection<T>(value: T, secrets: readonly string[] = []): T {
  const candidates = [
    ...new Set(
      secrets
        .filter(Boolean)
        .flatMap((key) => [key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)]),
    ),
  ].sort((a, b) => b.length - a.length);
  function visit(item: unknown): unknown {
    if (typeof item === 'string') {
      let safe = item.replace(/\b(?:Bearer|Basic)\s+[^\s"<>]+/gi, '[凭证已隐藏]');
      for (const key of candidates) safe = safe.split(key).join('[密钥已隐藏]');
      return safe;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([key, entry]) => [
          key,
          /^(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_]?key|access[-_]?token)$/i.test(
            key,
          )
            ? '[敏感字段已隐藏]'
            : visit(entry),
        ]),
      );
    return item;
  }
  return visit(value) as T;
}
// 从已序列化原生 payload 派生显示用角色，不再次调用 Composer。
export function payloadMessages(
  body: Record<string, unknown>,
  protocol: RequestSnapshot['channel']['protocol'],
): AiMessage[] {
  if (protocol === 'openai')
    return array(body.messages).map((m) => ({
      role: string(record(m).role) as AiMessage['role'],
      content: string(record(m).content),
    }));
  const system =
    protocol === 'gemini'
      ? array(record(body.systemInstruction).parts)
          .map((part) => string(record(part).text))
          .join('')
      : string(body.system);
  const conversation = protocol === 'gemini' ? array(body.contents) : array(body.messages);
  return [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    ...conversation.map((m): AiMessage => ({
      role: ['assistant', 'model'].includes(string(record(m).role)) ? 'assistant' : 'user',
      content:
        protocol === 'gemini'
          ? array(record(m).parts)
              .map((part) => string(record(part).text))
              .join('')
          : string(record(m).content),
    })),
  ];
}
export function inspectedContext(messages: readonly AiMessage[]) {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const match = message.content.match(/^<GAME_CONTEXT>\s*([\s\S]*)\s*<\/GAME_CONTEXT>$/);
    if (match) {
      try {
        return JSON.parse(match[1]) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
export class RequestInspectionStore {
  private records: readonly RequestInspection[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.records;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(records: readonly RequestInspection[]) {
    this.records = records;
    for (const listener of this.listeners) listener();
  }
  clear = () => this.publish([]);
  start(snapshot: RequestSnapshot, serializedBody: string, scope?: InspectionScope) {
    const original = JSON.parse(serializedBody) as Record<string, unknown>;
    const messages = payloadMessages(original, snapshot.channel.protocol);
    const value = redactInspection(
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        stage: snapshot.stage,
        route: {
          channelId: snapshot.channel.id,
          channelName: snapshot.channel.name,
          protocol: snapshot.channel.protocol,
          model: snapshot.model,
        },
        scope,
        status: 'pending' as const,
        body: original,
        messages,
        outputTokenLimit: typeof original.max_tokens === 'number' ? original.max_tokens
          : typeof original.max_completion_tokens === 'number' ? original.max_completion_tokens
            : typeof record(original.generationConfig).maxOutputTokens === 'number'
              ? Number(record(original.generationConfig).maxOutputTokens) : undefined,
        statistics: contextStatistics(messages),
      },
      [secretFor(snapshot), ...browserCredentials()],
    );
    this.publish([freeze(value), ...this.records].slice(0, 12));
    return value.id;
  }
  finish(id: string, usage?: Usage, errorCode?: string) {
    this.publish(
      this.records.map((item) =>
        item.id !== id || item.status !== 'pending'
          ? item
          : freeze({
              ...item,
              status: errorCode ? ('failed' as const) : ('received' as const),
              errorCode,
              statistics: {
                ...item.statistics,
                actual: {
                  inputTokens: usage?.inputTokens,
                  outputTokens: usage?.outputTokens,
                  totalTokens: usage?.totalTokens,
                  ...(usage?.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
                },
              },
            }),
      ),
    );
  }
}
export const requestInspections = new RequestInspectionStore();
