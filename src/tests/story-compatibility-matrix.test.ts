import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { channelSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { defaultUrls } from '../services/ai/configuration';
import { runStageRequest } from '../services/ai/runtime';
import { requestInspections } from '../services/ai/inspection';
import { stageResponses } from '../services/ai/stageResponses';
import { StorySchema } from '../domain/state';
import { createTurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { StoryStage } from '../workflows/storyStage';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { generateAndSettleTurn } from '../workflows/automaticTurn';
import { worldState, worldDraft, worldResult } from './fixtures/world';
import { variableReply } from './fixtures/variableReply';
import {
  compatibilityProtocols, compatibilitySetup, compatibilityResponse, requestModel, expectedMockUsage,
  shortNarrative, longNarrative, storyEnvelope, publicThought, privatePlan,
} from './fixtures/storyCompatibility';
import type { CompatibilityReply } from './fixtures/storyCompatibility';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const size = (value: unknown) => ({ characters: Array.from(JSON.stringify(value)).length, utf8Bytes: Buffer.byteLength(JSON.stringify(value)) });
const evidence: Record<string, unknown>[] = [];
const cells = compatibilityProtocols.flatMap(protocol => [false, true].flatMap(tool => [false, true].map(stream => ({ protocol, tool, stream }))));
afterEach(() => { vi.restoreAllMocks(); stageResponses.clear(); requestInspections.clear(); });
afterAll(async () => {
  if (process.env.HEIJIN_COMPAT_EVIDENCE) await writeFile(process.env.HEIJIN_COMPAT_EVIDENCE, JSON.stringify({
    reviewedHead: '5efb8c65f8cf14a7e2fa90173cf2b1e3304377a4', realModelCalls: 0, usageSource: 'synthetic fixture, not billed tokens', records: evidence,
  }, null, 2) + '\n');
});

describe('四协议 × 文本/单一工具 × JSON/SSE：同一正文的无损与usage', () => {
  it.each(cells)('$protocol / tool=$tool / stream=$stream', async cell => {
    for (const variant of ['normal', 'reasoning', 'long'] as const) {
      const narrative = variant === 'long' ? longNarrative : shortNarrative, text = storyEnvelope(narrative);
      const input = compatibilitySetup(cell.protocol, cell.tool, cell.stream), bodies: Record<string, unknown>[] = [];
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return compatibilityResponse({ ...cell, text, reasoning: variant === 'normal' ? '' : publicThought }); });
      const start = performance.now();
      const result = await runStageRequest({ stage: 'story', mode: 'opening', userInput: '在街边用餐并观察街道', state: worldState(), settings: input.settings }, input.config, input.vault, { stream: cell.stream }, new AiClient(fetcher));
      const story = StorySchema.parse(result.result), elapsedMs = performance.now() - start;
      expect(story.narrative).toBe(narrative); expect(story.summary).toBe('用餐结束，观察街道。'); expect(story.variableGuide).toEqual([]);
      expect(story.narrative).not.toContain(privatePlan); expect(story.narrative).not.toContain(publicThought);
      expect(result.storyInspection?.nativeReasoning ?? '').toBe(variant === 'normal' ? '' : publicThought);
      expect(fetcher).toHaveBeenCalledTimes(1); expect(Boolean(bodies[0].tools)).toBe(cell.tool);
      expect(result.usage).toEqual(expectedMockUsage(cell.protocol));
      const inspection = requestInspections.getSnapshot()[0];
      expect(inspection.status).toBe('received'); expect(inspection.statistics.actual).toMatchObject(expectedMockUsage(cell.protocol));
      expect(JSON.stringify(inspection)).not.toContain('fictional-phase3-key');
      const response = stageResponses.getSnapshot()[0]; expect(response.status).toBe('validated'); expect(response.text).toBe(cell.tool ? JSON.stringify({ content: text }) : text);
      evidence.push({ category: 'round-trip', ...cell, variant, narrativeCharacters: Array.from(narrative).length,
        narrativeSha256: hash(story.narrative), expectedSha256: hash(narrative), exactText: true, modelRequests: fetcher.mock.calls.length,
        inputPayload: size(bodies[0]), usage: result.usage, elapsedMs, usageSource: 'mock' });
    }
  });
});

