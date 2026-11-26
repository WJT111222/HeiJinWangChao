import type { LegacyContinuationConsent } from '../../workflows/legacyContinuation';
import { useLayoutEffect, useRef, useState } from 'react';
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
import { AiError, isContinuationDeliveryUnknown } from '../../services/ai/errors';
import { readFailureDiagnostic } from '../../services/ai/failureDiagnostic';
import { chimeForFailure, chimeForTurn, chimeIfWanted, primeChime } from './completionChime';

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
  const errorTurn = useRef<string | undefined>(undefined);
  const turnKey = (value: TurnDraft | undefined) => value && `${value.saveId}:${value.turnId}:${value.storyRevision}`;
  const [settling, setSettling] = useState(false);
  const saving = useRef(false);
  const active = useRef(false),
    token = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<TurnProgress | undefined>(undefined);
  const lastLoggedStage = useRef<TurnProgress['stage'] | undefined>(undefined);
  const lastProgress = () => pending.current;
  // 提示音按播放当时的最新设置判断（包括生成中修改、跨标签同步），不冻结开始时的快照。
  const latestSettings = useRef(settings);
  latestSettings.current = settings;
  const chimeMode = () => latestSettings.current.notifications.completionChime;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      token.current++;
      runner.dispose();
      clearTimeout(timer.current);
    };
  }, [runner]);
  async function generate(expected = draft, consent?: LegacyContinuationConsent) {
    if (!mounted.current || !expected || active.current) return;
    active.current = true;
    // 开始生成多由玩家点击触发：此时启用声音，之后异步完成才能出声；关闭提示音时不初始化音频。
    primeChime(chimeMode());
    errorTurn.current = turnKey(expected);
    const id = ++token.current;
    setRunning(true);
    onRuntimeEvent?.('workflow', 'started');
    lastLoggedStage.current = undefined;
    setError('');
    setOutcome(undefined);
    setProgress(undefined);
    pending.current = undefined;
    let observed = expected;
    let reported: unknown;
    try {
      const result = await generateAndSettleTurn(runner, repository, {
        draft: expected, consent,
        settings,
        companionProfile,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
        onAttemptFailure: (stage, error) => {
          reported = error;
          if (token.current === id) onRuntimeEvent?.(stage, 'failed', error, expected.turnId, { retain: true });
        },
        onDraft: (next) => {
          if (token.current === id) {
            // Only a newly saved ready stage retires its earlier diagnostic errors.
            // A ready candidate by itself must not hide a later failed preflight.
            for (const stage of ['story', 'entities', 'variables', 'world'] as const)
              if (next.stageStatus[stage] === 'ready' && observed.stageStatus[stage] !== 'ready')
                onRuntimeEvent?.(stage, 'completed', undefined, expected.turnId);
            observed = next;
            onSaved(next);
          }
        },
        onProgress: (next) => {
          if (token.current !== id) return;
          const bodyStarted = next.readingPhase === 'body' && pending.current?.readingPhase !== 'body';
          pending.current = next;
          if (next.stage !== lastLoggedStage.current) {
            lastLoggedStage.current = next.stage;
            onRuntimeEvent?.(next.stage, 'started', undefined, expected.turnId);
          }
          if (next.stage !== 'story' || next.phase !== 'generating' || bodyStarted) {
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
        chimeIfWanted(chimeMode(), chimeForTurn(result));
      }
    } catch (failure) {
      if (token.current === id) {
        errorTurn.current = turnKey(observed);
        const diagnostic = readFailureDiagnostic(failure);
        const stage = saving.current || diagnostic?.phase === 'commit_validation' ? 'commit' : lastProgress()?.stage;
        if (failure !== reported) onRuntimeEvent?.(stage ?? 'workflow', 'failed', failure, expected.turnId);
        if (!diagnostic?.openingTime) setError(
          `${stage ? { story: '正文生成', entities: '人物与实体', variables: '主角与现场', world: '场外与网络', commit: '正式结算' }[stage] + '：' : ''}${storyError(failure)}`,
        );
        chimeIfWanted(chimeMode(), chimeForFailure(failure));
        if (consent && (!consent.sent || isContinuationDeliveryUnknown(failure))) return storyError(failure);
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
  return { generate, cancel, running, settling, progress, error: errorTurn.current === turnKey(draft) ? error : '', outcome };
}
