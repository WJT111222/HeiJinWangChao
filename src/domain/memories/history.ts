import type { ActorRef } from '../common';
import type { GameState } from '../state';

export type HistoryEntry = Pick<GameState['journal'][number], 'turnId' | 'story' | 'relatedActorRefs'>;
export interface HistoryRecord {
  turnId: string;
  turnNumber: number;
  narrative: string;
  summary: string;
  relatedActorRefs: ActorRef[];
}
export interface HistoryMatch extends HistoryRecord {
  score: number;
  matchedTerms: string[];
  matchedEntityRefs: ActorRef[];
}
export const historySearchLimit = 20;
export const recallLimits = { turns: 3, characters: 6000, summary: 400, narrative: 1500 } as const;
export function historyRecords(journal: readonly HistoryEntry[]): HistoryRecord[] {
  return journal.map((entry, index) => ({
    turnId: entry.turnId,
    turnNumber: index + 1,
    narrative: entry.story.narrative,
    summary: entry.story.summary,
    relatedActorRefs: entry.relatedActorRefs,
  }));
}

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const commonTerms = new Set(['主角', '现在', '今天', '然后', '一个', '我们', '他们', '自己', '这个', '那个', '继续', '看看', '已经', '可以', '一下', '什么', '怎么']);
function termsFor(query: string) {
  return [...new Set([...segmenter.segment(query.toLocaleLowerCase('zh-CN'))]
    .filter((part) => part.isWordLike && Array.from(part.segment).length >= 2 && !commonTerms.has(part.segment))
    .map((part) => part.segment))].slice(0, 32);
}

// 只接收永久 journal，不接收 NPC 档案、事件、草稿或任何私有记忆。
// 姓名/别名只作为文本线索，不借字符串相同推断人物身份。实体加权仅使用可信引用或显式稳定 ID。
export function searchHistory(
  journal: readonly HistoryRecord[],
  query: string,
  options: { limit?: number; excludeTurnIds?: ReadonlySet<string>; entityRefs?: readonly ActorRef[] } = {},
): HistoryMatch[] {
  const limit = Math.min(historySearchLimit, Math.max(0, Math.trunc(options.limit ?? historySearchLimit)));
  const text = query.trim().slice(0, 4000).toLocaleLowerCase('zh-CN');
  const terms = termsFor(text);
  const explicitIds = new Set(query.slice(0, 4000).match(/[a-zA-Z0-9][a-zA-Z0-9_.:-]*/g) ?? []);
  const refKeys = new Set(options.entityRefs?.map((ref) => `${ref.kind}:${ref.id}`));
  return journal.filter((entry) => !options.excludeTurnIds?.has(entry.turnId)).map((entry) => {
    const narrative = entry.narrative.toLocaleLowerCase('zh-CN');
    const summary = entry.summary.toLocaleLowerCase('zh-CN');
    const matchedEntityRefs = entry.relatedActorRefs.filter((ref) =>
      refKeys.has(`${ref.kind}:${ref.id}`) || explicitIds.has(ref.id) || explicitIds.has(`${ref.kind}:${ref.id}`));
    const matchedTerms = terms.filter((term) => summary.includes(term) || narrative.includes(term));
    const phrase = text.length >= 2 && text.length <= 80 && (summary.includes(text) || narrative.includes(text));
    return {
      ...entry,
      matchedTerms,
      matchedEntityRefs,
      score: matchedEntityRefs.length * 1000 + (phrase ? 8 : 0) + matchedTerms.reduce((score, term) =>
        score + (summary.includes(term) ? 4 : 1), 0),
    };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.turnNumber - a.turnNumber)
    .filter((entry, index, all) => all.findIndex((other) => other.turnId === entry.turnId) === index)
    .slice(0, limit);
}

// 截取命中附近的原文，永不改写成新事实。字符预算只影响模型输入，不修改 journal。
function excerpt(text: string, limit: number, terms: string[] = []) {
  if (text.length <= limit) return text;
  const lower = text.toLocaleLowerCase('zh-CN');
  const hits = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - 120);
  const prefix = start ? '…' : '';
  return prefix + text.slice(start, start + limit - prefix.length - 1) + '…';
}

export function recallHistory(journal: readonly HistoryRecord[], query: string, excluded: ReadonlySet<string>) {
  let remaining = recallLimits.characters;
  return searchHistory(journal, query, { limit: recallLimits.turns, excludeTurnIds: excluded }).map((entry) => {
    const summary = excerpt(entry.summary, Math.min(recallLimits.summary, remaining), entry.matchedTerms);
    remaining -= summary.length;
    const narrativeExcerpt = excerpt(entry.narrative, Math.min(recallLimits.narrative, remaining), entry.matchedTerms);
    remaining -= narrativeExcerpt.length;
    return {
      turnId: entry.turnId,
      turnNumber: entry.turnNumber,
      summary,
      narrativeExcerpt,
      narrativeTruncated: narrativeExcerpt !== entry.narrative,
      matchedEntityRefs: entry.matchedEntityRefs,
      matchedTerms: entry.matchedTerms,
    };
  });
}
