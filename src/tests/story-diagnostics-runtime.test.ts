import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { DataError } from '../domain/common';
import { pendingOpeningClock } from '../domain/openingTime';
import { StoryStage, storyError } from '../workflows/storyStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { runStageRequest } from '../services/ai/runtime';
import * as runtime from '../services/ai/runtime';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { event, game } from './fixtures/game';

const secret = 'mock-secret/story-key';
function envelope(guide: unknown = [], narrative = '【旁白】主角在街边等候。') {
  return `<thinking>保持场景。</thinking><正文>${narrative}</正文><短期记忆>在街边等候。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
}
function route(text: string) {
  const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'story-diagnostics';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
  const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, secret);
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  return { config, vault, settings, fetcher, client: new AiClient(fetcher) };
}
function pending() { const state = game(); state.openingTimePending = true; state.worldClock = pendingOpeningClock; return GameStateSchema.parse(state); }
const startAt = '2015-07-08T09:00:00+08:00', endAt = '2015-07-08T09:01:00+08:00';
const opening = (value: unknown) => ({ group: 'time', subjectHint: 'time:opening', observedFact: typeof value === 'string' ? value : JSON.stringify(value) });
async function acceptedNotes(state: GameState, guide: unknown, mode: 'opening' | 'regular' = 'opening') {
  const text = envelope(guide), r = route(text), before = structuredClone(state);
  const draft = createTurnDraft(state.saveId, state.revision, 'test-story', mode, '');
  const response = await runStageRequest({ stage: 'story', mode, state, draft, userInput: '', settings: r.settings }, r.config, r.vault, {}, r.client);
  expect(response.result).toMatchObject({ narrative: '【旁白】主角在街边等候。', variableGuideRaw: JSON.stringify(guide) });
  expect(stageResponses.getSnapshot()[0]).toMatchObject({ status: 'validated', text });
  expect(r.fetcher).toHaveBeenCalledTimes(1);
  expect(state).toEqual(before);
  return response.result;
}
afterEach(() => { stageResponses.clear(); vi.restoreAllMocks(); });

describe('Story diagnostics through real Composer / client / validation', () => {
  it.each([
    ['missing', []],
    ['duplicate', [opening({ startAt, endAt }), opening({ startAt, endAt })]],
    ['bad JSON', [opening('{隐私材料')]],
    ['missing date', [opening({ endAt })]],
    ['bad calendar', [opening({ startAt: '2015-02-30T09:00:00+08:00', endAt })]],
    ['wrong type', [opening({ startAt: 42, endAt })]],
    ['timezone', [opening({ startAt: '2015-07-08T01:00:00Z', endAt: '2015-07-08T01:01:00Z' })]],
    ['reversed', [opening({ startAt: endAt, endAt: startAt })]],
    ['mixed protocol', [opening({ startAt, endAt }), { group: 'time', subjectHint: 'time:end', observedFact: endAt }]],
  ] as const)('opening %s', async (_name, guide) => { await acceptedNotes(pending(), guide); });

  it.each([
    ['time_duplicate', [{ group: 'time', subjectHint: 'time:end', observedFact: '2026-10-18T08:01:00+08:00' }, { group: 'time', subjectHint: 'time:pause', observedFact: '2026-10-18T08:02:00+08:00' }]],
    ['time_invalid_or_reversed', [{ group: 'time', subjectHint: 'time:end', observedFact: '2026-10-18T07:00:00+08:00' }]],
    ['time_kind', [{ group: 'time', subjectHint: 'time:private-invalid-type', observedFact: '2026-10-18T08:01:00+08:00' }]],
    ['time_interrupt', [{ group: 'time', subjectHint: 'time:interrupt:private-id', observedFact: '2026-10-18T08:01:00+08:00' }]],
    ['retrospective_duplicate', [{ group: 'time', subjectHint: 'time:retrospective', observedFact: '{}' }, { group: 'time', subjectHint: 'time:retrospective', observedFact: '{}' }]],
    ['retrospective_json', [{ group: 'time', subjectHint: 'time:retrospective', observedFact: '{private-json' }]],
    ['retrospective_schema', [{ group: 'time', subjectHint: 'time:retrospective', observedFact: '{}' }]],
    ['retrospective_source', [{ group: 'time', subjectHint: 'time:retrospective', observedFact: JSON.stringify({ npcId: 'absent-npc', perspectiveRequest: '切换同事视角', pastRequest: '昨日', temporalScope: 'past_only', currentPlotAdvances: false }) }]],
  ] as const)('regular reference: %s', async (_rule, guide) => {
    await acceptedNotes(game(), guide, 'regular');
  });

  function withEntry(status: 'pending' | 'presented' | 'declined' = 'pending') {
    const state = game(); state.events['event-a'] = { ...event(), status: 'active',
      protagonistEntry: { id: 'entry-a', sourceTurnId: 'turn-a', queuedAt: state.worldClock, channel: '来访', cue: '隐私材料', status,
        ...(status === 'pending' ? {} : { handledTurnId: 'turn-a', textEvidence: '曾收到来访。' }) } };
    return GameStateSchema.parse(state);
  }
  const receipt = { group: 'event', observedFact: '收到来访', textEvidence: '收到来访', eventInteraction: { eventId: 'event-a', entryId: 'entry-a', action: 'presented' } };
  it.each([
    ['duplicate', [receipt, receipt]],
    ['group', [{ ...receipt, group: 'npc' }]],
    ['reference', [{ ...receipt, eventInteraction: { ...receipt.eventInteraction, entryId: 'private-invalid-id' } }]],
    ['evidence_empty', [{ ...receipt, textEvidence: ' \n ' }]],
    ['status', [{ ...receipt, eventInteraction: { ...receipt.eventInteraction, action: 'private-invalid-action' } }]],
  ] as const)('event receipt %s', async (_name, guide) => {
    expect(await acceptedNotes(withEntry(), guide)).toMatchObject({ variableGuide: [] });
  });
  it.each(['presented', 'declined'] as const)('existing %s entry', async status => {
    expect(await acceptedNotes(withEntry(status), [receipt])).toMatchObject({ variableGuide: [] });
  });
  it('a legal opening time and a legal receipt still succeed, with one request', async () => {
    for (const [state, guide] of [[pending(), [opening({ startAt, endAt })]], [withEntry(), [receipt]]] as const) {
      const r = route(envelope(guide)), before = structuredClone(state);
      const result = await runStageRequest({ stage: 'story', mode: 'opening', state, draft: createTurnDraft(state.saveId, 0, 'legal', 'opening', ''), userInput: '', settings: r.settings }, r.config, r.vault, {}, r.client);
      expect(result.result).toMatchObject({ variableGuide: guide }); expect(r.fetcher).toHaveBeenCalledTimes(1);
      expect(stageResponses.getSnapshot()[0].status).toBe('validated'); expect(state).toEqual(before);
    }
  });
});

describe('late Story failure remains safe and synchronizes temporary response diagnostics', () => {
  async function run(text: string, configure?: (repo: SaveRepository, draft: ReturnType<typeof createTurnDraft>) => Promise<void> | void) {
    const repo = await SaveRepository.open('story-diagnostics', new IDBFactory());
    await repo.create(game()); const draft = createTurnDraft('save-a', 0, 'turn-story', 'opening', ''); await repo.saveDraft(draft, null);
    const before = await repo.loadGame('save-a'), r = route(text), stage = new StoryStage(repo, r.client);
    try {
      await configure?.(repo, draft);
      let caught: unknown; try { await stage.generate({ ...r, draft }); } catch (error) { caught = error; }
      expect(caught).toBeDefined(); expect(await repo.loadGame('save-a')).toEqual(before);
      return { caught, record: stageResponses.getSnapshot()[0], calls: r.fetcher.mock.calls.length };
    } finally { stage.dispose(); repo.close(); }
  }
  it.each([secret, encodeURIComponent(secret)])('credential echo is blocked and safely diagnosed: %s', async value => {
    const { caught, record, calls } = await run(envelope([], '【旁白】' + value));
    expect(caught).toMatchObject({ code: 'invalid_output', details: { storyRule: 'credential_output' } });
    expect(calls).toBe(1); expect(record).toMatchObject({ status: 'failed', error: { details: { storyRule: 'credential_output' } } });
    expect(record.normalized).toBeUndefined(); expect(JSON.stringify(record)).not.toContain(secret); expect(JSON.stringify(record)).not.toContain(encodeURIComponent(secret));
    expect(storyError(caught)).toContain('凭证'); expect(JSON.stringify(runtimeLogEvent(1, 'story', 'failed', caught))).not.toContain(value);
  });
  it('response basis mismatch retains invalid_output and does not save', async () => {
    const original = runtime.runStageRequest;
    const { caught, record, calls } = await run(envelope(), () => {
      vi.spyOn(runtime, 'runStageRequest').mockImplementation(async (...args) => { const response = await original(...args); return { ...response, requestBasis: { ...response.requestBasis, storyRevision: 999 } }; });
    });
    expect(caught).toMatchObject({ code: 'invalid_output', details: { storyRule: 'request_basis' } });
    expect(calls).toBe(1); expect(record).toMatchObject({ status: 'failed', error: { details: { storyRule: 'request_basis' } } });
  });
  it('CAS conflict keeps the original DataError and marks the corresponding response failed', async () => {
    const { caught, record, calls } = await run(envelope(), repo => {
      vi.spyOn(repo, 'saveDraft').mockRejectedValue(new DataError('DRAFT_CONFLICT', 'secret-internal-detail'));
    });
    expect(caught).toMatchObject({ code: 'DRAFT_CONFLICT' }); expect(caught).toBeInstanceOf(DataError);
    expect(calls).toBe(1); expect(record).toMatchObject({ status: 'failed', error: { code: 'candidate_conflict', details: { storyRule: 'draft_conflict' } } });
    expect(storyError(caught)).toContain('版本'); expect(JSON.stringify(runtimeLogEvent(1, 'story', 'failed', caught))).not.toContain('secret-internal-detail');
  });
  it('pre-request mismatch makes no API request and does not relabel old responses', async () => {
    const { caught, calls, record } = await run(envelope(), (repo, draft) => {
      vi.spyOn(repo, 'loadDraft').mockResolvedValue({ ...draft, draftRevision: 1 });
      // loadGame reads the stored transaction directly, so the preserved-draft assertion remains real.
    });
    expect(caught).toMatchObject({ code: 'DRAFT_CONFLICT' }); expect(calls).toBe(0); expect(record).toBeUndefined();
    expect(runtimeLogEvent(1, 'story', 'failed', caught)).toMatchObject({ code: 'DRAFT_CONFLICT', storyRule: 'draft_conflict' });
  });
});
