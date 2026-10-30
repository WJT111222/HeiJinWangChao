import { z } from 'zod';
import { DataError } from '../../domain/common';
import { GameStateSchema, SaveShape } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { DomainCommandSchema } from '../../domain/commands';

// 严格旧格式，不把缺字段的损坏数据冒充可迁移存档。
export const GameStateV4Schema = z.strictObject(SaveShape).omit({ retiredEvents: true }).extend({schemaVersion:z.literal(4)});
export const GameStateV3Schema = GameStateV4Schema.omit({ contactReviewNpcIds: true })
  .extend({ schemaVersion: z.literal(3) });
export const GameStateV2Schema = GameStateV3Schema.omit({ contactNpcIds: true, retiredNpcs: true })
  .extend({ schemaVersion: z.literal(2) });
export const GameStateV1Schema = GameStateV2Schema.omit({ weatherText: true, environmentText: true })
  .extend({ schemaVersion: z.literal(1) });

export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 5) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  let candidate: unknown = raw;
  if (version.data.schemaVersion === 1) {
    const v1 = GameStateV1Schema.safeParse(raw);
    if (!v1.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    candidate = { ...v1.data, schemaVersion: 2, weatherText: '', environmentText: '' };
  } else if (![2, 3, 4, 5].includes(version.data.schemaVersion)) {
    throw new DataError('UNSUPPORTED_VERSION', '没有此版本的迁移路径');
  }
  if (version.data.schemaVersion <= 2) {
    const v2 = GameStateV2Schema.safeParse(candidate);
    if (!v2.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    candidate = { ...v2.data, schemaVersion: 3, contactNpcIds: [], retiredNpcs: {} };
  }
  if (version.data.schemaVersion <= 3) {
    const v3 = GameStateV3Schema.safeParse(candidate);
    if (!v3.success) throw new DataError('CORRUPT_SAVE', '旧版存档结构损坏，未执行迁移');
    // V3预览曾将所有旧人物误标为联系人。只从初始同伴和真实登记命令确认永久联系人；
    // 无凭据者全部保留完整实体并进入待复核，而不是直接视为非联系人或自动删除。
    const confirmed = new Set(v3.data.initialCompanionId ? [v3.data.initialCompanionId] : []);
    for (const entry of v3.data.appliedCommands) {
      let command: unknown;
      try { command = JSON.parse(entry.fingerprint); } catch { continue; }
      const parsed = DomainCommandSchema.safeParse(command);
      if (parsed.success && parsed.data.type === 'RegisterContact' && parsed.data.commandId === entry.commandId
        && v3.data.npc[parsed.data.npcId]) confirmed.add(parsed.data.npcId);
    }
    candidate = { ...v3.data, schemaVersion: 4, contactNpcIds: [...confirmed],
      contactReviewNpcIds: (version.data.schemaVersion <= 2 ? Object.keys(v3.data.npc) : v3.data.contactNpcIds).filter((id) => !confirmed.has(id)) };
  }
  if (version.data.schemaVersion <= 4) {
    const v4 = GameStateV4Schema.safeParse(candidate);
    if (!v4.success) throw new DataError('CORRUPT_SAVE','旧版存档结构损坏，未执行迁移');
    candidate = {...v4.data, schemaVersion:5, retiredEvents:{}}; // 不补时间、结果或覆盖历史。
  }
  const result = GameStateSchema.safeParse(candidate);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或引用损坏，原始数据已保留');
  return result.data;
}
