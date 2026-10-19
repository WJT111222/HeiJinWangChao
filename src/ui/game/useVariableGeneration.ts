import { useEffect, useRef, useState } from 'react';
import type { TurnDraft } from '../../domain/drafts';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { VariableStage } from '../../workflows/variableStage';
import { storyError } from '../../workflows/storyStage';
import type { Settings } from '../settings/model';

export function useVariableGeneration(
  repository: SaveRepository,
  draft: TurnDraft | undefined,
  settings: Settings,
  onSaved: (draft: TurnDraft) => void,
) {
  const [runner] = useState(() => new VariableStage(repository));
  const [phase, setPhase] = useState<'generating' | 'saving'>();
  const [error, setError] = useState('');
  const errorStory = useRef<number | undefined>(undefined);
  const token = useRef(0),
    running = useRef(false);
  useEffect(
    () => () => {
      token.current++;
      runner.dispose();
    },
    [runner],
  );
  async function generate() {
    if (!draft || running.current) return;
    running.current = true;
    errorStory.current = draft.storyRevision;
    const id = ++token.current;
    setError('');
    setPhase('generating');
    try {
      const saved = await runner.generate({
        draft,
        settings,
        config: readAiConfig(localStorage),
        vault: new CredentialVault(sessionStorage, localStorage),
        onDraft: (next) => {
          if (token.current === id) onSaved(next);
        },
        onProgress: (next) => {
          if (token.current === id) setPhase(next);
        },
      });
      if (token.current === id) onSaved(saved);
    } catch (failure) {
      if (token.current === id) setError(storyError(failure));
    } finally {
      if (token.current === id) {
        running.current = false;
        setPhase(undefined);
      }
    }
  }
  function cancel() {
    if (!runner.cancel()) return;
    token.current++;
    running.current = false;
    setPhase(undefined);
    setError('变量请求已取消，正文与正式世界状态保持不变。');
  }
  return {
    generate,
    cancel,
    phase,
    error: errorStory.current === draft?.storyRevision ? error : '',
  };
}
