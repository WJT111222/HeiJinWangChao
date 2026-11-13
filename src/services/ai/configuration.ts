import { z } from 'zod';
import { IdSchema } from '../../domain/common';
import { readDocument, writeDocument } from '../local/documents';

export const aiConfigKey = 'heijin.ai.v1';
export const ProtocolSchema = z.enum(['openai', 'gemini', 'anthropic', 'deepseek']);
export type Protocol = z.infer<typeof ProtocolSchema>;
/** DeepSeek 官方 Chat Completions 兼容 OpenAI 的传输与响应结构，保留独立协议标识。 */
export const isOpenAiCompatible = (protocol: Protocol): protocol is 'openai' | 'deepseek' =>
  protocol === 'openai' || protocol === 'deepseek';
export type AiStage = 'story' | 'variables' | 'world';
export type AiTask = AiStage | 'memory';
export const modelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim() && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value), '模型 ID 不能包含控制字符或首尾空白');
const endpointSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, '服务地址须为 HTTPS（本机可 HTTP），不能含凭证、查询参数或片段');
export const ChannelSchema = z.strictObject({
  id: IdSchema,
  name: z.string().trim().min(1).max(100),
  protocol: ProtocolSchema,
  baseUrl: endpointSchema,
  defaultModel: z.union([modelIdSchema, z.literal('')]),
  parameters: z.strictObject({
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().max(1000000).optional(),
  }),
  compatibility: z.strictObject({
    temperature: z.boolean(),
    maxOutputTokens: z.boolean(),
    jsonMode: z.boolean(),
    cotMode: z.enum(['off', 'confirmation', 'prefix']),
    cotModels: z.array(modelIdSchema),
  }),
});
export type Channel = z.infer<typeof ChannelSchema>;
const direct = z.strictObject({
  channelId: z.string(),
  modelId: z.union([modelIdSchema, z.literal('')]),
});
const optionalRoute = z.discriminatedUnion('mode', [
  // Keep a stage's own selection while it temporarily inherits Story. IDs only, no credentials.
  z.strictObject({ mode: z.literal('follow-story'), independent: direct.optional() }),
  direct.extend({ mode: z.literal('independent') }),
]);
export const AiConfigSchema = z
  .strictObject({
    version: z.literal(1),
    channels: z.array(ChannelSchema),
    routes: z.strictObject({ story: direct, variables: optionalRoute, world: optionalRoute,
      memory: optionalRoute.default({ mode: 'follow-story' }) }),
  })
  .superRefine((config, ctx) => {
    if (new Set(config.channels.map((c) => c.id)).size !== config.channels.length)
      ctx.addIssue({ code: 'custom', message: '渠道 ID 重复' });
    for (const route of Object.values(config.routes)) {
      const saved = 'independent' in route ? route.independent : undefined;
      if (
        'channelId' in route &&
        route.channelId &&
        !config.channels.some((c) => c.id === route.channelId)
      )
        ctx.addIssue({ code: 'custom', message: '路由引用的渠道不存在' });
      if (saved?.channelId && !config.channels.some((c) => c.id === saved.channelId))
        ctx.addIssue({ code: 'custom', message: '独立模型选择引用的渠道不存在' });
    }
  });
export type AiConfig = z.infer<typeof AiConfigSchema>;
export function defaultAiConfig(): AiConfig {
  return {
    version: 1,
    channels: [],
    routes: {
      story: { channelId: '', modelId: '' },
      variables: { mode: 'follow-story' },
      world: { mode: 'follow-story' },
      memory: { mode: 'follow-story' },
    },
  };
}
export const defaultUrls: Record<Protocol, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  anthropic: 'https://api.anthropic.com/v1',
  deepseek: 'https://api.deepseek.com',
};
export function newChannel(protocol: Protocol = 'openai'): Channel {
  return {
    id: crypto.randomUUID(),
    name: '新渠道',
    protocol,
    baseUrl: defaultUrls[protocol],
    defaultModel: '',
    parameters: { maxOutputTokens: 8192 },
    compatibility: {
      temperature: true,
      maxOutputTokens: true,
      jsonMode: false,
      cotMode: 'confirmation',
      cotModels: [],
    },
  };
}
export function readAiConfig(storage: Pick<Storage, 'getItem'>) {
  return readDocument(storage, aiConfigKey, AiConfigSchema) ?? defaultAiConfig();
}
export function saveAiConfig(storage: Pick<Storage, 'setItem'>, config: AiConfig) {
  return writeDocument(storage, aiConfigKey, AiConfigSchema, config);
}
export function setModelRouteFollow(config: AiConfig, stage: Exclude<AiTask, 'story'>, follow: boolean): AiConfig {
  const route = config.routes[stage];
  if ((route.mode === 'follow-story') === follow) return config;
  const next = route.mode === 'independent'
    ? { mode: 'follow-story' as const, independent: { channelId: route.channelId, modelId: route.modelId } }
    : { mode: 'independent' as const, ...(route.independent ?? { channelId: '', modelId: '' }) };
  return { ...config, routes: { ...config.routes, [stage]: next } };
}
export function removeChannel(config: AiConfig, id: string): AiConfig {
  const remainingRoute = (route: AiConfig['routes']['variables']): AiConfig['routes']['variables'] => {
    if (route.mode === 'independent')
      return route.channelId === id ? { mode: 'independent', channelId: '', modelId: '' } : route;
    return route.independent?.channelId === id ? { mode: 'follow-story' } : route;
  };
  return AiConfigSchema.parse({
    ...config,
    channels: config.channels.filter((c) => c.id !== id),
    routes: {
      story:
        config.routes.story.channelId === id ? { channelId: '', modelId: '' } : config.routes.story,
      variables: remainingRoute(config.routes.variables),
      world: remainingRoute(config.routes.world),
      memory: remainingRoute(config.routes.memory),
    },
  });
}
