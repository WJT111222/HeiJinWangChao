import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { StageResponseContent } from '../ui/game/StageResponsesPanel';
import { rawResponseObservation } from '../services/ai/responseContent';
import { StageResponseStore, stageResponses } from '../services/ai/stageResponses';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { StoryStage } from '../workflows/storyStage';
import type { StoryProgress } from '../workflows/storyStage';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

const body = '【旁白】小说正文，仅含实际故事。';
const project = '<thinking>项目实际规划</thinking>';
const tail = '</正文><短期记忆>本幕记忆</短期记忆><变量规划>[]</变量规划>';
const text = `<think>兼容实际文本</think>${project}<正文>${body}${tail}`;
const key = 'fictional-continuous-key';
const repos: SaveRepository[] = [], stages: StoryStage[] = [];
afterEach(() => { stages.splice(0).forEach(s => s.dispose()); repos.splice(0).forEach(r => r.close()); stageResponses.clear(); });
async function fixture(protocol: Protocol = 'openai') {
  const repo = await SaveRepository.open('raw-continuous', new IDBFactory()); repos.push(repo);
  const state = await repo.create(game()), draft = await repo.saveDraft(createTurnDraft(state.saveId, state.revision, 'raw-turn', 'opening', ''), null);
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  const channel = { ...newChannel(protocol), defaultModel: 'mock-raw' }, config = defaultAiConfig();
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
  const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, key);
  return { repo, state, draft, settings, config, vault };
}
function stage(repo: SaveRepository, fetcher: typeof fetch) { const result = new StoryStage(repo, new AiClient(fetcher)); stages.push(result); return result; }
const frame = (delta: Record<string, unknown>) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n';
const done = 'data: [DONE]\n\n';
function sse(wire: string) {
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream<Uint8Array>({ start(c) {
    for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

it('Story实际文本和独立公开思考只有一个只读原文文本框', () => {
  const html = renderToStaticMarkup(<StageResponseContent label="正文" record={{ id: 'raw', saveId: 's', stage: 'story',
    status: 'received', text: '<think>兼容文本</think><thinking>项目规划</thinking><正文>小说</正文>', nativeReasoning: '独立公开思考',
  }} />);
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
  expect(html).toContain('readOnly=""');
  expect(html).toContain('独立公开思考');
  expect(html).toContain('&lt;think&gt;兼容文本');
  expect(html).not.toContain('story-native-response');
  expect(html).not.toContain('供应商公开原生思考全文');
  expect(html).toContain('真实返回先后不可知');
});

it.each(['openai', 'deepseek'] as const)('%s实际SSE事件交错：保留到达顺序、全部标签和迟到思考，正式文本不变', async protocol => {
  const a = await fixture(protocol), progress: StoryProgress[] = [];
  const cut = text.indexOf('<正文>');
  const first = text.slice(0, 12), middle = text.slice(12, cut), last = text.slice(cut);
  const wire = frame({ reasoning_content: '原生甲' }) + frame({ content: first }) + frame({ reasoning_content: '原生乙' })
    + frame({ content: middle }) + frame({ content: last }) + frame({ reasoning_content: '迟到原生丙' }) + done;
  const fetcher = vi.fn<typeof fetch>(async () => sse(wire));
  const saved = await stage(a.repo, fetcher).generate({ ...a, onProgress: p => progress.push(p) });
  const record = stageResponses.getSnapshot()[0];
  expect(record).toMatchObject({ text, displayText: '原生甲' + first + '原生乙' + middle + last + '迟到原生丙', displayOrder: 'events' });
  expect(saved.story?.narrative).toBe(body); expect(await a.repo.load('save-a')).toEqual(a.state);
  expect(progress.some(p => p.planning === '项目实际规划')).toBe(true);
  const index = progress.findIndex(p => p.readingPhase === 'body'); expect(index).toBeGreaterThanOrEqual(0);
  expect(progress.slice(index).every(p => !p.planning && !p.nativeReasoning && !p.compatibilityReasoning)).toBe(true);
  expect(JSON.stringify(saved.story)).not.toContain('原生'); expect(fetcher).toHaveBeenCalledTimes(1);
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html.match(/<textarea\b/g)).toHaveLength(1); expect(html.split('原生甲')).toHaveLength(2);
});

it.each(['content-first', 'reasoning-first'] as const)('%s同一事件字段按实际响应排列，但不声称字段生成先后', async order => {
  const a = await fixture();
  const delta = order === 'content-first' ? { content: text, reasoning_content: '原生实际内容' } : { reasoning_content: '原生实际内容', content: text };
  await stage(a.repo, async () => sse(frame(delta) + done)).generate(a);
  const record = stageResponses.getSnapshot()[0];
  expect(record.displayText).toBe(order === 'content-first' ? text + '原生实际内容' : '原生实际内容' + text);
  expect(record.displayOrder).toBe('same-event');
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html).toContain('同一事件'); expect(html).toContain('不代表生成先后'); expect(html.match(/<textarea\b/g)).toHaveLength(1);
});

it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s完整JSON合并所有公开值但明确时序未知，不改变正式解析', async protocol => {
  const a = await fixture(protocol), raw = protocol === 'openai' || protocol === 'deepseek' ? text : text.replace('<think>兼容实际文本</think>', '');
  const data = protocol === 'openai' || protocol === 'deepseek'
    ? { choices: [{ message: { content: raw, reasoning_content: '公开思考' }, finish_reason: 'stop' }] }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: raw }, { thought: true, text: '公开思考' }] }, finishReason: 'STOP' }] }
    : { content: [{ type: 'text', text: raw }, { type: 'thinking', thinking: '公开思考' }], stop_reason: 'end_turn' };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(data));
  const saved = await stage(a.repo, fetcher).generate(a), record = stageResponses.getSnapshot()[0];
  expect(record).toMatchObject({ text: raw, displayText: raw + '公开思考', displayOrder: 'unknown' });
  expect(saved.story?.narrative).toBe(body); expect(fetcher).toHaveBeenCalledTimes(1);
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html).toContain('真实返回先后不可知'); expect(html.match(/<textarea\b/g)).toHaveLength(1);
});

