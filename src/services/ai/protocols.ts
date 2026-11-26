import { compatibleBase } from './compatibleEndpoints';
import type { Sampling } from '../../presets/package';
import type { RequestSnapshot } from './snapshot';
import { secretFor } from './snapshot';
import { AiError } from './errors';
import { attachFailureDiagnostic, classifyUpstreamPayload } from './failureDiagnostic';
import { deepseekVariablesThinking, thinkingParameters } from './thinking';
import { checkFinish, knownSamplingLimit, samplingFields, skipsPresetSampling, skipsTemperature, usesCompletionTokens } from './compat';
import type { PresetSamplingInspection } from './compat';
import { isOpenAiCompatible } from './configuration';
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  /** 本次输入中命中提示缓存的 Token（供应商返回才有）；已包含在 inputTokens 内。 */
  cacheReadTokens?: number;
  /** 本次写入提示缓存的 Token（目前只有 Claude 返回）；已包含在 inputTokens 内。 */
  cacheWriteTokens?: number;
}
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const string = (value: unknown) => (typeof value === 'string' ? value : '');
export function endpoint(snapshot: RequestSnapshot, path: string) {
  if (isOpenAiCompatible(snapshot.channel.protocol)) return compatibleBase(snapshot.channel.baseUrl) + '/' + path;
  return snapshot.channel.baseUrl.replace(/\/$/, '') + '/' + path;
}
export function authHeaders(snapshot: RequestSnapshot): Record<string, string> {
  const key = secretFor(snapshot);
  if (isOpenAiCompatible(snapshot.channel.protocol)) return { Authorization: `Bearer ${key}` };
  if (snapshot.channel.protocol === 'gemini') return { 'x-goog-api-key': key };
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}
/**
 * Claude 格式需要显式缓存标记：系统提示词整体一个，GAME_CONTEXT 里固定字段结束处一个
 * （第一个会变的字段 CURRENT_TIME 之前，见 composer.ts）。内容不变，只把同一段文字拆成两块。
 * 只对官方地址 api.anthropic.com 启用：兼容 Claude 格式的中转不一定认这些字段，
 * 一律保持原来的纯文本请求体，也不会因此额外重发请求。其他格式按前缀自动缓存，不发送这些字段。
 */
