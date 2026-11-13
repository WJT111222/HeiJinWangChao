import { redactInspection } from './inspection';
import { safeAiError } from './errors';
import type { AiStage, Protocol } from './configuration';
import { freeze } from './snapshot';

export interface StageResponse {
  id: string; saveId: string; turnId?: string; storyRevision?: number; stage: AiStage;
  status: 'pending' | 'received' | 'validated' | 'failed';
  text?: string; normalized?: string; error?: ReturnType<typeof safeAiError>;
  protocol?: Protocol;
  /** Only actual independent provider fields, never extracted project <thinking>. */
  nativeReasoning?: string;
}
// 保留字符串布局；仅安全边界中的凭证会被遮蔽，不把响应重新格式化或截断。
export function safeResponseText(text: string, secrets: readonly string[]) {
  return redactInspection(text, secrets)
    .replace(/("(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token)"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[凭证已隐藏]"')
    .replace(/\b((?:authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token)\s*[=:]\s*)[^\s,;<>]+/gi, '$1[凭证已隐藏]');
}
// While a response is incomplete, do not expose a known credential one prefix at a time.
export function safeStreamResponseText(text: string, secrets: readonly string[]) {
  const safe = safeResponseText(text, secrets);
  let tail = 0;
  for (const secret of secrets.filter(Boolean)) {
    for (const value of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      for (let n = Math.min(value.length - 1, safe.length); n > tail; n--) {
        if (safe.endsWith(value.slice(0, n))) { tail = n; break; }
      }
    }
  }
  return tail ? safe.slice(0, -tail) + '[凭证片段已隐藏]' : safe;
}
// 最近六次请求，单次长度沿用AiClient上限。没有Storage/IndexedDB或普通日志写入。
export class StageResponseStore {
  private records: readonly StageResponse[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.records;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(records: readonly StageResponse[]) { this.records = records; this.listeners.forEach(listener => listener()); }
  clear = () => this.publish([]);
  begin(scope: Pick<StageResponse, 'saveId' | 'turnId' | 'stage' | 'storyRevision' | 'protocol'>) {
    const id = crypto.randomUUID();
    this.publish([freeze({ ...scope, id, status: 'pending' as const }), ...this.records].slice(0, 6));
    return id;
  }
  update(id: string, patch: Partial<Pick<StageResponse, 'text' | 'nativeReasoning' | 'normalized' | 'status' | 'error'>>, secrets: readonly string[]) {
    this.publish(this.records.map(item => item.id === id ? freeze({ ...item, ...patch,
      ...(patch.text === undefined ? {} : { text: safeResponseText(patch.text, secrets) }),
      ...(patch.nativeReasoning === undefined ? {} : { nativeReasoning: safeResponseText(patch.nativeReasoning, secrets) }),
      ...(patch.normalized === undefined ? {} : { normalized: safeResponseText(patch.normalized, secrets) }),
    }) : item));
  }
}
export const stageResponses = new StageResponseStore();
