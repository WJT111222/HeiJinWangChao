import type { Organization } from '../../domain/organizations/schema';
import type { ActorRef } from '../../domain/common';
import { eventArchive, eventFamily } from './eventArchive';
import type { ArchiveEvent } from './eventArchive';
import { money, orgLabels } from './playerView';
import type { PlayerView } from './playerView';

type Row = { label: string; value: string };
const text = (value: string | readonly string[] | undefined) => Array.isArray(value) ? value.join('；') : (value as string | undefined)?.trim() ?? '';

/** 四类组织统一为七项公开信息；缺失或空白的项不显示。 */
export function factionPublicRows(org: Organization): Row[] {
  const leader = org.leadership?.find(row => row.publicName);
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
  return ([['首脑', leader ? `${leader.position} · ${leader.publicName}` : ''], ['简介', fields.intro], ['范围', fields.scope],
    ['实力', fields.power], ['资金', fields.funds], ['主要业务', fields.business], ['名声', fields.reputation]] as const)
    .map(([label, value]) => ({ label, value: text(value) })).filter(row => row.value);
}

const involves = (refs: readonly ActorRef[] | undefined, kind: ActorRef['kind'], id?: string) =>
  Boolean(refs?.some(ref => ref.kind === kind && (id === undefined || ref.id === id)));
const terminal = (event: ArchiveEvent) => event.status === 'resolved' || event.status === 'cancelled';

/** 主角主势力的只读观察投影；不改变任何可见性或知情记录。 */
export function factionView(view: PlayerView) {
  const faction = view.protagonistFaction;
  const org = faction && view.organizations.find(row => row.id === faction.organizationId);
  if (!faction || !org) return undefined;
  const people = new Map(view.npc.map(person => [person.id, person]));
  const roles = new Map<string, { position: string; departmentId?: string }>();
  for (const row of org.leadership ?? []) if (row.npcId) roles.set(row.npcId, { position: row.position });
  for (const id of org.keyNpcIds) if (!roles.has(id)) roles.set(id, { position: '成员' });
  for (const row of org.members ?? []) roles.set(row.npcId, { position: row.position, departmentId: row.departmentId });
  const known = [...roles].filter(([id]) => people.get(id)?.isContact)
    .map(([id, role]) => ({ id, name: people.get(id)!.name, ...role }));
  const departmentIds = new Set((org.departments ?? []).map(row => row.id));
  const departments = (org.departments ?? []).map(row => ({
    ...row, mine: faction.departmentId === row.id,
    headName: row.headNpcId ? people.get(row.headNpcId)?.name ?? row.headPublicName ?? undefined : row.headPublicName ?? undefined,
    people: known.filter(person => person.departmentId === row.id),
  }));
  const otherPeople = known.filter(person => !person.departmentId || !departmentIds.has(person.departmentId));

  const archive = eventArchive(view);
  const knownToProtagonist = (event: ArchiveEvent) => involves(event.detail?.actorRefs, 'protagonist') || Boolean(event.detail?.protagonistKnowledge);
  const visible = (event: ArchiveEvent) => event.detail?.visibility !== 'hidden' || knownToProtagonist(event);
  const memberDepartment = (refs: readonly ActorRef[] | undefined) => [...new Set((refs ?? []).flatMap(ref => {
    const department = ref.kind === 'npc' ? roles.get(ref.id)?.departmentId : undefined;
    const name = department ? departments.find(row => row.id === department)?.name : undefined;
    return name ? [name] : [];
  }))];
  const mains = [...archive.records.values()].filter(event => event.eventKind === 'main');
  const families = mains.map(event => ({ event, family: eventFamily(archive, event.id, view.worldClock) }))
    .filter(({ event, family }) => involves(event.detail?.actorRefs, 'organization', org.id)
      || [...family.running, ...family.upcoming, ...family.ended, ...family.incomplete].some(child => involves(child.detail?.actorRefs, 'organization', org.id)))
    .filter(({ event }) => visible(event));
  const ongoing = families.filter(({ event }) => !event.retired && (event.status === 'active' || event.status === 'blocked')).map(({ event, family }) => ({
    id: event.id, title: event.title, status: event.status,
    stages: [...family.ended.map(row => ({ id: row.id, title: row.title, state: 'done' as const })),
      ...family.running.map(row => ({ id: row.id, title: row.title, state: 'now' as const })),
      ...family.upcoming.map(row => ({ id: row.id, title: row.title, state: 'next' as const }))],
    departments: memberDepartment([...(event.detail?.actorRefs ?? []), ...family.running.flatMap(row => row.detail?.actorRefs ?? [])]),
    startAt: event.startAt,
    relation: involves(event.detail?.actorRefs, 'protagonist') ? '你参与了' : event.detail?.protagonistKnowledge ? '你知道' : undefined,
  }));
  const recent = families.filter(({ event }) => terminal(event) || event.retired)
    .filter(({ event }) => knownToProtagonist(event) || event.detail?.visibility === 'known')
    .map(({ event }) => ({ id: event.id, title: event.title, at: event.detail?.resolvedAt ?? event.startAt, outcome: event.detail?.resolutionText }))
    .sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0)).slice(0, 5);
  const mine = [...archive.records.values()].filter(event => !terminal(event) && !event.retired
    && involves(event.detail?.actorRefs, 'protagonist') && involves(event.detail?.actorRefs, 'organization', org.id))
    .map(event => ({ id: event.id, title: event.title, status: event.status }));

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
