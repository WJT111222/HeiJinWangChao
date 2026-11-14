import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { StoryStream } from '../workflows/storyStream';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import type { StoryProgress } from '../workflows/storyStage';
import { StoryStreamReading } from '../ui/game/StoryStreamReading';
import { StageResponseContent } from '../ui/game/StageResponsesPanel';
import { AiClient } from '../services/ai/client';
import { requestSnapshot } from '../services/ai/snapshot';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { stageResponses, safeStreamResponseText, StageResponseStore } from '../services/ai/stageResponses';
import { storyInspections } from '../services/ai/storyInspection';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { parseStoryEnvelope } from '../services/validation/aiOutputs';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

const body = '【旁白】雨落在站台，主角看着驶来的公交车。';
const planning = '项目规划标记：保持本幕连续。';
const native = '供应商公开思考标记';
const compatibility = '兼容公开文本标记：沿着站台核对现场。';
const tail = '<短期记忆>主角等车。</短期记忆><变量规划>[]</变量规划>';
const output = (p = planning) => `<thinking>${p}</thinking><正文>${body}</正文>${tail}`;
const secret = 'stream-test-api-secret';
const repos: SaveRepository[] = [], stages: StoryStage[] = [];
afterEach(() => {
  stages.splice(0).forEach(s => s.dispose()); repos.splice(0).forEach(r => r.close());
  stageResponses.clear(); storyInspections.clear(); vi.restoreAllMocks();
});
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
function packets(protocol: Protocol, text: string, reasoning = '') {
  const isChat = protocol === 'openai' || protocol === 'deepseek';
  const content = (s: string) => isChat ? { choices: [{ delta: { content: s } }] }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: s }] } }] }
    : { type: 'content_block_delta', delta: { type: 'text_delta', text: s } };
  const thought = isChat ? { choices: [{ delta: { reasoning_content: reasoning } }] }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ thought: true, text: reasoning }] } }] }
    : { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: reasoning } };
  return (reasoning ? frame(thought) : '') + Array.from(text).map(c => frame(content(c))).join('')
    + (isChat ? 'data: [DONE]\n\n' : protocol === 'gemini'
      ? frame({ candidates: [{ finishReason: 'STOP' }] }) : frame({ type: 'message_stop' }));
}
function sse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
async function fixture(protocol: Protocol = 'openai', disableStages = false) {
  const repo = await SaveRepository.open('story-stream-ui', new IDBFactory()); repos.push(repo);
  const state = await repo.create(game());
  const draft = await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'stream-turn', 'opening', '', !disableStages, !disableStages), null);
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const channel = { ...newChannel(protocol), defaultModel: 'mock-stream' }, config = defaultAiConfig();
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, secret);
  return { repo, state, draft, settings, config, vault };
}
function runner(repo: SaveRepository, transport: typeof fetch) {
  const s = new StoryStage(repo, new AiClient(transport)); stages.push(s); return s;
}

it('任意标签切点、空规划仍不合法，但直接正文通过正式校验', () => {
  for (const text of [output(), output(''), `<正文>${body}</正文>${tail}`]) {
    for (let i = 0; i <= text.length; i++) {
      const stream = new StoryStream(); stream.push(text.slice(0, i));
      expect(stream.push(text.slice(i))).toBe(body); expect(stream.bodyStarted).toBe(true);
      expect(stream.push('迟到的内部内容')).toBe(body);
    }
  }
  const stream = new StoryStream();
  stream.push('<thinking>实际规划</thinking><正'); expect(stream.bodyStarted).toBe(false);
  expect(stream.planning).toBe('实际规划'); stream.push('文>'); expect(stream.bodyStarted).toBe(true);
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  expect(() => parseStoryEnvelope(output(''), 'opening', settings)).toThrow();
  expect(parseStoryEnvelope(`<正文>${body}</正文>${tail}`, 'opening', settings)).toMatchObject({ planning: '', story: { narrative: body } });
  expect(parseStoryEnvelope(output(), 'opening', settings).story.narrative).toBe(body);
});