export function officialAnthropic(baseUrl: string) {
  try { return new URL(baseUrl).hostname.toLowerCase() === 'api.anthropic.com'; } catch { return false; }
}
const CACHE_MARK = { type: 'ephemeral' } as const;
const DYNAMIC_CONTEXT_MARKER = ',"CURRENT_TIME":';
export function anthropicMessage(message: AiMessage) {
  const boundary = message.role === 'user' && message.content.startsWith('<GAME_CONTEXT>')
    ? message.content.indexOf(DYNAMIC_CONTEXT_MARKER) : -1;
  if (boundary <= 0) return { role: message.role, content: message.content };
  const cut = boundary + 1;
  return { role: message.role, content: [
    { type: 'text', text: message.content.slice(0, cut), cache_control: CACHE_MARK },
    { type: 'text', text: message.content.slice(cut) },
  ] };
}
export function wireRequest(
  snapshot: RequestSnapshot,
  messages: readonly AiMessage[],
  stream: boolean,
  presetSampling?: Sampling,
) {
  if (!messages.length || !snapshot.model) throw new AiError('configuration');
  const sampling = snapshot.stage === 'story' ? presetSampling : undefined;
  const mixedSystemAllowed = !!sampling && isOpenAiCompatible(snapshot.channel.protocol);
  let userSeen = false;
  for (const message of messages) {
    if (!['system', 'user', 'assistant'].includes(message.role) || !message.content.trim())
      throw new AiError('configuration');
    if (message.role !== 'system') userSeen = true;
    else if (userSeen && !mixedSystemAllowed) throw new AiError('unsupported');
  }
  if (messages.at(-1)?.role === 'assistant' && !snapshot.useCot) throw new AiError('unsupported');
  // 使用完整确认历史，以 user 收尾；不猜测中转的预填充/Prefix 能力。
  const ordered = messages.at(-1)?.role === 'assistant'
    ? [...messages, { role: 'user' as const, content: '请按已确认的本阶段协议生成当前回合。' }]
    : messages;
  const { protocol, parameters: params, compatibility: cap } = snapshot.channel;
  const diagnostics = [...snapshot.diagnostics];
  const max = cap.maxOutputTokens ? params.maxOutputTokens : undefined;
  const thinking = thinkingParameters(snapshot.thinkingCapability, protocol === 'anthropic' ? max ?? 4096 : max);
  const desiredTemperature = sampling ? sampling.temperature : params.temperature;
  const rememberedTemperature = protocol === 'openai' && skipsTemperature(snapshot.channel, snapshot.model);
  const temperature =
    cap.temperature && !thinking.anthropic && !(protocol === 'anthropic' && (desiredTemperature ?? 0) > 1)
      && !rememberedTemperature
      ? desiredTemperature
      : undefined;
  const completionTokens = protocol === 'openai' && usesCompletionTokens(snapshot.channel, snapshot.model);
  if (completionTokens && max !== undefined) diagnostics.push('MAX_COMPLETION_TOKENS_FIELD');
  if (desiredTemperature !== undefined && temperature === undefined)
    diagnostics.push('TEMPERATURE_SKIPPED_UNSUPPORTED');
  if (params.maxOutputTokens !== undefined && max === undefined)
    diagnostics.push('MAX_TOKENS_SKIPPED_UNSUPPORTED');
  if (thinking.gemini || thinking.anthropic) diagnostics.push('NATIVE_THINKING_AUTO_ENABLED');
  const structured = snapshot.stage === 'memory' || snapshot.stage === 'phone';
  if (snapshot.stage === 'variables' && cap.jsonMode) diagnostics.push('VARIABLE_TEXT_MODE_JSON_DISABLED');
  if (structured && (!cap.jsonMode || protocol === 'anthropic'))
    diagnostics.push('NATIVE_JSON_MODE_SKIPPED_STRICT_PROMPT_RETAINED');
  const system = ordered
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = ordered.filter((m) => m.role !== 'system');
  let path: string, body: Record<string, unknown>;
  if (isOpenAiCompatible(protocol)) {
    path = 'chat/completions';
    body = {
      model: snapshot.model,
      messages: ordered,
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(max !== undefined ? completionTokens ? { max_completion_tokens: max } : { max_tokens: max } : {}),
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
        ...(thinking.gemini ? { thinkingConfig: thinking.gemini } : {}),
      },
    };
  } else {
    if (!cap.maxOutputTokens) throw new AiError('unsupported');
    path = 'messages';
    body = {
      model: snapshot.model,
      // 空系统块会被 Claude 接口拒绝；没有系统提示词时保持原来的空字符串。
      ...(officialAnthropic(snapshot.channel.baseUrl)
        ? { system: system ? [{ type: 'text', text: system, cache_control: CACHE_MARK }] : system, messages: conversation.map(anthropicMessage) }
        : { system, messages: conversation }),
      stream,
      max_tokens: max ?? 4096,
      ...(thinking.anthropic ? { thinking: thinking.anthropic } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }
  const url = endpoint(snapshot, path);
  const deepseekThinking = isOpenAiCompatible(protocol) ? deepseekVariablesThinking(url, snapshot.model, snapshot.stage) : undefined;
  if (deepseekThinking) body.thinking = deepseekThinking;
  let presetSamplingInspection: PresetSamplingInspection[] | undefined;
  if (sampling) {
    if (isOpenAiCompatible(protocol)) {
      presetSamplingInspection = [];
      for (const field of samplingFields) {
        const desired = sampling[field];
        if (desired === undefined) continue;
        const omission = field === 'temperature' && !cap.temperature ? 'channel_setting'
          : knownSamplingLimit(snapshot.channel, url, snapshot.model, field, body) ? 'known_capability'
          : (field === 'temperature' && rememberedTemperature)
            || skipsPresetSampling(snapshot.channel, url, snapshot.model, field, desired, body) ? 'remembered_rejection'
          : undefined;
        if (omission) {
          delete body[field];
          presetSamplingInspection.push({ field, desired, omission });
        } else {
          body[field] = desired;
          presetSamplingInspection.push({ field, desired, sent: desired });
        }
      }
    } else if (protocol === 'gemini') {
      Object.assign(body.generationConfig as object, {
        topP: sampling.top_p, frequencyPenalty: sampling.frequency_penalty, presencePenalty: sampling.presence_penalty,
      });
    } else {
      if (sampling.top_p !== undefined && temperature === undefined && !thinking.anthropic) body.top_p = sampling.top_p;
      else if (sampling.top_p !== undefined) diagnostics.push('PRESET_TOP_P_SKIPPED');
      if (sampling.frequency_penalty !== undefined || sampling.presence_penalty !== undefined) diagnostics.push('PRESET_PENALTIES_UNSUPPORTED');
    }
  }
  return {
    url,
    init: {
      method: 'POST',
      headers: { ...authHeaders(snapshot), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    diagnostics,
    ...(presetSamplingInspection ? { presetSamplingInspection } : {}),
  };
}
const token = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
// Anthropic input_tokens仅为未缓存部分；完整输入还包括供应商提供的缓存读/写计数。
function anthropicInputTokens(usage: Record<string, unknown>) {
  const input = token(usage.input_tokens);
  if (input === undefined) return undefined;
  const caches = [usage.cache_creation_input_tokens, usage.cache_read_input_tokens].filter((value) => value !== undefined).map(token);
  if (caches.some((value) => value === undefined)) return undefined;
  return token(caches.reduce<number>((sum, value) => sum + (value ?? 0), input));
}
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
    isOpenAiCompatible(protocol)
      ? {
          inputTokens: token(usage.prompt_tokens),
          outputTokens: token(usage.completion_tokens),
          totalTokens: token(usage.total_tokens),
          reasoningTokens: token(record(usage.completion_tokens_details).reasoning_tokens),
          // DeepSeek 返回 prompt_cache_hit_tokens；OpenAI 及多数兼容服务返回 prompt_tokens_details.cached_tokens。
          cacheReadTokens: token(usage.prompt_cache_hit_tokens) ?? token(record(usage.prompt_tokens_details).cached_tokens),
        }
      : protocol === 'gemini'
        ? {
            inputTokens: token(usage.promptTokenCount),
            outputTokens: token(usage.candidatesTokenCount),
            totalTokens: token(usage.totalTokenCount),
            reasoningTokens: token(usage.thoughtsTokenCount),
            cacheReadTokens: token(usage.cachedContentTokenCount),
          }
        : { inputTokens: anthropicInputTokens(usage), outputTokens: token(usage.output_tokens),
            reasoningTokens: token(record(usage.output_tokens_details).thinking_tokens),
            cacheReadTokens: token(usage.cache_read_input_tokens), cacheWriteTokens: token(usage.cache_creation_input_tokens) };
  return Object.values(result).some((v) => v !== undefined)
    ? Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined))
    : undefined;
}
export function responseText(value: unknown, protocol: RequestSnapshot['channel']['protocol'], allowOutputLimit = false) {
  const data = record(value);
  if (data.error) {
    const failure = new AiError('rejected');
    attachFailureDiagnostic(failure, classifyUpstreamPayload(data, { transport: 'json' }));
    throw failure;
  }
  if (isOpenAiCompatible(protocol)) {
    const choice = record(array(data.choices)[0]);
    checkFinish(choice.finish_reason, allowOutputLimit);
    const content = record(choice.message).content;
    return typeof content === 'string'
      ? content
      : array(content)
          .filter((part) => record(part).type === 'text')
          .map((part) => string(record(part).text))
          .join('');
  }
  if (protocol === 'gemini') {
    if (record(data.promptFeedback).blockReason) throw new AiError('content_filter');
    const candidate = record(array(data.candidates)[0]);
    checkFinish(candidate.finishReason, allowOutputLimit);
    return array(record(candidate.content).parts)
      .filter((p) => record(p).thought !== true)
      .map((p) => string(record(p).text))
      .join('');
  }
  checkFinish(data.stop_reason, allowOutputLimit);
  return array(data.content)
    .filter((part) => record(part).type === 'text')
    .map((part) => string(record(part).text))
    .join('');
}

// 只读取协议实际公开的文本，不解释为世界事实；不提取签名、redacted 或隐藏推理。
export function nativeReasoning(value: unknown, protocol: RequestSnapshot['channel']['protocol'], streaming = false): string {
  const data = record(value);
  if (isOpenAiCompatible(protocol)) {
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
