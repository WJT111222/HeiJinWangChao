import type { GameState } from '../state';
import type { HistoryTime } from './time';
import { historyBounds, historyTimeKey } from './time';

type Check = (ok: unknown, message: string, path?: (string | number)[], rule?: string) => void;
/** Runs on the entire final projection (also on reload). Never judges prose/significance.
 * Ordinary/legacy records deliberately do not acquire the major-history requirements.
 */
export function validateChronicles(state: GameState, check: Check) {
  const records = new Map(state.timeline.map(entry => [entry.id, entry]));
  const turns = new Set(state.journal.map(entry => entry.turnId));
  const milestones = new Map<string, { time: string; categories: Set<string> }>();
  const edges = new Map<string, string[]>();
  for (const [index, entry] of state.timeline.entries()) {
    const c = entry.chronicle;
    if (!c) continue;
    const path = (field: string) => ['timeline', index, 'chronicle', ...field.split('.')];
    const knowledge = c.nature === 'fact' ? 'established' : c.nature === 'statement' ? 'reported' : 'suspected';
    check(entry.knowledgeKind === knowledge, '纪事信息性质与原历史认知分类冲突', path('nature'), 'history_structure');
    check(entry.title.length <= 120 && entry.summary.length <= 600, '重大纪事标题或简述超出长度上限', ['timeline', index], 'history_structure');
    const time = (value: HistoryTime, field: string) => {
      const bounds = historyBounds(value);
      check(!bounds || bounds.earliest <= Date.parse(entry.recordedAt), '历史发生时间在记录时间之后', path(field), 'event_time');
      if (value.precision === 'range') check(historyBounds(value.from)!.earliest <= historyBounds(value.to)!.latest,
        '历史时间范围倒置', path(field), 'event_time');
      return bounds;
    };
    const start = time(c.time, 'time'), end = c.endTime && time(c.endTime, 'endTime');
    check(!start || !end || start.earliest <= end.latest, '历史开始晚于结束', path('endTime'), 'event_time');
    if (entry.occurredAt) check(start && Date.parse(entry.occurredAt) >= start.earliest && Date.parse(entry.occurredAt) <= start.latest,
      '历史发生时间与结构化时间冲突', path('time'), 'event_time');
    const prior = milestones.get(c.milestoneId), key = historyTimeKey(c.time);
    check(!prior?.categories.has(c.category), '同一重大事实与类别重复记录', path('milestoneId'), 'history_duplicate');
    check(!prior || prior.time === key, '同一重大事实的双视角时间不一致', path('time'), 'event_time');
    if (prior) prior.categories.add(c.category);
    else milestones.set(c.milestoneId, { time: key, categories: new Set([c.category]) });
    (c.supportingTurnIds ?? []).forEach((id, i) => check(id === entry.sourceTurnId || turns.has(id),
      '历史来源回合不存在', [...path('supportingTurnIds'), i], 'history_source'));
    const relations = c.relations ?? [];
    check(new Set(relations.map(r => `${r.kind}:${r.entryId}`)).size === relations.length,
      '历史关系重复', path('relations'), 'history_reference');
    relations.forEach((r, i) => check(r.entryId !== entry.id && records.has(r.entryId),
      '历史关系不存在或自引用', [...path('relations'), i, 'entryId'], 'history_reference'));
    edges.set(entry.id, relations.filter(r => r.kind !== 'parallel').map(r => r.entryId));
    if (c.category === 'world') {
      if (c.basis === 'historical_event') {
        check(!entry.eventId, '已有事件的纪事必须使用事件结果或撤销决定依据', path('basis'), 'history_event');
      } else {
        const active = entry.eventId ? state.events[entry.eventId] : undefined;
        const retired = entry.eventId ? state.retiredEvents[entry.eventId] : undefined;
        const event = active ?? retired, detail = active ?? retired?.detail;
        check(event && ['resolved', 'cancelled'].includes(event.status) && detail?.resolvedAt,
          '世界重大纪事需要有实际结束时间的终态事件', path('basis'), 'history_event');
        if (detail?.resolvedAt && event) {
          const decision = c.basis === 'cancellation_decision';
          check(!decision || event.status === 'cancelled', '撤销决定必须关联已取消事件', path('basis'), 'history_event');
          check(decision || Date.parse(detail.resolvedAt) >= Date.parse(detail.startAt),
            '尚未开始即取消的计划不能作为已发生事件归档', path('basis'), 'history_event');
          const expectedStart = decision ? detail.resolvedAt : detail.startAt;
          check(c.time.precision === 'instant' && Date.parse(c.time.at) === Date.parse(expectedStart),
            '已记录事件须使用实际开始时间；撤销决定使用实际撤销时间', path('time'), 'event_time');
          check(c.endTime.precision === 'instant' && Date.parse(c.endTime.at) === Date.parse(detail.resolvedAt),
            '纪事结束时间必须与事件实际终止时间一致', path('endTime'), 'event_time');
        }
      }
    }
  }
  // Iterative cycle detection avoids deep recursion on long games. Parallel links are non-causal.
  const indegree = new Map([...records.keys()].map(id => [id, 0]));
  for (const targets of edges.values()) for (const id of targets) if (indegree.has(id)) indegree.set(id, indegree.get(id)! + 1);
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < ready.length; i++) for (const id of edges.get(ready[i]) ?? []) if (indegree.has(id)) {
    const count = indegree.get(id)! - 1; indegree.set(id, count); if (count === 0) ready.push(id);
  }
  check(ready.length === records.size, '历史前序或更正关系成环', ['timeline'], 'history_reference');
}
