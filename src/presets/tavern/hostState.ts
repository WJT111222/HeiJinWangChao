import type { ComposeInput } from '../../prompts/context';
import isEqual from 'lodash/isEqual';
import type { PackageOverride } from '../package';
import type { Protocol } from '../../services/ai/configuration';
import { AiError } from '../../services/ai/errors';
import { builtInPresets, captureStoryPreset } from '../library';
import { readPresetSettings, savePresetSettings } from '../settings';
import type { GenerationType } from './events';
import { tavernEvents } from './events';

export type StoryContext = ComposeInput & { stage: 'story'; saveInstance?: string };
export interface ScriptButton { name: string; visible: boolean }
export interface ScriptInstance {
  id: string;
  name: string;
  status: '加载中' | '已初始化' | '已停用' | '出错';
  buttons: ScriptButton[];
  phases: Record<string, string>;
  /** Latest safe diagnostic. A ready instance can report runtime errors. */
  error?: string;
  edition?: string;
}
const listeners = new Set<() => void>();
let instances: ScriptInstance[] = [];
export const assistantView = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  snapshot: () => instances,
  publish() { instances = [...instances]; for (const fn of listeners) fn(); },
  add(instance: ScriptInstance) { instances.push(instance); this.publish(); },
};
export const buttonEvent = (id: string, name: string) => JSON.stringify(['script_button', id, name]);
export function pressScriptButton(id: string, name: string) {
  return tavernEvents.emit(buttonEvent(id, name));
}

let lastChat: string | undefined;
export function enterTavernChat(saveId: string, instance?: string) {
  const key = JSON.stringify([saveId, instance]);
  if (lastChat === key) return;
  lastChat = key;
  void tavernEvents.emit('chat_id_changed', saveId).catch(() => console.warn('酒馆聊天切换监听失败'));
}
let pageContext: (() => StoryContext | undefined) | undefined;
let preparePageRefresh: (() => void | (() => void)) | undefined;
export function bindTavernPage(context: () => StoryContext | undefined, prepare: () => void | (() => void)) {
  pageContext = context;
  preparePageRefresh = prepare;
  return () => { if (pageContext === context) { pageContext = undefined; preparePageRefresh = undefined; } };
}
type GenerationSettings = { function_calling: boolean; squash_system_messages: boolean };
let request: { input: StoryContext; protocol: Protocol; type: GenerationType; settings: GenerationSettings; variables: PackageOverride['scriptVariables'] } | undefined;
export const currentStoryContext = () => request?.input ?? pageContext?.();
export const currentTavernRequest = () => request;
export async function withTavernRequest<T>(input: StoryContext, protocol: Protocol, type: GenerationType, overrides: PackageOverride | undefined, work: () => Promise<T>) {
  if (!baseSettings) return work();
  if (request) throw new AiError('configuration', undefined, { fieldPath: 'tavern.busy' });
  const page = pageContext?.();
  const saveInstance = page?.state.saveId === input.state.saveId ? page.saveInstance : undefined;
  request = { input: { ...input, saveInstance }, protocol, type, settings: Object.freeze({ ...baseSettings, ...overrides?.assistant }), variables: overrides?.scriptVariables };
  try { return await work(); } finally { request = undefined; }
}
let baseSettings: GenerationSettings | undefined;
let savePending: (() => boolean) | undefined;
let snapshotChanges: ((override: PackageOverride) => void) | undefined;
let syncSaved: ((override?: PackageOverride) => void) | undefined;
export function readEditorOverride(id: string) {
  savePending?.();
  return readPresetSettings().packages[id];
}
export function storeEditorOverride(id: string, expected: PackageOverride | undefined, next?: PackageOverride) {
  savePending?.();
  const saved = readPresetSettings();
  if (!isEqual(saved.packages[id], expected)) throw new Error('配置已在另一处更新，请重新打开后编辑。');
  const active = saved.enabled && saved.selected === id;
  const reload = active && !isEqual(expected?.scripts ?? {}, next?.scripts ?? {});
  if (reload && request) throw new Error('恢复脚本启动偏好前，请完成或取消当前生成。');
  const rollback = reload ? preparePageRefresh?.() : undefined;
  try {
    if (next) saved.packages[id] = next;
    else delete saved.packages[id];
    savePresetSettings(saved);
  } catch (error) {
    rollback?.();
    throw error;
  }
  if (active) syncSaved?.(next);
  return reload;
}
export function registerRuntimeSettings(flush: () => boolean, apply: (override: PackageOverride) => void, defaults: GenerationSettings, sync: (override?: PackageOverride) => void) {
  syncSaved = sync;
  savePending = flush; snapshotChanges = apply; baseSettings = defaults;
}
export function switchPreset(id: string | null, resetCorrupt = false) {
  if (request) throw new Error('请先完成或取消当前生成。');
  if (id && !builtInPresets.some(p => p.id === id)) throw new Error('所选内置预设不存在。');
  const rollbackInput = preparePageRefresh?.();
  try {
    savePending?.();
    const settings = resetCorrupt && new URLSearchParams(location.search).get('safe') === '1' ? { packages: {} } : readPresetSettings();
    savePresetSettings({ ...settings, enabled: Boolean(id), selected: id });
  } catch (error) {
    rollbackInput?.();
    throw error;
  }
  location.reload();
}
let initialized = false;
let startup: Promise<void> | undefined;
export function startAssistant() {
  if (startup) return startup;
  startup = (async () => {
    if (new URLSearchParams(location.search).get('safe') === '1') return;
    const settings = readPresetSettings();
    if (!settings.enabled) return;
    const { loadAssistant } = await import('./scriptHost');
    await loadAssistant();
  })().then(() => { initialized = true; }).catch(error => {
    if (!instances.some(i => i.status === '出错')) assistantView.add({ id: 'loader', name: '酒馆助手', status: '出错', buttons: [], phases: {}, error: '酒馆助手 · 初始化失败：预设资源或脚本宿主未能加载。' });
    throw error;
  });
  void startup.catch(() => undefined); // Startup errors stay visible, and are rethrown at the generation gate.
  return startup;
}
export function assistantStarting() { return startup && !initialized; }
export function captureAssistantPreferences() {
  const selected = captureStoryPreset();
  if (!selected) return null;
  if (assistantView.snapshot().some(row => row.status === '出错')) throw new AiError('configuration', undefined, { fieldPath: 'tavern.initialization' });
  if (initialized && snapshotChanges) {
    const override = selected.overrides ??= { version: selected.definition.version, entries: {}, scripts: {} };
    snapshotChanges(override); // Apply live edits to this request copy; only an explicit save persists them.
  }
  return selected;
}
export async function awaitAssistant(signal: AbortSignal) {
  if (!startup) return;
  signal.throwIfAborted();
  const cancelled = () => new AiError('cancelled');
  let abort!: () => void;
  const stop = new Promise<never>((_, reject) => { abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); });
  try { await Promise.race([startup, stop]); savePending?.(); }
  catch { throw signal.aborted ? cancelled() : new AiError('configuration', undefined, { fieldPath: 'tavern.initialization' }); }
  finally { signal.removeEventListener('abort', abort); }
}
