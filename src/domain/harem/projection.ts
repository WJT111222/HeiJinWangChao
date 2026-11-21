import { activeMembers, currentStanding } from './schema';
import type { Harem } from './schema';
import type { NPC } from '../npc/schema';

// Story only receives current public facts. Source histories remain in the save.
export function householdContext(h: Harem, people: Record<string, NPC>, variables: boolean, action: string) {
  const visible = (v: { visibility: string }) => variables || v.visibility === 'player_known';
  const rank = activeMembers(h);
  const named = rank.filter((member) => action.includes(people[member.id].name));
  const storyMembers = new Set([
    ...named,
    ...rank.slice(0, 1),
    ...rank.filter((member) => people[member.id].onScene),
  ]);
  const participants = variables ? Object.values(h.members) : Array.from(storyMembers).slice(0, 12);
  const ids = new Set(participants.map((m) => m.id));
  return {
    overview: h.overview && {
      harmony: h.overview.harmony,
      competition: h.overview.competition,
      summary: h.overview.summary,
    },
    members: participants.map((m) => ({
      npcId: m.id,
      statusValue: currentStanding(m),
      ...(variables ? { identityKey: m.identityKey } : {}),
      plan:
        m.plan && visible(m.plan)
          ? {
              action: m.plan.action,
              purpose: m.plan.purpose,
              status: m.plan.status,
              visibility: m.plan.visibility,
            }
          : undefined,
      pregnancy:
        m.pregnancy && visible(m.pregnancy)
          ? {
              status: m.pregnancy.status,
              startedAt: m.pregnancy.startedAt,
              confirmedAt: m.pregnancy.confirmedAt,
              estimatedDueAt: m.pregnancy.estimatedDueAt,
              endedAt: m.pregnancy.endedAt,
              outcome: m.pregnancy.outcome,
              visibility: m.pregnancy.visibility,
            }
          : undefined,
    })),
    pairs: h.pairs
      .filter((p) => visible(p) && (variables || (ids.has(p.leftNpcId) && ids.has(p.rightNpcId))))
      .map((p) => ({
        leftNpcId: p.leftNpcId,
        rightNpcId: p.rightNpcId,
        relationship: p.relationship,
        cooperation: p.cooperation,
        conflict: p.conflict,
        visibility: p.visibility,
      })),
    children: h.children
      .filter((c) => visible(c) && (variables || ids.has(c.parentNpcId)))
      .map((c) => ({
        childNpcId: c.childNpcId,
        parentNpcId: c.parentNpcId,
        kinship: c.kinship,
        protagonistParentage: c.protagonistParentage,
        bornAt: c.bornAt,
        visibility: c.visibility,
      })),
  };
}

/** The dossier consumes known facts only, leaving private records in the formal state. */
export function playerHousehold(h: Harem): Harem {
  return {
    members: Object.fromEntries(
      Object.entries(h.members).map(([id, { plan, pregnancy, ...member }]) => [
        id,
        {
          ...member,
          ...(plan?.visibility === 'player_known' ? { plan } : {}),
          ...(pregnancy?.visibility === 'player_known' ? { pregnancy } : {}),
        },
      ]),
    ),
    overview: h.overview,
    pairs: h.pairs.filter((p) => p.visibility === 'player_known'),
    children: h.children.filter((c) => c.visibility === 'player_known'),
  };
}
