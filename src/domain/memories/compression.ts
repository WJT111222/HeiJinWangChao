import { z } from 'zod';
import { DataError, IdSchema, requireData } from '../common';
import { GameStateSchema } from '../state';
import type { GameState } from '../state';
import { MemoryEntrySchema } from './schema';
import { fingerprint } from '../commands';
import { estimateTokens } from '../../prompts/statistics';

export const compressionPolicy = {
  shortThreshold: 30, mediumThreshold: 50, batchSize: 10,
  inputCharacters: 16000, inputEstimatedTokens: 12000,
  requestCharacters: 20000, requestEstimatedTokens: 16000,
} as const;
export const CompressionBatchSchema = z.strictObject({
  saveId: IdSchema, saveCreatedAt: z.string(),
  layer: z.enum(['short', 'medium']),
  entries: z.array(MemoryEntrySchema).min(2).max(compressionPolicy.batchSize),
  journalProofs: z.array(z.strictObject({ turnId: IdSchema, fingerprint: z.string() })),
});
export type CompressionBatch = z.infer<typeof CompressionBatchSchema>;
export const targetLayer = (layer: CompressionBatch['layer']) => layer === 'short' ? 'medium' as const : 'long' as const;
export const memoryTask = (layer: CompressionBatch['layer']) => layer === 'short' ? 'memory.short_to_medium' as const : 'memory.medium_to_long' as const;
export const sourceUnion = (entries: readonly z.infer<typeof MemoryEntrySchema>[]) => [...new Set(entries.flatMap((entry) => entry.sourceTurnIds))];

export function compressionCandidates(state: GameState, layer: CompressionBatch['layer']) {
  const journal = new Map(state.journal.map((entry, index) => [entry.turnId, index]));
  const upper = layer === 'short' ? [...state.memories.medium, ...state.memories.long] : state.memories.long;
  const covered = new Set(upper.filter((entry) => entry.visibility === 'player_known').flatMap((entry) => entry.sourceTurnIds));
  return state.memories[layer].filter((entry) => entry.visibility === 'player_known' && entry.sourceTurnIds.length &&
    entry.sourceTurnIds.every((id) => journal.has(id) && !covered.has(id)) &&
    Date.parse(entry.createdAtGameTime) <= Date.parse(state.worldClock))
    .sort((a, b) => Math.min(...a.sourceTurnIds.map((id) => journal.get(id)!)) - Math.min(...b.sourceTurnIds.map((id) => journal.get(id)!)) || a.id.localeCompare(b.id));
}

export function compressionInput(batch: CompressionBatch) {
  return { task: memoryTask(batch.layer), entries: batch.entries };
}
export function planCompression(state: GameState): CompressionBatch | undefined {
  for (const layer of ['short', 'medium'] as const) {
    const candidates = compressionCandidates(state, layer);
    if (candidates.length <= (layer === 'short' ? compressionPolicy.shortThreshold : compressionPolicy.mediumThreshold)) continue;
    const entries: CompressionBatch['entries'] = [];
    for (const entry of candidates.slice(0, compressionPolicy.batchSize)) {
      const text = JSON.stringify({ task: memoryTask(layer), entries: [...entries, entry] })
        .replace(/[<>&]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      if (text.length > compressionPolicy.inputCharacters || estimateTokens(text).estimatedTokens > compressionPolicy.inputEstimatedTokens) break;
      entries.push(entry);
    }
    requireData(entries.length >= 2, 'MEMORY_BUDGET', '最早记忆超出安全批次预算，原条目已保留，未请求模型');
    const ids = entries.map((entry) => entry.id);
    requireData(new Set(ids).size === ids.length, 'MEMORY_SOURCE', '记忆 ID 重复，不能安全整理');
    const sources = sourceUnion(entries);
    return CompressionBatchSchema.parse({
      saveId: state.saveId, saveCreatedAt: state.createdAt, layer, entries,
      journalProofs: sources.map((id) => ({ turnId: id, fingerprint: fingerprint(state.journal.find((entry) => entry.turnId === id)) })),
    });
  }
}

// AI 只归纳文本；来源、引用、可见性和时间均由程序重建，不能由模型伪造。
export const CompressionOutputSchema = z.strictObject({
  entries: z.array(z.strictObject({ text: z.string().trim().min(1).max(4000) })).length(1),
  unresolved: z.array(z.string()), contradictions: z.array(z.string()),
});
export function parseCompression(text: string, batch: CompressionBatch, id: string) {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new DataError('MEMORY_OUTPUT', '整理结果不是完整JSON，原记忆已保留'); }
  const parsed = CompressionOutputSchema.safeParse(raw);
  requireData(parsed.success && !parsed.data.unresolved.length && !parsed.data.contradictions.length,
    'MEMORY_OUTPUT', '整理结果含未解决事项、矛盾或非法字段，原记忆已保留');
  return MemoryEntrySchema.parse({
    id, text: parsed.data.entries[0].text,
    sourceTurnIds: sourceUnion(batch.entries),
    affectedEntityRefs: [...new Map(batch.entries.flatMap((entry) => entry.affectedEntityRefs).map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()],
    visibility: 'player_known',
    createdAtGameTime: batch.entries.reduce((last, entry) => Date.parse(entry.createdAtGameTime) > Date.parse(last) ? entry.createdAtGameTime : last, batch.entries[0].createdAtGameTime),
  });
}

export function applyCompression(state: GameState, input: CompressionBatch, result: z.infer<typeof MemoryEntrySchema>): GameState {
  const batch = CompressionBatchSchema.parse(input);
  requireData(state.saveId === batch.saveId && state.createdAt === batch.saveCreatedAt, 'MEMORY_CONFLICT', '存档身份已变化');
  const current = state.memories[batch.layer];
  requireData(new Set(batch.entries.map((entry) => entry.id)).size === batch.entries.length,
    'MEMORY_SOURCE', '记忆ID重复');
  requireData(batch.entries.every((entry) => current.filter((item) => item.id === entry.id).length === 1 &&
    fingerprint(current.find((item) => item.id === entry.id)) === fingerprint(entry)), 'MEMORY_CONFLICT', '来源批次已改变');
  const sources = sourceUnion(batch.entries);
  requireData(batch.journalProofs.length === sources.length &&
    new Set(batch.journalProofs.map((proof) => proof.turnId)).size === sources.length &&
    batch.journalProofs.every((proof) => sources.includes(proof.turnId)) &&
    batch.journalProofs.every((proof) => fingerprint(state.journal.find((entry) => entry.turnId === proof.turnId)) === proof.fingerprint),
  'MEMORY_CONFLICT', '原始回合已改变');
  const eligible = compressionCandidates(state, batch.layer);
  requireData(batch.entries.every((entry) => eligible.some((item) => item.id === entry.id)), 'MEMORY_CONFLICT', '来源已被整理或权限已变化');
  const expected = parseCompression(JSON.stringify({ entries: [{ text: result.text }], unresolved: [], contradictions: [] }), batch, result.id);
  requireData(fingerprint(expected) === fingerprint(MemoryEntrySchema.parse(result)), 'MEMORY_OUTPUT', '来源、时间或可见性不符');
  requireData(![...state.memories.short, ...state.memories.medium, ...state.memories.long].some((entry) => entry.id === result.id), 'MEMORY_CONFLICT', '结果已存在');
  const ids = new Set(batch.entries.map((entry) => entry.id));
  const target = targetLayer(batch.layer);
  return GameStateSchema.parse({ ...state, memories: { ...state.memories,
    [batch.layer]: current.filter((entry) => !ids.has(entry.id)),
    [target]: [...state.memories[target], expected],
  } });
}
