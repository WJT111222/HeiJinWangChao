import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema, SaveShape } from '../../domain/state';
import type { GameState } from '../../domain/state';

// V1 与当前模型一致，但尚无场景描述字段。M0 未产生正式存档。
// 此版本契约用于验证升级链，不能把任意缺字段的损坏数据当作旧版。
export const GameStateV1Schema = z.strictObject(SaveShape).omit({
  weatherText: true, environmentText: true,
}).extend({ schemaVersion: z.literal(1) });

export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 2) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  let candidate: unknown = raw;
  if (version.data.schemaVersion === 1) {
    const v1 = GameStateV1Schema.safeParse(raw);
    if (!v1.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    candidate = { ...v1.data, schemaVersion: 2, weatherText: '', environmentText: '' };
  } else if (version.data.schemaVersion !== 2) {
    throw new DataError('UNSUPPORTED_VERSION', '没有此版本的迁移路径');
  }
  const result = GameStateSchema.safeParse(candidate);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或引用损坏，原始数据已保留');
  return result.data;
}
