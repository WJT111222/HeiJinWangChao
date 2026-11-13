import type { Channel } from './configuration';
import { AiError } from './errors';

// 官方接口与中转站在「结束原因」上的写法并不统一：Claude 经 OpenAI 格式中转常原样返回 end_turn，
// 部分自部署推理服务返回 eos，Gemini 兼容层可能是大写 STOP。这里只归类明确的取值，未知值仍按不完整处理。
const finished = new Set(['stop', 'end_turn', 'stop_sequence', 'eos', 'eos_token']);
const truncated = new Set(['length', 'max_tokens']);
const filtered = new Set(['content_filter', 'sensitive', 'safety', 'refusal', 'prohibited_content', 'blocklist', 'spii', 'recitation', 'image_safety']);

/** 返回 true 表示正常结束；undefined 表示这一块没有结束原因；其他情况直接抛出对应错误。 */
export function checkFinish(reason: unknown): true | undefined {
  if (reason === undefined || reason === null || reason === '') return undefined;
  const value = typeof reason === 'string' ? reason.toLowerCase() : '';
  if (finished.has(value)) return true;
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
const adjusted = new Map<string, Set<AdjustedParameter>>();
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
/** 只识别 OpenAI 格式的明确参数错误：error.param 或标准报错原文，不解读其他自然语言。 */
export function unsupportedParameter(raw: unknown): AdjustedParameter | undefined {
  const error = object(object(raw).error), message = typeof error.message === 'string' ? error.message : '';
  if (error.param === 'max_tokens' || /\bmax_completion_tokens\b/.test(message) && /\bmax_tokens\b/.test(message)) return 'max_tokens';
  if (error.param === 'temperature' || /Unsupported (?:value|parameter): 'temperature'/.test(message)) return 'temperature';
  return undefined;
}
export function rememberUnsupported(route: Route, model: string, parameter: AdjustedParameter) {
  const key = keyFor(route, model);
  if (!adjusted.has(key) && adjusted.size >= 500) adjusted.delete(adjusted.keys().next().value ?? '');
  const set = adjusted.get(key) ?? new Set<AdjustedParameter>(); set.add(parameter); adjusted.set(key, set);
}
export function clearAdjustedParameters() { adjusted.clear(); }
