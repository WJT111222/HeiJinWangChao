import type { Channel } from './configuration';
import { AiError } from './errors';

// 官方接口与中转站在「结束原因」上的写法并不统一：Claude 经 OpenAI 格式中转常原样返回 end_turn，
// 部分自部署推理服务返回 eos，Gemini 兼容层可能是大写 STOP。这里只归类明确的取值，未知值仍按不完整处理。
const finished = new Set(['stop', 'end_turn', 'stop_sequence', 'eos', 'eos_token']);
const truncated = new Set(['length', 'max_tokens']);
const filtered = new Set(['content_filter', 'sensitive', 'safety', 'refusal', 'prohibited_content', 'blocklist', 'spii', 'recitation', 'image_safety']);

/** 返回 true 表示正常结束；undefined 表示这一块没有结束原因；其他情况直接抛出对应错误。 */
export function checkFinish(reason: unknown, allowOutputLimit = false): true | undefined {
  if (reason === undefined || reason === null || reason === '') return undefined;
  const value = typeof reason === 'string' ? reason.toLowerCase() : '';
  if (finished.has(value)) return true;
  if (truncated.has(value) && allowOutputLimit) return true;
  if (truncated.has(value)) throw new AiError('output_limit');
  if (filtered.has(value)) throw new AiError('content_filter');
  throw new AiError('stream_interrupted');
}

/**
 * 部分推理模型（自部署或经中转）把思考过程以 <think>…</think> 写在正文最前面。
 * 只处理开头的这一块，正文中间的同名文字原样保留；项目自己的 <thinking> 标签不受影响。
 */
export class LeadingThink {
  private state: 'start' | 'think' | 'after' | 'content' = 'start';
  private pending = '';
  reasoning = '';

  /** 喂入一段正文增量，返回可以立即交给正文的部分；思考部分进入 reasoning。 */
  push(delta: string): { content: string; reasoning: string } {
    this.pending += delta;
    let content = '', reasoning = '';
    for (;;) {
      if (this.state === 'start') {
        const head = this.pending.trimStart();
        if (!head || ('<think>'.startsWith(head) && head.length < 7)) break;
        if (head.startsWith('<think>')) { this.pending = head.slice(7); this.state = 'think'; continue; }
        this.state = 'content'; continue;
      }
      if (this.state === 'think') {
        const end = this.pending.indexOf('</think>');
        if (end < 0) {
          // 保留可能是半个结束标签的尾巴。
          const keep = Math.min(this.pending.length, 7);
          let cut = this.pending.length;
          for (let size = keep; size > 0; size--) if ('</think>'.startsWith(this.pending.slice(-size))) { cut = this.pending.length - size; break; }
          reasoning += this.pending.slice(0, cut); this.pending = this.pending.slice(cut); break;
        }
        reasoning += this.pending.slice(0, end); this.pending = this.pending.slice(end + 8); this.state = 'after'; continue;
      }
      if (this.state === 'after') {
        this.pending = this.pending.trimStart();
        if (!this.pending) break;
        this.state = 'content'; continue;
      }
      content += this.pending; this.pending = ''; break;
    }
    this.reasoning += reasoning;
    return { content, reasoning };
  }

  /** 输入结束：还在等待判断的开头内容属于正文；未闭合的思考块整体算作思考。 */
  end(): { content: string; reasoning: string } {
    const rest = this.pending; this.pending = '';
    if (this.state === 'start' || this.state === 'content') { this.state = 'content'; return { content: rest, reasoning: '' }; }
    if (this.state === 'think') { this.reasoning += rest; return { content: '', reasoning: rest }; }
    return { content: '', reasoning: '' };
  }
}

export function splitLeadingThink(text: string) {
  const splitter = new LeadingThink(), first = splitter.push(text), last = splitter.end();
  return { content: first.content + last.content, reasoning: splitter.reasoning };
}

