import { useEffect, useRef, useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { storyError } from '../../workflows/storyStage';
import { TurnCoordinator } from '../../workflows/turnCoordinator';
import type { TurnOutcome, TurnProgress } from '../../workflows/turnCoordinator';
import type { Settings } from '../settings/model';

export function useTurnGeneration(
  repository: SaveRepository,
  draft: TurnDraft | undefined,
  settings: Settings,
  companionProfile: CompanionProfile | undefined,
  onSaved: (draft: TurnDraft) => void,
) {
  const [runner] = useState(() => new TurnCoordinator(repository));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TurnProgress>();
  const [outcome, setOutcome] = useState<TurnOutcome>();
  const [error, setError] = useState('');
  const active = useRef(false),
    token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<TurnProgress | undefined>(undefined);
  const lastProgress = () => pending.current;
  useEffect(
    () => () => {
      token.current++;
      runner.dispose();
      clearTimeout(timer.current);
    },
    [runner],
  );
  async function generate() {
    if (!draft || active.current) return;
    active.current = true;
    const id = ++token.current;
    setRunning(true);
    setError('');
    setOutcome(undefined);
    setProgress(undefined);
    pending.current = undefined;
    try {
      const result = await runner.generate({
        draft,
        settings,
        companionProfile,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
        onDraft: (next) => {
          if (token.current === id) onSaved(next);
        },
        onProgress: (next) => {
          if (token.current !== id) return;
          pending.current = next;
          if (next.stage !== 'story' || next.phase !== 'generating') {
            clearTimeout(timer.current);
            timer.current = undefined;
            setProgress(next);
          } else if (!timer.current) {
            timer.current = setTimeout(() => {
              timer.current = undefined;
              if (token.current === id) setProgress(pending.current);
            }, 50);
          }
        },
      });
      if (token.current === id) setOutcome(result);
    } catch (failure) {
      if (token.current === id) {
        const stage = lastProgress()?.stage;
        setError(
          `${stage ? { story: '正文生成', variables: '变量管理', world: '动态世界' }[stage] + '：' : ''}${storyError(failure)}`,
        );
      }
    } finally {
      if (token.current === id) {
        clearTimeout(timer.current);
        timer.current = undefined;
        active.current = false;
        setRunning(false);
        setProgress(undefined);
      }
    }
  }
  function cancel() {
    if (!runner.cancel()) return;
    // 等当前执行器退出后才开放新运行，避免宣称仍在保存的事务已经取消。
    setError('正在取消自动执行；已完整保存的合法候选将保留。');
  }
  return { generate, cancel, running, progress, error, outcome };
}
