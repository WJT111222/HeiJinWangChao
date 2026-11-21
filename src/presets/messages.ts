import type { AiMessage } from '../services/ai/protocols';
import { historyForSending } from './history';
import { presetMacros } from './macros';
import type { LoadedPreset, PromptEntry } from './package';

export interface StoryMaterials {
  user: string;
  char: string;
  markers: Record<string, string>;
  history: AiMessage[];
}

export function assemblePreset(preset: LoadedPreset, materials: StoryMaterials, random?: () => number) {
  const macros = presetMacros(materials.user, materials.char, random);
  const sequence: (AiMessage | 'history')[] = [];
  const absolute: PromptEntry[] = [];
  const history = historyForSending(materials.history, preset);
  for (const entry of preset.entries) {
    if (!entry.enabled) continue;
    if (entry.identifier === 'chatHistory') {
      sequence.push('history');
      continue;
    }
    let content: string;
    if (Object.hasOwn(materials.markers, entry.identifier)) content = materials.markers[entry.identifier];
    else if (entry.marker) throw new Error('不支持的预设占位条目：' + entry.identifier);
    else content = macros.expand(entry.content);
    if (!content.trim()) continue;
    if (entry.injection_position === 1) absolute.push({ ...entry, content });
    else sequence.push({ role: entry.role, content });
  }
  if (!sequence.includes('history')) throw new Error('缺少已启用的 chatHistory，无法提交本回合行动');
  // 酒馆从历史末端按 depth 插入后反转；超出已有楼层的深度聚集在最早一端。
  const reversed = [...history].reverse();
  let inserted = 0;
  for (const depth of [...new Set(absolute.map((p) => p.injection_depth))].sort((a, b) => a - b)) {
    const atDepth = absolute.filter((p) => p.injection_depth === depth);
    const batch: AiMessage[] = [];
    for (const order of [...new Set(atDepth.map((p) => p.injection_order))].sort((a, b) => b - a)) {
      for (const role of ['system', 'user', 'assistant'] as const) {
        const content = atDepth
          .filter((p) => p.injection_order === order && p.role === role)
          .map((p) => p.content.trim())
          .join('\n');
        if (content) batch.push({ role, content });
      }
    }
    reversed.splice(depth + inserted, 0, ...batch);
    inserted += batch.length;
  }
  const injected = reversed.reverse().filter((m) => m.content.trim());
  return {
    messages: sequence.flatMap((m) => (m === 'history' ? injected : [m])),
    history: history.filter(m => m.content.trim()),
    unknownMacros: [...macros.unknown],
  };
}
