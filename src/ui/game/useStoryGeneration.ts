import { useEffect, useRef, useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import type { LegacyNotificationSelection } from '../../domain/events/legacyNotification';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { StoryStage, storyError } from '../../workflows/storyStage';
import type { StoryProgress } from '../../workflows/storyStage';
import { executeWithAutoRetry } from '../../workflows/stageRetry';
import type { RetryNotice } from '../../workflows/stageRetry';
import { SettingsSchema } from '../settings/model';
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
  const [runner] = useState(() => new StoryStage(repository));
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
  useEffect(
    () => () => {
      token.current++;
      waitAbort.current?.abort();
      runner.dispose();
      clearTimeout(timer.current);
    },
    [runner],
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
    const frozen = SettingsSchema.parse(settings);
    try {
      const saved = await executeWithAutoRetry({
        settings: frozen,
        signal: controller.signal,
        onFailure: (failure) => {
          reported = failure;
          if (token.current === id) onRuntimeEvent?.('story', 'failed', failure, current.turnId, { retain: true });
        },
        onRetry: (notice) => {
          if (token.current === id) setRetry(notice);
        },
        run: () => runner.generate({
        draft: current,
        legacyNotificationSelection: selection,
        settings: frozen,
        companionProfile,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
        onFailureSaved: (saved) => {
          current = saved;
          if (token.current === id) onSaved(saved);
        },
        onProgress: (next) => {
          if (token.current !== id) return;
          const bodyStarted = next.readingPhase === 'body' && latest.current?.readingPhase !== 'body';
          latest.current = next;
          if (next.phase === 'saving' || bodyStarted) {
            clearTimeout(timer.current);
            timer.current = undefined;
            setProgress(next);
          } else if (!timer.current) {
            // 高频 SSE 合并为每 50ms 一次 React 更新，保留服务端 delta 顺序。
            timer.current = setTimeout(() => {
              timer.current = undefined;
              if (token.current === id) setProgress(latest.current);
            }, 50);
          }
        },
      }),
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
      if (token.current === id) {
        clearTimeout(timer.current);
        timer.current = undefined;
        running.current = false;
        setProgress(undefined);
        setRetry(undefined);
      }
    }
  }
  function cancel() {
    if (!runner.cancel()) return;
    waitAbort.current?.abort();
    token.current++;
    running.current = false;
    clearTimeout(timer.current);
    timer.current = undefined;
    setProgress(undefined);
    setRetry(undefined);
    errorTurn.current = turnKey(draft);
    setError('请求已取消，已保存的正文草稿保持不变。');
    onRuntimeEvent?.('story', 'cancelled');
  }
  return { generate, cancel, progress, retry, error: errorTurn.current === turnKey(draft) ? error : '' };
}
