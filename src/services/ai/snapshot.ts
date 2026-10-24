import { AiConfigSchema, ChannelSchema, modelIdSchema } from './configuration';
import type { AiConfig, AiTask, Channel } from './configuration';
import type { CredentialVault } from './credentials';
import { AiError } from './errors';

const secrets = new WeakMap<object, string>();
export interface RequestSnapshot {
  readonly channel: Readonly<Channel>;
  readonly model: string;
  readonly stage: AiTask;
  readonly useCot: boolean;
  readonly diagnostics: readonly string[];
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function channelSnapshot(
  channel: Channel,
  vault: CredentialVault,
  model = channel.defaultModel,
  stage: AiTask = 'story',
): RequestSnapshot {
  const parsed = ChannelSchema.safeParse(channel);
  if (!parsed.success) throw new AiError('configuration');
  if (model && !modelIdSchema.safeParse(model).success) throw new AiError('configuration');
  const secret = vault.get(channel.id);
  if (!secret) throw new AiError('credentials');
  if (parsed.data.baseUrl.includes(secret) || model.includes(secret))
    throw new AiError('configuration');
  const diagnostics: string[] = [];
  const compatibility = parsed.data.compatibility;
  const useCot = cotSupported(parsed.data, model, stage);
  if (stage === 'story' && compatibility.cotMode === 'prefix') diagnostics.push('COT_PREFIX_FALLBACK_COMPLETE_HISTORY');
  if (compatibility.cotMode !== 'off' && !useCot) diagnostics.push('COT_SKIPPED_PROTOCOL_OR_MODEL');
  const snapshot = freeze({ channel: parsed.data, model, stage, useCot, diagnostics });
  secrets.set(snapshot, secret);
  return snapshot;
}
export function resolveModelRoute(config: AiConfig, stage: AiTask) {
  const checked = AiConfigSchema.safeParse(config);
  if (!checked.success) throw new AiError('configuration');
  const selected = checked.data.routes[stage];
  const route =
    'mode' in selected && selected.mode === 'follow-story' ? checked.data.routes.story : selected;
  if (!('channelId' in route)) throw new AiError('configuration');
  const channel = checked.data.channels.find((c) => c.id === route.channelId);
  if (!channel) throw new AiError('configuration');
  const model = route.modelId || channel.defaultModel;
  if (!modelIdSchema.safeParse(model).success) throw new AiError('configuration');
  return { channel, model };
}
// 完整历史确认不依赖模型名单；旧名单仅为配置读取兼容保留。
export function cotSupported(channel: Channel, _model: string, stage: AiTask) {
  return stage === 'story' && channel.compatibility.cotMode !== 'off';
}
export function requestSnapshot(
  config: AiConfig,
  stage: AiTask,
  vault: CredentialVault,
): RequestSnapshot {
  const { channel, model } = resolveModelRoute(config, stage);
  return channelSnapshot(channel, vault, model, stage);
}
export function secretFor(snapshot: RequestSnapshot) {
  const key = secrets.get(snapshot);
  if (!key) throw new AiError('credentials');
  return key;
}
