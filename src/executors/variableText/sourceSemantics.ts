import { z } from 'zod';
import { EquipmentSchema } from '../../domain/protagonist/schema';
import { variableCommandSchemas } from '../../domain/variableCommands';
import type { DomainCommand } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { digest, failed } from './model';
import type { ExecutionResult } from './model';
import { textInputSchema } from './entities';

/** 来源：MoRanJiangHu utils/stateHelpers.ts 的数组替换/push/splice及数值增量语义。
 * 这里只算已有领域命令所需的终值；不写GameState，不是任意路径执行器。 */
export function sourceValues(state: GameState) {
  const npc = new Map(Object.values(state.npc).map(person => [person.id, {
    affinity: person.affinity, from: person.id === state.initialCompanionId && !person.affinityConfirmed ? null : person.affinity,
    relationshipText: person.relationshipText, goals: person.kind === 'special' ? [...person.activeGoals] : undefined,
  }]));
  return { skills: [...state.protagonist.skills], wear: structuredClone(state.protagonist.currentWear), npc };
}
type Values = ReturnType<typeof sourceValues>;
export function normalizeSourcePath(command: ParsedVariableCommand): ParsedVariableCommand {
  const [root, field, ...rest] = command.path.nodes;
  return root.name === 'gameState' && field?.kind === 'field'
    ? { ...command, path: { nodes: [{ kind: 'root', name: field.name }, ...rest] } } : command;
}
export function trackSourceValues(values: Values, command: DomainCommand) {
  if (command.type === 'UpdateProtagonist' && command.changes.skills) values.skills = [...command.changes.skills];
  if (command.type === 'SetEquipment') values.wear = structuredClone(command.equipment);
  if (command.type === 'CreateNpc') values.npc.set(command.npc.id, { affinity: command.npc.affinity,
    from: command.npc.affinity, relationshipText: command.npc.relationshipText,
    goals: command.npc.kind === 'special' ? [...command.npc.activeGoals] : undefined });
  if (command.type === 'UpdateNpc') {
    const person = values.npc.get(command.npcId);
    if (!person) return;
    if (command.changes.relationshipText !== undefined) person.relationshipText = command.changes.relationshipText;
    if (command.affinityChange) { person.affinity = command.affinityChange.to; person.from = command.affinityChange.to; }
    if (command.activeGoals) person.goals = [...command.activeGoals];
  }
}

