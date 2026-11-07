import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';

// Demo 新历史协议仅支持 V6；不猜补旧历史或保留双轨数据转换。
// 无法读取的记录仍可由既有管理入口原始导出/删除，不改写数据库。
export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 6) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  if (version.data.schemaVersion !== 6) throw new DataError('UNSUPPORTED_VERSION', '当前版本仅支持 V6 存档，旧测试记录可导出原始数据');
  const result = GameStateSchema.safeParse(raw);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或引用损坏，原始数据已保留');
  return result.data;
}
