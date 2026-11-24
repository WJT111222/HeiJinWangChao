import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { Settings } from '../settings/model';
import { defaultSettings, SettingsSchema, settingsKey } from '../settings/model';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { DataError } from '../../domain/common';
import { MemoryMaintenance } from '../../workflows/memoryMaintenance';
import { MemorySummaryQueue } from '../../workflows/memorySummaryQueue';
import type { SummaryFailure, SummaryQueueSnapshot } from '../../workflows/memorySummaryQueue';
import type { MemoryFailureObservation } from '../../services/ai/memoryObservation';
import { summaryKinds } from '../../domain/memories/configuration';
import type { SummaryKind } from '../../domain/memories/configuration';

/** 仅队列判断自动维护资格的配置参与唤醒；不包含提示词正文或运行参数。 */
export function memoryScheduleKey(settings: Settings) {
  return JSON.stringify(summaryKinds.map(kind => {
    const { automatic, threshold, batchSize } = settings.memory.summaries[kind];
    return [automatic, threshold, batchSize];
  }));
}

function readMemorySettings() {
  try {
    const raw = localStorage.getItem(settingsKey);
    return raw === null ? defaultSettings() : SettingsSchema.parse(JSON.parse(raw));
  } catch {
    throw new DataError('MEMORY_STORAGE', '无法核对已保存的记忆设置。');
  }
}

const failureKey = (failure: SummaryFailure) => failure.retryId ?? JSON.stringify([failure.kind, failure.npcId, failure.code]);

export function useMemoryMaintenance(repository: SaveRepository, saveId: string, settings: Settings, onSaved: (state: GameState) => void,
  onSettings?: (settings: Settings) => void, onFailure?: (failure: MemoryFailureObservation) => void) {
  const runner = useMemo(() => new MemoryMaintenance(repository), [repository, saveId]);
  const [phase, setPhase] = useState<'generating' | 'saving'>();
  const [activity, setActivity] = useState<{ kind: SummaryKind; npcId?: string }>();
  const [snapshot, setSnapshot] = useState<SummaryQueueSnapshot>({ paused: false, failures: [] });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const current = useRef({ onSaved, onSettings, onFailure, settings }); current.current = { onSaved, onSettings, onFailure, settings };
  const queue = useRef<MemorySummaryQueue | undefined>(undefined);
  const scheduleKey = memoryScheduleKey(settings);
  const previousScheduleKey = useRef(scheduleKey);
  const keyAtMount = useRef(scheduleKey);
  keyAtMount.current = scheduleKey;
  useEffect(() => {
    let mounted = true;
    const tasks = new MemorySummaryQueue({ saveId, storage: localStorage, settings: readMemorySettings,
      load: async () => {
        const { state, paused } = await repository.loadMemoryContext(saveId);
        const locks = await navigator.locks?.query?.().catch(() => undefined);
        return { state, paused, busy: locks?.held?.some(lock => lock.name === `heijin.memory:${saveId}`) };
      },
      reconcile: () => runner.reconcile(saveId, localStorage),
      changed: next => { if (mounted) setSnapshot(next); },
      execute: async (kind, immediate, npcId, retryId) => {
        if (!mounted) return;
        try {
          const state = await runner.run({ saveId, kind, npcId, retryId, immediate, automatic: !immediate,
            attempts: localStorage, config: () => readAiConfig(localStorage),
            vault: new CredentialVault(sessionStorage, localStorage), timeoutSeconds: current.current.settings.runtime.timeoutSeconds,
            readSettings: () => {
              const saved = readMemorySettings();
              return { summaryConfig: saved.memory.summaries[kind], timeoutSeconds: saved.runtime.timeoutSeconds };
            },
            onFailure: failure => {
              if (mounted && !['MEMORY_BUSY', 'MEMORY_THROTTLED', 'MEMORY_PREVIOUS', 'MEMORY_CHANGED', 'cancelled'].includes(failure.diagnostic.code))
                current.current.onFailure?.(failure);
            },
            onPhase: next => { if (mounted) { setPhase(next); setActivity({ kind, npcId }); } } });
          if (mounted) {
            if (state) current.current.onSaved(state);
            if (state || immediate) setNotice(state ? '总结已保存，原始历史与来源完整保留。' : '合格记忆不足，未请求模型。');
          }
        } catch (error) {
          if (mounted && error instanceof DataError && ['MEMORY_BUSY', 'MEMORY_THROTTLED'].includes(error.code))
            setNotice(error.code === 'MEMORY_BUSY' ? '另一个标签或任务正在总结此存档，未重复请求。' : '达到自动请求限额，等待下一次检查。');
          throw error;
        } finally { if (mounted) { setPhase(undefined); setActivity(undefined); } }
      },
    });
    queue.current = tasks;
    previousScheduleKey.current = keyAtMount.current;
    void tasks.wake();
    const sync = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;
      if (event.key === null || event.key === `heijin.summary.failures:${saveId}` ||
        event.key.startsWith(`heijin.summary.records:${saveId}:`) || event.key.startsWith(`heijin.summary.attempt:${saveId}:`)) {
        void tasks.refresh();
      }
    };
    window.addEventListener('storage', sync);
    const timer = setInterval(() => { void tasks.wake(); }, 60000);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('storage', sync);
      tasks.stop();
      runner.cancel();
      if (queue.current === tasks) queue.current = undefined;
    };
  }, [repository, runner, saveId]);
  useEffect(() => {
    if (previousScheduleKey.current === scheduleKey) return;
    previousScheduleKey.current = scheduleKey;
    void queue.current?.wake();
  }, [scheduleKey]);
  async function run(automatic = false, kind: SummaryKind = 'short', npcId?: string, retryId?: string) {
    if (automatic) await queue.current?.wake();
    else await queue.current?.immediate(kind, npcId, retryId);
  }
  function closeFailure(failure: SummaryFailure) {
    setDismissed(value => [...value, failureKey(failure)]);
  }
  function pause(failure: SummaryFailure) {
    try {
      const next = readMemorySettings();
      next.memory.summaries[failure.kind].automatic = false;
      current.current.onSettings?.(next);
      if (readMemorySettings().memory.summaries[failure.kind].automatic) throw new Error();
      closeFailure(failure);
    } catch { setNotice('暂停设置保存失败，请检查本地存储。'); }
  }
  const popup = snapshot.failures.find(item => item.code !== 'MEMORY_LEGACY_BATCH_MISMATCH' &&
    (settings.memory.summaries[item.kind].automatic || (item.manual && !item.pending)) && !dismissed.includes(failureKey(item)) &&
    !(snapshot.busy && item.pending && item.code === 'MEMORY_PREVIOUS'));
  return { phase, activity, notice, snapshot, popup, run, pause, closeFailure, cancel: () => runner.cancel() };
}
