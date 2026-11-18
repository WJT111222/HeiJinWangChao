import type { Protocol } from '../../services/ai/configuration';
import { isOpenAiCompatible, defaultAiConfig, newChannel } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { defaultSettings } from '../../ui/settings/model';
import { STORY_OUTPUT_TOOL } from '../../services/ai/storyToolContract';
import { worldNarrative } from './world';

export const compatibilityProtocols: Protocol[] = ['openai', 'deepseek', 'gemini', 'anthropic'];
/** Labels exercise local model/Thinking selection, not verified live-model support. */
export const compatibilityModels: Record<Protocol, string> = {
  openai: 'gpt-4.1', deepseek: 'deepseek-chat', gemini: 'gemini-2.5-flash', anthropic: 'claude-sonnet-4-6',
};
export const publicThought = '公开思考：只依据已经给出的事实，不代替玩家决定。';
export const privatePlan = 'MATRIX_PRIVATE_PLAN_仅主动查看原文。';
export const shortNarrative = `【旁白】${worldNarrative}\n【林舟】“街上人很多。”\n【旁白】牌上的数字写着 3<5，雨水映着灯光🙂。`;
export const longNarrative = shortNarrative + '\n\n' + Array.from({ length: 240 }, (_, index) =>
  `【旁白】第${index + 1}段。雨水沿着屋檐落下，玻璃上映出街口的灯。\\ 路牌上的引号“原样保留”，人物没有得到新的资产、职位或秘密。\n【现场人物】“雨还没停。”`).join('\n\n');
export const storyEnvelope = (narrative = shortNarrative) => `<thinking>${privatePlan}</thinking><正文>${narrative}</正文><短期记忆>用餐结束，观察街道。</短期记忆><变量规划>[]</变量规划>`;
export type ResponseEnding = 'normal' | 'limit' | 'filter' | 'missing';
export interface CompatibilityReply {
  protocol: Protocol;
  tool: boolean;
  stream: boolean;
  text: string;
  reasoning?: string;
  ending?: ResponseEnding;
  multiple?: boolean;
  badIdentity?: boolean;
  badArguments?: boolean;
  chunkSize?: number;
}
export function compatibilitySetup(protocol: Protocol, tool: boolean, stream: boolean) {
  const channel = newChannel(protocol), config = defaultAiConfig(), values = new Map<string, string>();
  channel.defaultModel = compatibilityModels[protocol]; channel.baseUrl = `https://compatibility.mock.invalid/${protocol}`;
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: channel.defaultModel };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'fictional-phase3-key');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 12; settings.prompts.actionOptions = false;
  settings.runtime.storyToolOutput = tool; settings.runtime.streamStory = stream;
  for (const summary of Object.values(settings.memory.summaries)) summary.automatic = false;
  return { config, channel, vault, settings };
}
export function requestModel(protocol: Protocol, url: string, body: Record<string, unknown>) {
  return protocol === 'gemini' ? decodeURIComponent(/\/models\/([^/:]+):/.exec(url)?.[1] ?? '') : String(body.model);
}
export function mockUsage(protocol: Protocol) {
  return isOpenAiCompatible(protocol) ? { usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300,
    ...(protocol === 'deepseek' ? { prompt_cache_hit_tokens: 10 } : { prompt_tokens_details: { cached_tokens: 10 } }) } }
    : protocol === 'gemini' ? { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300, cachedContentTokenCount: 10 } }
      : { usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } };
}
export function expectedMockUsage(protocol: Protocol) {
  return protocol === 'anthropic' ? { inputTokens: 115, outputTokens: 200, cacheReadTokens: 10, cacheWriteTokens: 5 }
    : { inputTokens: 100, outputTokens: 200, totalTokens: 300, cacheReadTokens: 10 };
}
const jsonArguments = (reply: CompatibilityReply) => reply.badArguments ? { content: null } : { content: reply.text };
const reasonFor = ({ protocol, tool, ending = 'normal' }: CompatibilityReply) => ending === 'missing' ? undefined
  : ending === 'limit' ? protocol === 'gemini' ? 'MAX_TOKENS' : protocol === 'anthropic' ? 'max_tokens' : 'length'
    : ending === 'filter' ? protocol === 'gemini' ? 'SAFETY' : protocol === 'anthropic' ? 'refusal' : 'content_filter'
      : protocol === 'gemini' ? 'STOP' : protocol === 'anthropic' ? tool ? 'tool_use' : 'end_turn' : tool ? 'tool_calls' : 'stop';
