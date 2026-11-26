import { useEffect, useRef, useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { AiClient } from '../../services/ai/client';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { VariableStage } from '../../workflows/variableStage';
import { storyError } from '../../workflows/storyStage';
import { captureRunInputs, executeWithAutoRetry } from '../../workflows/stageRetry';
import type { RetryNotice } from '../../workflows/stageRetry';
import { withHeldStageLock } from '../../workflows/stageGuard';
import type { Settings } from '../settings/model';
import type { RuntimeLogReporter } from './runtimeLog';

export function useVariableGeneration(
  repository: SaveRepository,
  draft: TurnDraft | undefined,
  settings: Settings,
  onSaved: (draft: TurnDraft) => void,
  onRuntimeEvent?: RuntimeLogReporter,
  expectedInstance?: string | null,
) {
  const [phase, setPhase] = useState<'generating' | 'saving' | 'retrying'>();
  const [retry, setRetry] = useState<RetryNotice>();
  const [error, setError] = useState('');
  const errorStory = useRef<number | undefined>(undefined);
  const errorTurn = useRef<string | undefined>(undefined);
  const turnKey = (value: TurnDraft | undefined) => value && `${value.saveId}:${value.turnId}`;
  const token = useRef(0),
    running = useRef(false),
    waitAbort = useRef<AbortController | undefined>(undefined),
    activeStage = useRef<VariableStage | undefined>(undefined);
  useEffect(
    () => () => {
      token.current++;
      waitAbort.current?.abort();
      activeStage.current?.dispose();
    },
    [],
  );
  async function generate() {
    if (!draft || running.current) return;
    running.current = true;
    errorTurn.current = turnKey(draft);
    errorStory.current = draft.storyRevision;
    const id = ++token.current;
    setError('');
    setRetry(undefined);
    onRuntimeEvent?.('variables', 'started');
    setPhase('generating');
    const controller = new AbortController();
    waitAbort.current = controller;
    let current = draft;
    let reported: unknown;
    try {
      const frozen = captureRunInputs({
        settings,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
      });
      const saved = await withHeldStageLock(draft.saveId, async (guard) => {
        const stage = new VariableStage(repository, new AiClient(), guard);
        activeStage.current = stage;
        try {
          return await executeWithAutoRetry({
            settings: frozen.settings,
            signal: controller.signal,
            onFailure: (failure) => {
              reported = failure;
              if (token.current === id) onRuntimeEvent?.('variables', 'failed', failure, current.turnId, { retain: true });
            },
            onRetry: (notice) => {
              if (token.current !== id) return;
              setRetry(notice);
              setPhase('retrying');
            },
            run: () => stage.generate({
              draft: current, expectedInstance,
              settings: frozen.settings,
              config: frozen.config,
              vault: frozen.vault,
              orderPreferences: frozen.orderPreferences,
              onDraft: (next) => {
                current = next;
                if (token.current === id) onSaved(next);
              },
              onProgress: (next) => {
                if (token.current !== id) return;
                setRetry(undefined);
                setPhase(next);
              },
            }),
          });
        } finally {
          stage.dispose();
          if (activeStage.current === stage) activeStage.current = undefined;
        }
      });
      if (token.current === id) {
        onSaved(saved);
        onRuntimeEvent?.('variables', 'completed');
      }
    } catch (failure) {
      if (token.current === id) {
        setError(storyError(failure));
        if (failure !== reported) onRuntimeEvent?.('variables', 'failed', failure);
      }
    } finally {
      if (waitAbort.current === controller) waitAbort.current = undefined;
      running.current = false;
      setPhase(undefined);
      setRetry(undefined);
    }
  }
  function cancel() {
    const stage = activeStage.current;
    if (stage && !stage.cancel()) return;
    if (!stage && !waitAbort.current) return;
    waitAbort.current?.abort();
    token.current++;
    setError('变量请求已取消，正文与正式世界状态保持不变。');
    onRuntimeEvent?.('variables', 'cancelled');
  }
  return {
    generate,
    cancel,
    phase,
    retry,
    error: errorTurn.current === turnKey(draft) && errorStory.current === draft?.storyRevision ? error : '',
  };
}
