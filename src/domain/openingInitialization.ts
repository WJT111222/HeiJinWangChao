import { z } from 'zod';
import { MoneySchema, TextSchema, requireData } from './common';
import { IncomeRecordSchema } from './economy/schema';
import type { GameState } from './state';

// Reuse the existing income record. This is an expectation, never a receipt or credit.
export const OpeningExpectedIncomeSchema = IncomeRecordSchema.omit({ receivedAt: true, sourceTurnId: true }).extend({
  amount: MoneySchema, status: z.literal('expected'), scheduleText: TextSchema,
});
export const OpeningInitialStateSchema = z.strictObject({
  weatherText: TextSchema.optional(), environmentText: TextSchema.optional(),
  cash: MoneySchema.optional(), onlineBalance: MoneySchema.optional(),
  expectedIncomes: z.array(OpeningExpectedIncomeSchema).max(30).optional(),
}).refine(value => Object.keys(value).length > 0, '初始化至少提供一个字段');

export function initializeOpeningState(state: GameState, changes: z.infer<typeof OpeningInitialStateSchema>, newEntity: (id: string) => void) {
  requireData(state.openingInitializationPending && state.turnNumber === 0 && state.revision === 0 && state.journal.length === 0,
    'OPENING_INITIALIZATION', '仅新创建且尚未结算的开局可初始化一次');
  for (const field of ['weatherText', 'environmentText'] as const) if (changes[field] !== undefined) {
    requireData(state[field] === '' || state[field] === changes[field], 'INITIAL_VALUE_CONFLICT', '不能覆盖已有明确初始数据');
    state[field] = changes[field];
  }
  for (const account of ['cash', 'onlineBalance'] as const) if (changes[account] !== undefined) {
    requireData(state.economy[account] === null || state.economy[account] === changes[account],
      'INITIAL_VALUE_CONFLICT', '不能覆盖已有明确初始数据');
    state.economy[account] = changes[account];
  }
  for (const income of changes.expectedIncomes ?? []) {
    newEntity(income.id);
    requireData(!income.expectedAt || Date.parse(income.expectedAt) >= Date.parse(state.worldClock),
      'INCOME_TIME', '初始预期收入日期不能早于当前游戏时间');
    state.economy.incomes[income.id] = income;
  }
  delete state.openingInitializationPending;
}