// OpenAI 新一代推理模型不接受 max_tokens（须用 max_completion_tokens），也常不接受自定义 temperature。
// 官方地址直接使用新字段；其他地址只在服务明确报「不支持该参数」后，对同一渠道和模型记住，下次请求生效，不自动重发。
type Route = Pick<Channel, 'id' | 'protocol' | 'baseUrl'>;
export type AdjustedParameter = 'max_tokens' | 'temperature';
type Reasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const samplingFields = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty'] as const;
type SamplingField = typeof samplingFields[number];
export type PresetSamplingInspection = { field: SamplingField; desired: number } & (
  { sent: number } | { omission: 'known_capability' | 'remembered_rejection' | 'channel_setting' }
);
type SamplingRule = { kind: 'unsupported' } | { kind: 'default_only'; rejectedValue: number };
const adjusted = new Map<string, Set<AdjustedParameter>>();
const presetAdjustments = new Map<string, Map<string, SamplingRule>>();
const keyFor = (route: Route, model: string) => JSON.stringify([route.id, route.protocol, route.baseUrl, model]);
function officialOpenAi(route: Route) {
  try { return route.protocol === 'openai' && new URL(route.baseUrl).hostname === 'api.openai.com'; } catch { return false; }
}
export function usesCompletionTokens(route: Route, model: string) {
  return officialOpenAi(route) || adjusted.get(keyFor(route, model))?.has('max_tokens') === true;
}
export function skipsTemperature(route: Route, model: string) {
  return adjusted.get(keyFor(route, model))?.has('temperature') === true;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value)) : {};
/**
 * 只在服务明确拒绝「本次实际发送的参数」时才记住：
 * - max_tokens：错误类别为 unsupported_parameter（或标准原文「Unsupported parameter: 'max_tokens'」），且建议改用 max_completion_tokens；
 * - temperature：错误类别为 unsupported_parameter / unsupported_value（模型只接受默认值），或对应的标准原文。
 * 数值越界（invalid_value、「must be <= 1」等）、方向相反的建议和其他模糊提示一律不记，不改动玩家参数。
 */
export function unsupportedParameter(raw: unknown, sent: { maxTokens: boolean; temperature: boolean }): AdjustedParameter | undefined {
  const error = object(object(raw).error), message = typeof error.message === 'string' ? error.message : '';
  const code = typeof error.code === 'string' ? error.code : '';
  if (sent.maxTokens) {
    const unsupported = (code === 'unsupported_parameter' && error.param === 'max_tokens') || /Unsupported parameter: 'max_tokens'/.test(message);
    const suggestion = /\buse\s+'?max_completion_tokens'?/i.test(message);
    if (unsupported && suggestion && error.param !== 'max_completion_tokens') return 'max_tokens';
  }
  if (sent.temperature) {
    const unsupported = (['unsupported_parameter', 'unsupported_value'].includes(code) && error.param === 'temperature')
      || /Unsupported (?:value|parameter): 'temperature'/.test(message);
    const range = /must be|out of range|between|greater than|less than|<=|>=/i.test(message);
    if (unsupported && code !== 'invalid_value' && !range) return 'temperature';
  }
  return undefined;
}
export function rememberUnsupported(route: Route, model: string, parameter: AdjustedParameter) {
  const key = keyFor(route, model);
  if (!adjusted.has(key) && adjusted.size >= 500) adjusted.delete(adjusted.keys().next().value ?? '');
  const set = adjusted.get(key) ?? new Set<AdjustedParameter>(); set.add(parameter); adjusted.set(key, set);
}
export function clearAdjustedParameters() { adjusted.clear(); presetAdjustments.clear(); }

