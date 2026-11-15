import { createTurnDraft } from '../domain/drafts';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { VariableStage } from '../workflows/variableStage';
import { WorldStage } from '../workflows/worldStage';
import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiClient } from '../services/ai/client';
import { runStageRequest } from '../services/ai/runtime';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses, StageResponseStore, selectStageResponse, responseLimits } from '../services/ai/stageResponses';
import { StageResponseContent } from '../ui/game/StageResponsesPanel';
import { defaultSettings } from '../ui/settings/model';
import { worldState, worldDraft } from './fixtures/world';

const key = 'mock-observation-secret';
function fixture(protocol: Protocol = 'deepseek') {
  const channel = newChannel(protocol); channel.defaultModel = 'mock';
  const config = defaultAiConfig(); config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' };
  const entries = new Map<string, string>(), storage = { getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, value: string) => { entries.set(k, value); }, removeItem: (k: string) => { entries.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, key);
  return { config, vault, settings: defaultSettings(), state: worldState(), draft: worldDraft(false) };
}
async function request(data: unknown, stage: 'variables' | 'world' = 'variables') {
  const a = fixture(), before = structuredClone(a.state);
  const transport = vi.fn<typeof fetch>(async () => Response.json(data));
  const promise = runStageRequest({ settings: a.settings, state: a.state, draft: a.draft, stage, mode: 'regular', userInput: '' }, a.config, a.vault, {}, new AiClient(transport));
  await expect(promise).rejects.toBeDefined();
  expect(transport).toHaveBeenCalledTimes(1); expect(a.state).toEqual(before);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body)).stream).not.toBe(true);
  return stageResponses.getSnapshot()[0];
}
afterEach(() => { stageResponses.clear(); vi.restoreAllMocks(); });

it.each(['variables', 'world'] as const)('%s reasoning-only keeps actual public reasoning before empty', async stage => {
  const record = await request({ choices: [{ message: { content: null, reasoning_content: '公开思考' }, finish_reason: 'stop' }] }, stage);
  expect(record).toMatchObject({ status: 'failed', nativeReasoning: '公开思考', error: { code: 'empty' } });
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="阶段" />);
  expect(html).toContain('供应商未返回可展示的正文；已收到公开思考。');
});
it('finish error still preserves content before rejecting', async () => {
  const record = await request({ choices: [{ message: { content: '收到的部分文本' }, finish_reason: 'length' }] });
  expect(record).toMatchObject({ text: '收到的部分文本', error: { code: 'output_limit' } });
});

it.each(['variables', 'world'] as const)('%s empty / think-only / unsupported / refusal are observations, not accepted candidates', async stage => {
  for (const [content, extra, code] of [
    ['', {}, 'empty'], [null, {}, 'empty'], ['<think>实际思考</think>', {}, 'empty'],
    [{ unsupported: '不应外泄的任意字段' }, {}, 'empty'], ['', { refusal: '任意拒绝文字不直接展示' }, 'empty'],
    ['部分文本', {}, 'content_filter'],
  ] as const) {
    const r = await request({ choices: [{ message: { content, ...extra }, finish_reason: code === 'content_filter' ? code : 'stop' }] }, stage);
    expect(r.error?.code).toBe(code); expect(r.normalized).toBeUndefined();
    expect(r.diagnostics?.contentTypes).toContain(content === null ? 'null' : typeof content);
    expect(r.diagnostics?.complete).toBe(true);
    expect(JSON.stringify(r)).not.toContain('不应外泄'); expect(JSON.stringify(r)).not.toContain('任意拒绝文字');
    if ('refusal' in extra) expect(r.diagnostics?.refusal).toBe(true);
    if (content === '<think>实际思考</think>') expect(r.text).toBe(content);
  }
});
it.each(['variables', 'world'] as const)('%s invalid actual content is preserved and never normalized', async stage => {
  const content = stage === 'world' ? '{"not-valid-json":' : '<命令>set npc[unknown].secret = "非法"</命令>';
  const r = await request({ choices: [{ message: { content }, finish_reason: 'stop' }] }, stage);
  expect(r.text).toBe(content); expect(r.normalized).toBeUndefined(); expect(r.status).toBe('failed');
});

