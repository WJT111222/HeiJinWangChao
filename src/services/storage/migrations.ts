import { z } from 'zod';
import { DataError, entityTable } from '../../domain/common';
import { GameStateSchema, SaveShape } from '../../domain/state';
import { NpcMemorySchema } from '../../domain/memories/schema';
import { OrdinaryNpcSchema, SpecialNpcSchema, SpecialProfileSchema, DormantNpcProfileSchema } from '../../domain/npc/schema';
import type { GameState } from '../../domain/state';

const oldMemories = z.array(NpcMemorySchema);
const oldOrdinary = OrdinaryNpcSchema.omit({importancePreference:true});
const oldSpecial = SpecialNpcSchema.omit({importancePreference:true,profilePending:true});
const oldProfile = SpecialProfileSchema.omit({profilePending:true});
const {npcManagementRevision: management, ...legacyShape} = SaveShape;
void management;
const v8Shape = {...legacyShape,schemaVersion:z.literal(8),npc:entityTable(z.discriminatedUnion('kind',[oldOrdinary,oldSpecial])),
  dormantNpcProfiles:entityTable(DormantNpcProfileSchema.extend({profile:oldProfile})).optional()};
const V8Schema = z.strictObject(v8Shape);
const v7Shape = {...v8Shape,schemaVersion:z.literal(7),
  npc:entityTable(z.discriminatedUnion('kind',[oldOrdinary,oldSpecial.extend({longTermMemories:oldMemories})])),
  dormantNpcProfiles:entityTable(DormantNpcProfileSchema.extend({profile:oldProfile.extend({longTermMemories:oldMemories})})).optional()};
const V7Schema = z.strictObject(v7Shape);
const { dormantNpcProfiles: archive, ...v6Shape } = v7Shape;
void archive;
const V6Schema = z.strictObject({...v6Shape,schemaVersion:z.literal(6),npc:entityTable(z.discriminatedUnion('kind',[
  oldOrdinary.omit({phoneContact:true,usualLocations:true}),
  oldSpecial.omit({phoneContact:true,usualLocations:true,relationshipNetwork:true}).extend({longTermMemories:oldMemories}),
]))});

/** Strict deterministic conversion, no AI. Repository persists only after complete
 * validation/transaction succeeds; old snapshot records are read on demand. */
export function migrateSave(raw: unknown): GameState {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
  if (!version.success) throw new DataError('CORRUPT_SAVE', '存档缺少合法版本，原始数据已保留');
  if (version.data.schemaVersion > 9) throw new DataError('FUTURE_VERSION', '存档来自更高版本，当前程序不能覆盖');
  if (![6, 7, 8, 9].includes(version.data.schemaVersion)) throw new DataError('UNSUPPORTED_VERSION', '当前版本仅支持 V6、V7、V8、V9 存档，原始数据已保留');
  if (version.data.schemaVersion === 9) {
    const result = GameStateSchema.safeParse(raw);
    if (!result.success) throw new DataError('CORRUPT_SAVE', '存档结构或来源引用损坏，原始数据已保留');
    return result.data;
  }
  const legacy = (version.data.schemaVersion === 6 ? V6Schema : version.data.schemaVersion === 7 ? V7Schema : V8Schema).safeParse(raw);
  if (!legacy.success) throw new DataError('CORRUPT_SAVE', '旧存档结构损坏，原始数据已保留');
  if (legacy.data.initialCompanionId && legacy.data.npc[legacy.data.initialCompanionId]?.kind !== 'special')
    throw new DataError('CORRUPT_SAVE', '旧版初始同伴结构损坏，原始数据已保留');
  const next = { ...legacy.data, schemaVersion: 9 };
  for (const person of Object.values(next.npc)) if (person.kind === 'special') {
    person.memories = [...person.memories, ...person.longTermMemories];
    person.longTermMemories = [];
  }
  if ('dormantNpcProfiles' in next) for (const [id, dormant] of Object.entries(next.dormantNpcProfiles ?? {})) {
    const owner = next.npc[id];
    if (!owner || owner.kind !== 'ordinary' || owner.identityKey !== dormant.identityKey)
      throw new DataError('CORRUPT_SAVE', '休眠资料所属身份不符，原始数据已保留');
    owner.memories = [...owner.memories, ...dormant.profile.longTermMemories];
    dormant.profile.longTermMemories = [];
  }
  const result = GameStateSchema.safeParse(next);
  if (!result.success) throw new DataError('CORRUPT_SAVE', '记忆ID冲突、来源缺失或结构引用损坏，未写入迁移结果');
  return result.data;
}
