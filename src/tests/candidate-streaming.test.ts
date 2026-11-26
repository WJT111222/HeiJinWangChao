import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { readDocument } from '../services/local/documents';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { payloadMessages } from '../services/ai/inspection';
import { stageResponses } from '../services/ai/stageResponses';
import { defaultSettings, SettingsSchema, settingsKey } from '../ui/settings/model';
import { VariableStage } from '../workflows/variableStage';
import { WorldStage } from '../workflows/worldStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { saveFixtureStory, completeDraft } from './fixtures/turn';
import { worldState, worldNarrative } from './fixtures/world';
import { variableTextEnvelope } from './fixtures/variableReply';

const variableText = variableTextEnvelope('<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\n</命令>');
const worldText = JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
function setup(protocol: Protocol = 'deepseek') {
  const channel = newChannel(protocol), config = defaultAiConfig(); channel.defaultModel = 'story';
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  for (const stage of ['variables', 'world'] as const) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
  const map = new Map<string, string>(), storage = { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-streaming-secret');
  return { config, vault, storage, settings: defaultSettings() };
}
async function repository(mode: 'opening' | 'regular' = 'regular') {
  const repo = await SaveRepository.open('candidate-streaming', new IDBFactory());
  await repo.create(worldState());
  if (mode === 'regular') {
    const committed = await repo.commitTurn({ draft: await completeDraft(repo), nextAction: '', useVariableStage: true, useWorldStage: true });
    await repo.deleteDraft('save-a', committed.draft.draftRevision);
  }
  const state = await repo.load('save-a'), initial = createTurnDraft('save-a', state.revision, 'stream-turn', mode, '');
  await repo.saveDraft(initial, null);
  const draft = await saveFixtureStory(repo,rerollStory(initial, { turnKind: mode, narrative: worldNarrative, summary: '用餐', variableGuide: [] }), 0);
  return { repo, draft };
}
function json(protocol: Protocol, text: string, reasoning = '公开思考') {
  return protocol === 'gemini' ? { candidates: [{ content: { parts: [{ thought: true, text: reasoning }, { text }] }, finishReason: 'STOP' }] }
    : protocol === 'anthropic' ? { content: [{ type: 'thinking', thinking: reasoning }, { type: 'text', text }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: text, reasoning_content: reasoning }, finish_reason: 'stop' }] };
}
const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';
function events(protocol: Protocol, text: string, reason = 'stop', terminal = true) {
  const parts = [text.slice(0, 4), text.slice(4, 19), text.slice(19)];
  if (protocol === 'gemini') return frame({ candidates: [{ content: { parts: [{ thought: true, text: '公开思考' }] } }] })
    + parts.map(text => frame({ candidates: [{ content: { parts: [{ text }] } }] })).join('')
    + (terminal ? frame({ candidates: [{ finishReason: reason === 'stop' ? 'STOP' : reason === 'length' ? 'MAX_TOKENS' : 'SAFETY' }] }) : '');
  if (protocol === 'anthropic') return frame({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '公开思考' } })
    + parts.map(text => frame({ type: 'content_block_delta', delta: { type: 'text_delta', text } })).join('')
    + (terminal ? frame({ type: 'message_delta', delta: { stop_reason: reason === 'stop' ? 'end_turn' : reason === 'length' ? 'max_tokens' : 'content_filter' } }) + frame({ type: 'message_stop' }) : '');
  return frame({ choices: [{ delta: { reasoning_content: '公开思考' } }] })
    + parts.map(content => frame({ choices: [{ delta: { content } }] })).join('')
    + (terminal ? frame({ choices: [{ delta: {}, finish_reason: reason }] }) + 'data: [DONE]\n\n' : '');
}
function stream(protocol: Protocol, text: string, reason = 'stop', terminal = true) {
  const bytes = new TextEncoder().encode(events(protocol, text, reason, terminal));
  return new Response(new ReadableStream<Uint8Array>({ start(c) {
    const chunk = bytes.length > 10_000 ? 4093 : 7;
    for (let n = 0; n < bytes.length; n += chunk) c.enqueue(bytes.slice(n, n + chunk)); c.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function wantsStream(url: RequestInfo | URL, init?: RequestInit) {
  return String(url).includes(':streamGenerateContent') || JSON.parse(String(init?.body)).stream === true;
}
afterEach(() => { stageResponses.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('old local settings retain every preference and version without rewriting storage; malformed flags are not coerced', () => {
  const a = setup(), old = structuredClone(a.settings) as unknown as { runtime: Record<string, unknown> };
  delete old.runtime.streamVariables; delete old.runtime.streamWorld; old.runtime.timeoutSeconds = 77;
  a.storage.setItem(settingsKey, JSON.stringify(old)); const write = vi.spyOn(a.storage, 'setItem');
  const restored = readDocument(a.storage, settingsKey, SettingsSchema)!;
  expect(restored).toEqual({ ...old, runtime: { ...old.runtime, streamVariables: false, streamWorld: false } });
  expect(write).not.toHaveBeenCalled(); expect(restored.version).toBe(1);
  expect(SettingsSchema.safeParse({ ...restored, runtime: { ...restored.runtime, streamWorld: 'true' } }).success).toBe(false);
});

for (const protocol of ['deepseek', 'openai', 'gemini', 'anthropic'] as const) {
  it.each([[false, false], [true, false], [false, true], [true, true]])(`${protocol} independent flags Variables=%s World=%s: manual and automatic wires/results match`, async (v, w) => {
    const outputs: TurnDraft[] = [];
    for (const automatic of [false, true]) {
      const a = setup(protocol), { repo, draft } = await repository();
      a.settings.runtime.streamVariables = v; a.settings.runtime.streamWorld = w;
      const expected = new Map([['variables', v], ['world', w]]), stages: string[] = [];
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const body = JSON.parse(String(init?.body));
        const stage = protocol === 'gemini' ? (String(url).includes('models/variables:') ? 'variables' : 'world') : body.model;
        stages.push(stage); const streaming = wantsStream(url, init); expect(streaming).toBe(expected.get(stage));
        const serialized = JSON.stringify(payloadMessages(body, protocol)); expect(serialized).not.toMatch(/streamVariables|streamWorld/);
        const text = stage === 'variables' ? variableText : worldText;
        return streaming ? stream(protocol, text) : Response.json(json(protocol, text));
      });
      try {
        const before = await repo.load('save-a'), client = new AiClient(fetcher);
        const final = automatic ? (await new TurnCoordinator(repo, client).generate({ ...a, draft })).draft
          : await new WorldStage(repo, client).generate({ ...a, draft: await new VariableStage(repo, client).generate({ ...a, draft }) });
        expect(final.variables?.validation).toBe('validated'); expect(final.world?.validation).toBe('validated');
        expect(await repo.load('save-a')).toEqual(before); expect(stages).toEqual(['variables', 'world']); expect(fetcher).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(final)).not.toMatch(/streamVariables|streamWorld|公开思考/); outputs.push(final);
      } finally { repo.close(); }
    }
    expect(outputs[0].variables?.result).toEqual(outputs[1].variables?.result); expect(outputs[0].world?.result).toEqual(outputs[1].world?.result);
  });

  it.each(['variables', 'world'] as const)(`${protocol} %s same accepted candidate for nonstream, SSE and full JSON fallback`, async stage => {
    const results: unknown[] = [];
    for (const fallback of [false, true, 'nonstream'] as const) {
      const a = setup(protocol), { repo, draft } = await repository('opening');
      a.settings.runtime.streamVariables = fallback !== 'nonstream'; a.settings.runtime.streamWorld = fallback !== 'nonstream';
      const text = stage === 'variables' ? variableText : worldText;
      const fetcher = vi.fn<typeof fetch>(async (url, init) => { expect(wantsStream(url, init)).toBe(fallback !== 'nonstream'); return fallback ? Response.json(json(protocol, text)) : stream(protocol, text); });
      try {
        const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
        const final = await runner.generate({ ...a, draft }); results.push(final[stage]?.result);
        expect(fetcher).toHaveBeenCalledTimes(1); expect(stageResponses.getSnapshot()[0]).toMatchObject({ text, nativeReasoning: '公开思考', status: 'validated' });
      } finally { repo.close(); }
    }
    expect(results[0]).toEqual(results[1]); expect(results[0]).toEqual(results[2]);
  });

  it.each(['reasoning-only', 'missing-terminal', 'length', 'filter', 'unsupported'] as const)(`${protocol} %s remains a strict failure and never falls back/retries`, async failure => {
    const a = setup(protocol), { repo, draft } = await repository(); a.settings.runtime.streamVariables = true;
    const fetcher = vi.fn<typeof fetch>(async () => failure === 'unsupported' ? Response.json({ error: { message: 'Streaming unsupported' } }, { status: 400 })
      : stream(protocol, failure === 'reasoning-only' ? '' : variableText, failure === 'length' ? 'length' : failure === 'filter' ? 'content_filter' : 'stop', failure !== 'missing-terminal'));
    try {
      const state = await repo.load('save-a');
      await expect(new VariableStage(repo, new AiClient(fetcher)).generate({ ...a, draft })).rejects.toMatchObject({ code:
        failure === 'reasoning-only' ? 'empty' : failure === 'missing-terminal' ? 'stream_interrupted' : failure === 'length' ? 'output_limit' : failure === 'filter' ? 'content_filter' : 'rejected' });
      expect(fetcher).toHaveBeenCalledTimes(1); expect(await repo.load('save-a')).toEqual(state); expect((await repo.loadDraft('save-a'))?.variables).toBeUndefined();
      const raw = stageResponses.getSnapshot()[0]; expect(raw.status).toBe('failed');
      if (failure !== 'unsupported') { expect(raw.nativeReasoning).toBe('公开思考'); expect(raw.text ?? '').toBe(failure === 'reasoning-only' ? '' : variableText); }
    } finally { repo.close(); }
  });
}

it('a running automatic attempt snapshots both stream flags even if settings change before World sends', async () => {
  const a = setup(), { repo, draft } = await repository(); a.settings.runtime.streamVariables = true; a.settings.runtime.streamWorld = false;
  const flags: boolean[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const stage = JSON.parse(String(init?.body)).model; flags.push(wantsStream(url, init));
    if (stage === 'variables') { a.settings.runtime.streamVariables = false; a.settings.runtime.streamWorld = true; return stream('deepseek', variableText); }
    return Response.json(json('deepseek', worldText));
  });
  try { await new TurnCoordinator(repo, new AiClient(fetcher)).generate({ ...a, draft }); expect(flags).toEqual([true, false]); }
  finally { repo.close(); }
});

it.each(['variables', 'world'] as const)('%s manual flag is snapshotted before asynchronous repository reads', async stage => {
  const a = setup(), { repo, draft } = await repository();
  a.settings.runtime.streamVariables = true; a.settings.runtime.streamWorld = true;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => { expect(wantsStream(url, init)).toBe(true); return stream('deepseek', stage === 'variables' ? variableText : worldText); });
  try {
    const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
    const pending = runner.generate({ ...a, draft }); a.settings.runtime.streamVariables = false; a.settings.runtime.streamWorld = false;
    await pending; expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { repo.close(); }
});

it.each(['variables', 'world'] as const)('%s streaming cancellation and late JSON cannot replace the next explicit request/candidate', async stage => {
  const a = setup(), { repo, draft } = await repository(); a.settings.runtime.streamVariables = true; a.settings.runtime.streamWorld = true;
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { release = resolve; }));
  const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
  try {
    const pending = runner.generate({ ...a, draft }); const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); const started = await repo.loadGame('save-a');
    runner.cancel(); await rejected; expect(await repo.loadGame('save-a')).toEqual(started);
    const nextFetcher = vi.fn<typeof fetch>(async () => stream('deepseek', stage === 'variables' ? variableText : worldText));
    const next = stage === 'variables' ? new VariableStage(repo, new AiClient(nextFetcher)) : new WorldStage(repo, new AiClient(nextFetcher));
    const saved = await next.generate({ ...a, draft: started.draft! }), raw = stageResponses.getSnapshot()[0];
    release(Response.json(json('deepseek', '旧请求非法迟到文本', '旧思考')));
    await new Promise(resolve => setTimeout(resolve, 65));
    expect(await repo.loadDraft('save-a')).toEqual(saved); expect(stageResponses.getSnapshot()[0]).toEqual(raw);
    expect(JSON.stringify(stageResponses.getSnapshot())).not.toContain('旧请求非法迟到文本');
    expect(fetcher).toHaveBeenCalledTimes(1); expect(nextFetcher).toHaveBeenCalledTimes(1);
  } finally { runner.dispose(); repo.close(); }
});

