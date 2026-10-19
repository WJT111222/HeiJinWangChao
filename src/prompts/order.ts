import { z } from 'zod';
import { promptManifest } from './manifest';
import type { PromptModule } from './manifest';
import { AiError } from '../services/ai/errors';
import { readDocument, writeDocument } from '../services/local/documents';

export const promptOrderKey = 'heijin.prompt-order.v1';
export type OrderPreferences = Record<string, number>;
function validateGlobal(overrides: OrderPreferences) {
  for (const [id, value] of Object.entries(overrides)) {
    const module = promptManifest.modules.find((m) => m.id === id);
    if (!module?.reorderable || !Number.isInteger(value)) throw new AiError('configuration');
  }
  for (const group of promptManifest.ordering.adjustableGroups) {
    const members = promptManifest.modules.filter((m) => m.reorderable && m.orderGroup === group);
    const actual = members.map((m) => overrides[m.id] ?? m.defaultOrder).sort((a, b) => a - b);
    const slots = members.map((m) => m.defaultOrder).sort((a, b) => a - b);
    if (actual.join() !== slots.join()) throw new AiError('configuration');
  }
}
export const PromptOrderSchema = z
  .strictObject({ version: z.literal(1), overrides: z.record(z.string(), z.number().int()) })
  .superRefine((value, ctx) => {
    try {
      validateGlobal(value.overrides);
    } catch {
      ctx.addIssue({ code: 'custom', message: '排序越过固定模块/同组槽位，或存在重复/未知模块' });
    }
  });
export function readPromptOrder(storage: Pick<Storage, 'getItem'>) {
  return (
    readDocument(storage, promptOrderKey, PromptOrderSchema) ?? {
      version: 1 as const,
      overrides: {},
    }
  );
}
export function savePromptOrder(storage: Pick<Storage, 'setItem'>, overrides: OrderPreferences) {
  return writeDocument(storage, promptOrderKey, PromptOrderSchema, { version: 1, overrides });
}
export function browserPromptOrder() {
  if (typeof window === 'undefined') return {};
  try {
    return readPromptOrder(window.localStorage).overrides;
  } catch {
    throw new AiError('configuration');
  }
}
// 全局偏好保持完整；关闭模块后，将剩余相对顺序投影到该组选中模块的原有槽位。
export function projectPromptOrder(preferences: OrderPreferences, selected: PromptModule[]) {
  validateGlobal(preferences);
  const overrides: OrderPreferences = {};
  for (const group of promptManifest.ordering.adjustableGroups) {
    const members = selected.filter((m) => m.reorderable && m.orderGroup === group);
    const slots = members.map((m) => m.defaultOrder).sort((a, b) => a - b);
    members.sort(
      (a, b) => (preferences[a.id] ?? a.defaultOrder) - (preferences[b.id] ?? b.defaultOrder),
    );
    members.forEach((module, index) => {
      overrides[module.id] = slots[index];
    });
  }
  return overrides;
}
export function movePromptOrder(preferences: OrderPreferences, id: string, otherId: string) {
  validateGlobal(preferences);
  const module = promptManifest.modules.find((m) => m.id === id);
  const other = promptManifest.modules.find((m) => m.id === otherId);
  if (!module?.reorderable || !other?.reorderable || module.orderGroup !== other.orderGroup)
    throw new AiError('configuration');
  const next = {
    ...preferences,
    [id]: preferences[otherId] ?? other.defaultOrder,
    [otherId]: preferences[id] ?? module.defaultOrder,
  };
  validateGlobal(next);
  return next;
}
