import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theaterLengths, maxTheaterBody } from '../domain/theater/record';
import { theaterInputTokens } from '../domain/theater/background';
import { contextStatistics } from '../prompts/statistics';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { backupSummary, parseBackup, serializeBackup } from '../services/storage/backup';
import { SaveRepository } from '../services/storage/saveRepository';
import type { OpenTheater } from '../services/storage/theaters';
import { defaultSettings } from '../ui/settings/model';
import { appendTheaterText, prepareTheater, runTheater, theaterMessages } from '../workflows/theater';
import type { TheaterAction } from '../workflows/theater';
import { event, game, gameTime, npc } from './fixtures/game';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';

const content = '晨雾散开。博物馆门口，灯亮了起来。';
const secret = 'sk-theater-fixture-not-real';
const openAi = (text: string, finish: string | null = 'stop') =>
  ({ choices: [{ message: { content: text, reasoning_content: '测试公开思考' }, finish_reason: finish }] });
const delta = (text: string) => ({ choices: [{ delta: { content: text } }] });
const sse = (...events: unknown[]) => new Response(events.map(value => value === '[DONE]'
  ? 'data: [DONE]\n\n' : 'data: ' + JSON.stringify(value) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
const allow = async <T,>(_key: string, run: () => Promise<T>) => run();

function channelSetup(protocol: Protocol = 'openai') {
  const kv = new Map<string, string>();
  const store = { getItem: (key: string) => kv.get(key) ?? null,
    setItem: (key: string, value: string) => { kv.set(key, value); }, removeItem: (key: string) => { kv.delete(key); } };
  const unused = { ...store, removeItem: () => undefined };
  const vault = new CredentialVault(store, unused);
  const channel = { ...newChannel(protocol), defaultModel: 'story-mock',
    parameters: { temperature: 0.35, maxOutputTokens: 32100 } };
  const config = defaultAiConfig();
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '' };
  vault.set(channel.id, secret);
  return { config, vault, channel };
}

let repo: SaveRepository;
let factory: IDBFactory;
beforeEach(async () => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  factory = new IDBFactory();
  repo = await SaveRepository.open('theater-test', factory);
  await repo.create(game());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); repo.close(); });

async function open(options: { protocol?: Protocol; target?: number; stream?: boolean; timeout?: number; independent?: boolean } = {}) {
  const credentials = channelSetup(options.protocol);
  const settings = defaultSettings();
  if (options.timeout !== undefined) settings.runtime.timeoutSeconds = options.timeout;
  const input = { title: '', theme: '博物馆的凌晨', target: options.target ?? 1500, perspective: 'third' as const,
    stream: options.stream ?? false, ...(options.independent ? { choice: { channelId: credentials.channel.id, model: 'independent-mock' } } : {}) };
  const project = await prepareTheater(input, settings, credentials.config, credentials.vault);
  return { ...credentials, opened: await repo.theaters.create('save-a', project, await repo.theaters.getOwner('save-a')) };
}

const run = (opened: OpenTheater, action: TheaterAction, creds: ReturnType<typeof channelSetup>, transport: typeof fetch,
  options: Partial<Parameters<typeof runTheater>[3]> = {}) => runTheater(repo.theaters, opened, action,
  { ...creds, signal: new AbortController().signal, lifetime: new AbortController().signal, ...options }, new AiClient(transport), allow);

async function saveBody(opened: OpenTheater, body = content) { return repo.theaters.saveText(opened, body, 'complete'); }

function pendingStream() {
  let output!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start: value => { output = value; }, cancel });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }), cancel,
    push(value: unknown) { output.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(value) + '\n\n')); },
    break() { output.error(new Error('mock disconnected')); },
  };
}