it('Gemini同一事件的交错内容块按数组顺序显示，不把思考统一移到开头或结尾', () => {
  expect(rawResponseObservation({ candidates: [{ content: { parts: [
    { text: '正文甲' }, { thought: true, text: '思考乙' }, { text: '正文丙' }, { thought: true, text: '思考丁' }, { thoughtSignature: '不公开签名' },
  ] } }] }, 'gemini', true)).toEqual({ text: '正文甲思考乙正文丙思考丁', order: 'same-event' });
});

it('公开别名字段全部保留一次，不读取签名、凭证字段或隐藏块', () => {
  expect(rawResponseObservation({ choices: [{ delta: { reasoning_text: '甲', content: [{ type: 'text', text: '乙' }],
    reasoning_content: '丙', reasoning: '丁', authorization: '不公开凭证' } }] }, 'openai', true))
    .toEqual({ text: '甲乙丙丁', order: 'same-event' });
  expect(rawResponseObservation({ content: [{ type: 'thinking', thinking: '甲', signature: '不公开签名' },
    { type: 'redacted_thinking', data: '不公开隐藏思考' }, { type: 'text', text: '乙' }] }, 'anthropic'))
    .toEqual({ text: '甲乙', order: 'unknown' });
});

it.each(['content_block_start', 'content_block_delta'] as const)('Anthropic %s公开思考单事件不混入签名', type => {
  const start = type === 'content_block_start';
  expect(rawResponseObservation({ type, [start ? 'content_block' : 'delta']: { type: start ? 'thinking' : 'thinking_delta', thinking: '公开实际值', signature: '不公开签名' } }, 'anthropic', true))
    .toEqual({ text: '公开实际值', order: 'events' });
});

