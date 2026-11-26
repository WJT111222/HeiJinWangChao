import { fingerprint } from '../../domain/commands';
import type { TurnDraft } from '../../domain/drafts';
import { officialIds, type MainWorldview } from '../../domain/worldbook/mainWorldbook';
import { AiError } from '../ai/errors';
import { WorldbookLibrary } from '../storage/worldbookLibrary';

export const missingWorldview = () => new AiError('storage', undefined, { fieldPath: 'worldbook.unbound' });

export interface StoryWorldview {
  saveId: string;
  instance: string | null;
  epoch: string;
  owner: string;
  generation: string;
  turnId: string;
  baseRevision: number;
  draftRevision: number;
  storyRevision: number;
  worldviewHash: string;
  worldview: MainWorldview;
}

// Stage attempts and downstream candidates can change without changing the Story they consume.
export async function storySourceHash(draft: TurnDraft) {
  const source = [
    draft.saveId,
    draft.turnId,
    draft.baseSaveRevision,
    draft.turnKind,
    draft.userInput,
    draft.storyRevision,
    draft.stageStatus.story,
    draft.story,
    draft.storyPartial,
    draft.failures.filter((f) => f.stage === 'story' && f.storyRevision === draft.storyRevision),
  ];
  return hashSource(source);
}

async function hashSource(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Enabled built-ins are bundled resources. The loader verifies these manifest hashes before composing.
export async function worldviewDigest(worldview: MainWorldview) {
  const { promptManifest } = await import('../../prompts/manifest');
  const officialHashes = officialIds
    .filter((id) => worldview.official[id])
    .map((id) => {
      const resource = promptManifest.modules.find((module) => module.id === id);
      if (!resource) throw new AiError('resource');
      return resource.contentSha256;
    });
  return hashSource([worldview, officialHashes]);
}

export async function loadMainWorldview(): Promise<MainWorldview> {
  return withWorldbookLibrary((lib) => lib.worldview());
}

export async function restoreWorldview(saveId: string, owner: string, generation: string, expectedHash: string) {
  const worldview = await withWorldbookLibrary((lib) => lib.readWorldview(saveId, owner, generation));
  if ((await worldviewDigest(worldview)) !== expectedHash) throw missingWorldview();
  return worldview;
}

export async function withWorldbookLibrary<T>(read: (lib: WorldbookLibrary) => Promise<T>): Promise<T> {
  const opened = await WorldbookLibrary.open();
  if (!opened.ok)
    throw new AiError('storage', undefined, {
      fieldPath: 'worldbook.' + (opened.code === 'blocked' ? 'blocked' : 'unavailable'),
    });
  try {
    return await read(opened.library);
  } catch (error) {
    const unavailable =
      error instanceof DOMException &&
      ['InvalidStateError', 'SecurityError', 'QuotaExceededError', 'UnknownError', 'AbortError'].includes(
        error.name,
      );
    const reason = unavailable
      ? 'unavailable'
      : error instanceof Error && ['missing_version', 'unbound'].includes(error.message)
        ? error.message
        : 'invalid';
    throw new AiError('storage', undefined, { fieldPath: 'worldbook.' + reason });
  } finally {
    opened.library.close();
  }
}
