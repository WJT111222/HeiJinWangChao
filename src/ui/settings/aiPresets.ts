import { defaultUrls } from '../../services/ai/configuration';
import type { Channel, Protocol } from '../../services/ai/configuration';

// 「服务商」只是界面上的快捷选择：最终仍保存为原有的协议 + 服务地址，不改变 AI 配置格式。
export type PresetId = 'openai' | 'claude' | 'gemini' | 'deepseek' | 'compat' | 'local';
export interface Preset { id: PresetId; label: string; sub: string; protocol: Protocol; url: string; name: string; official: boolean }
export const localUrl = 'http://localhost:11434/v1';
export const presets: readonly Preset[] = [
  { id: 'openai', label: 'OpenAI', sub: '官方', protocol: 'openai', url: defaultUrls.openai, name: 'OpenAI 官方', official: true },
  { id: 'claude', label: 'Claude', sub: '官方', protocol: 'anthropic', url: defaultUrls.anthropic, name: 'Claude 官方', official: true },
  { id: 'gemini', label: 'Gemini', sub: '官方', protocol: 'gemini', url: defaultUrls.gemini, name: 'Gemini 官方', official: true },
  { id: 'deepseek', label: 'DeepSeek', sub: '官方', protocol: 'deepseek', url: defaultUrls.deepseek, name: 'DeepSeek 官方', official: true },
  { id: 'compat', label: 'OpenAI 兼容', sub: '中转／其他', protocol: 'openai', url: '', name: 'OpenAI 兼容', official: false },
  { id: 'local', label: '本地模型', sub: 'Ollama 等', protocol: 'openai', url: localUrl, name: '本地模型', official: false },
];
export const presetById = (id: PresetId) => presets.find((preset) => preset.id === id)!;
export const protocolNames: Record<Protocol, string> = { openai: 'OpenAI 兼容', anthropic: 'Claude 格式', gemini: 'Gemini 格式', deepseek: 'DeepSeek 格式' };

const trim = (url: string) => url.trim().replace(/\/+$/, '');
/** 由已保存的协议与地址推断服务商；只用于显示与快捷切换。 */
export function detectPreset(channel: Pick<Channel, 'protocol' | 'baseUrl'>): PresetId {
  // 以真实地址为准：只有地址就是官方地址时才算官方，DeepSeek 格式的中转地址按「OpenAI 兼容」显示。
  const official = presets.find((preset) => preset.official && preset.protocol === channel.protocol && trim(preset.url) === trim(channel.baseUrl));
  if (official) return official.id;
  try {
    const host = new URL(channel.baseUrl).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return 'local';
  } catch { /* 无效地址按 OpenAI 兼容显示，保存时再提示。 */ }
  return 'compat';
}
export function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}
