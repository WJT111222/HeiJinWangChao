import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { IdSchema } from '../../domain/common';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { failed } from './model';
import { diagnosticForObject, diagnosticForRule } from './diagnostics';
import type { ExecutionResult } from './model';

type TransactionType = 'ReceiveIncome' | 'Borrow' | 'TransferFunds' | 'RepayDebt'
  | 'AcquireItem' | 'PurchaseItem' | 'TransferItem' | 'LoseItem' | 'PurchaseVehicle' | 'SetEquipment';
interface Target { type: TransactionType; operation: 'set' | 'push'; id?: string }
const object = z.record(z.string(), z.unknown());
function target(command: ParsedVariableCommand): Target | undefined {
  const [root, second, third, fourth] = command.path.nodes, length = command.path.nodes.length;
  if (length === 2 && root.name === 'protagonist' && second?.kind === 'field' && second.name === 'currentWear')
    return {type:'SetEquipment',operation:'set'};
  if (root.name === 'items' && second?.kind === 'id' && IdSchema.safeParse(second.id).success) {
    if (length === 2) return {type:'AcquireItem',operation:'set',id:second.id};
    if (length === 3 && third?.kind === 'field') {
      if (third.name === 'purchase') return {type:'PurchaseItem',operation:'set',id:second.id};
      if (third.name === 'transfer') return {type:'TransferItem',operation:'set',id:second.id};
      if (third.name === 'loss') return {type:'LoseItem',operation:'set',id:second.id};
    }
  }
  if (root.name !== 'economy' || second?.kind !== 'field') return;
  if (length === 2 && second.name === 'transfers') return {type:'TransferFunds',operation:'push'};
  if (third?.kind !== 'id' || !IdSchema.safeParse(third.id).success) return;
  if (length === 3 && second.name === 'incomes') return {type:'ReceiveIncome',operation:'set',id:third.id};
  if (length === 3 && second.name === 'debts') return {type:'Borrow',operation:'set',id:third.id};
  if (length === 4 && fourth?.kind === 'field') {
    if (second.name === 'debts' && fourth.name === 'repayments') return {type:'RepayDebt',operation:'push',id:third.id};
    if (second.name === 'vehicles' && fourth.name === 'purchase') return {type:'PurchaseVehicle',operation:'set',id:third.id};
  }
}
/** ID来自路径；其余数据完全交给原DomainCommandSchema，不复制经济/物品Schema。 */
function identified(value: unknown, id: string | undefined) {
  const parsed = object.safeParse(value);
  if (!parsed.success || id === undefined || Object.hasOwn(parsed.data, 'id')) return;
  return {...parsed.data,id};
}
export function compileTransaction(command: ParsedVariableCommand, common: {commandId:string; evidence:string}, expectedRevision: number): ExecutionResult<DomainCommand> | undefined {
  const path = target(command);
  if (!path) return;
  if (command.operation !== path.operation) return failed('unsupported_operation');
  const value = object.safeParse(command.value);
  if (!value.success) return failed('type_mismatch', null, [], diagnosticForObject(command));
  const data = value.data;
  // 这些是程序的命令身份/版本及路径绑定，不能被输入覆盖。不是剧情凭据或授权。
  if (['commandId','type','evidence','expectedRevision'].some((key) => Object.hasOwn(data,key))) return failed('type_mismatch', null, [], diagnosticForRule(command, 'reserved_field'));
  let raw: unknown;
  switch (path.type) {
    case 'ReceiveIncome': {
      const income = identified(data,path.id); if (!income) return failed('type_mismatch', null, [], diagnosticForRule(command, 'path_identity'));
      raw = {...common,type:path.type,income}; break;
    }
    case 'AcquireItem': {
      const item = identified(data,path.id); if (!item) return failed('type_mismatch', null, [], diagnosticForRule(command, 'path_identity'));
      raw = {...common,type:path.type,item}; break;
    }
    case 'Borrow': {
      const debt = identified(data.debt,path.id); if (!debt) return failed('type_mismatch', null, [], diagnosticForRule(command, 'domain_schema'));
      raw = {...data,...common,type:path.type,debt}; break;
    }
    case 'PurchaseItem': {
      const item = identified(data.item,path.id); if (!item) return failed('type_mismatch', null, [], diagnosticForRule(command, 'domain_schema'));
      raw = {...data,...common,type:path.type,item}; break;
    }
    case 'PurchaseVehicle': {
      const vehicle = identified(data.vehicle,path.id); if (!vehicle) return failed('type_mismatch', null, [], diagnosticForRule(command, 'domain_schema'));
      raw = {...data,...common,type:path.type,vehicle}; break;
    }
    case 'LoseItem':
      if (Object.hasOwn(data,'itemId')) return failed('type_mismatch', null, [], diagnosticForRule(command, 'reserved_field'));
      raw = {...data,...common,type:path.type,itemId:path.id,expectedRevision}; break;
    case 'TransferItem':
      if (Object.hasOwn(data,'itemId')) return failed('type_mismatch', null, [], diagnosticForRule(command, 'reserved_field'));
      raw = {...data,...common,type:path.type,itemId:path.id}; break;
    case 'RepayDebt':
      if (Object.hasOwn(data,'debtId')) return failed('type_mismatch', null, [], diagnosticForRule(command, 'reserved_field'));
      raw = {...data,...common,type:path.type,debtId:path.id}; break;
    case 'TransferFunds': raw = {...data,...common,type:path.type}; break;
    case 'SetEquipment': raw = {...common,type:path.type,equipment:data}; break;
  }
  const parsed = DomainCommandSchema.safeParse(raw);
  return parsed.success ? {ok:true,value:parsed.data} : failed('type_mismatch', null, [], diagnosticForRule(command, 'domain_schema'));
}