it.each([
  ['仅项目规划', output(), '', true], ['仅公开原生思考', `<正文>${body}</正文>${tail}`, native, true],
  ['两种思考', output(), native, true], ['空规划且无公开思考', output(''), '', false],
  ['没有任何思考', `<正文>${body}</正文>${tail}`, '', true],
] as const)('%s：收到正文开标签才清空思考，不改变最终成功/失败', async (_name, text, reasoning, valid) => {
  const a = await fixture(), progress: StoryProgress[] = [], before = await a.repo.loadGame('save-a');
  const transport = vi.fn<typeof fetch>(async () => sse(packets('openai', text, reasoning)));
  const generated = runner(a.repo, transport).generate({ ...a, onProgress: p => progress.push(p) });
  if (valid) await expect(generated).resolves.toHaveProperty('story.narrative', body);
  else await expect(generated).rejects.toMatchObject({ code: 'invalid_output' });
  const bodyIndex = progress.findIndex(p => p.readingPhase === 'body'); expect(bodyIndex).toBeGreaterThanOrEqual(0);
  expect(progress.slice(bodyIndex).every(p => !p.planning && !p.nativeReasoning)).toBe(true);
  expect(progress.at(-1)?.narrative).toBe(body);
  const raw = stageResponses.getSnapshot()[0];
  expect(raw).toMatchObject({ text, nativeReasoning: reasoning, status: valid ? 'validated' : 'failed' });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await a.repo.load('save-a')).toEqual(before.state);
  if (!valid) expect(await a.repo.loadGame('save-a')).toEqual(before);
  else expect(JSON.stringify((await a.repo.loadDraft('save-a'))?.story)).not.toContain(planning);
});

it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s真实SSE/中文单字节分块：公开原生字段和完整原文各保留一份', async protocol => {
  const a = await fixture(protocol), progress: StoryProgress[] = [];
  const rawText = '\n' + output() + '\n';
  const transport = vi.fn<typeof fetch>(async () => sse(packets(protocol, rawText, native)));
  await runner(a.repo, transport).generate({ ...a, onProgress: p => progress.push(p) });
  expect(progress.some(p => p.nativeReasoning === native && p.readingPhase === 'thinking')).toBe(true);
  expect(progress.some(p => p.planning === planning && p.readingPhase === 'thinking')).toBe(true);
  const record = stageResponses.getSnapshot()[0];
  expect(record).toMatchObject({ text: rawText, nativeReasoning: native, protocol });
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html.split(planning)).toHaveLength(2); expect(html.split(native)).toHaveLength(2);
  expect(html).toContain('&lt;thinking&gt;'); expect(html).toContain('&lt;变量规划&gt;');
  expect(record.displayText).toBe(native + rawText);
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
  expect(html).not.toContain('story-native-response'); expect(transport).toHaveBeenCalledTimes(1);
});

it('兼容层提取前的 think 标签仍属于完整文本，不伪装成独立供应商字段或复制项目规划', async () => {
  const a = await fixture(), raw = '<think>兼容文本思考</think>\n' + output();
  const progress: StoryProgress[] = [];
  await runner(a.repo, async () => sse(packets('openai', raw))).generate({ ...a, onProgress: p => progress.push(p) });
  expect(progress.some(p => p.readingPhase === 'thinking' && p.compatibilityReasoning === '兼容文本思考')).toBe(true);
  const bodyIndex = progress.findIndex(p => p.readingPhase === 'body');
  expect(bodyIndex).toBeGreaterThanOrEqual(0);
  expect(progress.slice(bodyIndex).every(p => !p.compatibilityReasoning && !p.planning && !p.nativeReasoning)).toBe(true);
  expect(progress.every(p => !p.nativeReasoning)).toBe(true);
  const record = stageResponses.getSnapshot()[0]; expect(record.text).toBe(raw);
  expect(record.nativeReasoning).toBe('');
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html).toContain('&lt;think&gt;兼容文本思考'); expect(html).not.toContain('story-native-response');
  expect(html.split(planning)).toHaveLength(2);
});

