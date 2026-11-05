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
import type { RuntimeLogReporter } from './runtimeLog';
import { generateAndSettleTurn } from '../../workflows/automaticTurn';
import type { TurnCommitResult } from '../../services/storage/saveRepository';
import { AiError } from '../../services/ai/errors';

export function useTurnGeneration(
  repository: SaveRepository,
  draft: TurnDraft | undefined,
  settings: Settings,
  companionProfile: CompanionProfile | undefined,
  onSaved: (draft: TurnDraft) => void,
  onRuntimeEvent?: RuntimeLogReporter,
  onSettled?: (result: TurnCommitResult) => void,
) {
  const [runner] = useState(() => new TurnCoordinator(repository));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TurnProgress>();
  const [outcome, setOutcome] = useState<TurnOutcome>();
  const [error, setError] = useState('');
  const [settling, setSettling] = useState(false);
  const saving = useRef(false);
  const active = useRef(false),
    token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<TurnProgress | undefined>(undefined);
  const lastLoggedStage = useRef<TurnProgress['stage'] | undefined>(undefined);
  const lastProgress = () => pending.current;
  useEffect(
    () => () => {
      token.current++;
      runner.dispose();
      clearTimeout(timer.current);
    },
    [runner],
  );
  async function generate(expected = draft) {
    if (!expected || active.current) return;
    active.current = true;
    const id = ++token.current;
    setRunning(true);
    onRuntimeEvent?.('workflow', 'started');
    lastLoggedStage.current = undefined;
    setError('');
    setOutcome(undefined);
    setProgress(undefined);
    pending.current = undefined;
    try {
      const result = await generateAndSettleTurn(runner, repository, {
        draft: expected,
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
          if (next.stage !== lastLoggedStage.current) {
            lastLoggedStage.current = next.stage;
            onRuntimeEvent?.(next.stage, 'started');
          }
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
      }, { check: () => { if (token.current !== id) throw new AiError('cancelled'); },
        onSettling: () => { saving.current = true; setSettling(true); onRuntimeEvent?.('commit', 'started'); } });
      if (token.current === id) {
        setOutcome(result.outcome);
        if (result.committed) { onRuntimeEvent?.('commit', 'completed'); onSettled?.(result.committed); }
        onRuntimeEvent?.('workflow', 'completed');
      }
    } catch (failure) {
      if (token.current === id) {
        const stage = saving.current ? 'commit' : lastProgress()?.stage;
        onRuntimeEvent?.(stage ?? 'workflow', 'failed', failure);
        setError(
          `${stage ? { story: '正文生成', variables: '变量管理', world: '动态世界', commit: '正式结算' }[stage] + '：' : ''}${storyError(failure)}`,
        );
      }
    } finally {
      if (token.current === id) {
        clearTimeout(timer.current);
        timer.current = undefined;
        active.current = false;
        setRunning(false);
        setProgress(undefined);
        saving.current = false;
        setSettling(false);
      }
    }
  }
  function cancel() {
    if (saving.current) return;
    if (!runner.cancel()) return;
    // 等当前执行器退出后才开放新运行，避免宣称仍在保存的事务已经取消。
    setError('正在取消自动执行；已完整保存的合法候选将保留。');
    onRuntimeEvent?.('workflow', 'cancelled');
  }
  return { generate, cancel, running, settling, progress, error, outcome };
}
