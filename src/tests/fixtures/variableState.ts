import { z } from 'zod';
import { SaveShape } from '../../domain/state';
import { entityTable } from '../../domain/common';
import { OrdinaryNpcSchema, SpecialNpcSchema } from '../../domain/npc/schema';

/** 模型完整只读状态投影，不是正式存档；实际存储仍用完整GameStateSchema重验。
 * 从原Schema复用字段类型，不能为读取省略的历史数据捏造第二份完整存档。 */
export const VariableStateProjectionSchema = z.strictObject({ ...SaveShape,
  // Batch 4 deliberately omits the empty legacy marker, not any raw memory.
  npc: entityTable(z.discriminatedUnion('kind', [OrdinaryNpcSchema, SpecialNpcSchema.omit({ longTermMemories: true })])),
}).omit({
  journal: true, appliedCommands: true, dormantNpcProfiles: true,
});
