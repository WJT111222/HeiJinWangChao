import { mergeWith } from 'lodash';
import { z } from 'zod';
import type { LoadedPreset } from '../package';
import { readPresetSettings, savePresetSettings } from '../settings';
import { editOverrides } from './runtimePreset';
import { currentStoryContext, currentTavernRequest } from './hostState';

type Options = { type?: string; message_id?: number | 'latest'; script_id?: string };
const variables = z.record(z.string(), z.json());
type Values = z.infer<typeof variables>;
export function storyFloors() {
  const input = currentStoryContext();
  if (!input) return [];
  const rows: { role: 'user' | 'assistant'; message: string }[] = [];
  for (const entry of input.state.journal.slice(-input.settings.memory.immediateWindowSize)) {
    const action = input.historyActions?.[entry.turnId];
    if (action) rows.push({ role: 'user', message: action });
    rows.push({ role: 'assistant', message: entry.story.narrative });
  }
  if (input.userInput) rows.push({ role: 'user', message: input.userInput });
  if (!currentTavernRequest() && input.draft?.story) rows.push({ role: 'assistant', message: input.draft.story.narrative });
  return rows.map((row, message_id) => ({ ...row, message_id, name: row.role === 'user' ? input.state.protagonist.name : '旁白' }));
}
export function variableStore(preset: LoadedPreset) {
  let chatKey = '';
  let floorKey = '';
  let revision = -1;
  const temporary = new Map<string, Values>();
  function access(id: string, defaults: Values, options: Options, write?: Values): Values {
    const type = options.type ?? 'chat';
    if (type === 'chat' || type === 'message') {
      const story = currentStoryContext();
      if (!story) throw new Error('当前没有游戏资料');
      const identity = JSON.stringify([story.state.saveId, story.saveInstance]);
      if (identity !== chatKey || story.state.revision < revision) {
        temporary.clear();
        chatKey = identity;
      }
      revision = story.state.revision;
      const currentFloors = JSON.stringify([revision, story.draft?.turnId, story.draft?.storyRevision]);
      if (floorKey !== currentFloors) {
        for (const key of temporary.keys()) if (key.startsWith('message-')) temporary.delete(key);
        floorKey = currentFloors;
      }
      const floors = storyFloors();
      const offset = options.message_id === 'latest' ? -1 : options.message_id ?? -1;
      const floor = floors.at(offset);
      if (type === 'message' && !floor) throw new Error('楼层不存在');
      const key = type === 'chat' ? type : 'message-' + floor!.message_id;
      if (write) temporary.set(key, write);
      return temporary.get(key) ?? {};
    }
    const settings = readPresetSettings();
    if (type === 'global') {
      if (write) savePresetSettings({ ...settings, globalVariables: write });
      return write ?? settings.globalVariables ?? {};
    }
    const pack = settings.packages[preset.definition.id];
    if (type === 'preset') {
      if (write) editOverrides(preset, p => { p.variables = write; });
      return write ?? pack?.variables ?? {};
    }
    if (type !== 'script' || (options.script_id && options.script_id !== id)) throw new Error('不支持该变量作用域或脚本实例');
    if (write) editOverrides(preset, p => { (p.scriptVariables ??= {})[id] = write; });
    return write ?? pack?.scriptVariables?.[id] ?? defaults;
  }
  return (id: string, defaults: Values) => ({
    getVariables: (options: Options = {}) => structuredClone(access(id, defaults, options)),
    replaceVariables: (data: unknown, options: Options = {}) => structuredClone(access(id, defaults, options, variables.parse(data))),
    insertOrAssignVariables(data: unknown, options: Options = {}) {
      const next = mergeWith({}, access(id, defaults, options), variables.parse(data), (_old: unknown, v: unknown) => Array.isArray(v) ? v : undefined);
      return structuredClone(access(id, defaults, options, variables.parse(next)));
    },
  });
}