it('仅有独立公开思考的失败也有单一原文框，不能伪造正文或保存草稿', async () => {
  const a = await fixture(), before = await a.repo.loadGame('save-a');
  await expect(stage(a.repo, async () => sse(frame({ reasoning_content: '只有实际思考' }) + done)).generate(a)).rejects.toMatchObject({ code: 'empty' });
  const record = stageResponses.getSnapshot()[0];
  expect(record).toMatchObject({ status: 'failed', displayText: '只有实际思考' });
  const html = renderToStaticMarkup(<StageResponseContent record={record} label="正文" />);
  expect(html.match(/<textarea\b/g)).toHaveLength(1); expect(html).not.toContain('没有可恢复');
  expect(await a.repo.loadGame('save-a')).toEqual(before);
});

it.each(['cancel', 'network', 'invalid'] as const)('%s失败保留实际连续原文、脱敏且不产生正式或草稿写入', async mode => {
  const a = await fixture(), before = await a.repo.loadGame('save-a');
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    c.enqueue(new TextEncoder().encode(frame({ reasoning_content: '公开' + key.slice(0, 12) })));
  } }), { headers: { 'content-type': 'text/event-stream' } }));
  const runner = stage(a.repo, fetcher), pending = runner.generate(a);
  const rejected = expect(pending).rejects.toMatchObject({ code: mode === 'cancel' ? 'cancelled' : mode === 'network' ? 'stream_interrupted' : 'invalid_output' });
  await vi.waitFor(() => expect(stageResponses.getSnapshot()[0].displayText).toContain('公开'));
  expect(stageResponses.getSnapshot()[0].displayText).not.toContain(key.slice(0, 12));
  controller!.enqueue(new TextEncoder().encode(frame({ reasoning_content: key.slice(12) + '结束' }) + frame({ content: '<正文>缺少必需项目规划</正文>' })));
  if (mode === 'cancel') runner.cancel(); else if (mode === 'network') controller!.error(new TypeError('mock network'));
  else { controller!.enqueue(new TextEncoder().encode(done)); controller!.close(); }
  await rejected;
  const record = stageResponses.getSnapshot()[0]; expect(record.status).toBe('failed');
  expect(JSON.stringify(record)).not.toContain(key);
  expect(record.displayText).toContain('公开');
  expect(await a.repo.loadGame('save-a')).toEqual(before); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('连续显示值沿用内存容量、凭证脱敏和clear，不恢复已淘汰内容', () => {
  const store = new StageResponseStore(), id = store.begin({ saveId: 's', stage: 'story' });
  store.update(id, { displayText: key + '<think>实际值</think>', displayOrder: 'events' }, [key]);
  expect(store.getSnapshot()[0].displayText).not.toContain(key);
  for (let i = 0; i < 6; i++) store.begin({ saveId: 's', stage: 'story' });
  expect(store.getSnapshot()).toHaveLength(6); expect(store.getSnapshot().some(r => r.displayText)).toBe(false);
  store.clear(); expect(store.getSnapshot()).toEqual([]);
});

it('成功响应最后一个公开事件中的凭证前缀也保持脱敏，不影响真实正文', async () => {
  const a = await fixture();
  await stage(a.repo, async () => sse(frame({ content: text }) + frame({ reasoning_content: '实际末尾' + key.slice(0, 12) }) + done)).generate(a);
  const record = stageResponses.getSnapshot()[0]; expect(record.status).toBe('validated');
  expect(record.displayText).toContain(text); expect(record.displayText).toContain('实际末尾');
  expect(record.displayText).not.toContain(key.slice(0, 12));
  expect((await a.repo.loadDraft('save-a'))?.story?.narrative).toBe(body);
});

it.each(['variables', 'world'] as const)('%s原文显示保留原有pre，不受Story文本框迁移影响', stage => {
  const html = renderToStaticMarkup(<StageResponseContent label="候选" record={{ id: 'raw', saveId: 's', stage,
    status: 'received', text: '{"原始":"正式候选"}', nativeReasoning: '不会增加其他阶段分区',
  }} />);
  expect(html.match(/<pre\b/g)).toHaveLength(1); expect(html).not.toContain('<textarea'); expect(html).not.toContain('不会增加其他阶段分区');
});
