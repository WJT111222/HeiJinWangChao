import type { Organization } from '../../domain/organizations/schema';
import type { ActorRef } from '../../domain/common';
import { protagonistKnownEvent } from '../../domain/events/knowledge';
import { eventArchive, eventFamily } from './eventArchive';
import type { ArchiveEvent } from './eventArchive';
import { money, orgLabels } from './playerView';
import type { PlayerView } from './playerView';

type Row = { label: string; value: string };
const text = (value: string | readonly string[] | undefined) => Array.isArray(value) ? value.join('；') : (value as string | undefined)?.trim() ?? '';

/** 四类组织统一为七项公开信息；缺失或空白的项不显示。 */
export function factionPublicRows(org: Organization): Row[] {
  // 管理层没有约定“第一位即首脑”，只列出公开的职位与姓名，不替玩家猜谁是头。
  const leaders = (org.leadership ?? []).flatMap(row => row.publicName ? [`${row.position} · ${row.publicName}`] : []).join('；');
  const fields = (() => {
    switch (org.kind) {
      case 'gang': return { scope: org.territoryText, power: org.powerText, funds: org.funds === undefined ? '' : money(org.funds),
        business: text(org.industries), reputation: org.reputationText, intro: org.description };
      case 'government': return { scope: org.jurisdictionText, power: org.enforcementCapacityText, funds: org.fundingText,
        business: text(org.lawfulPowers), reputation: org.publicTrustText, intro: org.description };
      case 'civil': return { scope: org.activityAreaText, power: org.membershipText, funds: org.fundingText,
        business: text(org.activities), reputation: org.publicInfluenceText, intro: org.missionText?.trim() || org.description };
      case 'business': return { scope: org.operatingAreaText, power: org.ownershipText, funds: org.assetsEstimate === undefined ? '' : money(org.assetsEstimate),
        business: text(org.sectors), reputation: org.reputationText, intro: org.description };
    }
  })();
  return ([['管理层', leaders], ['简介', fields.intro], ['范围', fields.scope],
    ['实力', fields.power], ['资金', fields.funds], ['主要业务', fields.business], ['名声', fields.reputation]] as const)
    .map(([label, value]) => ({ label, value: text(value) })).filter(row => row.value);
}

const involves = (refs: readonly ActorRef[] | undefined, kind: ActorRef['kind'], id?: string) =>
  Boolean(refs?.some(ref => ref.kind === kind && (id === undefined || ref.id === id)));

