import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { IdSchema } from '../../domain/common';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { failed } from './model';
import type { ExecutionResult } from './model';

const object = z.record(z.string(), z.unknown());
export const textInputSchema = z.string().trim().min(1).max(8192);
export const memoryInputSchema = z.strictObject({ text: textInputSchema, knowledgeKind: z.enum(['observed', 'reported', 'suspected']),
  knowledgeSource: textInputSchema, visibility: z.enum(['npc_private', 'internal', 'player_known']) });
/** 有限实体操作；创建值使用原领域Schema，路径只绑定稳定ID，不是任意字段补丁。 */
export function compileEntity(command: ParsedVariableCommand, common: { commandId: string; evidence: string },
  expectedRevision: number): ExecutionResult<DomainCommand> | undefined {
  const [root, id, field] = command.path.nodes;
  if (id?.kind !== 'id' || !IdSchema.safeParse(id.id).success) return;
  const creation = command.path.nodes.length === 2 && ['npc', 'organizations'].includes(root.name);
  const relation = command.path.nodes.length === 3 && root.name === 'organizations' && field?.kind === 'field' && field.name === 'protagonistRelation';
  const npc = command.path.nodes.length === 3 && root.name === 'npc' && field?.kind === 'field'
    && ['affinityChange', 'activeGoals', 'contact'].includes(field.name);
  if (!creation && !relation && !npc) return;
  if (command.operation !== 'set') return failed('unsupported_operation');
  let raw: unknown;
  if (npc && field?.kind === 'field' && field.name === 'activeGoals') {
    raw = { ...common, type: 'UpdateNpc', expectedRevision, npcId: id.id, changes: {}, activeGoals: command.value };
  } else {
    const value = object.safeParse(command.value);
    if (!value.success) return failed('type_mismatch');
    const data = value.data;
    if (creation) {
      if (Object.hasOwn(data, 'id')) return failed('type_mismatch');
      raw = root.name === 'npc' ? { ...common, type: 'CreateNpc', npc: { ...data, id: id.id } }
        : { ...common, type: 'CreateOrganization', organization: { ...data, id: id.id } };
    } else if (relation) {
      if (Object.keys(data).some((key) => !['relation', 'reason'].includes(key))) return failed('type_mismatch');
      raw = { ...common, type: 'RecordOrgRelation', organizationId: id.id, ...data };
    } else if (field?.kind === 'field' && field.name === 'contact') {
      if (Object.keys(data).some((key) => key !== 'reason')) return failed('type_mismatch');
      raw = { ...common, type: 'RegisterContact', npcId: id.id, ...data };
    } else {
      if (Object.keys(data).some((key) => !['from', 'to', 'reason', 'relationshipText'].includes(key))) return failed('type_mismatch');
      const { relationshipText, ...affinityChange } = data;
      raw = { ...common, type: 'UpdateNpc', expectedRevision, npcId: id.id, changes: { relationshipText }, affinityChange };
    }
  }
  const parsed = DomainCommandSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : failed('type_mismatch');
}