it.each(compatibilityProtocols.flatMap(protocol => [false, true].map(tool => ({ protocol, tool }))))('$protocol / tool=$tool: 流式请求收到完整JSON仍是一次响应', async cell => {
  const input = compatibilitySetup(cell.protocol, cell.tool, true), text = storyEnvelope();
  const fetcher = vi.fn(async () => compatibilityResponse({ ...cell, stream: false, text, reasoning: publicThought }));
  const result = await runStageRequest({ stage: 'story', mode: 'opening', userInput: '', state: worldState(), settings: input.settings }, input.config, input.vault, { stream: true }, new AiClient(fetcher));
  expect(StorySchema.parse(result.result).narrative).toBe(shortNarrative); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.usage).toEqual(expectedMockUsage(cell.protocol));
  evidence.push({ category: 'stream-json', ...cell, modelRequests: 1, accepted: true });
});

it.each(compatibilityProtocols)('%s 官方/中转端点：工具声明增量，原消息、模型、预算和Thinking保持不变', protocol => {
  for (const official of [false, true]) {
    const input = compatibilitySetup(protocol, false, true);
    if (official) input.channel.baseUrl = defaultUrls[protocol];
    const snapshot = channelSnapshot(input.channel, input.vault), messages = [{ role: 'system' as const, content: '固定系统规则' }, { role: 'user' as const, content: '同一 Story 内容' }];
    const textWire = wireRequest(snapshot, messages, true), toolWire = wireRequest(snapshot, messages, true, true);
    const textBody = JSON.parse(String(textWire.init.body)), toolBody = JSON.parse(String(toolWire.init.body)), stripped = { ...toolBody };
    delete stripped.tools; delete stripped.tool_choice; delete stripped.toolConfig; delete stripped.parallel_tool_calls;
    expect(stripped).toEqual(textBody); expect(toolWire.url).toBe(textWire.url);
    if (protocol === 'anthropic') {
      expect(toolBody.tool_choice.type).toBe('auto'); expect(toolBody.thinking).toEqual(textBody.thinking);
      expect(Array.isArray(toolBody.system)).toBe(official);
    }
    const textSize = size(textBody), toolSize = size(toolBody), plainOutput = Buffer.byteLength(storyEnvelope()), toolOutput = Buffer.byteLength(JSON.stringify({ content: storyEnvelope() }));
    evidence.push({ category: 'wire-overhead', protocol, official, model: snapshot.model, text: textSize, tool: toolSize,
      extraInputCharacters: toolSize.characters - textSize.characters, extraInputUtf8Bytes: toolSize.utf8Bytes - textSize.utf8Bytes,
      plainOutputUtf8Bytes: plainOutput, toolArgumentUtf8Bytes: toolOutput, modelRequests: 0,
      interpretation: 'serialized sizes only; not tokenizer output, actual cache hits or billed usage' });
  }
});

