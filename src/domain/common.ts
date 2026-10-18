import { z } from 'zod';

// ID 可作为实体表的键，拒绝原型属性名；所有实体在单个存档内全局唯一。
export const IdSchema = z.string().min(1).max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  .refine((id) => !['__proto__', 'prototype', 'constructor'].includes(id));
export const TextSchema = z.string().trim().min(1);
export const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// 所有金额、余额和估值均为人民币分，避免浮点累计误差。未知金额不猜测为零。
export const MoneySchema = CountSchema;
export const GameTimeSchema = z.iso.datetime({ offset: true }).refine(
  (time) => Number.isFinite(Date.parse(time)), '无效游戏时间',
);
export const ActorRefSchema = z.strictObject({
  kind: z.enum(['protagonist', 'npc', 'organization']),
  id: IdSchema,
});
export type ActorRef = z.infer<typeof ActorRefSchema>;
export const VisibilitySchema = z.enum(['hidden', 'partially_known', 'known']);
export const StringsSchema = z.array(TextSchema);
export const IdsSchema = z.array(IdSchema).refine((ids) => new Set(ids).size === ids.length, '重复引用');
export function entityTable<S extends z.ZodType<{ id: string }>>(schema: S) {
  return z.record(IdSchema, schema).refine(
    (table) => Object.entries(table).every(([id, value]) => id === value.id), '实体键与 ID 不一致',
  );
}

export class DataError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DataError';
  }
}

export function requireData(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DataError(code, message);
}
