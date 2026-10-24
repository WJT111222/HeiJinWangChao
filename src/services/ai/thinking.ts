import type { Channel } from './configuration';

// 官方原生协议的已核实型号契约（不是玩家白名单）。未知型号不外推未来能力。
// https://ai.google.dev/gemini-api/docs/generate-content/thinking
// https://platform.claude.com/docs/en/build-with-claude/thinking
export type ThinkingCapability = 'gemini-summary' | 'gemini-dynamic' | 'anthropic-adaptive' | 'anthropic-enabled' | 'none';
type Route = Pick<Channel, 'id' | 'protocol' | 'baseUrl'>;
const advertised = new Map<string, ThinkingCapability>();
const keyFor = (route: Route, model: string) => JSON.stringify([route.id, route.protocol, route.baseUrl, model.replace(/^models\//, '')]);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value)) : {};

// 只在已有、用户触发的免费Models查询中读取官方字段，不为能力探测另发请求。
// 原生中转与官方端点同规则；服务器明确不支持时优先于型号契约。
export function rememberThinkingCapability(route: Route, model: string, raw: unknown) {
  const item = object(raw);
  let capability: ThinkingCapability | undefined;
  if (route.protocol === 'gemini' && typeof item.thinking === 'boolean') {
    const baseModel = typeof item.baseModelId === 'string' ? item.baseModelId : model;
    capability = item.thinking ? documentedThinking(route.protocol, baseModel) ?? 'gemini-summary' : 'none';
  }
  if (route.protocol === 'anthropic') {
    const thinking = object(object(item.capabilities).thinking), types = object(thinking.types);
    if (thinking.supported === false) capability = 'none';
    else if (thinking.supported === true) {
      if (object(types.adaptive).supported === true) capability = 'anthropic-adaptive';
      else if (object(types.enabled).supported === true) capability = 'anthropic-enabled';
      else capability = 'none';
    }
  }
  if (capability !== undefined) {
    if (advertised.size >= 500) advertised.delete(advertised.keys().next().value ?? '');
    advertised.set(keyFor(route, model), capability);
  } // 缺省字段不撤销此前明确的能力声明/拒绝；仅新的明确声明可覆盖。
}
export function clearThinkingCapabilities() { advertised.clear(); }
function documentedThinking(protocol: Channel['protocol'], model: string): ThinkingCapability | undefined {
  const id = model.replace(/^models\//, '');
  if (protocol === 'gemini') {
    if (id === 'gemini-2.5-flash-lite') return 'gemini-dynamic';
    if (/^gemini-2\.5-(?:pro|flash)$/.test(id)) return 'gemini-summary';
    if (/^gemini-3-(?:pro|flash)(?:-preview)?$/.test(id)
      || /^gemini-3\.1-(?:pro|flash-lite)(?:-preview)?$/.test(id)
      || /^gemini-3\.5-flash-lite$/.test(id) || /^gemini-3\.[68]-flash$/.test(id)
      || id === 'gemini-4-argon') return 'gemini-summary';
  }
  if (protocol === 'anthropic') {
    if (/^claude-(?:opus-4-[678]|sonnet-4-6|(?:opus|sonnet|haiku)-5(?:-5)?|(?:fable|mythos)-5(?:-1)?)(?:-\d{8})?$/.test(id)
      || id === 'claude-mythos-preview') return 'anthropic-adaptive';
    if (/^claude-(?:(?:opus|sonnet|haiku)-4-5|opus-4-1|(?:opus|sonnet)-4|3-7-sonnet)(?:-\d{8}|-latest)?$/.test(id)) return 'anthropic-enabled';
  }
  return undefined;
}
export function thinkingCapability(route: Route, model: string) {
  return advertised.get(keyFor(route, model)) ?? documentedThinking(route.protocol, model) ?? 'none';
}
export function thinkingParameters(capability: ThinkingCapability, maxOutputTokens: number | undefined) {
  if (capability === 'gemini-summary') return { gemini: { includeThoughts: true } };
  if (capability === 'gemini-dynamic') return { gemini: { includeThoughts: true, thinkingBudget: -1 } };
  if (capability === 'anthropic-adaptive') return { anthropic: { type: 'adaptive', display: 'summarized' } };
  // 不提高玩家上限；达不到官方最小thinking预算时用正常请求，不阻止生成。
  if (capability === 'anthropic-enabled' && maxOutputTokens !== undefined && maxOutputTokens > 1024)
    return { anthropic: { type: 'enabled', budget_tokens: 1024 } };
  return {};
}

export function unsupportedThinkingParameter(raw: unknown) {
  const error = object(object(raw).error);
  const fields = [error.param, ...((Array.isArray(error.details) ? error.details : []).flatMap((detail) => {
    const violations = object(detail).fieldViolations;
    return Array.isArray(violations) ? violations.map((item) => object(item).field) : [];
  }))];
  if (fields.some((field) => typeof field === 'string' && /^(?:thinking(?:\.|$)|generationConfig\.thinkingConfig(?:\.|$)|generation_config\.thinking_config(?:\.|$))/.test(field))) return true;
  // 仅识别API的明确未知参数错误，不解释供应商任意文本或游戏自然语言。
  return typeof error.message === 'string' && /Unknown name ["'](?:thinking|thinkingConfig)["']/.test(error.message);
}
export function blockThinkingCapability(route: Route, model: string) {
  if (advertised.size >= 500) advertised.delete(advertised.keys().next().value ?? '');
  advertised.set(keyFor(route, model), 'none');
}