it.each(['openai', 'deepseek'] as const)('%s兼容 think 任意切点及UTF-8单字节：只报告一次确认来源的增量', async protocol => {
  const a = await fixture(protocol), raw = `<think>${compatibility}</think>` + output();
  const snapshot = requestSnapshot(a.config, 'story', a.vault);
  for (let cut = 0; cut <= raw.length; cut++) {
    const chunks = [raw.slice(0, cut), raw.slice(cut)];
    const wire = chunks.map(content => frame({ choices: [{ delta: { content } }] })).join('') + 'data: [DONE]\n\n';
    const fetcher = vi.fn<typeof fetch>(async () => sse(wire));
    let compatText = '', rawText = '', received = '', legacy = '', nativeText = '';
    const response = await new AiClient(fetcher).generate(snapshot, [{ role: 'user', content: '隔离流式显示测试' }], { stream: true,
      onCompatibilityReasoningDelta: delta => { compatText += delta; },
      onRawTextDelta: delta => { rawText += delta; },
      onNativeReasoningDelta: delta => { nativeText += delta; },
      onReasoningDelta: delta => { legacy += delta; },
      onDelta: delta => { received += delta; },
    });
    expect(compatText).toBe(compatibility); expect(legacy).toBe(compatibility); expect(nativeText).toBe('');
    expect(rawText).toBe(raw); expect(received).toBe(output()); expect(response.text).toBe(output());
    expect(parseStoryEnvelope(response.text, 'opening', a.settings).story.narrative).toBe(body);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it.each(['only-think', 'direct-body'] as const)('%s兼容思考可见；只有无正文的输出不能写入存档', async mode => {
  const a = await fixture(), before = await a.repo.loadGame('save-a'), progress: StoryProgress[] = [];
  const raw = `<think>${compatibility}</think>` + (mode === 'direct-body' ? `<正文>${body}</正文>${tail}` : '');
  const fetcher = vi.fn<typeof fetch>(async () => sse(packets('deepseek', raw)));
  const request = runner(a.repo, fetcher).generate({ ...a, onProgress: p => progress.push(p) });
  if (mode === 'only-think') await expect(request).rejects.toMatchObject({ code: 'empty' });
  else await expect(request).resolves.toHaveProperty('story.narrative', body);
  expect(progress.some(p => p.readingPhase === 'thinking' && p.compatibilityReasoning === compatibility)).toBe(true);
  expect(progress.every(p => !p.nativeReasoning && !p.planning)).toBe(true);
  if (mode === 'direct-body') {
    const index = progress.findIndex(p => p.readingPhase === 'body'); expect(index).toBeGreaterThanOrEqual(0);
    expect(progress.slice(index).every(p => !p.compatibilityReasoning)).toBe(true);
  }
  expect(stageResponses.getSnapshot()[0]).toMatchObject({ text: raw, nativeReasoning: '', status: mode === 'only-think' ? 'failed' : 'validated' });
  expect(await a.repo.load('save-a')).toEqual(before.state);
  if (mode === 'only-think') expect(await a.repo.loadGame('save-a')).toEqual(before);
  else expect((await a.repo.loadDraft('save-a'))?.story?.narrative).toBe(body);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  ['native-first', false], ['native-last', false], ['native-first', true], ['native-last', true],
] as const)('%s同次响应两类公开来源（相同=%s）：独立去重且正文开始三类思考同时清空', async (order, duplicate) => {
  const a = await fixture(), progress: StoryProgress[] = [], before = await a.repo.load('save-a');
  const raw = `<think>${compatibility}</think>` + output(), nativeText = duplicate ? compatibility : native;
  const nativeFrame = frame({ choices: [{ delta: { reasoning_content: nativeText } }] });
  const lead = Array.from(`<think>${compatibility}</think>`).map(content => frame({ choices: [{ delta: { content } }] })).join('');
  const wire = (order === 'native-first' ? nativeFrame + lead : lead + nativeFrame) + packets('openai', output());
  const fetcher = vi.fn<typeof fetch>(async () => sse(wire));
  await runner(a.repo, fetcher).generate({ ...a, onProgress: p => progress.push(p) });
  const complete = progress.find(p => p.readingPhase === 'thinking' && p.planning === planning
    && p.nativeReasoning === nativeText && p.compatibilityReasoning === compatibility);
  expect(complete).toBeDefined();
  const html = renderToStaticMarkup(<StoryStreamReading progress={complete!} />);
  expect(html).toContain('aria-label="供应商公开思考"'); expect(html).toContain('aria-label="项目 thinking 内容"');
  expect(html.split(compatibility)).toHaveLength(2);
  if (duplicate) expect(html).not.toContain('aria-label="兼容文本思考"');
  else expect(html).toContain('aria-label="兼容文本思考"');
  const index = progress.findIndex(p => p.readingPhase === 'body'); expect(index).toBeGreaterThanOrEqual(0);
  expect(progress.slice(index).every(p => !p.compatibilityReasoning && !p.planning && !p.nativeReasoning)).toBe(true);
  const record = stageResponses.getSnapshot()[0]; expect(record).toMatchObject({ text: raw, nativeReasoning: nativeText });
  expect(renderToStaticMarkup(<StageResponseContent record={record} label="正文" />).split('&lt;think&gt;')).toHaveLength(2);
  expect(await a.repo.load('save-a')).toEqual(before);
  const saved = JSON.stringify((await a.repo.loadDraft('save-a'))?.story);
  expect(saved).not.toContain(compatibility); expect(saved).not.toContain(nativeText); expect(saved).not.toContain(planning);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('完整JSON回退中的兼容文本和独立原生字段仍分源，不复制到正文', async () => {
  const a = await fixture(), progress: StoryProgress[] = [], raw = `<think>${compatibility}</think>` + output();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{
    message: { content: raw, reasoning_content: native }, finish_reason: 'stop',
  }] }));
  await runner(a.repo, fetcher).generate({ ...a, onProgress: p => progress.push(p) });
  expect(progress.some(p => p.readingPhase === 'thinking' && p.compatibilityReasoning === compatibility && p.nativeReasoning === native)).toBe(true);
  expect(progress.at(-1)).toMatchObject({ phase: 'saving', narrative: body });
  expect(stageResponses.getSnapshot()[0]).toMatchObject({ text: raw, nativeReasoning: native });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('兼容思考取消时保护分块凭证，不写草稿且不重复请求', async () => {
  const a = await fixture(), before = await a.repo.loadGame('save-a'), progress: StoryProgress[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    c.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: '<think>' + compatibility + ' ' + secret.slice(0, 10) } }] })));
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  const stage = runner(a.repo, fetcher), pending = stage.generate({ ...a, onProgress: p => progress.push(p) });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(progress.at(-1)?.compatibilityReasoning).toContain(compatibility));
  expect(progress.at(-1)?.compatibilityReasoning).not.toContain(secret.slice(0, 10));
  controller!.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: secret.slice(10) + ' 末尾' } }] })));
  await vi.waitFor(() => expect(progress.at(-1)?.compatibilityReasoning).toContain('末尾'));
  expect(JSON.stringify(progress)).not.toContain(secret); stage.cancel(); await rejected;
  expect(stageResponses.getSnapshot()[0].text).toContain('<think>');
  expect(JSON.stringify(stageResponses.getSnapshot())).not.toContain(secret);
  expect(await a.repo.loadGame('save-a')).toEqual(before); expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['stop', 'length'] as const)('完整JSON回退在最终%s检查前保留真实原文和独立原生字段', async finish => {
  const a = await fixture();
  const transport = vi.fn<typeof fetch>(async () => Response.json({ choices: [{
    message: { content: output(), reasoning_content: native }, finish_reason: finish,
  }] }));
  const pending = runner(a.repo, transport).generate(a);
  if (finish === 'stop') await pending; else await expect(pending).rejects.toMatchObject({ code: 'output_limit' });
  expect(stageResponses.getSnapshot()[0]).toMatchObject({ text: output(), nativeReasoning: native });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('思考阶段组件按实际内容显示，正文开始立即移除全部思考节点', () => {
  const thought = renderToStaticMarkup(<StoryStreamReading progress={{ phase: 'generating', narrative: '', readingPhase: 'thinking', planning, nativeReasoning: native, compatibilityReasoning: compatibility }} />);
  expect(thought).toContain(planning); expect(thought).toContain(native); expect(thought).toContain(compatibility);
  const novel = renderToStaticMarkup(<StoryStreamReading progress={{ phase: 'generating', narrative: '', readingPhase: 'body', planning, nativeReasoning: native, compatibilityReasoning: compatibility }} />);
  expect(novel).not.toContain(planning); expect(novel).not.toContain(native); expect(novel).not.toContain(compatibility); expect(novel).toContain('stream-narrative');
  const waiting = renderToStaticMarkup(<StoryStreamReading progress={{ phase: 'generating', narrative: '' }} />);
  expect(waiting).not.toContain('项目 &lt;thinking&gt;'); expect(waiting).not.toContain('供应商公开思考');
});

it('临时原文/公开字段统一脱敏，清除及六条容量仍适用，不恢复旧请求原生思考', () => {
  const store = new StageResponseStore();
  const id = store.begin({ saveId: 's', turnId: 't', stage: 'story', protocol: 'openai' });
  store.update(id, { text: `raw ${secret}`, nativeReasoning: `native ${secret}` }, [secret]);
  expect(JSON.stringify(store.getSnapshot())).not.toContain(secret);
  for (let n = 0; n < 6; n++) store.begin({ saveId: 's', turnId: `t${n}`, stage: 'story' });
  expect(store.getSnapshot()).toHaveLength(6); expect(store.getSnapshot().some(r => r.nativeReasoning)).toBe(false);
  store.clear(); expect(store.getSnapshot()).toEqual([]);
  for (let n = 1; n < secret.length; n++) expect(safeStreamResponseText('普通文本 ' + secret.slice(0, n), [secret])).not.toContain(' ' + secret.slice(0, n));
});

it.each(['cancel', 'network', 'timeout'] as const)('%s保留已收到的临时思考和原文，正式状态/草稿完全不变且不重发', async mode => {
  const a = await fixture(), before = await a.repo.loadGame('save-a');
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const transport = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    streamController = controller;
    controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { reasoning_content: native } }] })
      + frame({ choices: [{ delta: { content: '<thinking>已返回规划' } }] })));
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  a.settings.runtime.timeoutSeconds = 1;
  const stage = runner(a.repo, transport), seen: StoryProgress[] = [];
  const promise = stage.generate({ ...a, onProgress: p => seen.push(p) });
  const rejected = expect(promise).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'timeout' ? 'timeout' : 'stream_interrupted' });
  await vi.waitFor(() => expect(seen.some(p => p.planning === '已返回规划')).toBe(true));
  if (mode === 'cancel') stage.cancel();
  if (mode === 'network') streamController!.error(new TypeError('mock network failure'));
  await rejected;
  expect(stageResponses.getSnapshot()[0]).toMatchObject({ status: 'failed', text: '<thinking>已返回规划', nativeReasoning: native });
  expect(await a.repo.loadGame('save-a')).toEqual(before); expect(transport).toHaveBeenCalledTimes(1);
});

