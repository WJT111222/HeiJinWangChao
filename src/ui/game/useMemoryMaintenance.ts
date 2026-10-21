import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { Settings } from '../settings/model';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { safeAiError } from '../../services/ai/errors';
import { DataError } from '../../domain/common';
import { MemoryMaintenance } from '../../workflows/memoryMaintenance';

export function useMemoryMaintenance(repository: SaveRepository, saveId: string, settings: Settings, onSaved: (state: GameState) => void) {
  const runner = useMemo(() => new MemoryMaintenance(repository), [repository, saveId]);
  const [phase, setPhase] = useState<'generating' | 'saving'>();
  const [notice, setNotice] = useState('尚未运行整理；手动或自动整理可能产生额外API费用。');
  const mounted = useRef(true), callback = useRef(onSaved);
  const running = useRef(false), autoBlocked = useRef(false);
  callback.current = onSaved;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; runner.cancel(); };
  }, [runner]);
  async function run(automatic = false, task: 'public' | 'npc' = 'public') {
    if (automatic && task === 'npc') return; // 公开自动维护偏好不授权额外NPC收费。
    if (automatic && !settings.memory.automaticMaintenance) return;
    if (running.current || (automatic && autoBlocked.current)) return;
    running.current = true;
    try {
      setPhase('generating');
      setNotice('正在核对批次并整理记忆，不阻断游戏生成。');
      const state = await runner.run({ saveId, task, config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage), timeoutSeconds: settings.runtime.timeoutSeconds,
        onPhase: (next) => { if (mounted.current) setPhase(next); } });
      if (mounted.current) {
        if (state) callback.current(state);
        if (task === 'public') autoBlocked.current = false;
        setNotice(state ? task === 'npc' ? '一批私人记忆已整理并原子保存，原始记忆完整保留。' : '一批记忆已整理并原子保存，原始正文完整保留。' : '当前没有可安全整理的任务，无模型请求。');
      }
    } catch (error) {
      if (automatic) autoBlocked.current = true;
      if (mounted.current) setNotice((task === 'npc' ? '私人记忆整理未完成，原始记录保留；可能是来源冲突、取消、服务或存储失败。' : error instanceof DataError ? error.message : safeAiError(error).message) +
        (automatic ? ' 本页面已暂停后续自动维护，请检查后手动重试（可能收费）。' : ''));
    } finally { running.current = false; if (mounted.current) setPhase(undefined); }
  }
  return { phase, notice, run, cancel: () => runner.cancel() };
}
