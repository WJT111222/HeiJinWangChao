import { useEffect, useRef, useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import type { LegacyNotificationSelection } from '../../domain/events/legacyNotification';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { AiClient } from '../../services/ai/client';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { StoryStage, storyError } from '../../workflows/storyStage';
import type { StoryProgress } from '../../workflows/storyStage';
import { captureRunInputs, executeWithAutoRetry } from '../../workflows/stageRetry';
import type { RetryNotice } from '../../workflows/stageRetry';
import { withHeldStageLock } from '../../workflows/stageGuard';
import type { Settings } from '../settings/model';
import { mayStartStory } from './storyGenerationPolicy';
import type { RuntimeLogReporter } from './runtimeLog';

export function useStoryGeneration(
  repository: SaveRepository,
  draft: TurnDraft | undefined,
  settings: Settings,
  companionProfile: CompanionProfile | undefined,
  onSaved: (draft: TurnDraft) => void,
  onRuntimeEvent?: RuntimeLogReporter,
) {
  const [progress, setProgress] = useState<StoryProgress>();
  const [retry, setRetry] = useState<RetryNotice>();
  const [error, setError] = useState('');
  const errorTurn = useRef<string | undefined>(undefined);
  const turnKey = (value: TurnDraft | undefined) => value && `${value.saveId}:${value.turnId}:${value.storyRevision}`;
  const token = useRef(0);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<StoryProgress | undefined>(undefined);
  const waitAbort = useRef<AbortController | undefined>(undefined);
  const activeStage = useRef<StoryStage | undefined>(undefined);
  useEffect(
    () => () => {
      token.current++;
      waitAbort.current?.abort();
      activeStage.current?.dispose();
      clearTimeout(timer.current);
    },
    [],
  );
  async function generate(selection?: LegacyNotificationSelection) {
    if (!draft || running.current || (!selection && !mayStartStory(draft))) return;
    running.current = true;
    errorTurn.current = turnKey(draft);
    const id = ++token.current;
    setError('');
    setRetry(undefined);
    onRuntimeEvent?.('story', 'started');
    setProgress({ phase: 'generating', narrative: '' });
    const controller = new AbortController();
    waitAbort.current = controller;
    let current = draft;
    let reported: unknown;
    try {
      const frozen = captureRunInputs({
        settings,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
        companionProfile,
      });
      const saved = await withHeldStageLock(draft.saveId, async (guard) => {
        const stage = new StoryStage(repository, new AiClient(), guard);
        activeStage.current = stage;
        try {
          return await executeWithAutoRetry({
            settings: frozen.settings,
            signal: controller.signal,
            onFailure: (failure) => {
              reported = failure;
              if (token.current === id) onRuntimeEvent?.('story', 'failed', failure, current.turnId, { retain: true });
            },
            onRetry: (notice) => {
              if (token.current !== id) return;
              clearTimeout(timer.current);
              timer.current = undefined;
              setRetry(notice);
              setProgress((currentProgress) => ({
                phase: 'retrying',
                narrative: currentProgress?.narrative ?? '',
                readingPhase: currentProgress?.readingPhase,
                planning: currentProgress?.planning,
                nativeReasoning: currentProgress?.nativeReasoning,
                compatibilityReasoning: currentProgress?.compatibilityReasoning,
              }));
            },
            run: () => stage.generate({
              draft: current,
              legacyNotificationSelection: selection,
              settings: frozen.settings,
              companionProfile: frozen.companionProfile,
              config: frozen.config,
              vault: frozen.vault,
              orderPreferences: frozen.orderPreferences,
              onFailureSaved: (savedDraft) => {
                current = savedDraft;
                if (token.current === id) onSaved(savedDraft);
              },
              onProgress: (next) => {
                if (token.current !== id) return;
                setRetry(undefined);
                const bodyStarted = next.readingPhase === 'body' && latest.current?.readingPhase !== 'body';
                latest.current = next;
                if (next.phase === 'saving' || bodyStarted) {
                  clearTimeout(timer.current);
                  timer.current = undefined;
                  setProgress(next);
                } else if (!timer.current) {
                  timer.current = setTimeout(() => {
                    timer.current = undefined;
                    if (token.current === id) setProgress(latest.current);
                  }, 50);
                }
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
        onRuntimeEvent?.('story', 'completed');
      }
    } catch (failure) {
      if (token.current === id) {
        setError(storyError(failure));
        if (failure !== reported) onRuntimeEvent?.('story', 'failed', failure);
      }
    } finally {
      if (waitAbort.current === controller) waitAbort.current = undefined;
      clearTimeout(timer.current);
      timer.current = undefined;
      running.current = false;
      setProgress(undefined);
      setRetry(undefined);
    }
  }
  function cancel() {
    const stage = activeStage.current;
    if (stage && !stage.cancel()) return;
    if (!stage && !waitAbort.current) return;
    waitAbort.current?.abort();
    token.current++;
    errorTurn.current = turnKey(draft);
    setError('请求已取消，已保存的正文草稿保持不变。');
    onRuntimeEvent?.('story', 'cancelled');
  }
  return { generate, cancel, progress, retry, error: errorTurn.current === turnKey(draft) ? error : '' };
}