describe('四协议异常经正式StoryStage拒绝；正式状态和草稿完全不变', () => {
  it.each(cells)('$protocol / tool=$tool / stream=$stream', async cell => {
    const repo = await SaveRepository.open('matrix-negative', new IDBFactory());
    try {
      await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a', 0, 'matrix-bad', 'opening', ''), null);
      const before = await repo.loadGame('save-a'), input = compatibilitySetup(cell.protocol, cell.tool, cell.stream);
      for (const kind of ['limit', 'filter', 'incomplete-transport', 'invalid-guide', 'http-rejected'] as const) {
        const options: CompatibilityReply = { ...cell, text: kind === 'limit' ? '<正文>【旁白】正文还未完成。' : kind === 'invalid-guide' ? storyEnvelope().replace('>[]</变量规划>', '>not-json</变量规划>') : storyEnvelope(),
          ending: kind === 'limit' ? 'limit' : kind === 'filter' ? 'filter' : kind === 'incomplete-transport' ? 'missing' : 'normal' };
        const fetcher = vi.fn(async () => kind === 'http-rejected' ? Response.json({ error: { message: 'synthetic unsupported response' } }, { status: 400 })
          : kind === 'incomplete-transport' && !cell.stream ? new Response('{', { headers: { 'Content-Type': 'application/json' } }) : compatibilityResponse(options));
        const stage = new StoryStage(repo, new AiClient(fetcher));
        try {
          const failure = await stage.generate({ ...input, draft: before.draft! }).then(() => undefined, error => error);
          expect(failure).toBeDefined();
          expect(failure.code).toBe(kind === 'limit' ? 'output_limit' : kind === 'filter' ? 'content_filter' : kind === 'http-rejected' ? 'rejected'
            : kind === 'invalid-guide' ? 'invalid_json' : !cell.stream ? 'invalid_json' : cell.tool ? 'tool_response' : 'stream_interrupted');
          if (kind === 'invalid-guide') expect(failure.details).toMatchObject({ storyRule: 'guide_json', storyTag: '变量规划' });
          expect(fetcher).toHaveBeenCalledTimes(1); expect(await repo.loadGame('save-a')).toEqual(before);
          expect(String(failure.message)).not.toContain(privatePlan);
          expect(stageResponses.getSnapshot()[0].status).toBe('failed');
          evidence.push({ category: 'strict-failure', ...cell, scenario: kind, code: failure.code, modelRequests: 1, formalAndDraftUnchanged: true });
        } finally { stage.dispose(); }
      }
    } finally { repo.close(); }
  });
});

