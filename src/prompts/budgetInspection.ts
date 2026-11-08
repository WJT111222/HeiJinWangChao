import type { AiMessage } from '../services/ai/protocols';
import { characterCount, estimateTokens } from './statistics';

export const dataCategories = {
  system: '系统提示词（固定/世界书/阶段/领域）', protagonist: '主角档案、装备与经济资产',
  npc: 'NPC完整档案', npcMemory: 'NPC原始、长期与个人总结记忆', world: '世界组织、地点、任务、事件与时间线',
  layeredMemory: '短中长期分层记忆', recent: '近期完整正文', recall: '历史召回原文与元数据',
  candidate: '当前输入与阶段候选', catalog: '命令协议与目录', other: '其他资料', structure: 'JSON键名、标点、容器与空白',
} as const;
type Category = keyof typeof dataCategories;
const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).length;
export const unknownWindowWarning = '当前模型上下文窗口未知，无法确认请求是否超限。';
/** Only an explicitly verified limit may be passed. No model-name inference or request changes. */
export function windowRisk(estimatedInput: number, explicitLimit?: number, outputReserve?: number) {
  if (!Number.isSafeInteger(explicitLimit) || explicitLimit! <= 0)
    return { known: false as const, message: unknownWindowWarning };
  const reserve = outputReserve !== undefined && Number.isSafeInteger(outputReserve) && outputReserve >= 0 ? outputReserve : undefined;
  return { known: true as const, limit: explicitLimit!, outputReserve: reserve,
    estimatedRemaining: reserve === undefined ? undefined : explicitLimit! - estimatedInput - reserve,
    message: reserve === undefined ? '输出预留未知，只能比较输入估算与窗口；提醒不阻断请求。'
      : estimatedInput + reserve > explicitLimit! ? '输入估算与输出预留超过窗口；仅提醒，不自动裁剪或阻断。' : '输入估算与输出预留在窗口内；协议开销和估算误差仍未知。' };
}
interface Node { path: string[]; start: number; end: number; value: unknown; children: Node[] }
// Track spans in the actual serialized message, preserving escapes and whitespace.
function jsonNodes(text: string, offset: number): Node {
  let at = offset;
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const quoted = () => { const start = at++; while (at < text.length) { const ch = text[at++]; if (ch === '\\') at++; else if (ch === '"') break; } return JSON.parse(text.slice(start, at)) as string; };
  function read(path: string[]): Node {
    space(); const start = at; const children: Node[] = []; let value: unknown;
    if (text[at] === '{' || text[at] === '[') {
      const object = text[at++] === '{'; space(); let index = 0;
      while (text[at] !== (object ? '}' : ']')) {
        space(); const key = object ? quoted() : String(index++); space(); if (object) at++;
        children.push(read([...path, key])); space(); if (text[at] !== ',') break; at++;
      }
      at++; value = JSON.parse(text.slice(start, at));
    } else if (text[at] === '"') value = quoted();
    else { while (at < text.length && !/[\s,}\]]/.test(text[at])) at++; value = JSON.parse(text.slice(start, at)); }
    return { path, start, end: at, value, children };
  }
  return read([]);
}
function category(path: string[]): Category {
  const [top, field, third, fourth] = path;
  if (['TEXT_COMMAND_CATALOG', 'COMMAND_CATALOG'].includes(top)) return 'catalog';
  if (['PLAYER_ACTION', 'STORY_RESULT', 'VARIABLE_RESULT', 'VARIABLE_GUIDE'].includes(top)) return 'candidate';
  if (top === 'MEMORY_CONTEXT' && field === 'recentTurns') return 'recent';
  if (top === 'MEMORY_CONTEXT' && ['recalledTurns', 'recallDiagnostics', 'recallPolicy'].includes(field)) return 'recall';
  if (top === 'NPC_KNOWLEDGE' || top === 'SAVE_STATE' && field === 'memories' && third === 'npcSummaries') return 'npcMemory';
  const npcField = top === 'SCENE_NPCS' ? third : fourth;
  const npcContainer = top === 'SAVE_STATE' && field === 'npc' || top === 'SCENE_NPCS' || top === 'OFFSCREEN_STATE' && field === 'npc';
  if (npcContainer && ['memories', 'longTermMemories'].includes(npcField)) return 'npcMemory';
  if (top === 'SAVE_STATE' && field === 'memories') return 'layeredMemory';
  if (top === 'SAVE_STATE' && ['protagonist', 'economy', 'items'].includes(field) || top === 'PROTAGONIST_PROFILE' || top === 'CREATION_PROFILE' && field === 'protagonist') return 'protagonist';
  if (npcContainer || top === 'CREATION_PROFILE' && field === 'companion') return 'npc';
  if (['SAVE_STATE', 'OFFSCREEN_STATE'].includes(top) && ['organizations', 'locations', 'tasks', 'events', 'timeline', 'history', 'retiredEvents', 'retiredNpcs'].includes(field)
    || ['KNOWN_EVENTS', 'EVENT_ENTRIES', 'EVENT_SCHEDULE'].includes(top)) return 'world';
  return 'other';
}
interface Occurrence { location: string; characters: number; bytes: number; serialized: string; message: number; start: number; end: number }
export interface DuplicateDiagnostic { identity: string; occurrences: number; locations: string[]; extraCharacters: number; extraBytes: number; exactContent: boolean; compatibility: string }
/** Pure measurement of final message contents. Never deduplicates transmitted data. */
export function inspectBudget(messages: readonly AiMessage[]) {
  const amounts = Object.fromEntries(Object.keys(dataCategories).map(key => [key, { characters: 0, bytes: 0, weight: 0 }])) as Record<Category, { characters: number; bytes: number; weight: number }>;
  const identities = new Map<string, Occurrence[]>(); const exact = new Map<string, Occurrence[]>();
  let context: Record<string, unknown> | undefined;
  const parseWarnings: string[] = [];
  let npcCount = 0, npcMemoryCount = 0, recentCount = 0, recallCount = 0, recallMetadataCharacters = 0;
  const add = (key: Category, text: string) => {
    const row = amounts[key]; row.characters += characterCount(text); row.bytes += utf8Bytes(text);
    for (const ch of text) row.weight += ch.codePointAt(0)! < 128 ? 0.25 : 1.5;
  };
  messages.forEach((message, index) => {
    const marker = message.content.match(/^<GAME_CONTEXT>\s*/);
    if (!marker || message.role !== 'user') { add(message.role === 'system' ? 'system' : 'other', message.content); return; }
    const previousAmounts = structuredClone(amounts), previousIdentities = new Map(identities), previousExact = new Map(exact);
    const previousCounts = { npcCount, npcMemoryCount, recentCount, recallCount, recallMetadataCharacters, context };
    try {
      const root = jsonNodes(message.content, marker[0].length);
      context = root.value as Record<string, unknown>;
      function visit(node: Node, owner?: string) {
        const raw = message.content.slice(node.start, node.end); const path = node.path.join('.');
        if (node.value && typeof node.value === 'object' && !Array.isArray(node.value)) {
          const value = node.value as Record<string, unknown>;
          if (typeof value.ownerNpcId === 'string') owner = value.ownerNpcId;
          if (typeof value.id === 'string' && 'onScene' in value) owner = value.id;
          if (node.path[0] === 'SAVE_STATE' && node.path[1] === 'memories' && node.path[2] === 'npcSummaries') owner = node.path[3];
          const location = `messages[${index}]${node.path.map(segment => `[${JSON.stringify(segment)}]`).join('')}`;
          const occurrence = { location, characters: characterCount(raw), bytes: utf8Bytes(raw), serialized: raw, message: index, start: node.start, end: node.end };
          let family: string | undefined;
          if (typeof value.id === 'string') {
            if ('sourceTurnIds' in value && 'text' in value) family = 'memory';
            else if ('onScene' in value && 'name' in value) family = 'npc';
            else if (/organizations\.|organizations\.\d/.test(path)) family = 'organization';
            else if (/tasks\.|tasks\.\d/.test(path)) family = 'task';
            else if (/events\.|KNOWN_EVENTS\.|EVENT_ENTRIES\./.test(path)) family = 'event';
            else if (/locations\./.test(path)) family = 'location';
          }
          const identity = family ? `${family}:${family === 'memory' ? `${owner ?? 'layered'}:` : ''}${value.id}` : typeof value.ownerNpcId === 'string' ? `npc:${value.ownerNpcId}`
            : typeof value.turnId === 'string' && /MEMORY_CONTEXT.(recentTurns|recalledTurns)/.test(path) ? `turn:${value.turnId}` : undefined;
          if (identity) identities.set(identity, [...(identities.get(identity) ?? []), occurrence]);
          if (raw.length >= 80) exact.set(raw, [...(exact.get(raw) ?? []), occurrence]);
          if (node.path.length === 3 && node.path[0] === 'SAVE_STATE' && node.path[1] === 'npc') npcCount++;
          if (family === 'memory' && category(node.path) === 'npcMemory' && /^SAVE_STATE\./.test(path)) npcMemoryCount++;
          if (/^MEMORY_CONTEXT.recentTurns.\d+$/.test(path)) recentCount++;
          if (/^MEMORY_CONTEXT.recalledTurns.\d+$/.test(path)) {
            recallCount++;
            const narrative = node.children.find(child => child.path.at(-1) === 'narrativeExcerpt');
            recallMetadataCharacters += characterCount(raw) - (narrative ? characterCount(message.content.slice(narrative.start, narrative.end)) : 0);
          }
        }
        if (!node.children.length) { add(category(node.path), raw); return; }
        let cursor = node.start;
        for (const child of node.children) { add('structure', message.content.slice(cursor, child.start)); visit(child, owner); cursor = child.end; }
        add('structure', message.content.slice(cursor, node.end));
      }
      add('structure', message.content.slice(0, root.start)); visit(root); add('structure', message.content.slice(root.end));
    } catch {
      Object.assign(amounts, previousAmounts);
      identities.clear(); previousIdentities.forEach((value, key) => identities.set(key, value));
      exact.clear(); previousExact.forEach((value, key) => exact.set(key, value));
      ({ npcCount, npcMemoryCount, recentCount, recallCount, recallMetadataCharacters, context } = previousCounts);
      parseWarnings.push(`messages[${index}]：游戏容器无法解析，整条按其他资料计量。`);
      add('other', message.content);
    }
  });
  const totalCharacters = messages.reduce((sum, m) => sum + characterCount(m.content), 0);
  const duplicates: DuplicateDiagnostic[] = [];
  const repeatedSpans: Occurrence[] = [];
  const seenLocations = new Set<string>();
  const report = (identity: string, entries: Occurrence[]) => {
    if (entries.length < 2) return;
    const locations = entries.map(e => e.location); const key = [...locations].sort().join('|');
    if (seenLocations.has(key)) return; seenLocations.add(key);
    repeatedSpans.push(...entries.slice(1));
    duplicates.push({ identity, occurrences: entries.length, locations,
      extraCharacters: entries.slice(1).reduce((s, e) => s + e.characters, 0), extraBytes: entries.slice(1).reduce((s, e) => s + e.bytes, 0),
      exactContent: entries.every(e => e.serialized === entries[0].serialized),
      compatibility: '现有共享状态与专项协议的重复表示；是否可移除须另行验证，本检查器保留全部。' });
  };
  identities.forEach((entries, id) => report(id, entries));
  let exactIndex = 0; exact.forEach(entries => report(`exact-content:${++exactIndex}`, entries));
  // Union repeated representations, so parent objects and child memories never double count.
  let repeatedCharacters = 0, repeatedBytes = 0;
  const orderedSpans = repeatedSpans.sort((a, b) => a.message - b.message || a.start - b.start || a.end - b.end);
  let pending: { message: number; start: number; end: number } | undefined;
  const finishSpan = () => {
    if (!pending) return;
    const text = messages[pending.message].content.slice(pending.start, pending.end);
    repeatedCharacters += characterCount(text); repeatedBytes += utf8Bytes(text);
  };
  for (const span of orderedSpans) {
    if (pending && pending.message === span.message && span.start <= pending.end) pending.end = Math.max(pending.end, span.end);
    else { finishSpan(); pending = { message: span.message, start: span.start, end: span.end }; }
  }
  finishSpan();
  const categories = (Object.keys(dataCategories) as Category[]).map(id => ({ id, label: dataCategories[id], characters: amounts[id].characters,
    bytes: amounts[id].bytes, estimatedTokens: Math.ceil(amounts[id].weight), proportion: totalCharacters ? amounts[id].characters / totalCharacters : 0 }));
  const memory = context?.MEMORY_CONTEXT as Record<string, unknown> | undefined;
  const recalled = Array.isArray(memory?.recalledTurns) ? memory.recalledTurns.filter((turn): turn is Record<string, unknown> => Boolean(turn && typeof turn === 'object' && !Array.isArray(turn))) : [];
  return { categories, duplicates, repeatedRepresentation: { characters: repeatedCharacters, bytes: repeatedBytes }, parseWarnings, counts: { npc: npcCount, npcMemories: npcMemoryCount, recent: recentCount, recalled: recallCount },
    reconciliation: { characters: totalCharacters - categories.reduce((s, row) => s + row.characters, 0),
      bytes: messages.reduce((s, m) => s + utf8Bytes(m.content), 0) - categories.reduce((s, row) => s + row.bytes, 0),
      estimatedTokenRounding: categories.reduce((s, row) => s + row.estimatedTokens, 0) - estimateTokens(messages.map(m => m.content).join('\n')).estimatedTokens },
    recall: memory ? { diagnostics: memory.recallDiagnostics, strong: recalled.filter(e => e.relevance === 'strong').length,
      auxiliary: recalled.filter(e => e.relevance === 'auxiliary').length,
      truncated: recalled.filter(e => e.narrativeTruncated || e.summaryTruncated).length,
      narrativeCharacters: recalled.reduce((sum, e) => sum + characterCount(String(e.narrativeExcerpt ?? '')), 0),
      // Exact row spans minus serialized narrative value; includes its field name and punctuation.
      metadataCharacters: recallMetadataCharacters } : undefined };
}