/** 主角主势力的只读观察投影；不改变任何可见性或知情记录。 */
export function factionView(view: PlayerView) {
  const faction = view.protagonistFaction;
  const org = faction && view.organizations.find(row => row.id === faction.organizationId);
  if (!faction || !org) return undefined;
  const people = new Map(view.npc.map(person => [person.id, person]));
  const roles = new Map<string, { position: string; departmentId?: string }>();
  // 只认可公开的组织身份：带公开姓名的管理层、未标暗中身份的成员。关键人物名单和联系人本身不推定主角知情。
  for (const row of org.leadership ?? []) if (row.npcId && row.publicName) roles.set(row.npcId, { position: row.position });
  for (const row of org.members ?? []) {
    if (row.covert) { roles.delete(row.npcId); continue; }
    roles.set(row.npcId, { position: row.position, departmentId: row.departmentId });
  }
  const known = [...roles].filter(([id]) => people.get(id)?.isContact)
    .map(([id, role]) => ({ id, name: people.get(id)!.name, ...role }));
  const departmentIds = new Set((org.departments ?? []).map(row => row.id));
  const departments = (org.departments ?? []).map(row => ({
    ...row, mine: faction.departmentId === row.id,
    // 只显示公开姓名，即使绑定了人物也不用其真名代替。
    headName: row.headPublicName ?? undefined,
    people: known.filter(person => person.departmentId === row.id),
  }));
  const otherPeople = known.filter(person => !person.departmentId || !departmentIds.has(person.departmentId));

  const archive = eventArchive(view);
  // 与 Story 相同的正式知情投影：只有主角知情记录或完全公开的事件可见，并显示主角所知版本的标题与状态。
  const knownEvent = (event: ArchiveEvent) => {
    const detail = event.detail;
    if (!detail) return undefined;
    const sourceTurnIds = 'sourceTurnIds' in detail ? detail.sourceTurnIds : 'sourceTurnIds' in event.raw ? event.raw.sourceTurnIds : [];
    return protagonistKnownEvent({ id: event.id, title: detail.title, startAt: detail.startAt ?? event.startAt ?? view.worldClock,
      status: event.status, resolutionText: detail.resolutionText, visibility: detail.visibility, sourceTurnIds,
      protagonistKnowledge: detail.protagonistKnowledge });
  };
  const memberDepartment = (refs: readonly ActorRef[] | undefined) => [...new Set((refs ?? []).flatMap(ref => {
    const department = ref.kind === 'npc' ? roles.get(ref.id)?.departmentId : undefined;
    const name = department ? departments.find(row => row.id === department)?.name : undefined;
    return name ? [name] : [];
  }))];
  const done = (status?: string) => status === 'resolved' || status === 'cancelled';
  const families = [...archive.records.values()].filter(event => event.eventKind === 'main').flatMap(event => {
    const seen = knownEvent(event);
    if (!seen) return [];
    const family = eventFamily(archive, event.id, view.worldClock);
    const children = [...family.ended, ...family.running, ...family.upcoming, ...family.incomplete];
    if (!involves(event.detail?.actorRefs, 'organization', org.id) && !children.some(child => involves(child.detail?.actorRefs, 'organization', org.id))) return [];
    // 阶段逐个过滤：主角不知道的阶段不出现，标题同样取主角所知版本。
    const stages = [...family.ended, ...family.running, ...family.upcoming].flatMap(child => {
      const stage = knownEvent(child);
      return stage ? [{ id: child.id, title: stage.title, state: done(stage.status) ? 'done' as const : stage.status === 'scheduled' ? 'next' as const : 'now' as const }] : [];
    });
    return [{ event, seen, stages }];
  });
  const ongoing = families.filter(({ seen }) => seen.status === 'active' || seen.status === 'blocked').map(({ event, seen, stages }) => ({
    id: event.id, title: seen.title, status: seen.status === 'blocked' ? 'blocked' as const : 'active' as const, stages,
    // 参与部门由参与人物推算，只对完全公开的事件显示，避免暴露暗中参与。
    departments: event.detail?.visibility === 'known' ? memberDepartment(event.detail.actorRefs) : [],
    startAt: seen.startAt,
    relation: involves(event.detail?.actorRefs, 'protagonist') ? '我参与了' : '我知道',
  }));
  const recent = families.filter(({ seen }) => done(seen.status))
    .map(({ event, seen }) => ({ id: event.id, title: seen.title, at: event.detail?.resolvedAt ?? seen.startAt, outcome: seen.resolutionText }))
    .sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0)).slice(0, 5);
  const mine = [...archive.records.values()].flatMap(event => {
    const seen = knownEvent(event);
    return seen && !done(seen.status) && involves(event.detail?.actorRefs, 'protagonist') && involves(event.detail?.actorRefs, 'organization', org.id)
      ? [{ id: event.id, title: seen.title, status: seen.status ?? event.status }] : [];
  });

  const knownRows = org.protagonistKnown ?? [];
  return {
    org, faction, kindLabel: orgLabels[org.kind],
    department: departments.find(row => row.mine)?.name,
    publicRows: factionPublicRows(org),
    relations: (org.relations ?? []).map(row => ({ ...row, name: view.organizations.find(other => other.id === row.organizationId)?.name ?? row.organizationId })),
    departments, otherPeople,
    holdings: knownRows.filter(row => row.category === 'holding'),
    intel: knownRows.filter(row => row.category === 'intel'),
    ongoing, mine, recent,
  };
}
export type FactionView = NonNullable<ReturnType<typeof factionView>>;
