import jquery from 'jquery';
import lodash from 'lodash';
import { z } from 'zod';
import { estimateTokens } from '../../prompts/statistics';
import { captureStoryPreset, resolveStoryPreset } from '../library';
import type { LoadedPreset } from '../package';
import { tavernEvents, tavernTools, type FunctionTool } from './events';
import { assistantView, buttonEvent, currentStoryContext, currentTavernRequest, registerRuntimeSettings, type ScriptInstance } from './hostState';
import { runtimePreset } from './runtimePreset';
import { storyFloors, variableStore } from './scriptVariables';

const names = { GENERATION_STARTED: 'generation_started', GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATE_AFTER_DATA: 'generate_after_data', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready',
  CHAT_COMPLETION_SETTINGS_READY: 'chat_completion_settings_ready', GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped', CHAT_CHANGED: 'chat_id_changed', OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after' };
const buttonsSchema = z.array(z.object({ name: z.string().min(1), visible: z.boolean() }));
const scriptSchema = z.object({ id: z.string().min(1), name: z.string(), content: z.string(), enabled: z.boolean(),
  data: z.record(z.string(), z.json()).default({}), module: z.boolean().default(true), button: z.object({ enabled: z.boolean(), buttons: buttonsSchema }).optional() });
type Script = z.infer<typeof scriptSchema>;
export function scriptOrder(nodes: LoadedPreset['scripts'], enabled = true): Script[] {
  return nodes.flatMap(node => {
    if (node.type === 'folder' && Array.isArray(node.scripts)) return scriptOrder(node.scripts, enabled && node.enabled === true);
    const script = scriptSchema.parse(node);
    return [{ ...script, enabled: enabled && script.enabled }];
  }).sort((a,b) => a.id < b.id ? -1 : Number(a.id > b.id));
}
type Callback = (...args: unknown[]) => unknown;
function instanceEvents() {
  const owned = new Set<{ key: string; fn: Callback; stop(): void }>();
  const clear = (key?: string) => { for (const row of [...owned]) if (!key || key === row.key) row.stop(); };
  const remove = (key: string, fn: Callback) => [...owned].find(row => row.key === key && row.fn === fn)?.stop();
  function on(key: string, fn: Callback, order?: 'first' | 'last' | 'once') {
    if (order === 'first' || order === 'last') remove(key, fn);
    const handle = tavernEvents.on(key, (...args) => {
      if (order === 'once') row.stop();
      return fn(...args);
    }, order);
    const row = { key, fn, stop() { handle.stop(); owned.delete(row); } };
    owned.add(row);
    return { stop: row.stop };
  }
  return { eventOn: on, eventOnce: (k: string, f: Callback) => on(k,f,'once'),
    eventMakeFirst: (k: string, f: Callback) => on(k,f,'first'), eventMakeLast: (k: string, f: Callback) => on(k,f,'last'),
    eventRemoveListener: remove, eventClearAll: clear, eventEmit: tavernEvents.emit.bind(tavernEvents),
    eventEmitAndWait: tavernEvents.emitAndWait.bind(tavernEvents) };
}
type Registration = FunctionTool['function'] & { shouldRegister?: () => boolean | Promise<boolean> };
async function preview(type: string, _options: unknown, dryRun: boolean) {
  if (currentTavernRequest()) throw new Error('请在当前生成结束后预览。');
  const input = currentStoryContext();
  if (dryRun !== true || type !== 'normal' || !input) throw new Error('仅支持在游戏内预览当前正文请求');
  const { previewTavernStory } = await import('../../services/ai/runtime');
  return previewTavernStory(input);
}
function instanceApi(script: Script, row: ScriptInstance, preset: LoadedPreset, config: ReturnType<typeof runtimePreset>,
  vars: ReturnType<ReturnType<typeof variableStore>>, realm: Window) {
  const events = instanceEvents();
  const ownedTools = new Map<string, Registration>();
  function unregisterFunctionTool(name: string) {
    tavernTools.unregister(name);
    ownedTools.delete(name);
  }
  function registerFunctionTool(spec: Registration) {
    if (!spec.name || !spec.parameters) throw new Error('无效工具声明');
    const tool = { ...spec, toFunctionOpenAI(): FunctionTool {
      const { name, description, parameters, strict } = this;
      return { type: 'function', function: { name, description, parameters, ...(strict !== undefined && { strict }) } };
    } };
    tavernTools.register(tool);
    ownedTools.set(tool.name, tool);
  }
  const manager = { get tools() { return tavernTools.tools; } };
  const source = { on: events.eventOn, once: events.eventOnce, removeListener: events.eventRemoveListener,
    makeFirst: events.eventMakeFirst, makeLast: events.eventMakeLast, emit: events.eventEmit, emitAndWait: events.eventEmitAndWait };
  const context = () => ({ mainApi: 'openai', chatCompletionSettings: config.native, eventTypes: names, eventSource: source,
    registerFunctionTool, unregisterFunctionTool, ToolManager: manager, getGenerationSettings: () => currentTavernRequest()?.settings,
    getGenerationScriptVariables: () => structuredClone(currentTavernRequest()?.variables?.[script.id] ?? script.data), canPerformToolCalls(type: string) {
      const request = currentTavernRequest();
      return !!request && request.settings.function_calling && type === request.type && (type === 'normal' || type === 'regenerate')
        && ['openai','deepseek','gemini','anthropic'].includes(request.protocol);
    }, generate: preview, getTokenCountAsync: async (text: string) => estimateTokens(text).estimatedTokens,
    saveSettingsDebounced: config.saveSettingsDebounced, name1: currentStoryContext()?.state.protagonist.name,
    chatId: currentStoryContext()?.state.saveId, chat: storyFloors().map(f => ({ name: f.name, is_user: f.role === 'user', mes: f.message })) });
  const builtin = { promptManager: { render() {
    const count = config.getPreset().prompts.filter(p => p.enabled).length;
    row.phases['预设'] = '已启用 ' + count + ' 个条目';
    assistantView.publish();
  } } };
  let buttons = structuredClone(script.button?.buttons ?? []);
  const replaceButtons = (items: unknown) => {
    buttons = buttonsSchema.parse(items);
    row.buttons = script.button?.enabled === false ? [] : buttons.filter(b => b.visible);
    assistantView.publish();
  };
  const api = { ...vars, ...events, builtin, ...context(), getContext: context, getPreset: config.getPreset,
    getLoadedPresetName: config.getLoadedPresetName, getScriptId: () => script.id,
    getScriptTrees(options: { type: string }) { if (options.type !== 'preset') throw new Error('仅支持内置预设脚本树'); return structuredClone(preset.scripts); },
    getTavernVersion: () => '1.19.0 (王朝兼容)', getTavernHelperVersion: () => '4.12.1 (王朝兼容)',
    getButtonEvent: (name: string) => buttonEvent(script.id, name), getScriptButtons: () => structuredClone(buttons),
    replaceScriptButtons: (items: unknown, named?: unknown) => replaceButtons(typeof items === 'string' ? named : items),
    appendInexistentScriptButtons(items: unknown, named?: unknown) {
      replaceButtons([...buttons,...buttonsSchema.parse(typeof items === 'string' ? named : items).filter(b => !buttons.some(v => v.name === b.name))]);
    },
    getCurrentMessageId: () => storyFloors().length - 1,
    getChatMessages(range: number | string) {
      const floors = storyFloors();
      if (typeof range === 'number') return floors.at(range) ? [floors.at(range)] : [];
      const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(range);
      if (!match) throw new Error('不支持该楼层范围');
      const start = floors.at(Number(match[1]))?.message_id;
      const end = floors.at(Number(match[2] ?? match[1]))?.message_id;
      return start === undefined || end === undefined ? [] : floors.slice(start,end+1);
    },
    generateRaw() { throw new Error('不支持由脚本发送正式模型请求'); },
    reportScriptPhase(part: string, state: string) { row.phases[part] = state; assistantView.publish(); },
  };
  const notify = (message: string) => { row.phases['提示'] = String(message).slice(0,220); assistantView.publish(); };
  // The parent jQuery uses the game document as its default selector context.
  const readyJobs: Promise<unknown>[] = [];
  const scopedJquery = new Proxy(jquery, { apply(target, receiver, args) {
    if (typeof args[0] !== 'function') return Reflect.apply(target, receiver, args);
    const callback = args[0];
    const job = Promise.resolve(jquery.ready).then(() => callback.call(document, scopedJquery));
    readyJobs.push(job);
    void job.catch(() => undefined);
    return jquery(document);
  } });
  Object.assign(realm, api, { TavernHelper: api, SillyTavern: { getContext: context }, tavern_events: names, event_types: names,
    $: scopedJquery, jQuery: scopedJquery, _: lodash, toastr: { info: notify, warning: notify, success: notify, error: notify } });
  return { cleanup() { events.eventClearAll(); for (const [name,tool] of ownedTools) if (tavernTools.tools.includes(tool)) unregisterFunctionTool(name); },
    async ready() { for (const job of readyJobs) await job; } };
}