// OpenAI 官方 Chat Completions，仅使用已核对的模型 ID 和参数限制（见 BATCH1.md）。
const officialChat = 'https://api.openai.com/v1/chat/completions';
const withoutTemperatureOrTopP = new Set([
  'gpt-5', 'gpt-5-2025-08-07', 'gpt-5-mini', 'gpt-5-mini-2025-08-07', 'gpt-5-nano', 'gpt-5-nano-2025-08-07',
]);
const samplingWithReasoningNone = new Set(['gpt-5.1', 'gpt-5.1-2025-11-13', 'gpt-5.2', 'gpt-5.2-2025-12-11']);
const reasoningLevels = new Set<string>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
function isOfficialChat(route: Route, url: string) {
  return route.protocol === 'openai' && url === officialChat;
}
function reasoningEffort(route: Route, url: string, model: string, body: Record<string, unknown>): Reasoning | undefined {
  if (typeof body.reasoning_effort === 'string' && reasoningLevels.has(body.reasoning_effort))
    return body.reasoning_effort as Reasoning;
  if (!Object.hasOwn(body, 'reasoning_effort') && isOfficialChat(route, url) && samplingWithReasoningNone.has(model))
    return 'none';
}
export function knownSamplingLimit(route: Route, url: string, model: string, field: SamplingField, body: Record<string, unknown>) {
  if ((field !== 'temperature' && field !== 'top_p') || !isOfficialChat(route, url)) return false;
  if (withoutTemperatureOrTopP.has(model)) return true;
  const effort = reasoningEffort(route, url, model, body);
  return samplingWithReasoningNone.has(model) && effort !== undefined && effort !== 'none';
}
function samplingKey(route: Route, url: string, model: string, field: SamplingField, body: Record<string, unknown>) {
  // 未指定的中转推理设置只与同样未指定的请求匹配，不把它当成 none。
  const effort = reasoningEffort(route, url, model, body);
  if (!effort && Object.hasOwn(body, 'reasoning_effort')) return;
  return `${field}:${effort ?? 'unspecified'}`;
}
export function skipsPresetSampling(
  route: Route, url: string, model: string, field: SamplingField, desired: number, body: Record<string, unknown>,
) {
  const bucket = samplingKey(route, url, model, field, body);
  if (!bucket) return false;
  const rule = presetAdjustments.get(keyFor(route, model))?.get(bucket);
  return rule?.kind === 'unsupported' || (rule?.kind === 'default_only' && rule.rejectedValue === desired);
}
const plainRejection = /^(?:unsupported parameter:\s*)?['"`]?(temperature|top_p|frequency_penalty|presence_penalty)['"`]?(?:\s+(?:is\s+)?(?:not supported|unsupported)(?:\s+(?:with|by|for) this model)?)?\.?$/i;
const reasoningRejection = /^(?:unsupported parameter:\s*)?['"`]?(temperature|top_p|frequency_penalty|presence_penalty)['"`]?\s+is\s+(only supported|not supported) when reasoning_effort (?:is|=) ['"`]?(none|minimal|low|medium|high|xhigh|max)['"`]?\.?$/i;
const defaultOnlyRejection = /^Unsupported value:\s*['"`](temperature|top_p|frequency_penalty|presence_penalty)['"`] does not support (-?\d+(?:\.\d+)?) with this model\. Only the default(?: \((-?\d+(?:\.\d+)?)\))? value is supported\.?$/i;

export function rememberPresetSamplingRejection(
  route: Route, url: string, model: string, raw: unknown, sent: Record<string, unknown>,
) {
  const error = object(object(raw).error);
  if (error.message != null && typeof error.message !== 'string') return false;
  const message = error.message?.trim() ?? '';
  const code = error.code;
  if (code != null && code !== 'unsupported_parameter' && code !== 'unsupported_value') return false;

  const conditional = reasoningRejection.exec(message);
  const defaults = defaultOnlyRejection.exec(message);
  // 部分中转用 param 指定字段，message 仅说明默认值。
  const briefDefault = code === 'unsupported_value' && typeof error.param === 'string'
    ? /^Only the default(?: \((-?\d+(?:\.\d+)?)\))? value is supported\.?$/i.exec(message)
    : null;
  const plain = plainRejection.exec(message);
  const named = conditional?.[1] ?? defaults?.[1] ?? plain?.[1];
  const field = samplingFields.find((candidate) => candidate === (named ?? error.param));
  if (!field || (error.param != null && error.param !== field) || !Object.hasOwn(sent, field)) return false;
  const value = sent[field];
  if (typeof value !== 'number') return false;

  let rule: SamplingRule;
  const fullDefaultMatch = defaults && Number(defaults[2]) === value
    && (defaults[3] === undefined || Number(defaults[3]) !== value);
  const briefDefaultMatch = briefDefault && (briefDefault[1] === undefined || Number(briefDefault[1]) !== value);
  if (fullDefaultMatch || briefDefaultMatch) {
    // 默认值声明只证明本次值被拒，保留其他合法取值的出站机会。
    rule = { kind: 'default_only', rejectedValue: value };
  } else if (code === 'unsupported_value') {
    return false;
  } else if (conditional) {
    const effort = reasoningEffort(route, url, model, sent);
    const namedEffort = conditional[3].toLowerCase();
    const rejectedEffort = conditional[2].toLowerCase() === 'only supported'
      ? effort !== namedEffort : effort === namedEffort;
    if (!effort || !rejectedEffort) return false;
    rule = { kind: 'unsupported' };
  } else if ((plain && /unsupported|not supported/i.test(message)) || (!message && code === 'unsupported_parameter')) {
    rule = { kind: 'unsupported' };
  } else {
    return false;
  }
  const bucket = samplingKey(route, url, model, field, sent);
  if (!bucket) return false;
  const key = keyFor(route, model);
  if (!presetAdjustments.has(key) && presetAdjustments.size >= 500)
    presetAdjustments.delete(presetAdjustments.keys().next().value ?? '');
  const rules = presetAdjustments.get(key) ?? new Map<string, SamplingRule>();
  rules.set(bucket, rule);
  presetAdjustments.set(key, rules);
  return true;
}
