import { z } from 'zod';

/**
 * Sticky / 冷却 / 延迟（行为说明见 docs/WORLDBOOK_COMPATIBILITY.md「计时效果」）。
 *
 * 计时单位是“逻辑消息数”。王朝适配：每个成功结算的回合增加 2 条（玩家行动 + 正文），
 * 生成当前回合时再算上本回合的玩家行动 1 条。取消、失败、重试、预览都不推进；
 * 引擎只返回下一份状态，是否保存由调用方在回合正式结算时决定（阶段 C 接入存档与回溯）。
 */
export const TimedRecordSchema = z.strictObject({
  /** 条目指纹：条目被修改后对不上，旧效果不再作用于它。 */
  fingerprint: z.string(),
  start: z.number().finite(),
  end: z.number().finite(),
  /** 由 Sticky 结束转入的冷却：不会因“回到开始之前”而被清掉。 */
  protected: z.boolean(),
});
export type TimedRecord = z.infer<typeof TimedRecordSchema>;
export const TimedStateSchema = z.strictObject({
  sticky: z.record(z.string(), TimedRecordSchema),
  cooldown: z.record(z.string(), TimedRecordSchema),
});
export type TimedState = z.infer<typeof TimedStateSchema>;
export const EMPTY_TIMED_STATE: TimedState = { sticky: {}, cooldown: {} };

/** 生成第 N+1 回合时的逻辑消息数：已结算 N 回合 × 2 + 本回合玩家行动 1 条。 */
export function logicalMessageCount(settledTurns: number): number {
  return Math.max(0, Math.trunc(settledTurns)) * 2 + 1;
}

export interface TimedEntry { key: string; fingerprint: string; sticky: number | null; cooldown: number | null; delay: number | null }
export interface TimedEvaluation {
  sticky: Set<string>;
  cooldown: Set<string>;
  delay: Set<string>;
  /** 处理过到期、回退之后的状态副本；本次激活的条目还要再经 recordActivations 写入。 */
  working: TimedState;
}

function cloneRecords(records: Record<string, TimedRecord>): Record<string, TimedRecord> {
  const out: Record<string, TimedRecord> = Object.create(null);
  for (const key of Object.keys(records)) out[key] = { ...records[key] };
  return out;
}

/** 扫描开始前：清理回退或到期的效果，得出本次处于 Sticky / 冷却 / 延迟中的条目。不修改输入。 */
export function evaluateTimed(state: TimedState, entries: readonly TimedEntry[], messageCount: number): TimedEvaluation {
  const working: TimedState = { sticky: cloneRecords(state.sticky), cooldown: cloneRecords(state.cooldown) };
  const byFingerprint = new Map<string, TimedEntry>();
  for (const entry of entries) if (!byFingerprint.has(entry.fingerprint)) byFingerprint.set(entry.fingerprint, entry);
  const active = { sticky: new Set<string>(), cooldown: new Set<string>(), delay: new Set<string>() };

  const check = (type: 'sticky' | 'cooldown') => {
    const records = working[type];
    for (const key of Object.keys(records)) {
      const record = records[key];
      const entry = byFingerprint.get(record.fingerprint);
      // 回到了效果开始之前（例如回溯）：清掉，除非是受保护的冷却。
      if (messageCount <= record.start && !record.protected) { delete records[key]; continue; }
      // 条目不在本次的书里（被修改、停用或换了版本）：只在到期后清掉。
      if (!entry) { if (messageCount >= record.end) delete records[key]; continue; }
      // 条目已不再设置这种效果。
      if (!entry[type]) { delete records[key]; continue; }
      if (messageCount >= record.end) {
        delete records[key];
        // Sticky 结束时，若条目设置了冷却，立即进入受保护的冷却。
        if (type === 'sticky' && entry.cooldown) {
          working.cooldown[entry.key] = { fingerprint: entry.fingerprint, start: messageCount, end: messageCount + Number(entry.cooldown), protected: true };
          active.cooldown.add(entry.key);
        }
        continue;
      }
      active[type].add(entry.key);
    }
  };
  check('sticky');
  check('cooldown');
  for (const entry of entries) if (entry.delay && messageCount < entry.delay) active.delay.add(entry.key);
  return { ...active, working };
}

/** 扫描结束后：为本次激活、设置了 Sticky / 冷却且还没有对应记录的条目建立记录。返回新状态，不修改输入。 */
export function recordActivations(working: TimedState, activated: readonly TimedEntry[], messageCount: number): TimedState {
  const next: TimedState = { sticky: cloneRecords(working.sticky), cooldown: cloneRecords(working.cooldown) };
  for (const entry of activated) {
    for (const type of ['sticky', 'cooldown'] as const) {
      if (!entry[type] || next[type][entry.key]) continue;
      next[type][entry.key] = { fingerprint: entry.fingerprint, start: messageCount, end: messageCount + Number(entry[type]), protected: false };
    }
  }
  return { sticky: { ...next.sticky }, cooldown: { ...next.cooldown } };
}