export async function compileSourceOperation(command: ParsedVariableCommand, values: Values,
  state: GameState, quantities: ReadonlyMap<string, number>, prior: DomainCommand | undefined,
  common: { commandId: string; evidence: string }, expectedRevision: number): Promise<ExecutionResult<DomainCommand> | undefined> {
  const nodes = command.path.nodes, [root, second, third, fourth] = nodes;
  const skills = root.name === 'protagonist' && second?.kind === 'field' && second.name === 'skills';
  const goals = root.name === 'npc' && second?.kind === 'id' && third?.kind === 'field' && third.name === 'activeGoals';
  const affinity = root.name === 'npc' && second?.kind === 'id' && third?.kind === 'field' && third.name === 'affinity' && nodes.length === 3;
  const equipment = root.name === 'protagonist' && second?.kind === 'field' && second.name === 'currentWear' && nodes.length >= 3;
  const item = root.name === 'items' && second?.kind === 'id' && (nodes.length === 2 && command.operation === 'delete'
    || nodes.length === 3 && third?.kind === 'field' && third.name === 'quantity' && command.operation === 'set');
  const object = root.name === 'protagonist' && nodes.length === 1;
  if (!skills && !goals && !affinity && !equipment && !item && !object) return;
  // 既有set整个数组/装备及实体创建保留原映射；新增能力只翻译新增的有限路径。
  if (skills && nodes.length === 2 && command.operation === 'set' || goals && nodes.length === 3 && command.operation === 'set') return;
  // 数组delete无法从删除后的状态反推旧元素。把原始操作摘要放入既有evidence，
  // 仅区分精确重放与同ID不同输入，不是剧情凭据、审核许可或新的持久化字段。
  const evidence = `${common.evidence}；操作输入摘要：${await digest([command.operation, command.path, command.value])}`;
  if (prior) return prior.evidence === evidence ? { ok: true, value: prior } : failed('duplicate_or_conflicting_command');
  const base = { ...common, evidence };
  let mapped: DomainCommand;
  if (object) {
    if (command.operation !== 'set') return failed('unsupported_operation');
    const changes = variableCommandSchemas[0].shape.changes.safeParse(command.value);
    if (!changes.success) return failed('type_mismatch');
    for (const field of ['healthText', 'emotionText'] as const)
      if (changes.data[field] !== undefined && !textInputSchema.safeParse(changes.data[field]).success) return failed('type_mismatch');
    mapped = { ...base, type: 'UpdateProtagonist', expectedRevision, protagonistId: state.protagonist.id, changes: changes.data };
  } else if (skills || goals) {
    const person = goals && second?.kind === 'id' ? values.npc.get(second.id) : undefined;
    const current = skills ? values.skills : person?.goals;
    if (!current) return failed(goals && !person ? 'entity_not_found' : 'unsupported_path');
    const index = skills ? third : fourth, expectedLength = skills ? 2 : 3;
    const next = [...current];
    if (nodes.length === expectedLength && command.operation === 'push') {
      const text = z.string().trim().min(1).safeParse(command.value);
      if (!text.success) return failed('type_mismatch'); next.push(text.data);
    } else if (nodes.length === expectedLength + 1 && index?.kind === 'index') {
      if (index.index >= next.length) return failed('entity_not_found');
      if (command.operation === 'delete') next.splice(index.index, 1);
      else if (command.operation === 'set') {
        const text = z.string().trim().min(1).safeParse(command.value);
        if (!text.success) return failed('type_mismatch'); next[index.index] = text.data;
      } else return failed('unsupported_operation');
    } else return failed('unsupported_operation');
    if (skills) mapped = { ...base, type: 'UpdateProtagonist', expectedRevision, protagonistId: state.protagonist.id, changes: { skills: next } };
    else if (second?.kind === 'id') mapped = { ...base, type: 'UpdateNpc', expectedRevision, npcId: second.id, changes: {}, activeGoals: next };
    else return failed('unsupported_path');
  } else if (affinity && second?.kind === 'id') {
    const person = values.npc.get(second.id);
    if (!person) return failed('entity_not_found');
    if (command.operation !== 'set' && command.operation !== 'add') return failed('unsupported_operation');
    if (typeof command.value !== 'number' || !Number.isFinite(command.value)) return failed('type_mismatch');
    const to = command.operation === 'add' ? person.affinity + command.value : command.value;
    if (to < -100 || to > 100 || !person.relationshipText.trim()) return failed('type_mismatch');
    mapped = { ...base, type: 'UpdateNpc', expectedRevision, npcId: second.id, changes: { relationshipText: person.relationshipText },
      affinityChange: { from: person.from, to, reason: '变量模型根据本回合剧情更新' } };
  } else if (equipment && third?.kind === 'field') {
    const next = structuredClone(values.wear);
    if (third.name === 'accessoryItemIds' && fourth?.kind === 'index' && nodes.length === 4 && command.operation === 'delete') {
      if (fourth.index >= next.accessoryItemIds.length) return failed('entity_not_found'); next.accessoryItemIds.splice(fourth.index, 1);
    } else if (nodes.length === 3 && third.name === 'accessoryItemIds' && command.operation === 'push') {
      const id = z.string().safeParse(command.value); if (!id.success) return failed('type_mismatch'); next.accessoryItemIds.push(id.data);
    } else if (nodes.length === 3 && ['topItemId', 'bottomItemId', 'shoesItemId', 'primaryWeaponItemId', 'secondaryWeaponItemId', 'currentVehicleAssetId'].includes(third.name)) {
      if (command.operation === 'delete') Reflect.deleteProperty(next, third.name);
      else if (command.operation === 'set') Reflect.set(next, third.name, command.value);
      else return failed('unsupported_operation');
    } else return failed('unsupported_path');
    const checked = EquipmentSchema.safeParse(next); if (!checked.success) return failed('type_mismatch');
    mapped = { ...base, type: 'SetEquipment', equipment: checked.data };
  } else if (item && second?.kind === 'id') {
    const quantity = quantities.get(second.id);
    if (!quantity) return failed('entity_not_found');
    const next = command.operation === 'delete' ? 0 : command.value;
    if (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 0 || next === quantity) return failed('invalid_quantity');
    mapped = { ...base, type: 'UpdateItem', expectedRevision, itemId: second.id, expectedQuantity: quantity,
      changes: { quantity: next }, quantityReason: next > quantity ? 'gain' : 'consumption' };
  } else return failed('unsupported_path');
  return { ok: true, value: mapped };
}
