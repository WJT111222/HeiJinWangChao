import { z } from 'zod';
import { IdSchema } from '../../domain/common';
import type { GameState } from '../../domain/state';

export const kinds = {
  player: '主角',
  npc: 'NPC',
  story: '剧情',
  place: '地点',
  item: '物品',
  vehicle: '车辆',
};
export type Kind = keyof typeof kinds;
export const slots = {
  avatar: '头像',
  home: '居家照',
  bust: '半身照',
  full: '全身立绘',
  illustration: '剧情插画',
  location: '地点图',
  object: '物品图',
};
export type Slot = keyof typeof slots;
export const person = (kind: Kind) => kind === 'player' || kind === 'npc';
export const slotOptions = (kind: Kind): Slot[] =>
  person(kind)
    ? ['avatar', 'bust', 'full', 'home']
    : [kind === 'story' ? 'illustration' : kind === 'place' ? 'location' : 'object'];
export const targetSchema = z.strictObject({
  kind: z.enum(['player', 'npc', 'story', 'place', 'item', 'vehicle']),
  id: IdSchema,
  title: z.string().max(256),
  turnId: IdSchema.optional(),
  gameTime: z.string().max(80),
  summary: z.string().max(1600),
  identity: z.string().max(4000).optional(),
});
export type Target = z.infer<typeof targetSchema>;
export interface Scope {
  saveId: string;
  createdAt: string;
  instance?: string;
}
export function targetFor(s: GameState, kind: Kind, id: string): Target | undefined {
  const entry = kind === 'story' ? s.journal.find((j) => j.turnId === id) : s.journal.at(-1);
  const common = {
    kind,
    id,
    turnId: entry?.turnId,
    gameTime: entry?.scene?.worldClock ?? (kind === 'story' ? '' : s.worldClock),
  };
  let title: string, summary: string, identity: string | undefined;
  if (kind === 'story' && entry) {
    title = '第 ' + (s.journal.indexOf(entry) + 1) + ' 回合';
    summary = entry.story.summary || entry.story.narrative;
  } else if (person(kind)) {
    const p = kind === 'player' ? s.protagonist : s.npc[id];
    if (!p || p.id !== id) return;
    title = p.name;
    summary = [
      p.name,
      p.age === undefined ? '' : p.age + ' 岁',
      p.gender,
      'profession' in p ? p.profession : p.identity,
      p.appearance,
    ]
      .filter(Boolean)
      .join('，');
    identity = 'identityKey' in p ? p.identityKey : undefined;
  } else if (kind === 'place' && s.locations[id]) {
    const p = s.locations[id];
    title = p.name;
    summary = [s.locations[p.parentId ?? '']?.name, p.name].filter(Boolean).join(' · ');
  } else if (kind === 'item' && s.items[id]) {
    const p = s.items[id];
    title = p.name;
    summary = [p.name, p.description, p.conditionText].filter(Boolean).join('，');
    identity = p.createdByTurnId;
  } else if (kind === 'vehicle' && s.economy.vehicles[id]) {
    const p = s.economy.vehicles[id];
    title = p.name;
    summary = [p.name, p.model, p.statusText].filter(Boolean).join('，');
  } else return;
  return {
    ...common,
    title: title.slice(0, 256),
    summary: summary.slice(0, 1600),
    identity: identity?.slice(0, 4000),
  };
}
export function validTarget(s: GameState, t: Target, turnIds?: ReadonlySet<string>) {
  if (t.kind === 'story')
    return t.id === t.turnId && (turnIds ? turnIds.has(t.id) : s.journal.some((j) => j.turnId === t.id));
  const current = targetFor(s, t.kind, t.id);
  return Boolean(
    current &&
    current.identity === t.identity &&
    (!t.turnId || (turnIds ? turnIds.has(t.turnId) : s.journal.some((j) => j.turnId === t.turnId))),
  );
}
export const sameSubject = (a: Target, b: Target) =>
  a.kind === b.kind && a.id === b.id && a.identity === b.identity;
export const slotSchema = z.enum(['avatar', 'bust', 'full', 'home', 'illustration', 'location', 'object']);
export const metaSchema = z.strictObject({
  id: IdSchema,
  target: targetSchema,
  slot: slotSchema,
  created: z.string().max(80),
  bytes: z.number().int().positive(),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  current: z.boolean(),
  album: z.string().max(256).optional(),
});
export type Picture = z.infer<typeof metaSchema>;
export const anchorSchema = z.strictObject({ target: targetSchema, text: z.string().max(4000) });
export const collectionSchema = z.strictObject({
  pictures: z.array(metaSchema),
  anchors: z.array(anchorSchema),
});
export type Collection = z.infer<typeof collectionSchema>;
export const emptyCollection = (): Collection => ({ pictures: [], anchors: [] });
