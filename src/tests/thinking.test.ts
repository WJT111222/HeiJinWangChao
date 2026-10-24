import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { composePrompt } from '../prompts/composer';
import { selectPromptModules } from '../prompts/selection';
import { promptManifest } from '../prompts/manifest';
import { readPromptResource } from '../prompts/loader';
import { contextFor } from '../prompts/context';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig, AiConfigSchema } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { requestInspections } from '../services/ai/inspection';
import { storyBudget, storyInspections } from '../services/ai/storyInspection';
import { parseStory, parseStoryEnvelope, parseVariables } from '../services/validation/aiOutputs';
import { StoryStream } from '../workflows/storyStream';
import { StoryStage } from '../workflows/storyStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft } from '../domain/drafts';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { game } from './fixtures/game';

const protocols = ['openai', 'gemini', 'anthropic'] as const;
const planning = '创作提纲：保持眼前场景，人物各有目的，秘密规划标记不属于正文事实。';
const native = '服务商公开摘要标记';
const narrative = '【旁白】主角在街边喝水。';
const output = (body = narrative, plan = planning) => `<thinking>${plan}</thinking><正文>${body}</正文><短期记忆>在街边喝水。</短期记忆><变量规划>[]</变量规划>`;
function setup(protocol: Protocol = 'openai') {
  const channel = { ...newChannel(protocol), defaultModel: 'any-model' }, config = defaultAiConfig();
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'p6-test-credential');
  const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  return { channel, config, vault, settings };
}
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
function stream(data: string) {
  const bytes = new TextEncoder().encode(data); let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset));
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function response(protocol: Protocol, text: string, reasoning = native) {
  return protocol === 'openai' ? { choices: [{ message: { content: text, reasoning_content: reasoning }, finish_reason: 'stop' }] }
    : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: reasoning, thought: true }, { text }] }, finishReason: 'STOP' }] }
      : { content: [{ type: 'thinking', thinking: reasoning }, { type: 'redacted_thinking', data: '不可读取' }, { type: 'text', text }], stop_reason: 'end_turn' };
}
function frames(protocol: Protocol, text = output()) {
  if (protocol === 'openai') return frame({ choices: [{ delta: { reasoning_content: native } }] })
    + frame({ choices: [{ delta: { content: text.slice(0, 17) } }] })
    + frame({ choices: [{ delta: { reasoning: '后续公开摘要', content: text.slice(17) }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
  if (protocol === 'gemini') return frame({ candidates: [{ content: { parts: [{ thought: true, text: native }, { text: text.slice(0, 17) }] } }] })
    + frame({ candidates: [{ content: { parts: [{ text: text.slice(17) }, { thought: true, text: '后续公开摘要' }] }, finishReason: 'STOP' }],
      usageMetadata: { thoughtsTokenCount: 9, candidatesTokenCount: 11, totalTokenCount: 30 } });
  return frame({ type: 'content_block_start', content_block: { type: 'thinking', thinking: native } })
    + frame({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '后续公开摘要' } })
    + frame({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: '不可读取' } })
    + frame({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + frame({ type: 'message_stop' });
}
const repositories: SaveRepository[] = [];
const runners: StoryStage[] = [];
afterEach(() => { runners.splice(0).forEach((runner) => runner.dispose()); repositories.splice(0).forEach((repo) => repo.close());
  storyInspections.clear(); requestInspections.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('P6 原创资源与兼容历史', () => {
  it.each(['opening', 'regular'] as const)('%s规划只按当前模式注册一次，审定全文/步骤完整', async (mode) => {
    const text = await readPromptResource(`planning.${mode}`), module = promptManifest.modules.find((item) => item.id === `planning.${mode}`)!;
    expect((text.match(/^### Step \d+｜/gm) ?? [])).toHaveLength(mode === 'opening' ? 9 : 15);
    expect((text.match(/^[123]\. /gm) ?? [])).toHaveLength(mode === 'opening' ? 27 : 45);
    expect(createHash('sha256').update(readFileSync(`prompts/planning/${mode}.md`)).digest('hex')).toBe(module.contentSha256);
    const prompt = await composePrompt({ stage: 'story', mode, state: game(), settings: defaultSettings(), userInput: '' });
    expect(prompt.modules.filter((item) => item.id.startsWith('planning.')).map((item) => item.id)).toEqual([`planning.${mode}`]);
    expect(prompt.messages).toContainEqual({ role: 'system', content: text });
    expect(prompt.modules.slice(0, 3).map((item) => item.id)).toEqual(promptManifest.ordering.lockedPrefix);
    expect(prompt.modules.find((item) => item.id === `planning.${mode}`)?.order).toBe(350);
  });
  it.each(['variables', 'world', 'memory'] as const)('%s不会注入任何完整规划或确认历史', (stage) => {
    const modules = selectPromptModules({ stage, mode: 'opening', settings: defaultSettings(), domains: ['npc_ordinary'],
      memoryTask: 'memory.npc_summarize', cotAllowed: true });
    expect(modules.some((item) => item.id.startsWith('planning.') || item.id === 'compatibility.cot_format_ack')).toBe(false);
  });
  it('开局四原型仅作启发，旧强制灾难取消，七项写作设置不扩张', async () => {
    const text = await readPromptResource('stages.opening.story');
    expect(text).not.toContain('开局灾难必须'); expect(text).toContain('不强制四选一'); expect(text).toContain('不强制灾难');
    for (const item of ['命运崩塌', '人生牢笼', '壮志受阻', '异才觉醒']) expect(text).toContain(item);
    expect(Object.keys(SettingsSchema.parse(defaultSettings()).prompts)).toHaveLength(7);
  });
  it.each(protocols)('%s通用历史无模型白名单，以user收尾，无未经确认的原生参数/Prefix', async (protocol) => {
    const a = setup(protocol), snapshot = requestSnapshot(a.config, 'story', a.vault);
    expect(a.channel.compatibility.cotModels).toEqual([]); expect(snapshot.useCot).toBe(true);
    const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: game(), settings: a.settings, userInput: '喝水', cotAllowed: snapshot.useCot });
    expect(prompt.messages.slice(-3).map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(prompt.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    const wire = wireRequest(snapshot, prompt.messages, true), body = JSON.parse(wire.init.body);
    expect(body.messages?.at(-1)?.role ?? body.contents?.at(-1)?.role).toBe('user');
    for (const parameter of ['thinking', 'reasoning_effort', 'disable_thinking', 'prefix']) expect(wire.init.body).not.toContain(`"${parameter}":`);
    expect(a.channel.parameters.maxOutputTokens).toBe(4096);
  });
  it('旧off/名单配置继续读取，Prefix不发送扩展也不重试，不关闭项目规划', async () => {
    const a = setup(); a.channel.compatibility.cotMode = 'off'; a.channel.compatibility.cotModels = ['old-id'];
    expect(AiConfigSchema.parse(a.config).channels[0].compatibility.cotModels).toEqual(['old-id']);
    const snapshot = requestSnapshot(a.config, 'story', a.vault);
    const prompt = await composePrompt({ stage: 'story', mode: 'regular', state: game(), settings: a.settings, userInput: '', cotAllowed: snapshot.useCot });
    expect(prompt.modules.some((item) => item.id === 'compatibility.cot_format_ack')).toBe(false);
    expect(prompt.modules.some((item) => item.id === 'planning.regular')).toBe(true);
    a.channel.compatibility.cotMode = 'prefix';
    expect(requestSnapshot(a.config, 'story', a.vault).diagnostics).toContain('COT_PREFIX_FALLBACK_COMPLETE_HISTORY');
  });
});

describe('供应商实际公开的原生内容', () => {
  it.each(protocols)('%s非流式公开字段独立接收，缺失也成功', async (protocol) => {
    const a = setup(protocol), snapshot = requestSnapshot(a.config, 'story', a.vault);
    const present = await new AiClient(async () => Response.json(response(protocol, output()))).generate(snapshot, [{ role: 'user', content: '生成' }]);
    expect(present.text).toBe(output()); expect(present.nativeReasoning).toBe(native); expect(present.text).not.toContain('不可读取');
    const absent = await new AiClient(async () => Response.json(response(protocol, output(), ''))).generate(snapshot, [{ role: 'user', content: '生成' }]);
    expect(absent.text).toBe(output()); expect(absent.nativeReasoning).toBeUndefined();
  });
  it.each(['reasoning_content', 'reasoning', 'reasoning_text'])('OpenAI-compatible %s别名非流式和流式都不混入content', async (field) => {
    const a = setup(), snapshot = requestSnapshot(a.config, 'story', a.vault);
    const first = await new AiClient(async () => Response.json({ choices: [{ message: { content: '文本', [field]: native }, finish_reason: 'stop' }] }))
      .generate(snapshot, [{ role: 'user', content: '生成' }]);
    expect(first).toMatchObject({ text: '文本', nativeReasoning: native });
    const onDelta = vi.fn(), onReasoningDelta = vi.fn();
    const second = await new AiClient(async () => stream(frame({ choices: [{ delta: { content: '文本', [field]: native } }] }) + 'data: [DONE]\n\n'))
      .generate(snapshot, [{ role: 'user', content: '生成' }], { stream: true, onDelta, onReasoningDelta });
    expect(second).toMatchObject({ text: '文本', nativeReasoning: native });
    expect(onDelta).toHaveBeenCalledWith('文本'); expect(onReasoningDelta).toHaveBeenCalledWith(native);
  });
  it.each(protocols)('%s交替流/字节拆分，不丢正文，思考增量报告有效活动', async (protocol) => {
    const a = setup(protocol), onActivity = vi.fn(), onDelta = vi.fn(), onReasoningDelta = vi.fn();
    const result = await new AiClient(async () => stream(frames(protocol))).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }],
      { stream: true, onDelta, onReasoningDelta, onActivity });
    expect(result.text).toBe(output()); expect(result.nativeReasoning).toBe(native + '后续公开摘要');
    expect(onDelta.mock.calls.map(([text]) => text).join('')).toBe(output());
    expect(onActivity).toHaveBeenCalledWith('reasoning'); expect(onActivity).toHaveBeenCalledWith('content');
    if (protocol === 'gemini') expect(result.usage).toMatchObject({ outputTokens: 11, reasoningTokens: 9, totalTokens: 30 });
  });
  it.each(protocols)('%s未知参数拒绝不偷偷重发，错误详情不泄露', async (protocol) => {
    const a = setup(protocol), transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('unsupported thinking p6-test-credential', { status: 400 }));
    await expect(new AiClient(transport).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }])).rejects.toMatchObject({ code: 'rejected' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(protocols)('%s长度终止明确诊断，不能视为有效正文', async (protocol) => {
    const a = setup(protocol), data = protocol === 'openai' ? { choices: [{ message: { content: output() }, finish_reason: 'length' }] }
      : protocol === 'gemini' ? { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: output() }] } }] }
        : { content: [{ type: 'text', text: output() }], stop_reason: 'max_tokens' };
    await expect(new AiClient(async () => Response.json(data)).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }])).rejects.toMatchObject({ code: 'output_limit' });
  });
  it.each(protocols)('%s流式长度截断保留供应商usage但不返回候选', async (protocol) => {
    const a = setup(protocol), value = protocol === 'openai'
      ? { choices: [{ delta: { content: output() }, finish_reason: 'length' }], usage: { completion_tokens: 99 } }
      : protocol === 'gemini' ? { candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { candidatesTokenCount: 99 } }
        : { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 99 } };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(stream(frame(value)));
    await expect(new AiClient(transport).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }], { stream: true })).rejects.toMatchObject({ code: 'output_limit' });
    expect(requestInspections.getSnapshot()[0]).toMatchObject({ status: 'failed', errorCode: 'output_limit', statistics: { actual: { outputTokens: 99 } } });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('Anthropic首个text块正文不会因为同时存在thinking/signature而丢失', async () => {
    const a = setup('anthropic');
    const wire = frame({ type: 'content_block_start', content_block: { type: 'text', text: '前段' } })
      + frame({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: native } })
      + frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: '后段' } }) + frame({ type: 'message_stop' });
    const result = await new AiClient(async () => stream(wire)).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }], { stream: true });
    expect(result).toMatchObject({ text: '前段后段', nativeReasoning: native });
  });
  it('持续返回原生内容时即使没有正文也报告活动，不触发虚构的正文闲置超时', async () => {
    vi.useFakeTimers(); const a = setup(), activity = vi.fn(), encoder = new TextEncoder();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
      setTimeout(() => controller.enqueue(encoder.encode(frame({ choices: [{ delta: { reasoning_content: native } }] }))), 1000);
      setTimeout(() => { controller.enqueue(encoder.encode(frame({ choices: [{ delta: { content: output() } }] }) + 'data: [DONE]\n\n')); controller.close(); }, 2500);
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const pending = new AiClient(transport).generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }], { stream: true, timeoutSeconds: 4, onActivity: activity });
    await vi.advanceTimersByTimeAsync(1500); expect(activity).toHaveBeenCalledWith('reasoning');
    await vi.advanceTimersByTimeAsync(1500); expect((await pending).text).toBe(output()); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('只有原生内容没有正文时失败，不伪造叙事；硬超时不会因活动无限延长', async () => {
    const a = setup(), snapshot = requestSnapshot(a.config, 'story', a.vault);
    await expect(new AiClient(async () => stream(frame({ choices: [{ delta: { reasoning_content: native } }] }) + 'data: [DONE]\n\n'))
      .generate(snapshot, [{ role: 'user', content: '生成' }], { stream: true })).rejects.toMatchObject({ code: 'empty' });
    vi.useFakeTimers(); const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>(() => {}));
    const pending = new AiClient(transport).generate(snapshot, [{ role: 'user', content: '生成' }], { timeoutSeconds: 1 });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' }); await vi.advanceTimersByTimeAsync(1001); await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('结构隔离、流式与事务', () => {
  it('规划仅作为创作资料返回，Story不增加字段，字数只统计正文', () => {
    const a = setup(), parsed = parseStoryEnvelope(output(), 'opening', a.settings);
    expect(parsed.planning).toBe(planning); expect(parsed.story).toEqual({ turnKind: 'opening', narrative, summary: '在街边喝水。', variableGuide: [] });
    a.settings.prompts.minNarrativeChars = 100;
    expect(() => parseStory(output('短', '详'.repeat(500)), 'regular', a.settings)).toThrow();
  });
  it.each([
    output().replace(/<thinking>[\s\S]*?<\/thinking>/, ''),
    output().replace('</thinking>', ''),
    `<thinking>重复</thinking>${output()}`,
    output().replace(planning, '<thinking>嵌套</thinking>'),
    output().replace(narrative, '<thinking>伪装</thinking>'),
    output().replace(narrative, '<think>伪装</think>'),
    output().replace(narrative, '<judge>判定</judge>'),
    '<thinking>只有规划</thinking>',
    output().replace('</变量规划>', ''),
    output().replace(planning, ''),
  ])('缺失/重复/嵌套/截断输出不得保存（%#）', (text) => {
    expect(() => parseStory(text, 'regular', setup().settings)).toThrow();
  });
  it('所有增量切点只展示正文，规划标签拆分也不泄漏；规划内容不是叙事质量门槛', () => {
    const text = output();
    for (let split = 0; split <= text.length; split++) {
      const reader = new StoryStream(), preview = reader.push(text.slice(0, split));
      expect(narrative.startsWith(preview)).toBe(true); expect(reader.push(text.slice(split))).toBe(narrative); expect(reader.planning).toBe(planning);
    }
    const reader = new StoryStream(); for (const character of text) expect(narrative.startsWith(reader.push(character))).toBe(true);
    expect(reader.push('迟到正文')).toBe(narrative);
    expect(parseStory(output(narrative, '简短创作提纲'), 'regular', setup().settings).narrative).toBe(narrative);
  });
  it.each(protocols)('%s真实StoryStage保存只含Story，下游与正式状态无原生/规划标记', async (protocol) => {
    const a = setup(protocol), state = game(), repo = await SaveRepository.open('p6-' + protocol, new IDBFactory()); repositories.push(repo); await repo.create(state);
    const draft = createTurnDraft(state.saveId, 0, 'p6-turn', 'opening', '喝水'); await repo.saveDraft(draft, null);
    const stage = new StoryStage(repo, new AiClient(async () => stream(frames(protocol)))); runners.push(stage);
    const saved = await stage.generate({ ...a, draft });
    expect(JSON.stringify(saved)).not.toContain('秘密规划标记'); expect(JSON.stringify(saved)).not.toContain(native);
    expect(await repo.load(state.saveId)).toEqual(state);
    expect(storyInspections.getSnapshot()[0]).toMatchObject({ status: 'saved', planning, nativeReasoning: native + '后续公开摘要' });
    for (const next of ['variables', 'world'] as const) {
      const context = contextFor({ stage: next, mode: 'opening', state, draft: saved, settings: a.settings, userInput: '' });
      expect(JSON.stringify(context)).not.toContain('秘密规划标记'); expect(JSON.stringify(context)).not.toContain(native);
    }
    expect(() => parseVariables(JSON.stringify({ commands: [{ type: 'SetWorldClock', commandId: 'from-plan', worldClock: '2026-10-18T08:02:00+08:00', evidence: planning }], rejectedSuggestions: [], unresolved: [] }), state, saved)).toThrow();
    expect(JSON.stringify(requestInspections.getSnapshot())).not.toContain(native);
  });
  it('失败Roll保留旧正文，临时资料脱敏；旧草稿无thinking照常恢复', async () => {
    const a = setup(), state = game(), repo = await SaveRepository.open('p6-rollback', new IDBFactory()); repositories.push(repo); await repo.create(state);
    const draft = createTurnDraft(state.saveId, 0, 'p6-turn', 'opening', '喝水'); await repo.saveDraft(draft, null);
    const stage = new StoryStage(repo, new AiClient(async () => stream(frames('openai')))); runners.push(stage); const saved = await stage.generate({ ...a, draft });
    const broken = new StoryStage(repo, new AiClient(async () => stream(frames('openai', output(narrative, 'p6-test-credential').replace('</变量规划>', ''))))); runners.push(broken);
    await expect(broken.generate({ ...a, draft: saved })).rejects.toMatchObject({ code: 'invalid_output' });
    expect(await repo.loadDraft(state.saveId)).toEqual(saved); expect(await repo.load(state.saveId)).toEqual(state);
    expect(JSON.stringify(storyInspections.getSnapshot())).not.toContain('p6-test-credential');
    expect(storyInspections.getSnapshot()[0].status).toBe('failed'); storyInspections.clear(); expect(storyInspections.getSnapshot()).toEqual([]);
  });
  it('预算只诊断不改上限，无自动付费请求；按原生用量另存思考Token而不伪造', async () => {
    expect(storyBudget(4096, 1500, 'regular').warning).toBeDefined(); expect(storyBudget(undefined, 1500, 'regular').warning).toBeDefined();
    expect(storyBudget(20000, 1500, 'regular').warning).toBeUndefined();
    const a = setup(), result = await new AiClient(async () => Response.json({ ...response('openai', output()),
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 7 } } }))
      .generate(requestSnapshot(a.config, 'story', a.vault), [{ role: 'user', content: '生成' }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 7 }); expect(a.channel.parameters.maxOutputTokens).toBe(4096);
  });
});