it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s exposes only public response fields with one request', async protocol => {
  const a = fixture(protocol), content = '不能作为候选的实际文本';
  const data = protocol === 'gemini' ? { candidates: [{ content: { parts: [{ thought: true, text: '公开思考' }, { text: content }, { thoughtSignature: '隐藏签名' }] }, finishReason: 'MAX_TOKENS' }] }
    : protocol === 'anthropic' ? { content: [{ type: 'thinking', thinking: '公开思考', signature: '隐藏签名' }, { type: 'text', text: content }, { type: 'redacted_thinking', data: '隐藏思考' }], stop_reason: 'max_tokens' }
      : { choices: [{ message: { content, reasoning_content: '公开思考' }, finish_reason: 'length' }] };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(data));
  await expect(runStageRequest({ settings: a.settings, state: a.state, draft: a.draft, stage: 'variables', mode: 'regular', userInput: '' }, a.config, a.vault, {}, new AiClient(fetcher))).rejects.toMatchObject({ code: 'output_limit' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const r = stageResponses.getSnapshot()[0]; expect(r).toMatchObject({ text: content, nativeReasoning: '公开思考', diagnostics: { complete: true } });
  expect(JSON.stringify(r)).not.toMatch(/隐藏签名|隐藏思考/);
});

it.each([400, 401, 429, 500])('HTTP %i observes status and only reuses existing error-body reads, never retries or publishes error prose', async status => {
  const a = fixture('openai'), response = Response.json({ error: { type: 'content_filter', message: '任意错误与密钥' + key, other: '隐藏信息' } }, { status });
  const json = vi.spyOn(response, 'json'), fetcher = vi.fn<typeof fetch>(async () => response);
  await expect(runStageRequest({ settings: a.settings, state: a.state, draft: a.draft, stage: 'variables', mode: 'regular', userInput: '' }, a.config, a.vault, {}, new AiClient(fetcher))).rejects.toBeDefined();
  const r = stageResponses.getSnapshot()[0]; expect(r.diagnostics).toMatchObject({ transport: 'http', httpStatus: status });
  if (status === 400) expect(r.diagnostics).toMatchObject({ filtered: true, errorPresent: true });
  else expect(r.diagnostics?.filtered).not.toBe(true);
  expect(json).toHaveBeenCalledTimes(status === 400 ? 1 : 0); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(r)).not.toMatch(/任意错误|隐藏信息|mock-observation-secret/);
});

it.each(['cancelled', 'timeout', 'stream_interrupted'] as const)('%s preserves partial SSE, seals late observations and never accepts a candidate', async failure => {
  const a = fixture(), controller = new AbortController();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const frame = (delta: object) => new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; c.enqueue(frame({ content: '部分中文' + key.slice(0, 8), reasoning_content: '公开思考' })); } })));
  const task = runStageRequest({ settings: a.settings, state: a.state, draft: a.draft, stage: 'variables', mode: 'regular', userInput: '' }, a.config, a.vault,
    { stream: true, signal: controller.signal, timeoutSeconds: failure === 'timeout' ? 0.2 : 10 }, new AiClient(fetcher));
  const rejected = expect(task).rejects.toMatchObject({ code: failure });
  await vi.waitFor(() => expect(stageResponses.getSnapshot()[0]?.text).toContain('部分中文'));
  if (failure === 'cancelled') controller.abort();
  if (failure === 'stream_interrupted') stream.close();
  await rejected;
  const r = stageResponses.getSnapshot()[0]; expect(r.status).toBe('failed'); expect(r.nativeReasoning).toBe('公开思考');
  expect(r.text).not.toContain(key.slice(0, 8)); expect(r.normalized).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(r.diagnostics?.complete).toBe(false);
});

it.each(['variables', 'world'] as const)('%s real stage failure only saves existing failure metadata; viewing never writes state or candidate', async stage => {
  const a = fixture(), repo = await SaveRepository.open('observation-test', new IDBFactory());
  try {
    await repo.create(a.state);
    await repo.saveDraft(createTurnDraft(a.state.saveId, a.state.revision, a.draft.turnId, 'regular', ''), null);
    const draft = await repo.saveDraft(a.draft, 0);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: null, reasoning_content: '不进入草稿的公开思考' }, finish_reason: 'stop' }] }));
    const runner = stage === 'variables' ? new VariableStage(repo, new AiClient(fetcher)) : new WorldStage(repo, new AiClient(fetcher));
    await expect(runner.generate({ ...a, draft })).rejects.toMatchObject({ code: 'empty' });
    const stored = await repo.loadGame(a.state.saveId);
    expect(stored.state).toEqual(a.state); expect(stored.draft?.[stage]).toBeUndefined();
    expect(stored.draft?.failures.at(-1)).toMatchObject({ stage, errorCode: 'empty' });
    expect(JSON.stringify(stored)).not.toContain('公开思考');
    const r = selectStageResponse(stageResponses.getSnapshot(), draft.saveId, draft.turnId, stage, stored.draft);
    expect(r?.nativeReasoning).toBe('不进入草稿的公开思考');
    renderToStaticMarkup(<StageResponseContent record={r} label="阶段" />);
    expect(await repo.loadGame(a.state.saveId)).toEqual(stored); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { repo.close(); }
});

