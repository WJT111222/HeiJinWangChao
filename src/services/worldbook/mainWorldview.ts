import type { ComposeInput } from '../../prompts/context';
import { AiError } from '../ai/errors';
import { WorldbookLibrary } from '../storage/worldbookLibrary';

/** Story accepts its result at the next storyRevision. Its downstream stages use that same binding. */
export async function loadMainWorldview(input: ComposeInput, bind = false, continuing = false) {
  const opened = await WorldbookLibrary.open();
  if (!opened.ok) throw new AiError('storage', undefined, {fieldPath: 'worldbook.' + (opened.code === 'blocked' ? 'blocked' : 'unavailable')});
  try {
    const { draft, stage, state } = input;
    const basis = draft && { saveId: state.saveId, createdAt: state.createdAt, turnId: draft.turnId,
      baseRevision: draft.baseSaveRevision,
      // bindTurnAction reuses turnId, resets failed/partial Story and advances the draft CAS revision.
      bindingRevision: stage === 'story' && !continuing && !draft.story && !draft.storyPartial && !draft.failures.length
        ? draft.draftRevision : undefined,
      sourceRevision: stage === 'story' ? draft.storyRevision : Math.max(0, draft.storyRevision - 1) };
    return await opened.library.worldview(basis, bind, continuing || stage !== 'story');
  } catch (error) {
    const unavailable = error instanceof DOMException && ['InvalidStateError', 'SecurityError', 'QuotaExceededError', 'UnknownError', 'AbortError'].includes(error.name);
    const reason = unavailable ? 'unavailable' : error instanceof Error && ['missing_version', 'unbound'].includes(error.message) ? error.message : 'invalid';
    throw new AiError('storage', undefined, {fieldPath: 'worldbook.' + reason});
  } finally { opened.library.close(); }
}
