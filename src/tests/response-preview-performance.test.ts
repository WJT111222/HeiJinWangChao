import { afterEach, expect, it, vi } from 'vitest';
import { StageResponseStore, responseStoreBudget, responseSize, stageResponses, candidateResponseLimits, responseLimits } from '../services/ai/stageResponses';
import { requestFixtureStage } from './fixtures/stageRequest';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldDraft } from './fixtures/world';

afterEach(() => { stageResponses.clear(); vi.restoreAllMocks(); });
it('six heavy mixed records obey total preview budget, evicting oldest without changing current Story limits', () => {
  const store = new StageResponseStore(), ids: string[] = [];
  for (let n = 0; n < 6; n++) {
    const id = store.begin({ saveId: 's', stage: 'story' }); ids.push(id);
    store.update(id, { text: '文'.repeat(responseLimits.text), nativeReasoning: '思'.repeat(responseLimits.nativeReasoning),
      displayText: '原'.repeat(responseLimits.displayText), normalized: '值'.repeat(responseLimits.normalized) }, []);
    expect(store.getSnapshot().reduce((size, row) => size + responseSize(row), 0)).toBeLessThanOrEqual(responseStoreBudget);
    expect(store.getSnapshot()[0].text?.length).toBe(responseLimits.text);
  }
  expect(store.getSnapshot().some(row => row.id === ids[0])).toBe(false); expect(store.getSnapshot().length).toBeLessThan(6);
});
it('new candidate previews bound aggregate strings even under repeated overlarge updates and clear', () => {
  const store = new StageResponseStore();
  for (let n = 0; n < 15; n++) {
    const id = store.begin({ saveId: 's', stage: 'variables' });
    store.update(id, { text: '文'.repeat(2_000_000), nativeReasoning: '思'.repeat(500_000), normalized: '值'.repeat(2_000_000) }, []);
  }
  expect(store.getSnapshot()).toHaveLength(6);
  expect(store.getSnapshot().every(row => row.truncated && (row.text?.length ?? 0) <= candidateResponseLimits.text)).toBe(true);
  expect(store.getSnapshot().reduce((n, row) => n + responseSize(row), 0)).toBeLessThanOrEqual(6 * (256_000 + 64_000 + 256_000));
  store.clear(); expect(store.getSnapshot()).toEqual([]);
});
it('hundreds of SSE fragments publish at 50ms intervals, keep private raw output only in store, and retain partial on interruption', async () => {
  const channel = newChannel(), config = defaultAiConfig(); channel.defaultModel = 'mock'; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' };
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-performance-key');
  let publish = 0; const unsubscribe = stageResponses.subscribe(() => { publish++; });
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } })));
  const state = worldState(), draft = worldDraft(false), settings = defaultSettings();
  const promise = requestFixtureStage({ state, draft, settings, stage: 'world', mode: 'regular', userInput: '' }, config, vault, { stream: true }, new AiClient(fetcher));
  const rejected = expect(promise).rejects.toMatchObject({ code: 'stream_interrupted' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const start = performance.now();
  for (let batch = 0; batch < 6; batch++) {
    for (let n = 0; n < 100; n++) controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '私密片段。'.repeat(20) } }] }) + '\n\n'));
    await new Promise(resolve => setTimeout(resolve, 55));
  }
  controller.close(); await rejected; unsubscribe();
  const elapsed = performance.now() - start;
  expect(publish).toBeGreaterThanOrEqual(3); expect(publish).toBeLessThanOrEqual(Math.ceil(elapsed / 50) + 4);
  expect(publish).toBeLessThan(60); expect(stageResponses.getSnapshot()[0].text).toBe('私密片段。'.repeat(12_000));
  expect(stageResponses.getSnapshot()[0].normalized).toBeUndefined();
  console.log(JSON.stringify({ benchmark: '600-fragment-observer', elapsedMs: elapsed, publishes: publish, retainedChars: stageResponses.getSnapshot()[0].text?.length }));
});

it('identical preview snapshots do not trigger redundant subscriber/React updates', () => {
  const store = new StageResponseStore(), listener = vi.fn(); store.subscribe(listener);
  const id = store.begin({ saveId: 's', stage: 'world' });
  store.update(id, { text: '原文', diagnostics: { contentTypes: ['string'] } }, []);
  const snapshot = store.getSnapshot();
  for (let n = 0; n < 100; n++) store.update(id, { text: '原文', diagnostics: { contentTypes: ['string'] } }, []);
  expect(listener).toHaveBeenCalledTimes(2); expect(store.getSnapshot()).toBe(snapshot);
});
