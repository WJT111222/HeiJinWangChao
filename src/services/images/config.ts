import { z } from 'zod';
import { CredentialVault } from '../ai/credentials';

export const backendNames = { openai: 'OpenAI 兼容', novelai: 'NovelAI', comfy: 'ComfyUI', sd: 'SD WebUI' };
export type Backend = keyof typeof backendNames;
export const templates = {
  person: '将人物档案转为单人肖像描述。保留真实年龄、身份及已知外貌，沿用给定形象锚点。',
  home: '描绘单人在家中阅读、做饭或休息的日常瞬间。自然便装、环境光，保留人物辨识度与生活空间。',
  story: '选择这个已结算片段中一个具体时刻，描述相关人物、动作与环境，保留所给人物外貌。',
  place: '描述这个地点的用途、空间、光线与材质，画面重点为环境。',
  item: '为指定物品制作单件物品展示，保留可辨识的材质与造型。',
};
export const autoLabels = {
  ordinary: '新普通 NPC 头像',
  special: '新特殊 NPC 头像',
  story: '结算剧情插画',
  item: '获得重要物品',
};
const connection = z.object({
  base: z.string().max(500),
  path: z.string().max(500),
  model: z.string().max(200),
  size: z.string().regex(/^\d{2,4}x\d{2,4}$/),
  sampler: z.string().max(100),
  scheduler: z.string().max(100),
  steps: z.number().int().min(1).max(50),
  cfg: z.number().min(0).max(30),
  seed: z.number().int().min(-1).max(4294967295),
  workflow: z.string().max(500000),
});
const namedPreset = z.object({
  name: z.string().trim().min(1).max(80),
  backend: z.enum(['openai', 'novelai', 'sd', 'comfy']),
  connection,
});
const base = {
  base: '',
  path: '',
  model: '',
  size: '1024x1024',
  steps: 28,
  cfg: 5,
  seed: -1,
  sampler: '',
  scheduler: '',
  workflow: '',
};
export const defaults = {
  enabled: false,
  backend: 'openai' as Backend,
  connections: {
    openai: { ...base, model: 'gpt-image-1' },
    novelai: { ...base, model: 'nai-diffusion-4-5-full' },
    sd: { ...base },
    comfy: { ...base },
  },
  presets: [] as z.infer<typeof namedPreset>[],
  styles: [] as string[],
  convert: false,
  textBase: '',
  textModel: '',
  positive: '',
  negative: '',
  style: '',
  templates,
  auto: { ordinary: false, special: false, story: false, item: false },
  includeImages: true,
};
const schema = z.object({
  presets: z.array(namedPreset).max(24).default([]),
  styles: z.array(z.string().min(1).max(2000)).max(24).default([]),
  enabled: z.boolean(),
  backend: z.enum(['openai', 'novelai', 'sd', 'comfy']),
  connections: z.object({ openai: connection, novelai: connection, sd: connection, comfy: connection }),
  convert: z.boolean(),
  textBase: z.string().max(500),
  textModel: z.string().max(200),
  positive: z.string().max(4000),
  negative: z.string().max(4000),
  style: z.string().max(2000),
  templates: z.object({
    home: z.string().default(templates.home),
    person: z.string(),
    story: z.string(),
    place: z.string(),
    item: z.string(),
  }),
  auto: z.object({ ordinary: z.boolean(), special: z.boolean(), story: z.boolean(), item: z.boolean() }),
  includeImages: z.boolean(),
});
export type ImageConfig = z.infer<typeof schema>;
export const configKey = 'heijin.images.config.v1';
export function config(): ImageConfig {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(configKey) ?? 'null'));
  } catch {
    return structuredClone(defaults);
  }
}
export function saveConfig(value: ImageConfig) {
  localStorage.setItem(configKey, JSON.stringify(schema.parse(value)));
  window.dispatchEvent(new Event(configKey));
}
export function subscribeConfig(fn: () => void) {
  const changed = (e: StorageEvent) => {
    if (!e.key || e.key === configKey) fn();
  };
  window.addEventListener('storage', changed);
  window.addEventListener(configKey, fn);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(configKey, fn);
  };
}
export function imageVault() {
  return new CredentialVault(sessionStorage, localStorage);
}
export function endpoint(baseUrl: string, path: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('请填写完整的 API 地址');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('API 地址须为 HTTPS 或本机 HTTP，不含凭证、查询参数或片段');
  if (/[?#\\]/.test(path) || path.includes('://')) throw new Error('接口路径仅可填写同源路径');
  return url.href.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}
// Bind credentials to the destination origin, including when the endpoint is edited in another tab.
export function credentialId(kind: Backend | 'text', baseUrl: string) {
  return 'image.' + kind + '.' + new URL(endpoint(baseUrl, '')).origin;
}