describe('小剧场生成', () => {
  it.each([...theaterLengths.map(tier => tier.target), 15001, 100000])('目标 %i 不覆盖模型输出预算，也不改变主线', async target => {
    const fixture = await open({ target, independent: true });
    const before = await repo.loadGame('save-a');
    const transport = respond(Response.json(openAi(content)));
    const result = await run(fixture.opened, 'initial', fixture, transport);
    expect(result).toMatchObject({ kind: 'saved', value: { record: { status: 'complete', body: content } } });
    expect(transport).toHaveBeenCalledTimes(1);
    const wire = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(wire.messages).toHaveLength(2);
    expect(wire.messages[1].content).toContain('"targetCharacters":' + target);
    expect(wire).toMatchObject({ model: 'independent-mock', max_completion_tokens: 32100, temperature: 0.35, stream: false });
    expect(wire).not.toHaveProperty('tools');
    expect(await repo.loadGame('save-a')).toEqual(before);
  });

  it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s JSON 和 SSE 使用正式协议，公开思考不保存', async protocol => {
    for (const stream of [false, true]) {
      const fixture = await open({ protocol, stream });
      const thoughts = vi.fn();
      const response = protocol === 'gemini' ? (stream
        ? sse({ candidates: [{ content: { parts: [{ text: '测试公开思考', thought: true }, { text: content }] }, finishReason: 'STOP' }] })
        : Response.json({ candidates: [{ content: { parts: [{ text: '测试公开思考', thought: true }, { text: content }] }, finishReason: 'STOP' }] }))
        : protocol === 'anthropic' ? (stream
          ? sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '测试公开思考' } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: content } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' })
          : Response.json({ content: [{ type: 'thinking', thinking: '测试公开思考' }, { type: 'text', text: content }], stop_reason: 'end_turn' }))
          : stream ? sse({ choices: [{ delta: { reasoning_content: '测试公开思考' } }] }, delta(content), '[DONE]')
            : Response.json(openAi(content));
      const transport = respond(response);
      const result = await run(fixture.opened, 'initial', fixture, transport, { onReasoning: thoughts });
      expect(result).toMatchObject({ kind: 'saved', value: { record: { body: content } } });
      expect(thoughts).toHaveBeenCalledWith('测试公开思考');
      expect(JSON.stringify(result)).not.toContain('测试公开思考');
      expect(transport).toHaveBeenCalledTimes(1);
      expect(String(transport.mock.calls[0][0])).toContain(protocol === 'gemini' ? (stream ? 'streamGenerateContent' : 'generateContent')
        : protocol === 'anthropic' ? '/messages' : '/chat/completions');
    }
  });

  it('Anthropic 的真实 message_stop 完成读取，连接无需先关闭', async () => {
    const fixture = await open({ protocol: 'anthropic', stream: true });
    const stream = pendingStream();
    stream.push({ type: 'content_block_delta', delta: { type: 'text_delta', text: content } });
    stream.push({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
    stream.push({ type: 'message_stop' });
    const transport = respond(stream.response);
    expect(await run(fixture.opened, 'initial', fixture, transport)).toMatchObject({
      kind: 'saved', value: { record: { body: content, status: 'complete' } },
    });
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('已完成正文可原子替换，原文在失败、缺结束、输出上限和写入失败时保留', async () => {
    const fixture = await open();
    const saved = await saveBody(fixture.opened);
    for (const [response, status] of [
      [Response.json(openAi('新版本尚未结束', 'length')), 'incomplete'],
      [Response.json(openAi('新版本没有结束原因', null)), 'incomplete'],
      [Response.json({ error: { message: '不要保存供应商错误' }, ...openAi('伪正文') }), 'failed'],
      [Response.json(openAi('')), 'failed'],
    ] as const) {
      const transport = respond(response);
      expect((await run(saved, 'reroll', fixture, transport)).kind).toBe(status);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(await repo.theaters.open('save-a', saved.record.id)).toEqual(saved);
    }
    const write = vi.spyOn(repo.theaters, 'saveText').mockRejectedValueOnce(new DOMException('mock', 'QuotaExceededError'));
    await expect(run(saved, 'reroll', fixture, respond(Response.json(openAi('新版本。'))))).rejects.toHaveProperty('name', 'QuotaExceededError');
    expect(await repo.theaters.open('save-a', saved.record.id)).toEqual(saved);
    write.mockRestore();
    const result = await run(saved, 'reroll', fixture, respond(Response.json(openAi('已完整写出新的版本。'))));
    expect(result).toMatchObject({ kind: 'saved', value: { record: { body: '已完整写出新的版本。', revision: 2 } } });
  });

  it.each(['stop', 'disconnect', 'leave', 'error', 'tool'] as const)('流式异常 %s 只处理已有效接收的正文', async kind => {
    const fixture = await open({ stream: true });
    const signal = new AbortController(), lifetime = new AbortController();
    const stream = pendingStream();
    const transport = respond(stream.response);
    const live = vi.fn<(text: string) => void>();
    const running = run(fixture.opened, 'initial', fixture, transport, { signal: signal.signal, lifetime: lifetime.signal, onText: live });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    stream.push(delta(content));
    await vi.waitFor(() => expect(live).toHaveBeenCalledWith(content));
    if (kind === 'stop') signal.abort();
    if (kind === 'leave') lifetime.abort();
    if (kind === 'disconnect') stream.break();
    if (kind === 'error') stream.push({ error: { code: 'rejected' } });
    if (kind === 'tool') stream.push({ choices: [{ delta: { tool_calls: [{ index: 0 }] } }] });
    const result = await running;
    if (kind === 'stop' || kind === 'disconnect') {
      expect(result).toMatchObject({ kind: 'incomplete', status: kind === 'stop' ? 'stopped' : 'partial', body: content });
    } else expect(result.kind).toBe('failed');
    expect((await repo.theaters.open('save-a', fixture.opened.record.id)).record.body).toBe('');
    if (kind === 'stop' || kind === 'leave') expect(stream.cancel).toHaveBeenCalledTimes(1);
  });

  it('真实请求超时产生可选择保留的增量，无自动续发', async () => {
    const fixture = await open({ stream: true, timeout: 1 });
    const stream = pendingStream(), transport = respond(stream.response);
    const live = vi.fn();
    const running = run(fixture.opened, 'initial', fixture, transport, { onText: live });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    stream.push(delta(content));
    await vi.waitFor(() => expect(live).toHaveBeenCalledWith(content));
    expect(await running).toMatchObject({ kind: 'incomplete', status: 'partial', body: content });
    expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('续写保留前文，限制上下文且只去除可确定的边界重叠', async () => {
    const fixture = await open();
    const boundary = '当时廊下只有被雨水打湿的脚步和展览厅外的旧铜灯。';
    const body = '最早的人物设定。' + '中间段。'.repeat(9_000) + boundary;
    const saved = await saveBody(fixture.opened, body);
    const messages = theaterMessages(saved.record, 'continue');
    expect(messages[1].content).toContain('最早的人物设定');
    expect(messages[1].content).toContain(boundary);
    expect(messages[1].content).not.toContain('中间段。'.repeat(3_000));
    expect(contextStatistics(messages).estimatedTokens).toBeLessThanOrEqual(theaterInputTokens);
    expect(appendTheaterText(body, boundary + '他推门进去。')).toBe(body + '\n\n他推门进去。');
    const result = await run(saved, 'continue', fixture, respond(Response.json(openAi(boundary + '他推门进去。'))));
    expect(result).toMatchObject({ kind: 'saved', value: { record: { body: body + '\n\n他推门进去。' } } });
  });

  it('渠道失效不会改投模型，凭证不能写入小说或备份', async () => {
    const fixture = await open();
    const transport = respond(Response.json(openAi(secret)));
    const changed = { ...fixture, config: { ...fixture.config, channels: [{ ...fixture.channel, baseUrl: 'https://changed.invalid/v1' }] } };
    await expect(run(fixture.opened, 'initial', changed, transport)).rejects.toMatchObject({ code: 'THEATER_ROUTE' });
    expect(transport).not.toHaveBeenCalled();
    await expect(run(fixture.opened, 'initial', fixture, transport)).rejects.toMatchObject({ code: 'THEATER_PRIVATE' });
    expect(transport).toHaveBeenCalledTimes(1);
    const backup = await serializeBackup(await repo.exportBackup(['save-a']), 'test');
    expect(backup).not.toContain(secret);
    expect(backup).not.toContain(fixture.channel.baseUrl);
  });
});

describe('小剧场存储和主线结算', () => {
  it('上下文只含正式事实和公开材料，正式结算与撤回不改变已有快照', async () => {
    const imported = game('save-other');
    imported.npc['npc-a'] = { ...npc(), name: '博物馆同事', knownInformation: [{ text: '未公开的私密认知', source: '来信', learnedAt: gameTime }] };
    imported.events['event-a'] = { ...event(), title: '未公开的秘密事件' };
    const credentials = channelSetup();
    await repo.importBackup({ state: imported }, (await repo.compareBackup({ state: imported })).confirmation);
    const project = await prepareTheater({ title: '测试', theme: '博物馆同事', stream: false, target: 1500, perspective: 'follow' },
      defaultSettings(), credentials.config, credentials.vault);
    const projected = project(imported);
    expect(projected.background.context).toContain('博物馆同事');
    expect(projected.background.context).not.toMatch(/未公开|identity-npc/);
    const fixture = await open();
    const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '主角走进博物馆。', 60) });
    const result = await repo.commitTurn(submission(draft));
    const later = project(result.state);
    expect(later.background.turn).toBe(1);
    expect(later.background.time).toBe(result.state.worldClock);
    const history = await repo.history.create('save-a', '剧场与主线独立的恢复点');
    const secondDraft = await completeDraft(repo, { variables: await elapsedVariables(repo, '博物馆闭馆。', 60) });
    await repo.commitTurn(submission(secondDraft));
    const status = await repo.undoStatus('save-a');
    expect(status.available).toBe(1);
    const committed = await repo.loadGame('save-a');
    const undone = await repo.undoTurn({ saveId: 'save-a', expectedRevision: committed.state.revision, expectedDraft: committed.draft,
      operationId: 'theater-test-undo' });
    expect(undone.state.turnNumber).toBe(1);
    const selector = { kind: 'manual' as const, id: history.id };
    const preview = await repo.history.preview('save-a', selector);
    const restored = await repo.history.restore(preview.confirmation, '从收藏继续', true, true);
    expect(restored.state.turnNumber).toBe(1);
    const exported = await repo.history.exportNode('save-a', selector, 'test');
    expect(JSON.parse(exported.text).version).toBe(1);
    const backup = await parseBackup(exported.text);
    expect(backup.entries[0]).not.toHaveProperty('theaters');
    const episode = await repo.theaters.open('save-a', fixture.opened.record.id);
    expect(episode.record).toEqual(fixture.opened.record);
    expect(episode.owner.instance).not.toBe(fixture.opened.owner.instance);
  });

  it('批量列表按页读取，v2 往返，旧版恢复和相同标题不同 ID 不互相覆盖', async () => {
    const fixture = await open();
    const saved = await saveBody(fixture.opened, '长正文。'.repeat(8000));
    for (let i = 0; i < 23; i++) await repo.theaters.fork(saved, 'fork-' + i, '另存片段。', 'stopped');
    const first = await repo.theaters.list('save-a');
    const second = await repo.theaters.list('save-a', first.next);
    expect(first.items).toHaveLength(20); expect(first.next).toBeDefined();
    expect(second.items).toHaveLength(4); expect(second.next).toBeUndefined();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(24);
    expect(first.items.every(item => !('body' in item))).toBe(true);
    const other = await repo.create(game('save-b'));
    expect((await repo.theaters.list(other.saveId)).items).toEqual([]);
    const [entry] = await repo.exportBackup(['save-a']);
    const backup = await parseBackup(await serializeBackup([entry], 'test'));
    expect(backup.checksum).toBe('valid');
    expect(backup.entries[0]).toMatchObject({ ok: true, theaters: entry.theaters });
    const legacy = await parseBackup(JSON.stringify({ format: 'heijin-backup', version: 1,
      saves: [{ summary: backupSummary(entry.state), state: entry.state }] }));
    const old = legacy.entries[0];
    if (!old.ok) throw new Error('旧版备份无法解析');
    expect(old.theaters).toBeUndefined();
    await repo.importBackup(old, (await repo.compareBackup(old)).confirmation, { overwrite: true });
    expect((await repo.theaters.list('save-a')).items).toHaveLength(20);
    await expect(repo.theaters.saveText(saved, content, 'complete')).rejects.toMatchObject({ code: 'THEATER_OWNER' });
    const current = await repo.loadGame('save-a');
    await repo.delete('save-a', current.state.revision, current.instance ?? null);
    await expect(repo.theaters.open('save-a', saved.record.id)).rejects.toMatchObject({ code: 'THEATER_OWNER' });
    await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    repo.close();
    repo = await SaveRepository.open('theater-test', factory);
    expect((await repo.theaters.open('save-a', saved.record.id)).record).toEqual(saved.record);
    expect((await repo.theaters.list(other.saveId)).items).toEqual([]);
  });

  it('删除、写入和导入确认互不覆盖，单条容量超限不改原正文', async () => {
    const fixture = await open();
    const saved = await saveBody(fixture.opened);
    const [backup] = await repo.exportBackup(['save-a']);
    const overwrite = { ...backup, theaters: [] };
    const { confirmation } = await repo.compareBackup(overwrite);
    const renamed = await repo.theaters.rename(saved, '换过的标题');
    await expect(repo.importBackup(overwrite, confirmation, { overwrite: true })).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
    await expect(repo.theaters.saveText(renamed, '字'.repeat(maxTheaterBody + 1), 'complete')).rejects.toThrow();
    expect(await repo.theaters.open('save-a', renamed.record.id)).toEqual(renamed);
    let finishMock!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finishMock = resolve; });
    const transport = vi.fn<typeof fetch>().mockReturnValue(pending);
    const late = run(renamed, 'reroll', fixture, transport);
    const discarded = expect(late).rejects.toMatchObject({ code: 'THEATER_MISSING' });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    await repo.theaters.delete(renamed);
    finishMock(Response.json(openAi('迟到的响应')));
    await discarded;
    expect((await repo.theaters.list('save-a')).items).toEqual([]);
  });
});