it.each(['variables', 'world'] as const)('%s without Web Locks cannot send even with streaming enabled', async stage => {
  const a = setup(), { repo, draft } = await repository(); a.settings.runtime.streamVariables = true; a.settings.runtime.streamWorld = true;
  const fetcher = vi.fn<typeof fetch>(async () => stream('deepseek', 'should not be sent'));
  vi.stubGlobal('window', {}); vi.stubGlobal('navigator', {});
  try {
    const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
    const before = await repo.loadGame('save-a');
    await expect(runner.generate({ ...a, draft })).rejects.toMatchObject({ code: 'concurrency_unavailable' });
    expect(fetcher).not.toHaveBeenCalled(); expect(await repo.loadGame('save-a')).toEqual(before);
  } finally { repo.close(); }
});

it('long World preview is clipped while complete JSON still reaches strict parsing and candidate save', async () => {
  const a = setup(), { repo, draft } = await repository(); a.settings.runtime.streamWorld = true;
  const payload = { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: ['已收到的长说明。'.repeat(40_000)] };
  const long = JSON.stringify(payload), fetcher = vi.fn<typeof fetch>(async () => stream('deepseek', long));
  try {
    const before = await repo.load('save-a');
    const variables = await new VariableStage(repo, new AiClient(async () => Response.json(json('deepseek', variableText)))).generate({ ...a, draft });
    const saved = await new WorldStage(repo, new AiClient(fetcher)).generate({ ...a, draft: variables });
    expect(saved.world?.validation).toBe('validated'); expect(saved.world?.result).toEqual(payload);
    const raw = stageResponses.getSnapshot()[0]; expect(raw.truncated).toBe(true); expect(raw.text?.length).toBeLessThanOrEqual(256_000);
    expect(raw.text?.endsWith('}')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await repo.load('save-a')).toEqual(before);
  } finally { repo.close(); }
});

it.each(['variables', 'world'] as const)('%s SSE timeout retains the received fragment and never saves a partial candidate', async stage => {
  const a = setup(), { repo, draft } = await repository();
  a.settings.runtime.streamVariables = true; a.settings.runtime.streamWorld = true; a.settings.runtime.timeoutSeconds = 1;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: '超时前实际片段', reasoning_content: '公开思考' } }] })));
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  try {
    const before = await repo.load('save-a');
    const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
    await expect(runner.generate({ ...a, draft })).rejects.toMatchObject({ code: 'timeout' });
    expect(stageResponses.getSnapshot()[0]).toMatchObject({ status: 'failed', text: '超时前实际片段', nativeReasoning: '公开思考' });
    expect((await repo.loadDraft('save-a'))?.[stage]).toBeUndefined(); expect(await repo.load('save-a')).toEqual(before); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { repo.close(); }
});
