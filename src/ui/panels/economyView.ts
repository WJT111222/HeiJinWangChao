import type { PlayerView } from './playerView';

/** Read-only cents. BigInt is UI-local, never part of a save or settlement. */
export function amountSummary(values: readonly (number | null)[]) {
  let known = 0n, knownCount = 0;
  for (const value of values) if (value !== null) { known += BigInt(value); knownCount++; }
  return { known, knownCount, count: values.length, unknownCount: values.length - knownCount,
    amount: knownCount || !values.length ? known : null };
}
export function ownedAssets(view: Pick<PlayerView,'economy'|'protagonist'>) {
  return [...Object.values(view.economy.properties), ...Object.values(view.economy.vehicles), ...Object.values(view.economy.otherAssets)]
    .filter(asset => asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === view.protagonist.id);
}
export function debtProgress(principal: number | null, outstanding: number | null) {
  if (principal === null || outstanding === null) return { width: undefined, note: '本金或未偿本金未确认，暂不显示比例。' };
  if (![principal,outstanding].every(n => Number.isSafeInteger(n) && n >= 0)) return { width: undefined, note: '金额超出有效范围，暂不显示比例。' };
  if (!principal) return { width: undefined, note: '本金为零，未计算比例。' };
  return { width: Math.min(1,outstanding / principal) * 100,
    note: outstanding > principal ? '未偿本金超过本金，比例按 100% 显示；金额保留原值。' : undefined };
}
export const incomeLabels = { received: '已到账', expected: '待确认收入', cancelled: '已取消' };
export const debtLabels = { active: '偿还中', repaid: '已还清', disputed: '有争议', cancelled: '已取消' };
export const accountLabels = { cash: '现金', onlineBalance: '线上资金' };