it('same turn newer requests keep their own basis; late old results cannot replace them; commit preserves and undo/switch clears', () => {
  const store = new StageResponseStore(), draft = worldDraft(false);
  const scope = { saveId: draft.saveId, turnId: draft.turnId, stage: 'variables' as const,
    baseSaveRevision: draft.baseSaveRevision, storyRevision: draft.storyRevision, stageRequestRevision: 0 };
  const old = store.begin(scope), current = store.begin({ ...scope, stageRequestRevision: 1 });
  store.update(current, { text: '新请求', status: 'failed' }, []);
  store.update(old, { text: '旧迟到结果', status: 'validated' }, []);
  const updated = { ...draft, stageRequestRevisions: { ...draft.stageRequestRevisions, variables: 1 } };
  expect(selectStageResponse(store.getSnapshot(), draft.saveId, draft.turnId, 'variables', updated)?.id).toBe(current);
  expect(selectStageResponse(store.getSnapshot(), draft.saveId, draft.turnId, 'variables', { ...updated, storyRevision: 2 })).toBeUndefined();
  expect(selectStageResponse(store.getSnapshot(), draft.saveId, draft.turnId, 'world', updated)).toBeUndefined();
  expect(selectStageResponse(store.getSnapshot(), draft.saveId, draft.turnId, 'variables', { ...updated, turnId: 'next-turn' })?.id).toBe(current);
  const epoch = store.generation(); store.clearSave(draft.saveId);
  store.update(old, { text: '清空后迟到' }, []); store.begin(scope, epoch);
  expect(store.getSnapshot()).toEqual([]);
});

it('bounded temporary records redact before clipping, mark truncation, evict six records and do not retain large diagnostics', () => {
  const store = new StageResponseStore(), id = store.begin({ saveId: 's', stage: 'variables' });
  store.update(id, { text: key + '长'.repeat(responseLimits.text), nativeReasoning: '思'.repeat(responseLimits.nativeReasoning + 1),
    diagnostics: { finishReasons: ['x'.repeat(responseLimits.diagnostics + 1)] } }, [key]);
  const r = store.getSnapshot()[0]; expect(r.text?.length).toBe(responseLimits.text); expect(r.nativeReasoning?.length).toBe(responseLimits.nativeReasoning);
  expect(r.truncated).toBe(true); expect(r.text).not.toContain(key); expect(r.diagnostics).toBeUndefined();
  for (let n = 0; n < 6; n++) store.begin({ saveId: 's', stage: 'world' });
  expect(store.getSnapshot()).toHaveLength(6); expect(store.getSnapshot().some(entry => entry.id === id)).toBe(false);
  store.clear(); expect(store.getSnapshot()).toEqual([]);
});

it('late JSON after cancellation cannot resurrect response text or append to the next attempt', async () => {
  const a = fixture(), controller = new AbortController();
  let finish!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { finish = resolve; }));
  const task = runStageRequest({ settings: a.settings, state: a.state, draft: a.draft, stage: 'variables', mode: 'regular', userInput: '' }, a.config, a.vault,
    { signal: controller.signal }, new AiClient(fetcher));
  const rejected = expect(task).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort(); await rejected;
  const old = stageResponses.getSnapshot()[0];
  await request({ choices: [{ message: { content: null, reasoning_content: '新思考' }, finish_reason: 'stop' }] });
  finish(Response.json({ choices: [{ message: { content: '旧迟到敏感文本', reasoning_content: '旧思考' }, finish_reason: 'stop' }] }));
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(stageResponses.getSnapshot()[0].nativeReasoning).toBe('新思考');
  expect(stageResponses.getSnapshot().find(record => record.id === old.id)).toEqual(old);
  expect(JSON.stringify(stageResponses.getSnapshot())).not.toContain('旧迟到敏感文本');
});
