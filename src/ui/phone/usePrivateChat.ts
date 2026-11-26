import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DataError } from '../../domain/common';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { readAiConfig } from '../../services/ai/configuration';
import { CredentialVault } from '../../services/ai/credentials';
import { AiError } from '../../services/ai/errors';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { sendPrivateChat } from '../../workflows/phoneChat';
import { StageGuard, withHeldStageLock } from '../../workflows/stageGuard';
import type { Settings } from '../settings/model';

export function usePrivateChat(
  repository: SaveRepository,
  state: GameState,
  draft: TurnDraft | undefined,
  instance: string | null,
  settings: Settings,
  onSaved: (draft: TurnDraft) => void,
) {
  const [peer, setPeer] = useState(''),
    [remoteBusy, setRemoteBusy] = useState(false);
  const [error, setError] = useState<{ npcId: string; message: string }>();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const cancelled = useRef<StageGuard | null>(null);
  const active = useRef<StageGuard | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const live = useRef({ state, draft, instance, onSaved });
  useLayoutEffect(() => {
    live.current = { state, draft, instance, onSaved };
  });
  const marker = 'heijin.phone:' + state.saveId;
  useEffect(() => {
    let alive = true;
    setPeer('');
    setError(undefined);
    setInputs({});
    setRemoteBusy(false);
    const events = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(marker);
    channel.current = events;
    async function sync() {
      if (!navigator.locks?.query) return;
      try {
        const locks = await navigator.locks.query();
        if (alive) setRemoteBusy(Boolean(locks.held?.some((lock) => lock.name === marker)));
      } catch {
        /* The request itself still requires a Web Lock. */
      }
    }
    async function refresh() {
      const fresh = await repository.loadGame(state.saveId);
      const current = live.current;
      if (
        alive &&
        current.instance === (fresh.instance ?? null) &&
        current.state.revision === fresh.state.revision &&
        fresh.draft &&
        fresh.draft.draftRevision > (current.draft?.draftRevision ?? -1)
      )
        current.onSaved(fresh.draft);
    }
    const update = () => {
      void sync();
      void refresh().catch(() => {});
    };
    if (events) events.onmessage = update;
    window.addEventListener('focus', update);
    void sync();
    return () => {
      alive = false;
      active.current?.dispose();
      active.current = null;
      window.removeEventListener('focus', update);
      events?.close();
      channel.current = null;
    };
  }, [repository, state.saveId, instance, marker]);
  useEffect(() => {
    if (!remoteBusy) return;
    const timer = setInterval(() => {
      void navigator.locks
        ?.query()
        .then((locks) => setRemoteBusy(Boolean(locks.held?.some((lock) => lock.name === marker))))
        .catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [remoteBusy, marker]);
  async function send(npcId: string, text: string) {
    if (active.current) return false;
    const guard = new StageGuard();
    active.current = guard;
    setPeer(npcId);
    setError(undefined);
    try {
      if (!navigator.locks) throw new AiError('concurrency_unavailable');
      const saved = await navigator.locks.request(marker, { ifAvailable: true }, async (lock) => {
        if (!lock) throw new DataError('STORY_BUSY', '其他标签正在发送手机消息。');
        if (active.current !== guard || cancelled.current === guard) throw new AiError('cancelled');
        channel.current?.postMessage('busy');
        return sendPrivateChat(repository, guard, {
          state,
          draft,
          instance,
          npcId,
          text,
          settings,
          config: readAiConfig(localStorage),
          vault: new CredentialVault(sessionStorage, localStorage),
        });
      });
      if (active.current !== guard) return false;
      onSaved(saved);
      return true;
    } catch (failure) {
      if (active.current === guard)
        setError({
          npcId,
          message:
            failure instanceof AiError || failure instanceof DataError
              ? failure.message
              : '手机消息未保存，请重试。',
        });
      return false;
    } finally {
      if (active.current === guard) {
        active.current = null;
        setPeer('');
        setRemoteBusy(false);
        channel.current?.postMessage('idle');
      }
    }
  }
  async function abandon(npcId: string) {
    if (!draft || !window.confirm('放弃本回合的正文和候选？待结算聊天将原样保留。')) return;
    try {
      const restored = await withHeldStageLock(state.saveId, async () => {
        await repository.deleteDraft(state.saveId, draft.draftRevision, draft, instance);
        return repository.loadDraft(state.saveId);
      });
      if (restored && live.current.instance === instance) onSaved(restored);
      channel.current?.postMessage('idle');
    } catch {
      setError({ npcId, message: '草稿版本已变化，请重新读取后再试。' });
    }
  }
  return {
    send,
    abandon,
    peer,
    error,
    inputs,
    edit: (id: string, value: string) => setInputs((old) => ({ ...old, [id]: value })),
    busy: Boolean(peer) || remoteBusy,
    cancel: () => {
      if (active.current?.cancel()) cancelled.current = active.current;
    },
  };
}
