import type { NPC } from '../npc/schema';
import { currentStanding } from './schema';
import type { Harem } from './schema';

export function householdIssue(h: Harem, people: Record<string, NPC>, clock: string): string | undefined {
  const now = Date.parse(clock),
    members = Object.values(h.members);
  let active = 0,
    primary = 0;
  for (const m of members) {
    const person = Object.hasOwn(people, m.id) && people[m.id];
    if (!person || person.identityKey !== m.identityKey) return '成员的稳定人物身份不符';
    let previous: number | null = null,
      last = -Infinity;
    for (const c of m.changes) {
      const at = Date.parse(c.at);
      if (c.from !== previous || c.to === c.from || at < last || at > now)
        return '地位前值、变更顺序或时间不符';
      previous = c.to;
      last = at;
    }
    if (currentStanding(m) !== null) {
      active++;
      if (previous === 100) primary++;
      if (person.gender !== 'female' || person.age === undefined || person.age < 18)
        return '现役成员须为已确认成年的女性人物';
    }
    if (m.plan && Date.parse(m.plan.at) > now) return '规划记录晚于存档时间';
    const p = m.pregnancy;
    if (!p) continue;
    const at = Date.parse(p.at),
      start = p.startedAt && Date.parse(p.startedAt),
      confirmed = p.confirmedAt && Date.parse(p.confirmedAt);
    const end = p.endedAt && Date.parse(p.endedAt),
      due = p.estimatedDueAt && Date.parse(p.estimatedDueAt);
    if (
      at > now ||
      [start, confirmed, end].some((t) => typeof t === 'number' && t > at) ||
      (typeof start === 'number' && [confirmed, end, due].some((t) => typeof t === 'number' && t < start)) ||
      (typeof confirmed === 'number' && typeof end === 'number' && end < confirmed) ||
      (p.status !== 'ended' && (p.endedAt || p.outcome)) ||
      (p.confirmedAt && p.status !== 'confirmed' && p.status !== 'ended') ||
      (['unknown', 'not_pregnant'].includes(p.status) && (p.startedAt || p.estimatedDueAt))
    )
      return '妊娠状态与记录日期不一致';
  }
  if (primary !== (active ? 1 : 0)) return '非空现役后宫必须恰有一位地位为100的正宫';
  if (h.overview && Date.parse(h.overview.at) > now) return '总览记录晚于存档时间';
  const pairs = new Set<string>();
  for (const p of h.pairs) {
    const key = JSON.stringify([p.leftNpcId, p.rightNpcId]);
    if (
      !(p.leftNpcId < p.rightNpcId) ||
      pairs.has(key) ||
      !Object.hasOwn(h.members, p.leftNpcId) ||
      !Object.hasOwn(h.members, p.rightNpcId) ||
      Date.parse(p.at) > now
    )
      return '关系对的身份、次序或时间无效';
    pairs.add(key);
  }
  const children = new Map<string, string>();
  for (const c of h.children) {
    if (
      children.has(c.childNpcId) ||
      c.childNpcId === c.parentNpcId ||
      !Object.hasOwn(people, c.childNpcId) ||
      !Object.hasOwn(h.members, c.parentNpcId) ||
      Date.parse(c.at) > now ||
      (c.bornAt && Date.parse(c.bornAt) > Date.parse(c.at))
    )
      return '子嗣必须是已出生、无重复且引用有效的独立人物';
    const person = people[c.childNpcId];
    if (person.kind === 'special' && person.privateProfile && (person.age === undefined || person.age < 18))
      return '未确认成年子女不得关联成人私密资料';
    if (
      c.disclosure &&
      (c.visibility !== 'player_known' ||
        Date.parse(c.disclosure.at) < Date.parse(c.at) ||
        Date.parse(c.disclosure.at) > now)
    )
      return '亲子关系知情时间与正式记录不符';
    children.set(c.childNpcId, c.parentNpcId);
  }
  const checked = new Set<string>();
  for (const child of children.keys()) {
    const chain = new Set<string>();
    let id: string | undefined = child;
    while (id !== undefined && !checked.has(id)) {
      if (chain.has(id)) return '父母与子女不能形成循环引用';
      chain.add(id);
      id = children.get(id);
    }
    for (const visited of chain) checked.add(visited);
  }
}
