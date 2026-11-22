import type { z } from 'zod';
import { requireData } from '../common';
import type { GameState } from '../state';
import { currentStanding, type Harem, type HaremBackgroundCommandSchema, type HaremCommandSchema } from './schema';
import { householdIssue } from './validation';

// commitCommands owns the parsed working copy. No intermediate operation writes to storage.
export function applyHarem(state: GameState, command: z.infer<typeof HaremCommandSchema>, turnId: string) {
  requireData(command.expectedRevision === state.revision, 'REVISION_CONFLICT', '后宫候选的存档版本已改变');
  applyHouseholdEdits(state, command.changes, turnId);
}

/** World 的场外推进：只接受计划、成员关系与总体局势，且必须已有现役成员。 */
export function applyHaremBackground(state: GameState, command: z.infer<typeof HaremBackgroundCommandSchema>, turnId: string) {
  requireData(state.harem && Object.values(state.harem.members).some((m) => currentStanding(m) !== null),
    'HAREM_STATE', '没有现役后宫成员，World 不能推进家庭事务');
  applyHouseholdEdits(state, command.changes, turnId);
}

function applyHouseholdEdits(state: GameState, changes: z.infer<typeof HaremCommandSchema>['changes'], turnId: string) {
  const h: Harem = state.harem ?? { members: {}, pairs: [], children: [] };
  const editedPairs = new Set<string>();
  for (const edit of changes) {
    const source = { turnId, at: state.worldClock, reason: edit.reason };
    if (edit.op === 'overview') {
      h.overview = { ...edit.value, ...source };
      continue;
    }
    if (edit.op === 'child') {
      requireData(
        !h.children.some((c) => c.childNpcId === edit.value.childNpcId),
        'HAREM_CHILD',
        '子女已经登记',
      );
      h.children.push({ ...edit.value, ...source });
      continue;
    }
    if (edit.op === 'discloseChild') {
      const child = h.children.find((c) => c.childNpcId === edit.childNpcId);
      requireData(
        child && child.visibility === 'internal',
        'HAREM_CHILD',
        '只有已登记且尚未公开的亲子关系可确认知情',
      );
      child.visibility = 'player_known';
      child.disclosure = source;
      continue;
    }
    if (edit.op === 'pair') {
      const [leftNpcId, rightNpcId] = [edit.value.leftNpcId, edit.value.rightNpcId].sort();
      const key = JSON.stringify([leftNpcId, rightNpcId]);
      requireData(
        !editedPairs.has(key) &&
          [leftNpcId, rightNpcId].every(
            (id) => Object.hasOwn(h.members, id) && currentStanding(h.members[id]) !== null,
          ),
        'HAREM_PAIR',
        '须指定现役成员，同批不能重复登记成员对',
      );
      editedPairs.add(key);
      const index = h.pairs.findIndex((p) => p.leftNpcId === leftNpcId && p.rightNpcId === rightNpcId);
      const next = { ...edit.value, leftNpcId, rightNpcId, ...source };
      if (index < 0) h.pairs.push(next);
      else h.pairs[index] = next;
      continue;
    }
    const member = Object.hasOwn(h.members, edit.npcId) ? h.members[edit.npcId] : undefined;
    const from = member ? currentStanding(member) : null;
    if (edit.op === 'join') {
      const person = Object.hasOwn(state.npc, edit.npcId) && state.npc[edit.npcId];
      requireData(
        person &&
          person.age !== undefined &&
          person.age >= 18 &&
          person.gender === 'female' &&
          person.identityKey === edit.identityKey &&
          from === null,
        'HAREM_MEMBER',
        '加入需要已确认的成年女性身份且不能重复',
      );
      const record = member ?? { id: edit.npcId, identityKey: edit.identityKey, changes: [] };
      record.changes.push({ ...source, from: null, to: edit.to });
      h.members[edit.npcId] = record;
      continue;
    }
    requireData(member, 'HAREM_MEMBER', '人物没有正式成员记录');
    if (edit.op === 'pregnancy') {
      member.pregnancy = { ...edit.value, ...source };
      continue;
    }
    requireData(from !== null, 'HAREM_MEMBER', '操作需要现役成员');
    if (edit.op === 'plan') {
      if (edit.value) member.plan = { ...edit.value, ...source };
      else delete member.plan;
      continue;
    }
    requireData(from === edit.from, 'HAREM_STANDING', '地位前值与正式记录不符');
    member.changes.push({ ...source, from, to: edit.op === 'leave' ? null : edit.to });
    if (edit.op === 'leave') delete member.plan;
  }
  const issue = householdIssue(h, state.npc, state.worldClock);
  requireData(!issue, 'HAREM_STATE', issue ?? '');
  state.harem = h;
}