it.each(compatibilityProtocols.flatMap(protocol => [false, true].map(stream => ({ protocol, stream }))))('$protocol / stream=$stream: 不遵循单工具约定时拒绝，不猜身份或回退', async cell => {
  const input = compatibilitySetup(cell.protocol, true, cell.stream);
  for (const kind of ['model-returned-text', 'multiple', 'badIdentity', 'badArguments'] as const) {
    const reply: CompatibilityReply = { ...cell, tool: kind !== 'model-returned-text', text: storyEnvelope(),
      multiple: kind === 'multiple', badIdentity: kind === 'badIdentity', badArguments: kind === 'badArguments' };
    const fetcher = vi.fn(async () => compatibilityResponse(reply));
    await expect(runStageRequest({ stage: 'story', mode: 'opening', userInput: '', state: worldState(), settings: input.settings }, input.config, input.vault, { stream: cell.stream }, new AiClient(fetcher))).rejects.toMatchObject({ code: 'tool_response' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    evidence.push({ category: 'single-carrier-policy', ...cell, scenario: kind, expectedRejected: true, modelRequests: 1 });
  }
});

it.each(compatibilityProtocols)('%s: 完整合法Story+length的文本/工具政策差异如实保留', async protocol => {
  for (const stream of [false, true]) for (const tool of [false, true]) {
    const input = compatibilitySetup(protocol, tool, stream), fetcher = vi.fn(async () => compatibilityResponse({ protocol, tool, stream, text: storyEnvelope(), ending: 'limit' }));
    const request = runStageRequest({ stage: 'story', mode: 'opening', userInput: '', state: worldState(), settings: input.settings }, input.config, input.vault, { stream }, new AiClient(fetcher));
    if (tool) await expect(request).rejects.toMatchObject({ code: 'output_limit' });
    else expect(StorySchema.parse((await request).result).narrative).toBe(shortNarrative);
    expect(fetcher).toHaveBeenCalledTimes(1);
    evidence.push({ category: 'complete-limit-policy', protocol, stream, tool, accepted: !tool, modelRequests: 1 });
  }
});

it.each(cells)('$protocol / tool=$tool / stream=$stream: Story→Variables→World→Commit整合与刷新恢复', async cell => {
  const factory = new IDBFactory(), repo = await SaveRepository.open('matrix-flow', factory), input = compatibilitySetup(cell.protocol, cell.tool, cell.stream);
  const bodies: { model: string; tool: boolean; stream: boolean }[] = [];
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)), model = requestModel(cell.protocol, String(url), body);
    bodies.push({ model, tool: Boolean(body.tools), stream: cell.protocol === 'gemini' ? String(url).includes('alt=sse') : body.stream === true });
    return compatibilityResponse({ protocol: cell.protocol, tool: model === input.channel.defaultModel && cell.tool, stream: model === input.channel.defaultModel && cell.stream,
      text: model === 'variables' ? variableReply(worldDraft().variables!.result) : model === 'world' ? JSON.stringify(worldResult()) : storyEnvelope(), reasoning: model === input.channel.defaultModel ? publicThought : '' });
  });
  const runner = new TurnCoordinator(repo, new AiClient(fetcher));
  try {
    await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a', 0, 'matrix-flow', 'opening', ''), null);
    const commit = vi.spyOn(repo, 'commitTurn');
    const result = await generateAndSettleTurn(runner, repo, { ...input, draft: (await repo.loadDraft('save-a'))! }, { check: () => undefined, onSettling: () => undefined });
    expect(result.committed?.state.turnNumber).toBe(1); expect(result.committed?.state.revision).toBe(1); expect(commit).toHaveBeenCalledTimes(1);
    expect(result.committed?.state.journal[0].story.narrative).toBe(shortNarrative); expect(result.committed?.state.memories.short).toHaveLength(1);
    expect(result.committed?.state.economy.cash).toBe(7000); expect(result.committed?.draft.userInput).toBe('');
    expect(bodies).toEqual([{ model: input.channel.defaultModel, tool: cell.tool, stream: cell.stream }, { model: 'variables', tool: false, stream: false }, { model: 'world', tool: false, stream: false }]);
    const saved = await repo.loadGame('save-a'), reopened = await SaveRepository.open('matrix-flow', factory);
    try { expect(await reopened.loadGame('save-a')).toEqual(saved); expect(fetcher).toHaveBeenCalledTimes(3); } finally { reopened.close(); }
    evidence.push({ category: 'atomic-workflow', ...cell, modelRequests: bodies.length, commits: commit.mock.calls.length, turnNumber: saved.state.turnNumber, revision: saved.state.revision, reloadExact: true });
  } finally { runner.dispose(); repo.close(); }
});

it.each(compatibilityProtocols)('%s: 错误工具载体不启动下游或Commit', async protocol => {
  const repo = await SaveRepository.open('matrix-bad-flow', new IDBFactory()), input = compatibilitySetup(protocol, true, true);
  const fetcher = vi.fn(async () => compatibilityResponse({ protocol, tool: true, stream: true, text: storyEnvelope(), badArguments: true }));
  const runner = new TurnCoordinator(repo, new AiClient(fetcher));
  try {
    await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a', 0, 'matrix-bad-flow', 'opening', ''), null);
    const state = await repo.load('save-a'), commit = vi.spyOn(repo, 'commitTurn');
    await expect(generateAndSettleTurn(runner, repo, { ...input, draft: (await repo.loadDraft('save-a'))! }, { check: () => undefined, onSettling: () => undefined })).rejects.toMatchObject({ code: 'tool_response' });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled(); expect(await repo.load('save-a')).toEqual(state);
    const draft = await repo.loadDraft('save-a'); expect(draft?.story).toBeUndefined(); expect(draft?.variables).toBeUndefined(); expect(draft?.world).toBeUndefined();
    evidence.push({ category: 'failed-workflow', protocol, modelRequests: 1, commits: 0, formalUnchanged: true });
  } finally { runner.dispose(); repo.close(); }
});
