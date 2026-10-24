import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { AiError } from './errors';
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const string = (value: unknown) => (typeof value === 'string' ? value : '');
export function endpoint(snapshot: RequestSnapshot, path: string) {
  return snapshot.channel.baseUrl.replace(/\/$/, '') + '/' + path;
}
export function authHeaders(snapshot: RequestSnapshot): Record<string, string> {
  const key = secretFor(snapshot);
  if (snapshot.channel.protocol === 'openai') return { Authorization: `Bearer ${key}` };
  if (snapshot.channel.protocol === 'gemini') return { 'x-goog-api-key': key };
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}
export function wireRequest(
  snapshot: RequestSnapshot,
  messages: readonly AiMessage[],
  stream: boolean,
) {
  if (!messages.length || !snapshot.model) throw new AiError('configuration');
  let userSeen = false;
  for (const message of messages) {
    if (!['system', 'user', 'assistant'].includes(message.role) || !message.content.trim())
      throw new AiError('configuration');
    if (message.role !== 'system') userSeen = true;
    else if (userSeen) throw new AiError('unsupported');
  }
  if (messages.at(-1)?.role === 'assistant' && !snapshot.useCot) throw new AiError('unsupported');
  // 使用完整确认历史，以 user 收尾；不猜测中转的预填充/Prefix 能力。
  const ordered = messages.at(-1)?.role === 'assistant'
    ? [...messages, { role: 'user' as const, content: '请按已确认的本阶段协议生成当前回合。' }]
    : messages;
  const { protocol, parameters: params, compatibility: cap } = snapshot.channel;
  const diagnostics = [...snapshot.diagnostics];
  const temperature =
    cap.temperature && !(protocol === 'anthropic' && (params.temperature ?? 0) > 1)
      ? params.temperature
      : undefined;
  if (params.temperature !== undefined && temperature === undefined)
    diagnostics.push('TEMPERATURE_SKIPPED_UNSUPPORTED');
  const max = cap.maxOutputTokens ? params.maxOutputTokens : undefined;
  if (params.maxOutputTokens !== undefined && max === undefined)
    diagnostics.push('MAX_TOKENS_SKIPPED_UNSUPPORTED');
  const structured = snapshot.stage !== 'story';
  if (structured && (!cap.jsonMode || protocol === 'anthropic'))
    diagnostics.push('NATIVE_JSON_MODE_SKIPPED_STRICT_PROMPT_RETAINED');
  const system = ordered
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = ordered.filter((m) => m.role !== 'system');
  let path: string, body: Record<string, unknown>;
  if (protocol === 'openai') {
    path = 'chat/completions';
    body = {
      model: snapshot.model,
      messages: ordered,
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max !== undefined ? { max_tokens: max } : {}),
      ...(structured && cap.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
  } else if (protocol === 'gemini') {
    path = `models/${encodeURIComponent(snapshot.model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(max !== undefined ? { maxOutputTokens: max } : {}),
        ...(structured && cap.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
  } else {
    if (!cap.maxOutputTokens) throw new AiError('unsupported');
    path = 'messages';
    body = {
      model: snapshot.model,
      system,
      messages: conversation,
      stream,
      max_tokens: max ?? 4096,
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }
  return {
    url: endpoint(snapshot, path),
    init: {
      method: 'POST',
      headers: { ...authHeaders(snapshot), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    diagnostics,
  };
}
const token = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
export function usageFrom(
  value: unknown,
  protocol: RequestSnapshot['channel']['protocol'],
): Usage | undefined {
  const data = record(value);
  const usage =
    protocol === 'gemini'
      ? record(data.usageMetadata)
      : record(data.usage ?? record(data.message).usage);
  const result: Usage =
    protocol === 'openai'
      ? {
          inputTokens: token(usage.prompt_tokens),
          outputTokens: token(usage.completion_tokens),
          totalTokens: token(usage.total_tokens),
          reasoningTokens: token(record(usage.completion_tokens_details).reasoning_tokens),
        }
      : protocol === 'gemini'
        ? {
            inputTokens: token(usage.promptTokenCount),
            outputTokens: token(usage.candidatesTokenCount),
            totalTokens: token(usage.totalTokenCount),
            reasoningTokens: token(usage.thoughtsTokenCount),
          }
        : { inputTokens: token(usage.input_tokens), outputTokens: token(usage.output_tokens) };
  return Object.values(result).some((v) => v !== undefined)
    ? Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined))
    : undefined;
}
export function responseText(value: unknown, protocol: RequestSnapshot['channel']['protocol']) {
  const data = record(value);
  if (data.error) throw new AiError('rejected');
  if (protocol === 'openai') {
    const choice = record(array(data.choices)[0]);
    if (choice.finish_reason === 'length') throw new AiError('output_limit');
    if (choice.finish_reason && choice.finish_reason !== 'stop')
      throw new AiError('stream_interrupted');
    const content = record(choice.message).content;
    return typeof content === 'string'
      ? content
      : array(content)
          .filter((part) => record(part).type === 'text')
          .map((part) => string(record(part).text))
          .join('');
  }
  if (protocol === 'gemini') {
    const candidate = record(array(data.candidates)[0]);
    if (candidate.finishReason === 'MAX_TOKENS') throw new AiError('output_limit');
    if (candidate.finishReason && candidate.finishReason !== 'STOP')
      throw new AiError('stream_interrupted');
    return array(record(candidate.content).parts)
      .filter((p) => record(p).thought !== true)
      .map((p) => string(record(p).text))
      .join('');
  }
  if (data.stop_reason === 'max_tokens') throw new AiError('output_limit');
  if (data.stop_reason && data.stop_reason !== 'end_turn' && data.stop_reason !== 'stop_sequence')
    throw new AiError('stream_interrupted');
  return array(data.content)
    .filter((part) => record(part).type === 'text')
    .map((part) => string(record(part).text))
    .join('');
}

// 只读取协议实际公开的文本，不解释为世界事实；不提取签名、redacted 或隐藏推理。
export function nativeReasoning(value: unknown, protocol: RequestSnapshot['channel']['protocol'], streaming = false): string {
  const data = record(value);
  if (protocol === 'openai') {
    const choice = record(array(data.choices)[0]);
    const message = record(streaming ? choice.delta : choice.message);
    return [message.reasoning_content, message.reasoning, message.reasoning_text]
      .find((part): part is string => typeof part === 'string' && part.length > 0) ?? '';
  }
  if (protocol === 'gemini') return array(record(record(array(data.candidates)[0]).content).parts)
    .filter((part) => record(part).thought === true).map((part) => string(record(part).text)).join('');
  if (!streaming) return array(data.content).filter((part) => record(part).type === 'thinking')
    .map((part) => string(record(part).thinking)).join('');
  if (data.type === 'content_block_start' && record(data.content_block).type === 'thinking')
    return string(record(data.content_block).thinking);
  return data.type === 'content_block_delta' && record(data.delta).type === 'thinking_delta'
    ? string(record(data.delta).thinking) : '';
}
