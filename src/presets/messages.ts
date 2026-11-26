import type { AiMessage } from '../services/ai/protocols';
import { historyForSending } from './history';
import { presetMacros } from './macros';
import type { LoadedPreset, PromptEntry } from './package';

export const materialSlots = ['charDescription', 'charPersonality', 'dialogueExamples', 'enhanceDefinitions',
  'personaDescription', 'scenario', 'worldInfoBefore', 'worldInfoAfter'] as const;
export type MaterialSlot = typeof materialSlots[number];

export function literaryEntry(entry: PromptEntry) {
  const id = entry.identifier;
  if (id === 'chatHistory') return { kind: 'history' as const, id };
  const slot = materialSlots.find(key => key === id);
  if (!slot && entry.marker) throw new Error('不支持的预设占位条目：' + id);
  const placement = entry.injection_position === 1
    ? { position: 1 as const, depth: entry.injection_depth, order: entry.injection_order }
    : { position: 0 as const };
  const delivery = { id, role: entry.role, ...placement };
  return slot ? { ...delivery, kind: 'material' as const, slot } : { ...delivery, kind: 'text' as const, text: entry.content };
}

export interface StoryMaterials {
  user: string;
  char: string;
  markers: Record<string, string>;
  history: AiMessage[];
}

export function assemblePreset(preset: LoadedPreset, materials: StoryMaterials, random?: () => number) {
  const macros = presetMacros(materials.user, materials.char, random);
  const sequence: (AiMessage | 'history')[] = [];
  const absolute: { depth: number; order: number; role: AiMessage['role']; content: string }[] = [];
  const history = historyForSending(materials.history, preset);
  for (const entry of preset.entries) {
    if (!entry.enabled) continue;
    const input = literaryEntry(entry);
    if (input.kind === 'history') {
      sequence.push('history');
      continue;
    }
    const content = input.kind === 'material' ? materials.markers[input.slot] ?? '' : macros.expand(input.text);
    if (!content.trim()) continue;
    if (input.position === 1) absolute.push({ ...input, content });
    else sequence.push({ role: input.role, content });
  }
  if (!sequence.includes('history')) throw new Error('缺少已启用的 chatHistory，无法提交本回合行动');
  // 酒馆从历史末端按 depth 插入后反转；超出已有楼层的深度聚集在最早一端。
  const reversed = [...history].reverse();
  let inserted = 0;
  for (const depth of [...new Set(absolute.map((p) => p.depth))].sort((a, b) => a - b)) {
    const atDepth = absolute.filter((p) => p.depth === depth);
    const batch: AiMessage[] = [];
    for (const order of [...new Set(atDepth.map((p) => p.order))].sort((a, b) => b - a)) {
      for (const role of ['system', 'user', 'assistant'] as const) {
        const content = atDepth
          .filter((p) => p.order === order && p.role === role)
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
