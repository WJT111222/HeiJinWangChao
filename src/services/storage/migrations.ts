import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';

// Validate legacy input before adding the two V11 fields. No number is inferred from contactNpcIds.
const legacy = z.looseObject({
  phone: z.never().optional(),
  npc: z.record(z.string(), z.looseObject({ appearedInStory: z.never().optional() })),
});

export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  const schema = version.data.schemaVersion;
  if (schema > 11) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  if (schema < 10) throw new DataError('UNSUPPORTED_VERSION', '当前版本仅支持 V10、V11 存档，原始数据已保留');
  let candidate = raw;
  if (schema === 10) {
    const old = legacy.safeParse(raw);
    if (!old.success) throw new DataError('CORRUPT_SAVE', '旧存档结构损坏，原始数据已保留');
    candidate = {
      ...old.data,
      schemaVersion: 11,
      phone: { threads: {}, scheduled: [], topics: [] },
      npc: Object.fromEntries(
        Object.entries(old.data.npc).map(([id, npc]) => [id, { ...npc, appearedInStory: true }]),
      ),
    };
  }
  const parsed = GameStateSchema.safeParse(candidate);
  if (!parsed.success) throw new DataError('CORRUPT_SAVE', '存档结构或来源引用损坏，原始数据已保留');
  return parsed.data;
}
