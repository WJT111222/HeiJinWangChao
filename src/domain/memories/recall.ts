import type { GameState } from '../state';
import type { ActorRef } from '../common';
import { rawNpcMemories } from './npcMemory';

export interface RecallCues {
  stage: 'story' | 'variables' | 'world';
  playerInput: string;
  storyText?: string;
  variableGuide?: unknown;
  validatedVariables?: unknown;
  from?: string;
}
type Ref = { kind: string; id: string };
type Node = { ref: Ref; labels: string[]; text: string; links: Ref[]; turns: string[]; active?: boolean; due?: string; importance?: number };
type Source = { path: string; refs: Ref[]; turns: string[]; text: string; at?: string };
const key = (ref: Ref) => `${ref.kind}:${ref.id}`;
const norm = (text: string) => text.normalize('NFKC').toLowerCase();
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stop = new Set(['一个', '我们', '他们', '自己', '这个', '那个', '继续', '看看', '已经', '可以', '一下', '什么', '怎么', '现在', '今天', '然后', '主角', '新的']);
// Independent budget for old journal additions, including escaped JSON and provenance.
export const recallBudget = { serializedCharacters: 24000, narrativeCharacters: 16000, fullTurnCharacters: 7000,
  auxiliaryCharacters: 600, summaryCharacters: 400, metadataReferences: 8, maximumRecords: 32, queryCharacters: 12000, terms: 96 } as const;
const encodedSize = (value: unknown) => JSON.stringify(value).replace(/[<>&]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).length;
function termsFor(text: string) {
  return [...new Set([...segmenter.segment(norm(text))].filter(part => part.isWordLike && part.segment.length >= 2 &&
    !/^\p{Number}+$/u.test(part.segment) && !stop.has(part.segment)).map(part => part.segment))];
}
function cut(text: string, limit: number, terms: string[]) {
  // Offsets refer to original UTF-16 string, so locate using non-normalized text.
  const hits = terms.map(term => text.toLowerCase().indexOf(term)).filter(index => index >= 0);
  const start = text.length <= limit ? 0 : Math.max(0, (hits.length ? Math.min(...hits) : 0) - 120);
  const end = Math.min(text.length, start + limit);
  return { text: text.slice(start, end), range: { start, end, originalLength: text.length, unit: 'utf16' as const }, truncated: start !== 0 || end !== text.length };
}

