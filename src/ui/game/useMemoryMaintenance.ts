import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { Settings } from '../settings/model';
import { SettingsSchema, settingsKey } from '../settings/model';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { DataError } from '../../domain/common';
import { MemoryMaintenance } from '../../workflows/memoryMaintenance';
import { MemorySummaryQueue } from '../../workflows/memorySummaryQueue';
import type { SummaryFailure } from '../../workflows/memorySummaryQueue';
import type { SummaryKind } from '../../domain/memories/configuration';

export function useMemoryMaintenance(repository: SaveRepository, saveId: string, settings: Settings, onSaved: (state: GameState) => void,
  onSettings?: (settings: Settings) => void) {
  const runner = useMemo(() => new MemoryMaintenance(repository), [repository, saveId]);
  const [phase, setPhase] = useState<'generating' | 'saving'>();
  const [activeKind, setActiveKind] = useState<SummaryKind>();
  const [failures, setFailures] = useState<SummaryFailure[]>([]);
  const [dismissed, setDismissed] = useState<SummaryKind[]>([]);
  const [notice, setNotice] = useState('');
  const current = useRef({ settings, onSaved, onSettings }); current.current = { settings, onSaved, onSettings };
  const queue = useRef<MemorySummaryQueue | undefined>(undefined);
  useEffect(() => {
    let mounted = true;
    const tasks = new MemorySummaryQueue({ saveId, storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
      settings: () => current.current.settings, load: () => repository.load(saveId),
      changed: next => { if (mounted) { setFailures(next); if (next.length) setNotice(next.map(item => `${item.code}：${item.message}`).join(' ')); } },
      execute: async (kind, immediate, npcId) => {
        if (!mounted) return;
        const frozen = structuredClone(current.current.settings);
        try {
          const state = await runner.run({ saveId, kind, npcId, immediate, automatic: !immediate,
            summaryConfig: frozen.memory.summaries[kind], attempts: localStorage,
            config: readAiConfig(localStorage), vault: new CredentialVault(sessionStorage, localStorage),
            timeoutSeconds: frozen.runtime.timeoutSeconds,
            onPhase: next => { if (mounted) { setPhase(next); setActiveKind(kind); } } });
          if (mounted) {
            if (state) current.current.onSaved(state);
            setNotice(state ? '总结已保存，原始历史与来源完整保留。' : '合格记忆不足所设批次数量，未请求模型。');
          }
        } catch (error) {
          if (mounted && error instanceof DataError && ['MEMORY_BUSY', 'MEMORY_THROTTLED'].includes(error.code))
            setNotice(error.code === 'MEMORY_BUSY' ? '另一个标签或任务正在总结此存档，未重复请求。' : '后台请求达到节流限额，稍后检查；不会自动加量。');
          throw error;
        } finally { if (mounted) { setPhase(undefined); setActiveKind(undefined); } }
      },
    });
    queue.current = tasks;
    void tasks.wake();
    const timer = setInterval(() => { void tasks.wake(); }, 60000);
    return () => { mounted = false; clearInterval(timer); tasks.stop(); runner.cancel(); if (queue.current === tasks) queue.current = undefined; };
  }, [repository, runner, saveId]);
  useEffect(() => { void queue.current?.wake(); }, [settings]);
  async function run(automatic = false, kind: SummaryKind = 'short', npcId?: string) {
    if (automatic) await queue.current?.wake();
    else { setDismissed(value => value.filter(item => item !== kind)); await queue.current?.immediate(kind, npcId); }
  }
  function pause(kind: SummaryKind) {
    try {
      const next = structuredClone(current.current.settings);
      next.memory.summaries[kind].automatic = false;
      current.current.onSettings?.(next);
      const saved = SettingsSchema.parse(JSON.parse(localStorage.getItem(settingsKey) || 'null'));
      if (saved.memory.summaries[kind].automatic) throw new Error();
      queue.current?.dismiss(kind);
    } catch { setNotice('暂停设置保存失败，未清除失败记录，请检查本地存储。'); }
  }
  return { phase, activeKind, notice, failures: failures.filter(item => !dismissed.includes(item.kind)), run, pause,
    closeFailure: (kind: SummaryKind) => setDismissed(value => [...value, kind]), cancel: () => runner.cancel() };
}
