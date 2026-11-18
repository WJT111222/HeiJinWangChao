import { AiClient } from '../../services/ai/client';
import { channelSnapshot } from '../../services/ai/snapshot';
import { CredentialVault } from '../../services/ai/credentials';
import { newChannel } from '../../services/ai/configuration';
import type { Protocol } from '../../services/ai/configuration';
import { safeAiError } from '../../services/ai/errors';

export const responseProtocols: Protocol[] = ['openai', 'deepseek', 'gemini', 'anthropic'];
export const responseModes = ['json', 'sse', 'stream-json'] as const;
export const responseCases = ['normal', 'limit', 'filter', 'unknown-end', 'empty', 'provider-error', 'malformed', 'no-finish'] as const;
export type ResponseCase = typeof responseCases[number];
export type ResponseMode = typeof responseModes[number];
const content = '<正文>你好，中文🙂。</正文>';
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const compatible = (protocol: Protocol) => protocol === 'openai' || protocol === 'deepseek';
export function mockResponse(protocol: Protocol, mode: ResponseMode, scenario: ResponseCase, byteSize = 3) {
  const finish = scenario === 'limit' ? protocol === 'gemini' ? 'MAX_TOKENS' : 'length'
    : scenario === 'filter' ? 'content_filter' : scenario === 'unknown-end' ? 'UNRECOGNIZED_REAL_REASON'
      : scenario === 'no-finish' ? undefined : protocol === 'gemini' ? 'STOP' : protocol === 'anthropic' ? 'end_turn' : 'stop';
  const text = scenario === 'empty' ? '' : compatible(protocol) ? '<think>兼容思考</think>' + content : content;
  const native = scenario === 'empty' ? '' : '公开原生思考';
  const usage = compatible(protocol) ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
    ...(protocol === 'deepseek' ? { prompt_cache_hit_tokens: 3 } : { prompt_tokens_details: { cached_tokens: 3 } }) } }
    : protocol === 'gemini' ? { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, cachedContentTokenCount: 3 } }
      : { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } };
  const filtered = scenario === 'filter' && protocol === 'gemini' ? { promptFeedback: { blockReason: 'SAFETY' } } : {};
  const error = scenario === 'provider-error' ? { error: { code: 'provider_failure', message: 'MOCK_PRIVATE_ERROR' } } : {};
  const body = compatible(protocol)
    ? { choices: [{ message: { reasoning_content: native, content: text }, finish_reason: finish }], ...usage, ...error }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ thought: true, text: native }, { text }] }, finishReason: finish }], ...usage, ...filtered, ...error }
      : { content: [{ type: 'thinking', thinking: native }, { type: 'text', text }], stop_reason: finish, ...usage, ...error };
  const streamed = compatible(protocol)
    ? frame({ choices: [{ delta: { reasoning_content: native } }] }) + frame({ choices: [{ delta: { content: text }, finish_reason: finish }], ...usage, ...error })
      + (scenario === 'no-finish' ? '' : 'data: [DONE]\n\n')
    : protocol === 'gemini'
      ? frame({ candidates: [{ content: { parts: [{ thought: true, text: native }] } }] })
        + frame({ candidates: [{ content: { parts: [{ text }] }, finishReason: finish }], ...usage, ...filtered, ...error })
      : frame({ type: 'content_block_start', content_block: { type: 'thinking', thinking: native } })
        + frame({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
        + frame({ type: 'message_delta', delta: { stop_reason: finish }, ...usage, ...error })
        + (scenario === 'no-finish' ? '' : frame({ type: 'message_stop' }));
  if (mode !== 'sse') return new Response(scenario === 'malformed' ? '{' : JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  return splitResponse(scenario === 'malformed' ? 'data: {\n\n' : streamed, byteSize);
}
export function splitResponse(body: string, byteSize: number) {
  const bytes = new TextEncoder().encode(body); let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const next = Math.min(offset + byteSize, bytes.length);
    controller.enqueue(bytes.slice(offset, next)); offset = next;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
export function responseSnapshot(protocol: Protocol) {
  const channel = { ...newChannel(protocol), id: 'response-event-fixture', defaultModel: 'fixture-model', baseUrl: `https://events.mock.invalid/${protocol}` };
  const vault = new CredentialVault(memory(), memory()); vault.set(channel.id, 'mock-event-key');
  return channelSnapshot(channel, vault);
}
export async function captureResponse(protocol: Protocol, mode: ResponseMode, scenario: ResponseCase, allowLimit = false, byteSize = 3) {
  const sent: unknown[] = [], trace: unknown[] = [];
  const client = new AiClient(async (url, init) => {
    // Record only synthetic request data; never headers or credential values.
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), credentials: init?.credentials,
      redirect: init?.redirect, cache: init?.cache, referrerPolicy: init?.referrerPolicy });
    return mockResponse(protocol, mode, scenario, byteSize);
  });
  let outcome: unknown;
  try {
    const response = await client.generate(responseSnapshot(protocol), [{ role: 'system', content: '系统规则' }, { role: 'user', content: '合成行动' }], {
      stream: mode !== 'json', validateStoryOutputLimit: allowLimit,
      onResponseDiagnostics: value => { trace.push(['diagnostics', value]); },
      onRawResponse: value => { trace.push(['observation', value]); },
      onRawTextDelta: value => { trace.push(['raw', value]); },
      onNativeReasoningDelta: value => { trace.push(['native', value]); },
      onCompatibilityReasoningDelta: value => { trace.push(['compatibility', value]); },
      onDelta: value => { trace.push(['content', value]); },
      onReasoningDelta: value => { trace.push(['reasoning', value]); },
      onActivity: value => { trace.push(['activity', value]); },
    });
    outcome = { status: 'received', response };
  } catch (error) { outcome = { status: 'failed', error: safeAiError(error) }; }
  // JSON projection matches the pinned, immutable main fixture's serialization.
  return JSON.parse(JSON.stringify({ sent, trace, outcome })) as unknown;
}
export const responseMatrix = responseProtocols.flatMap(protocol => responseModes.flatMap(mode =>
  [...responseCases.map(scenario => ({ protocol, mode, scenario, allowLimit: false })),
    { protocol, mode, scenario: 'limit' as const, allowLimit: true }]));
export const responseCaseKey = (c: typeof responseMatrix[number]) => `${c.protocol}/${c.mode}/${c.scenario}/${c.allowLimit ? 'story-limit' : 'strict'}`;
