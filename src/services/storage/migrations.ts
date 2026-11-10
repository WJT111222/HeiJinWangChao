import { z } from 'zod';
import { DataError, entityTable } from '../../domain/common';
import { GameStateSchema, SaveShape } from '../../domain/state';
import { NpcCreationSchema } from '../../domain/npc/schema';
import type { GameState } from '../../domain/state';

const { dormantNpcProfiles: _archive, ...v6Shape } = SaveShape;
void _archive;
const V6Schema = z.strictObject({ ...v6Shape, schemaVersion: z.literal(6), npc: entityTable(NpcCreationSchema) });
// Pure V6 → V7 conversion: only the version changes; absent phone/location/network
// data stays absent. Repository load persists a fully validated migration in its
// existing transaction; undo snapshots are converted only when consumed.
export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 7) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  if (![6, 7].includes(version.data.schemaVersion)) throw new DataError('UNSUPPORTED_VERSION', '当前版本仅支持 V6、V7 存档，旧测试记录可导出原始数据');
  const legacy = version.data.schemaVersion === 6 ? V6Schema.safeParse(raw) : undefined;
  if (legacy && !legacy.success) throw new DataError('CORRUPT_SAVE', 'V6存档结构损坏，原始数据已保留');
  const result = GameStateSchema.safeParse(legacy?.success ? { ...legacy.data, schemaVersion: 7 } : raw);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或引用损坏，原始数据已保留');
  return result.data;
}