export function compatibilityJson(reply: CompatibilityReply): Record<string, unknown> {
  const { protocol, tool, text, reasoning = '', multiple, badIdentity } = reply, finish = reasonFor(reply);
  if (isOpenAiCompatible(protocol)) {
    const call = { id: badIdentity ? undefined : 'native-call-1', type: 'function', function: { name: STORY_OUTPUT_TOOL, arguments: JSON.stringify(jsonArguments(reply)) } };
    return { choices: [{ index: 0, message: { ...(reasoning ? { reasoning_content: reasoning } : {}), content: tool ? null : text,
      ...(tool ? { tool_calls: multiple ? [call, { ...call, id: 'native-call-2' }] : [call] } : {}) }, finish_reason: finish }], ...mockUsage(protocol) };
  }
  if (protocol === 'gemini') {
    const call = { functionCall: { name: badIdentity ? undefined : STORY_OUTPUT_TOOL, args: jsonArguments(reply) } };
    return { candidates: [{ index: 0, content: { parts: [...(reasoning ? [{ thought: true, text: reasoning }] : []),
      ...(tool ? multiple ? [call, call] : [call] : [{ text }])] }, finishReason: finish }], ...mockUsage(protocol) };
  }
  const call = { type: 'tool_use', id: badIdentity ? undefined : 'native-call-1', name: STORY_OUTPUT_TOOL, input: jsonArguments(reply) };
  return { content: [...(reasoning ? [{ type: 'thinking', thinking: reasoning }] : []), ...(tool ? multiple ? [call, { ...call, id: 'native-call-2' }] : [call] : [{ type: 'text', text }])], stop_reason: finish, ...mockUsage(protocol) };
}
/** Genuine native payload shapes, with per-protocol terminal semantics. A frame
 * list is also used by localhost browser mocks; it performs no API calls. */
export function compatibilityFrames(reply: CompatibilityReply): Record<string, unknown>[] {
  const { protocol, tool, text, reasoning = '', badIdentity, multiple } = reply, frames: Record<string, unknown>[] = [];
  const finish = reasonFor(reply), serialized = JSON.stringify(jsonArguments(reply));
  const chunks = (value: string) => Array.from({ length: Math.ceil(value.length / (reply.chunkSize ?? 127)) }, (_, index) => value.slice(index * (reply.chunkSize ?? 127), (index + 1) * (reply.chunkSize ?? 127)));
  if (isOpenAiCompatible(protocol)) {
    if (reasoning) frames.push({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] });
    if (tool) {
      frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: badIdentity ? undefined : 'native-call-1', type: 'function', function: { name: STORY_OUTPUT_TOOL } }] } }] });
      for (const args of chunks(serialized)) frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] });
      if (multiple) frames.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'native-call-2', type: 'function', function: { name: STORY_OUTPUT_TOOL, arguments: serialized } }] } }] });
    } else for (const content of chunks(text)) frames.push({ choices: [{ index: 0, delta: { content } }] });
    if (finish !== undefined) frames.push({ choices: [{ index: 0, delta: {}, finish_reason: finish }], ...mockUsage(protocol) });
  } else if (protocol === 'gemini') {
    if (reasoning) frames.push({ candidates: [{ index: 0, content: { parts: [{ thought: true, text: reasoning }] } }] });
    if (tool) frames.push(compatibilityJson({ ...reply, reasoning: '' }));
    else {
      for (const content of chunks(text)) frames.push({ candidates: [{ index: 0, content: { parts: [{ text: content }] } }] });
      if (finish !== undefined) frames.push({ candidates: [{ index: 0, finishReason: finish }], ...mockUsage(protocol) });
    }
  } else {
    frames.push({ type: 'message_start', message: { ...mockUsage(protocol) } });
    if (reasoning) {
      frames.push({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      frames.push({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: reasoning } });
      frames.push({ type: 'content_block_stop', index: 0 });
    }
    const index = reasoning ? 1 : 0;
    frames.push({ type: 'content_block_start', index, content_block: tool
      ? { type: 'tool_use', id: badIdentity ? undefined : 'native-call-1', name: STORY_OUTPUT_TOOL, input: {} }
      : { type: 'text', text: '' } });
    for (const value of chunks(tool ? serialized : text)) frames.push({ type: 'content_block_delta', index, delta: tool ? { type: 'input_json_delta', partial_json: value } : { type: 'text_delta', text: value } });
    frames.push({ type: 'content_block_stop', index });
    if (multiple && tool) {
      frames.push({ type: 'content_block_start', index: index + 1, content_block: { type: 'tool_use', id: 'native-call-2', name: STORY_OUTPUT_TOOL, input: {} } });
      frames.push({ type: 'content_block_delta', index: index + 1, delta: { type: 'input_json_delta', partial_json: serialized } });
      frames.push({ type: 'content_block_stop', index: index + 1 });
    }
    if (finish !== undefined) {
      frames.push({ type: 'message_delta', delta: { stop_reason: finish }, usage: { output_tokens: 200 } });
      frames.push({ type: 'message_stop' });
    }
  }
  return frames;
}
export const compatibilityFrame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
export function compatibilityResponse(reply: CompatibilityReply): Response {
  if (!reply.stream) return Response.json(compatibilityJson(reply));
  const body = compatibilityFrames(reply).map(compatibilityFrame).join('')
    + (isOpenAiCompatible(reply.protocol) && reply.ending !== 'missing' ? 'data: [DONE]\n\n' : '');
  const bytes = new TextEncoder().encode(body); let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const next = Math.min(offset + 97, bytes.length); controller.enqueue(bytes.slice(offset, next)); offset = next;
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
