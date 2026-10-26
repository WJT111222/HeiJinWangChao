import { z } from 'zod';
import { DataError } from '../../domain/common';
import { DomainCommandSchema } from '../../domain/commands';
import { AiError } from '../ai/errors';

// 不输出校验器原文、非法值、动态实体ID或供应商响应。路径只保留白名单字段。
const fields = new Set(['commands', 'type', 'commandId', 'evidence', 'changes', 'worldClock', 'expectedRevision',
  'npcId', 'protagonistId', 'itemId', 'organizationId', 'amount', 'price', 'account', 'income', 'debt',
  'receivedAt', 'createdAtGameTime', 'lastInteractionAt', 'startAt', 'endAt', 'resolvedAt', 'dueAt',
  'quantity', 'ownerRef', 'locationId', 'memory', 'rejectedSuggestions', 'unresolved']);
const moneyCodes = new Set(['UNKNOWN_BALANCE', 'INSUFFICIENT_FUNDS', 'DEBT_AMOUNT', 'SAME_ACCOUNT', 'FUTURE_INCOME']);
const timeCodes = new Set(['OPENING_TIME', 'TIME_PREFLIGHT', 'TIME_REVERSED', 'NPC_TIME', 'WORK_TIME', 'EVENT_TIME']);
const conflictCodes = new Set(['REVISION_CONFLICT', 'ENTITY_CONFLICT', 'DRAFT_CONFLICT', 'COMMAND_CONFLICT', 'DUPLICATE_COMMAND']);
export function variableValidationError(error: unknown, input?: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof z.ZodError) {
    const issue = error.issues[0], path = issue?.path ?? [];
    const commandIndex = path[0] === 'commands' && typeof path[1] === 'number' ? path[1] : undefined;
    const raw = commandIndex !== undefined && input && typeof input === 'object' && 'commands' in input && Array.isArray(input.commands) ? input.commands[commandIndex] : undefined;
    const type = raw && typeof raw === 'object' && 'type' in raw && DomainCommandSchema.options.some((option) => option.shape.type.value === raw.type) ? String(raw.type) : undefined;
    const wrongType = issue?.code === 'invalid_type' && issue.expected !== 'int';
    const time = path.some((part) => typeof part === 'string' && ['worldClock', 'startAt', 'endAt', 'createdAtGameTime', 'lastInteractionAt', 'receivedAt', 'resolvedAt', 'dueAt'].includes(part));
    const money = path.some((part) => part === 'amount' || part === 'price' || part === 'principal' || part === 'outstanding');
    return new AiError(time ? 'time_data' : money && !wrongType ? 'amount_balance' : input === undefined ? 'data_integrity' : 'schema_fields', undefined, {
      fieldPath: path.map((part) => typeof part === 'number' ? part : fields.has(String(part)) ? part : 'field').join('.'),
      ...(commandIndex === undefined ? {} : { commandIndex }), ...(type ? { commandType: type } : {}),
    });
  }
  if (error instanceof DataError) return new AiError(moneyCodes.has(error.code) ? 'amount_balance' : timeCodes.has(error.code) ? 'time_data' : conflictCodes.has(error.code) ? 'candidate_conflict' : 'data_integrity');
  return new AiError('data_integrity');
}
