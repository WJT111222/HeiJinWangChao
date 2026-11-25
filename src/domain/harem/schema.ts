import { z } from 'zod';
import { CountSchema, GameTimeSchema, IdSchema, TextSchema, entityTable } from '../common';

export const standingScore = z.number().int().min(0).max(100);
const visibility = z.enum(['player_known', 'internal']);
const source = { turnId: IdSchema, at: GameTimeSchema, reason: TextSchema };
const change = z.strictObject({ ...source, from: standingScore.nullable(), to: standingScore.nullable() });
const plan = z.strictObject({
  action: TextSchema,
  purpose: TextSchema.optional(),
  status: z.enum(['planned', 'active', 'blocked', 'done', 'cancelled']),
  visibility,
});
const pregnancy = z.strictObject({
  status: z.enum(['unknown', 'not_pregnant', 'suspected', 'confirmed', 'ended']),
  startedAt: GameTimeSchema.optional(),
  confirmedAt: GameTimeSchema.optional(),
  estimatedDueAt: GameTimeSchema.optional(),
  endedAt: GameTimeSchema.optional(),
  outcome: z.enum(['birth', 'loss', 'termination', 'other', 'unknown']).optional(),
  visibility,
});
const pair = z.strictObject({
  leftNpcId: IdSchema,
  rightNpcId: IdSchema,
  relationship: TextSchema,
  cooperation: z.boolean(),
  conflict: z.boolean(),
  visibility,
});
const parentage = z.strictObject({
  childNpcId: IdSchema,
  parentNpcId: IdSchema,
  protagonistParentage: z.literal('confirmed'),
  kinship: z.enum(['biological', 'adoptive', 'step', 'other']),
  bornAt: GameTimeSchema.optional(),
  visibility,
});
const overview = z.strictObject({
  harmony: standingScore.nullable(),
  competition: TextSchema.nullable(),
  summary: TextSchema.nullable(),
});
const member = z.strictObject({
  id: IdSchema,
  identityKey: TextSchema,
  changes: z.array(change).min(1),
  plan: plan.extend(source).optional(),
  pregnancy: pregnancy.extend(source).optional(),
});

export const HaremSchema = z.strictObject({
  members: entityTable(member),
  overview: overview.extend(source).optional(),
  pairs: z.array(pair.extend(source)),
  children: z.array(parentage.extend({ ...source, disclosure: z.strictObject(source).optional() })),
});
export type Harem = z.infer<typeof HaremSchema>;
export type HaremMember = Harem['members'][string];
export function currentStanding(member: HaremMember) {
  return member.changes[member.changes.length - 1].to;
}
export function activeMembers(harem: Harem) {
  return Object.values(harem.members)
    .filter((m) => currentStanding(m) !== null)
    .sort(
      (a, b) =>
        currentStanding(b)! - currentStanding(a)! ||
        Date.parse(a.changes[0].at) - Date.parse(b.changes[0].at) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
const subject = { npcId: IdSchema, reason: TextSchema };
export const HaremChangesSchema = z
  .array(
    z.discriminatedUnion('op', [
      z.strictObject({ op: z.literal('join'), ...subject, identityKey: TextSchema, to: standingScore }),
      z.strictObject({ op: z.literal('leave'), ...subject, from: standingScore }),
      z.strictObject({ op: z.literal('score'), ...subject, from: standingScore, to: standingScore }),
      z.strictObject({ op: z.literal('plan'), ...subject, value: plan.nullable() }),
      z.strictObject({ op: z.literal('pregnancy'), ...subject, value: pregnancy }),
      z.strictObject({ op: z.literal('overview'), reason: TextSchema, value: overview }),
      z.strictObject({ op: z.literal('pair'), reason: TextSchema, value: pair }),
      z.strictObject({ op: z.literal('child'), reason: TextSchema, value: parentage }),
      z.strictObject({ op: z.literal('discloseChild'), childNpcId: IdSchema, reason: TextSchema }),
    ]),
  )
  .min(1);
export const HaremCommandSchema = z.strictObject({
  type: z.literal('ApplyHaremChanges'),
  commandId: IdSchema,
  evidence: TextSchema,
  expectedRevision: CountSchema,
  changes: HaremChangesSchema,
});
