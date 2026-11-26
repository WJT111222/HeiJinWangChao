import { fingerprint } from '../domain/commands';
import type { TurnDraft } from '../domain/drafts';
import { captureAssistantSelection, writingWitness } from '../presets/library';
import { captureAssistantPreferences } from '../presets/tavern/hostState';
import { readAiConfig } from '../services/ai/configuration';
import { compatibleBase } from '../services/ai/compatibleEndpoints';
import { relayAttempt, relayMode, type ContinuationRoute } from '../services/ai/corsRelay';
import { relayTarget } from '../services/ai/relayTarget';
import { resolveModelRoute } from '../services/ai/snapshot';
import { AiError } from '../services/ai/errors';
import type { SaveRepository } from '../services/storage/saveRepository';
import type { Settings } from '../ui/settings/model';

type Repository = Pick<SaveRepository, 'load' | 'loadDraft'>;
const changed = () => new AiError('configuration', undefined, { fieldPath: 'tavern.confirmation_expired' });

export function canRelayLegacyStory() {
  try {
    const { channel } = resolveModelRoute(readAiConfig(localStorage), 'story');
    const { origin } = relayAttempt(channel.protocol);
    return !!origin && !!relayTarget(compatibleBase(channel.baseUrl) + '/chat/completions', origin, 'POST');
  } catch { return false; }
}

/** One page operation. The exact draft includes its revisions, bound action and complete partial. */
export async function prepareLegacyContinuation(draft: TurnDraft, repository: Repository,
  currentPrompts: () => Settings['prompts'], active: () => boolean) {
  if (!draft.storyPartial || draft.storyPartial.writing || draft.storyPartial.storyRevision !== draft.storyRevision) throw changed();
  const identity = fingerprint(draft);
  const prompts = currentPrompts();
  const selected = captureAssistantPreferences(false);
  const persisted = captureAssistantSelection();
  const [effective, saved] = await Promise.all([writingWitness(selected, prompts), writingWitness(persisted, prompts)]);
  let phase: 'offered' | 'confirmed' | 'claimed' | 'checking' | 'sent' = 'offered';
  function checkPage() {
    if (!active()) throw changed();
  }
  async function checkStored() {
    checkPage();
    const [current, state] = await Promise.all([repository.loadDraft(draft.saveId), repository.load(draft.saveId)]);
    checkPage();
    if (!current || fingerprint(current) !== identity || state.revision !== draft.baseSaveRevision) throw changed();
  }
  function checkWriting() {
    try {
      const now = currentPrompts();
      const storage = captureAssistantSelection();
      // A pending local script edit can overlay storage. A newer, conflicting saved value wins.
      if ((saved.matches(storage, now) || effective.matches(storage, now))
        && effective.matches(captureAssistantPreferences(false), now)) return;
    } catch {
      // A replaced package version or unreadable preferences can no longer prove the authorization.
    }
    throw changed();
  }
  await checkStored();
  checkWriting();
  return {
    writing: effective.writing,
    confirm(route: ContinuationRoute = 'direct') {
      checkPage();
      checkWriting();
      if (phase !== 'offered') throw changed();
      phase = 'confirmed';
      function check(expected: TurnDraft) {
        checkPage();
        if (phase !== 'confirmed' || fingerprint(expected) !== identity) throw changed();
      }
      return {
        route,
        check,
        writing: effective.writing,
        get sent() { return phase === 'sent'; },
        claim(expected: TurnDraft) {
          check(expected);
          phase = 'claimed';
        },
        async dispatch(send: () => Promise<Response>, signal: AbortSignal) {
          if (phase !== 'claimed') throw changed();
          phase = 'checking';
          await checkStored();
          checkPage();
          signal.throwIfAborted();
          checkWriting();
          if (route === 'relay' && relayMode() !== 'auto')
            throw new AiError('configuration', undefined, { fieldPath: 'channel.confirmed_relay_unavailable' });
          phase = 'sent';
          return send();
        },
      };
    },
  };
}
export type LegacyContinuationConsent = ReturnType<Awaited<ReturnType<typeof prepareLegacyContinuation>>['confirm']>;
