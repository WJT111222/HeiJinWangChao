import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema, SaveShape } from '../../domain/state';
import type { GameState } from '../../domain/state';

// V1 与初期模型一致，但尚无场景描述字段。M0 未产生正式存档。
// 此版本契约用于验证升级链，不能把任意缺字段的损坏数据当作旧版。
export const GameStateV2Schema = z.strictObject(SaveShape).omit({ contactNpcIds: true, retiredNpcs: true })
  .extend({ schemaVersion: z.literal(2) });
export const GameStateV1Schema = GameStateV2Schema.omit({ weatherText: true, environmentText: true })
  .extend({ schemaVersion: z.literal(1) });

export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 3) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  let candidate: unknown = raw;
  if (version.data.schemaVersion === 1) {
    const v1 = GameStateV1Schema.safeParse(raw);
    if (!v1.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    candidate = { ...v1.data, schemaVersion: 2, weatherText: '', environmentText: '' };
  } else if (![2, 3].includes(version.data.schemaVersion)) {
    throw new DataError('UNSUPPORTED_VERSION', '没有此版本的迁移路径');
  }
  if (version.data.schemaVersion <= 2) {
    const v2 = GameStateV2Schema.safeParse(candidate);
    if (!v2.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    // 旧档没有可靠联系人标识：保守保护全部现有人物，绝不从面板可见性猜测。
    candidate = { ...v2.data, schemaVersion: 3, contactNpcIds: Object.keys(v2.data.npc), retiredNpcs: {} };
  }
  const result = GameStateSchema.safeParse(candidate);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或引用损坏，原始数据已保留');
  return result.data;
}