it('自动工作流完整转发思考/正文阶段，只生成同一次Story，不执行被关闭的后续阶段', async () => {
  const a = await fixture('openai', true);
  const activeDraft = a.draft;
  a.settings.runtime.useVariableStage = false; a.settings.runtime.useWorldStage = false;
  const fetcher = vi.fn<typeof fetch>(async () => sse(packets('openai', `<think>${compatibility}</think>` + output(), native)));
  const coordinator = new TurnCoordinator(a.repo, new AiClient(fetcher));
  const progress: Array<{ readingPhase?: string; nativeReasoning?: string; compatibilityReasoning?: string; planning?: string }> = [];
  try {
    await coordinator.generate({ ...a, draft: activeDraft, onProgress: p => progress.push(p) });
    expect(progress.some(p => p.readingPhase === 'thinking' && p.nativeReasoning === native)).toBe(true);
    expect(progress.some(p => p.readingPhase === 'thinking' && p.planning === planning)).toBe(true);
    expect(progress.some(p => p.readingPhase === 'thinking' && p.compatibilityReasoning === compatibility)).toBe(true);
    const index = progress.findIndex(p => p.readingPhase === 'body');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(progress.slice(index).every(p => !p.nativeReasoning && !p.planning && !p.compatibilityReasoning)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await a.repo.load('save-a')).toEqual(a.state);
  } finally { coordinator.dispose(); }
});

it('正文开始后迟到的公开原生思考只进入原文视图，不回流到阅读区', async () => {
  const a = await fixture(), progress: StoryProgress[] = [];
  const text = frame({ choices: [{ delta: { reasoning_content: native } }] })
    + frame({ choices: [{ delta: { content: `<thinking>${planning}</thinking><正文>` } }] })
    + frame({ choices: [{ delta: { reasoning_content: '迟到原生片段' } }] })
    + frame({ choices: [{ delta: { content: body + '</正文>' + tail } }] }) + 'data: [DONE]\n\n';
  await runner(a.repo, async () => sse(text)).generate({ ...a, onProgress: p => progress.push(p) });
  const index = progress.findIndex(p => p.readingPhase === 'body');
  expect(progress.slice(index).every(p => !p.nativeReasoning && !p.planning)).toBe(true);
  expect(stageResponses.getSnapshot()[0].nativeReasoning).toBe(native + '迟到原生片段');
});
