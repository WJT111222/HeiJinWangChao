import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { IdSchema } from '../../domain/common';
import { variableCommandSchemas } from '../../domain/variableCommands';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { failed } from './model';
import { diagnosticForObject, diagnosticForRule } from './diagnostics';
import type { ExecutionResult } from './model';

const object = z.record(z.string(), z.unknown());
export const textInputSchema = z.string().trim().min(1).max(8192);
/** 好感唯一写入格式：set npc[id].affinityChange = {to,reason,relationshipText}；前值由程序读取，不接受from。 */
export const affinityChangeInput = variableCommandSchemas[1].shape.affinityChange.unwrap().omit({ from: true }).extend({ relationshipText: textInputSchema });
export const memoryInputSchema = z.strictObject({ text: textInputSchema, knowledgeKind: z.enum(['observed', 'reported', 'suspected']),
  knowledgeSource: textInputSchema, visibility: z.enum(['npc_private', 'internal', 'player_known']) });
/** 有限实体操作；创建值使用原领域Schema，路径只绑定稳定ID，不是任意字段补丁。 */
export function compileEntity(command: ParsedVariableCommand, common: { commandId: string; evidence: string },
  expectedRevision: number, identityKey?: string): ExecutionResult<DomainCommand> | undefined {
  const [root, id, field] = command.path.nodes;
  if (id?.kind !== 'id' || !IdSchema.safeParse(id.id).success) return;
  const creation = command.path.nodes.length === 2 && ['npc', 'organizations', 'tasks'].includes(root.name);
  const relation = command.path.nodes.length === 3 && root.name === 'organizations' && field?.kind === 'field' && field.name === 'protagonistRelation';
  const organizationState = command.path.nodes.length === 3 && root.name === 'organizations' && field?.kind === 'field' && field.name === 'state';
  const npc = command.path.nodes.length === 3 && root.name === 'npc' && field?.kind === 'field'
    && ['activeGoals', 'contact', 'specialProfile'].includes(field.name);
  if (!creation && !relation && !npc && !organizationState) return;
  if (command.operation !== 'set') return failed('unsupported_operation');
  let raw: unknown;
  if (npc && field?.kind === 'field' && field.name === 'specialProfile') {
    const value = object.safeParse(command.value);
    if (!value.success) return failed('type_mismatch');
    const owner = command.path.nodes[1];
    // identityKey is resolved from the formal owner by the compiler below.
    raw = { ...common,type:'PromoteNpc',expectedRevision,npcId:owner.kind==='id'?owner.id:'',identityKey: identityKey ?? id.id,
      ...(Object.keys(value.data).length ? {profile:value.data} : {}) };
  } else if (npc && field?.kind === 'field' && field.name === 'activeGoals') {
    raw = { ...common, type: 'UpdateNpc', expectedRevision, npcId: id.id, changes: {}, activeGoals: command.value };
  } else {
    const value = object.safeParse(command.value);
    if (!value.success) return failed('type_mismatch', null, [], diagnosticForObject(command));
    const data = value.data;
    if (creation) {
      if (Object.hasOwn(data, 'id')) return failed('type_mismatch', null, [], diagnosticForRule(command, 'path_identity'));
      if (root.name === 'npc') raw = { ...common, type: 'CreateNpc', npc: { ...data, id: id.id } };
      else if (root.name === 'tasks') raw = { ...common, type: 'SaveTask', task: { ...data, id: id.id } };
      else raw = { ...common, type: 'CreateOrganization', organization: { ...data, id: id.id } };
    } else if (organizationState) {
      const { financialBasis, ...changes } = data;
      raw = { ...common, type: 'UpdateOrganization', organizationId: id.id, expectedRevision, changes, ...(financialBasis === undefined ? {} : {financialBasis}) };
    } else if (relation) {
      if (Object.keys(data).some((key) => !['relation', 'reason'].includes(key))) return failed('type_mismatch', null, [], diagnosticForRule(command, 'schema_constraint'));
      raw = { ...common, type: 'RecordOrgRelation', organizationId: id.id, ...data };
    } else if (field?.kind === 'field' && field.name === 'contact') {
      if (Object.keys(data).some((key) => key !== 'reason')) return failed('type_mismatch', null, [], diagnosticForRule(command, 'schema_constraint'));
      raw = { ...common, type: 'RegisterContact', npcId: id.id, ...data };
    } else {
      // 好感由取值语义层的 npc[id].affinityChange 处理（需读取正式前值），这里没有其他结构化入口。
      return failed('unsupported_path');
    }
  }
  const parsed = DomainCommandSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : failed('type_mismatch', null, [], diagnosticForRule(command, 'domain_schema'));
}
