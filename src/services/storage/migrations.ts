import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';

/**
 * 正式发布前的测试期重置：只接受当前 V10 存档，不再携带 V6–V9 的升级代码。
 * 旧档读取时给出明确提示并保留原始数据（由调用方负责不覆盖），请重新开局。
 */
export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 10) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  if (version.data.schemaVersion !== 10)
    throw new DataError('UNSUPPORTED_VERSION', '测试期存档已重置：当前版本只支持 V10 存档，旧档不再升级，请重新开局；原始数据已保留');
  const parsed = GameStateSchema.safeParse(raw);
  if (!parsed.success) throw new DataError('CORRUPT_SAVE', '存档结构或来源引用损坏，原始数据已保留');
  return parsed.data;
}