/** Read-only retrieval. Relationships are only the actual V6 references, never inferred ownership or knowledge. */
export function recallJournal(state: GameState, windowSize: number, cues: RecallCues, enabled = true) {
  const nodes: Node[] = [], sources: Source[] = [];
  const actor = (ref: ActorRef): Ref => ref;
  const ref = (kind: string, id: string): Ref => ({ kind, id });
  const add = (kind: string, id: string, labels: string[], text: string, links: Ref[] = [], turns: string[] = [], active = false, due?: string, importance = 0) => {
    nodes.push({ ref: ref(kind, id), labels, text, links, turns, active, due, importance });
  };
  const memorySource = (path: string, entry: GameState['memories']['short'][number], owner?: Ref) => sources.push({
    path, refs: [...entry.affectedEntityRefs, ...(owner ? [owner] : [])], turns: entry.sourceTurnIds, text: entry.text, at: entry.createdAtGameTime,
  });
  for (const npc of Object.values(state.npc)) {
    add('npc', npc.id, [npc.name, ...npc.aliases], [npc.relationshipText, npc.background, ...(npc.kind === 'special' ? npc.activeGoals : [])].join('\n'),
      npc.kind === 'special' ? npc.offscreenTaskIds.map(id => ref('task', id)) : []);
    rawNpcMemories(npc).forEach(entry => memorySource(`npc.${npc.id}.${npc.memories.includes(entry) ? 'memories' : 'longTermMemories'}.${entry.id}`, entry, ref('npc', npc.id)));
  }
  for (const npc of Object.values(state.retiredNpcs)) add('npc', npc.id, [npc.name, ...npc.aliases], '', [], npc.sourceTurnIds);
  for (const [layer, entries] of Object.entries(state.memories)) {
    if (Array.isArray(entries)) entries.forEach(entry => memorySource(`memories.${layer}.${entry.id}`, entry));
  }
  for (const [owner, entries] of Object.entries(state.memories.npcSummaries)) entries.forEach(entry => memorySource(`memories.npcSummaries.${owner}.${entry.id}`, entry, ref('npc', owner)));
  for (const location of Object.values(state.locations)) add('location', location.id, [location.name], '', location.parentId ? [ref('location', location.parentId)] : []);
  for (const org of Object.values(state.organizations)) add('organization', org.id, [org.name], [org.description, org.protagonistRelation, ...org.relationHistory].join('\n'),
    [...org.keyNpcIds.map(id => ref('npc', id)), ...org.currentTaskIds.map(id => ref('task', id))]);
  for (const item of Object.values(state.items)) add('item', item.id, [item.name], item.conditionText ?? '', item.ownerRef ? [actor(item.ownerRef)] : []);
  for (const task of Object.values(state.tasks)) add('task', task.id, [task.goal], [task.goal, task.completionCondition,
    ...task.prerequisites, ...task.blockers, task.handoff?.content, task.resolution?.result].join('\n'),
    [actor(task.actorRef), ...(task.locationId ? [ref('location', task.locationId)] : []), ...(task.linkedEventId ? [ref('event', task.linkedEventId)] : []),
      ...(task.handoff ? [ref('task', task.handoff.fromTaskId)] : [])], task.resolution ? [task.resolution.sourceTurnId] : [],
    !['completed', 'cancelled'].includes(task.status), task.dueAt);
  for (const event of Object.values(state.events)) add('event', event.id, [event.title], [event.title, event.backgroundText,
    event.goalText, event.completionCondition, ...event.prerequisites, ...event.blockers, event.resolutionText].join('\n'),
    [...event.actorRefs, ...event.linkedTaskIds.map(id => ref('task', id)), ...(event.locationId ? [ref('location', event.locationId)] : []),
      ...(event.predecessorEventIds ?? []).map(id => ref('event', id))], event.sourceTurnIds,
    !['resolved', 'cancelled'].includes(event.status), event.estimatedEndAt, event.impact === 'major' ? 10 : event.impact === 'significant' ? 5 : 0);
  for (const event of Object.values(state.retiredEvents)) add('event', event.id, event.detail ? [event.detail.title] : [], '',
    [...(event.detail?.actorRefs ?? []), ...event.predecessorEventIds.map(id => ref('event', id))], event.sourceTurnIds);
  for (const entry of state.timeline) {
    add('timeline', entry.id, [entry.title], entry.summary, [...entry.actorRefs, ...(entry.sourceRef ? [entry.sourceRef] : []),
      ...(entry.eventId ? [ref('event', entry.eventId)] : []), ...(entry.locationId ? [ref('location', entry.locationId)] : []),
      ...entry.relatedEntryIds.map(id => ref('timeline', id))], [entry.sourceTurnId]);
    sources.push({ path: `timeline.${entry.id}`, refs: [ref('timeline', entry.id), ...entry.actorRefs, ...(entry.sourceRef ? [entry.sourceRef] : [])],
      turns: [entry.sourceTurnId], text: `${entry.title}\n${entry.summary}`, at: entry.recordedAt });
  }
  const rawTexts = [cues.playerInput, cues.storyText ?? '', cues.variableGuide ? JSON.stringify(cues.variableGuide) : '',
    cues.validatedVariables ? JSON.stringify(cues.validatedVariables) : ''];
  const texts = rawTexts.map(text => norm(text.slice(0, recallBudget.queryCharacters)));
  const journalText = state.journal.map(entry => norm(`${entry.story.summary}\n${entry.story.narrative}`));
  // One identity may cover almost the whole save. Count the UNION across both journal actors
  // and all memory owners/affected references, including hundreds of individually narrow memories.
  const knownTurns = new Set(state.journal.map(entry => entry.turnId));
  const npcCoverage = new Map<string, Set<string>>();
  const cover = (references: Ref[], turnIds: string[]) => {
    for (const reference of references) if (reference.kind === 'npc') {
      const turns = npcCoverage.get(reference.id) ?? new Set<string>();
      turnIds.forEach(turnId => { if (knownTurns.has(turnId)) turns.add(turnId); });
      npcCoverage.set(reference.id, turns);
    }
  };
  state.journal.forEach(entry => cover(entry.relatedActorRefs, [entry.turnId]));
  sources.forEach(source => cover(source.refs, source.turns));
  const commonNpc = (reference: Ref) => reference.kind === 'npc' && (npcCoverage.get(reference.id)?.size ?? 0) > Math.max(3, state.journal.length * 0.2);
  const rarity = (reference: Ref) => reference.kind === 'npc'
    ? (1 - (npcCoverage.get(reference.id)?.size ?? 0) / Math.max(1, state.journal.length)) ** 3 : 1;
  // IDs are case sensitive in V6; text normalization must not merge distinct identities.
  const ids = new Set(rawTexts.map(text => text.slice(0, recallBudget.queryCharacters)).join('\n').match(/[a-zA-Z0-9][a-zA-Z0-9_.:-]*/g) ?? []);
  const labels = new Map<string, Set<string>>();
  for (const node of nodes) for (const label of node.labels) {
    const normalized = norm(label);
    if (normalized.length < 2) continue;
    const owners = labels.get(normalized) ?? new Set<string>(); owners.add(key(node.ref)); labels.set(normalized, owners);
  }
  const selected = new Map<string, number>();
  const select = (reference: Ref, weight: number) => {
    // The protagonist occurs everywhere: never use that hub as a retrieval signal.
    if (reference.kind !== 'protagonist') selected.set(key(reference), Math.max(selected.get(key(reference)) ?? 0, weight));
  };
  // Longest overlapping label wins, including ambiguous labels which must not elevate a shorter name to identity.
  const named = new Set<string>();
  const orderedLabels = [...labels.entries()].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  for (const text of texts) {
    const occupied = new Uint8Array(text.length);
    for (const [label, owners] of orderedLabels) {
      let start = text.indexOf(label);
      while (start >= 0) {
        const end = start + label.length;
        if (!occupied.subarray(start, end).some(Boolean)) {
          occupied.fill(1, start, end);
          if (owners.size === 1) owners.forEach(owner => named.add(owner));
        }
        start = text.indexOf(label, end);
      }
    }
  }
  for (const node of nodes) {
    if (ids.has(node.ref.id) || ids.has(key(node.ref))) select(node.ref, 100);
    if (named.has(key(node.ref))) select(node.ref, 90);
  }
  if (enabled) {
    Object.values(state.npc).filter(npc => npc.onScene).forEach(npc => select(ref('npc', npc.id), 80));
    select(ref('location', state.protagonist.locationId), 10);
    const focus = new Set(selected.keys());
    for (const node of nodes) {
      if (!node.active) continue;
      const sceneRelated = node.links.some(link => focus.has(key(link)) && link.kind !== 'location') ||
        node.links.some(link => link.kind === 'protagonist');
      if (cues.stage === 'world' || sceneRelated) {
        const due = node.due && Date.parse(node.due) <= Date.parse(state.worldClock);
        // Active background plans are weaker than this scene or due work; they remain searchable without outranking it.
        select(node.ref, due ? 95 : sceneRelated ? 70 : 65);
      }
    }
    // Two bounded, directed relationship hops; never expand every event of an actor or every resident of a location.
    for (let depth = 0; depth < 2; depth++) {
      const before = new Map(selected);
      for (const node of nodes) {
        const weight = before.get(key(node.ref));
        if (!weight || weight < 50) continue;
        node.links.forEach(link => select(link, weight - 15));
      }
    }
  }
  // Existing task goals/blockers and focused profiles supply lexical cues when old journals lack references.
  // This does not infer new graph edges or invent a source turn for tasks (V6 has no creation sourceTurnId).
  let derivedRemaining = 8000;
  let omittedDerivedCueCharacters = 0;
  const topicalDerivedTexts: string[] = [];
  const derivedTexts = nodes.filter(node => (selected.get(key(node.ref)) ?? 0) >= (['task', 'event'].includes(node.ref.kind) ? 65 : 80))
    .sort((a, b) => (selected.get(key(b.ref)) ?? 0) - (selected.get(key(a.ref)) ?? 0) || key(a.ref).localeCompare(key(b.ref)))
    .map(node => {
      const original = [...node.labels, node.text].join('\n');
      const text = original.slice(0, Math.min(2000, derivedRemaining));
      derivedRemaining -= text.length; omittedDerivedCueCharacters += original.length - text.length;
      // A lifelong companion's static biography is not the player's current topic.
      if (!commonNpc(node.ref)) topicalDerivedTexts.push(text);
      return text;
    });
  const queryTerms = termsFor([...texts, ...derivedTexts].join('\n'));
  // Frequent background words cannot make nearly every turn relevant. Entity/source signals remain independent.
  const terms = queryTerms.slice(0, recallBudget.terms).filter(term => state.journal.length < 10 ||
    journalText.filter(text => text.includes(term)).length <= state.journal.length * 0.4);
  const identityTerms = new Set(nodes.filter(node => commonNpc(node.ref)).flatMap(node => termsFor(node.labels.join('\n'))));
  const topicalTerms = new Set(termsFor([...texts, ...topicalDerivedTexts].join('\n')).filter(term => terms.includes(term) && !identityTerms.has(term) &&
    journalText.filter(text => text.includes(term)).length <= Math.max(3, state.journal.length * 0.1)));
  const locationTurns = new Set(nodes.filter(node => node.links.some(link => link.kind === 'location' && link.id === state.protagonist.locationId)).flatMap(node => node.turns));
  const tokenMatches = (text: string) => { const lower = norm(text); return terms.filter(term => lower.includes(term)); };
  const turnSources = new Map<string, { score: number; substantive: boolean; sources: { path: string; sourceRecordedAt?: string }[]; sourceKeys: Set<string>; refs: Map<string, Ref>; importance: number }>();
  function cite(turnIds: string[], path: string, refs: Ref[], score: number, at?: string, importance = 0, substantive = false) {
    for (const turnId of turnIds) {
      const current = turnSources.get(turnId) ?? { score: 0, substantive: false, sources: [], sourceKeys: new Set<string>(), refs: new Map<string, Ref>(), importance: 0 };
      current.score = Math.max(current.score, score); current.importance = Math.max(current.importance, importance);
      current.substantive ||= substantive;
      if (!current.sourceKeys.has(path)) {
        current.sourceKeys.add(path);
        if (current.sources.length < recallBudget.metadataReferences) current.sources.push({ path, ...(at ? { sourceRecordedAt: at } : {}) });
      }
      for (const reference of refs) current.refs.set(key(reference), reference);
      turnSources.set(turnId, current);
    }
  }
  for (const node of nodes) {
    const weight = selected.get(key(node.ref)) ?? 0;
    if (weight >= 50) cite(node.turns, `${node.ref.kind}.${node.ref.id}`, [node.ref], weight * rarity(node.ref), undefined, node.importance,
      node.ref.kind !== 'npc');
  }
  for (const source of sources) {
    const related = source.refs.filter(reference => (selected.get(key(reference)) ?? 0) >= 50);
    const hits = tokenMatches(source.text);
    const topicHits = hits.filter(term => topicalTerms.has(term));
    const relationshipWeight = related.reduce((weight, reference) => Math.max(weight, (selected.get(key(reference)) ?? 0) * rarity(reference)), 0);
    const breadth = Math.sqrt(Math.max(1, new Set(source.turns.filter(turnId => knownTurns.has(turnId))).size));
    const topicScore = topicHits.length ? Math.min(85, 55 + topicHits.length * 8) / breadth : 0;
    const lexicalScore = hits.length && !related.some(commonNpc) ? Math.min(65, 35 + hits.length * 6) / breadth : 0;
    if (related.length || hits.length) cite(source.turns, source.path, related,
      Math.max(Math.min(85, relationshipWeight) / breadth, topicScore, lexicalScore), source.at, 0, topicScore >= 30);
  }
  const excluded = new Set(state.journal.slice(-windowSize).map(entry => entry.turnId));
  const ranked = enabled ? state.journal.flatMap((entry, index) => {
    if (excluded.has(entry.turnId)) return [];
    const linked = turnSources.get(entry.turnId);
    const matchedEntityRefs = entry.relatedActorRefs.filter(reference => (selected.get(key(reference)) ?? 0) >= 50);
    const matchedTerms = tokenMatches(`${entry.story.summary}\n${entry.story.narrative}`);
    const matchedTopicTerms = matchedTerms.filter(term => topicalTerms.has(term));
    const summaryTerms = tokenMatches(entry.story.summary);
    const textScore = Math.min(40, summaryTerms.length * 6 + matchedTerms.length * 3);
    const rareIdentity = matchedEntityRefs.some(reference => !commonNpc(reference)) ||
      Boolean(linked && linked.score >= 30 && [...linked.refs.values()].some(reference => !commonNpc(reference)));
    // Identity alone is insufficient for pervasive companions, including owner-only source links.
    // Explicit event/task/timeline evidence is independent of character prevalence and always survives.
    if (!linked?.substantive && !rareIdentity && !matchedTopicTerms.length && !(linked && !linked.refs.size && linked.score >= 30)) return [];
    const actorScore = matchedEntityRefs.reduce((weight, reference) => Math.max(weight,
      reference.kind === 'npc' ? Math.min(60, 90 * rarity(reference)) : 90), 0);
    const score = Math.round(actorScore + (linked?.score ?? 0) + textScore + (matchedTopicTerms.length ? 30 : 0) + (linked?.importance ?? 0) + (locationTurns.has(entry.turnId) ? 4 : 0)
      + Math.floor(4 * (index + 1) / Math.max(1, state.journal.length)));
    return [{ entry, index, score, matchedEntityRefs, matchedTerms, matchedTopicTerms, linked }];
  }).sort((a, b) => b.score - a.score || b.index - a.index || a.entry.turnId.localeCompare(b.entry.turnId)) : [];
  const recalledTurns = [];
  let textRemaining: number = recallBudget.narrativeCharacters;
  let sizeRemaining: number = recallBudget.serializedCharacters - 2;
  for (const candidate of ranked) {
    if (recalledTurns.length >= recallBudget.maximumRecords || textRemaining < 100) break;
    const { entry, index, score, matchedTerms, matchedTopicTerms, matchedEntityRefs, linked } = candidate;
    const strong = score >= 70;
    const share = Math.floor(textRemaining / Math.min(4, ranked.length - recalledTurns.length));
    const limit = Math.min(textRemaining, strong ? Math.min(recallBudget.fullTurnCharacters, Math.max(600, share)) : recallBudget.auxiliaryCharacters);
    let narrative = cut(entry.story.narrative, limit, matchedTerms);
    const summary = cut(entry.story.summary, recallBudget.summaryCharacters, matchedTerms);
    const citations = linked?.sources ?? [];
    const result = {
      turnId: entry.turnId, turnNumber: index + 1, revision: entry.revision, source: 'journal' as const, status: 'committed' as const,
      relevance: strong ? 'strong' as const : 'auxiliary' as const, score,
      summary: summary.text, summaryRange: summary.range, summaryTruncated: summary.truncated,
      narrativeExcerpt: narrative.text, narrativeRange: narrative.range, narrativeTruncated: narrative.truncated,
      excerptMarker: narrative.truncated ? '[原文截取；范围见narrativeRange]' : '[完整原始正文]',
      matchedTerms: matchedTerms.slice(0, 12), matchedEntityRefs: matchedEntityRefs.slice(0, recallBudget.metadataReferences),
      matchedTopicTerms: matchedTopicTerms.slice(0, 12),
      relatedActorRefs: entry.relatedActorRefs.slice(0, recallBudget.metadataReferences),
      omittedRelatedActorRefs: Math.max(0, entry.relatedActorRefs.length - recallBudget.metadataReferences),
      sourceReferences: citations, omittedSourceReferences: Math.max(0, (linked?.sourceKeys.size ?? 0) - recallBudget.metadataReferences),
      linkedEntityRefs: [...(linked?.refs.values() ?? [])].slice(0, recallBudget.metadataReferences),
      omittedLinkedEntityRefs: Math.max(0, (linked?.refs.size ?? 0) - recallBudget.metadataReferences),
    };
    let size = encodedSize(result) + 1;
    if (size > sizeRemaining) {
      const allowance = Math.max(0, narrative.text.length - (size - sizeRemaining) - 100);
      narrative = cut(entry.story.narrative, allowance, matchedTerms);
      Object.assign(result, { narrativeExcerpt: narrative.text, narrativeRange: narrative.range, narrativeTruncated: narrative.truncated,
        excerptMarker: '[原文截取；范围见narrativeRange]' });
      size = encodedSize(result) + 1;
    }
    if (size > sizeRemaining || narrative.text.length < Math.min(100, entry.story.narrative.length)) continue;
    recalledTurns.push(result); sizeRemaining -= size; textRemaining -= narrative.text.length;
  }
  return { recalledTurns, recallPolicy: '召回只提供已提交journal原始经过；sourceReferences指向SAVE_STATE既有记忆/世界资料，不是额外事件或身份断言。总结覆盖多个回合不证明每个角色参与每回合。当前STORY_RESULT及Variables投影仍是未提交候选。历史与较新正式状态冲突时以正式状态为准，不据历史重复记账。无可验证时间时不补造时间；原文截取范围以UTF-16半开区间标明。',
    recallDiagnostics: { algorithm: 'shared-journal-v2', stage: cues.stage, eligibleTurns: ranked.length, selectedTurns: recalledTurns.length,
      cueCharacters: rawTexts.map(text => text.length), queryTerms: queryTerms.length, usedQueryTerms: terms.length,
      strongTurns: recalledTurns.filter(turn => turn.relevance === 'strong').length,
      auxiliaryTurns: recalledTurns.filter(turn => turn.relevance === 'auxiliary').length,
      truncatedTurns: recalledTurns.filter(turn => turn.narrativeTruncated || turn.summaryTruncated).length,
      metadataSerializedCharacters: encodedSize(recalledTurns.map(turn => ({ ...turn, narrativeExcerpt: undefined }))),
      truncatedCueCharacters: rawTexts.map(text => Math.max(0, text.length - recallBudget.queryCharacters)),
      derivedCueCharacters: 8000 - derivedRemaining, omittedDerivedCueCharacters,
      omittedQueryTerms: Math.max(0, queryTerms.length - recallBudget.terms), suppressedFrequentTerms: Math.min(queryTerms.length, recallBudget.terms) - terms.length,
      omittedTurns: ranked.length - recalledTurns.length, serializedCharacters: recallBudget.serializedCharacters - sizeRemaining,
      narrativeCharacters: recallBudget.narrativeCharacters - textRemaining, budget: recallBudget, timeWindow: cues.stage === 'world' ? { from: cues.from, to: state.worldClock } : undefined } };
}
