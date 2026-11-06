import { z } from 'zod';
import { SaveShape } from '../../domain/state';

/** 模型输入活动状态投影，不是正式存档；实际存储仍用完整GameStateSchema重验。
 * 从原Schema复用字段类型，不能为读取省略的历史数据捏造第二份完整存档。 */
export const VariableStateProjectionSchema = z.strictObject(SaveShape).omit({
  journal: true, appliedCommands: true, memories: true, timeline: true,
});