async function mount(script: Script, row: ScriptInstance, install: (realm: Window) => ReturnType<typeof instanceApi>) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = script.name;
  frame.dataset.tavernScript = script.id;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  document.body.append(frame);
  await loaded;
  const realm = frame.contentWindow!;
  const { cleanup, ready } = install(realm);
  function fail(message: string) { row.status = '出错'; row.error = message; assistantView.publish(); }
  const url = URL.createObjectURL(new Blob([script.content], { type: 'text/javascript' }));
  try {
    await new Promise<void>((resolve,reject) => {
      realm.addEventListener('error', e => {
        const message = script.name + ' 第 ' + e.lineno + ' 行：' + e.message;
        fail(message); reject(new Error(message));
      });
      realm.addEventListener('unhandledrejection', e => {
        const message = script.name + ' 异步脚本失败：' + String(e.reason);
        fail(message); reject(new Error(message));
      });
      const element = realm.document.createElement('script');
      if (script.module) {
        // Import in the owning realm. A module element's load event does not wait for top-level await.
        Object.assign(realm, { finishTavernModule: resolve, failTavernModule(error: { stack?: string }) {
          const line = error?.stack?.split(url + ':')[1]?.match(/^\d+:\d+/)?.[0];
          reject(new Error(script.name + (line ? ' ' + line : '') + ' · ' + String(error), { cause: error }));
        } });
        element.type = 'module';
        element.textContent = 'import(' + JSON.stringify(url) + ').then(window.finishTavernModule, window.failTavernModule)';
      } else {
        element.src = url;
        element.onload = () => resolve();
      }
      element.onerror = () => reject(new Error(script.name + ' 脚本资源加载失败'));
      realm.document.body.append(element);
    });
    await ready();
    row.status = '已初始化';
  } catch (error) { cleanup(); fail(String(error)); throw error; }
  finally {
    Reflect.deleteProperty(realm, 'finishTavernModule');
    Reflect.deleteProperty(realm, 'failTavernModule');
    URL.revokeObjectURL(url);
    assistantView.publish();
  }
  function leave(e: PageTransitionEvent) {
    if (e.persisted) return;
    window.removeEventListener('pagehide', leave);
    cleanup(); frame.remove();
  }
  window.addEventListener('pagehide', leave);
}
export async function loadAssistant() {
  const selected = captureStoryPreset();
  if (!selected) return;
  await mountPresetScripts(await resolveStoryPreset(selected));
}
export async function mountPresetScripts(preset: LoadedPreset) {
  const config = runtimePreset(preset, () => assistantView.publish(), message => {
    assistantView.add({ id: 'settings', name: '脚本配置', status: '出错', error: message, buttons: [], phases: {} });
  });
  registerRuntimeSettings(config.flush, config.applyChanges, { function_calling: preset.data.function_calling === true, squash_system_messages: preset.data.squash_system_messages === true });
  const variables = variableStore(preset);
  const failures: unknown[] = [];
  const ordered = scriptOrder(preset.scripts);
  if (new Set(ordered.map(script => script.id)).size !== ordered.length) throw new Error('脚本标识重复');
  for (const script of ordered) {
    const row: ScriptInstance = { id: script.id, name: script.name, edition: preset.definition.scriptEditions?.[script.id], status: script.enabled ? '加载中' : '已停用',
      buttons: script.button?.enabled ? script.button.buttons.filter(b => b.visible) : [], phases: {} };
    assistantView.add(row);
    if (!script.enabled) continue;
    try { await mount(script, row, realm => instanceApi(script,row,preset,config,variables(script.id, script.data),realm)); }
    catch (error) { failures.push(error); }

  }
  if (failures.length) throw new AggregateError(failures, '预设脚本初始化失败');
}
