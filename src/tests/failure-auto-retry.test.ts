import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { AiError, manualRetryOnly } from '../services/ai/errors';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { AiStage } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { createTurnDraft } from '../domain/drafts';
import { SaveRepository } from '../services/storage/saveRepository';
import { DataError } from '../domain/common';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { VariableStage } from '../workflows/variableStage';
import { reserveStageSession, withHeldStageLock } from '../workflows/stageGuard';
import {
  backoffMs, captureRunInputs, executeWithAutoRetry, extendedStageRetryable, planRetry, RETRY_AFTER_MAX_MS, retryDelays,
} from '../workflows/stageRetry';
import { worldDraft, worldNarrative, worldResult, worldState } from './fixtures/world';
import { variableReply } from './fixtures/variableReply';

const stages: AiStage[] = ['story', 'variables', 'world'];
function armed(max: 1 | 3 = 3) {
  const settings = defaultSettings();
  settings.runtime.failureAutoRetry = true;
  settings.runtime.maxAutoRetries = max;
  settings.prompts.minNarrativeChars = 5;
  settings.prompts.actionOptions = false;
  return settings;
}
function setup() {
  const config = defaultAiConfig(), channel = newChannel();
  channel.baseUrl = 'https://retry.mock.invalid/v1';
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'mock-turn-key');
  return { config, vault, settings: armed() };
}
function model(init?: RequestInit): AiStage {
  const body: unknown = JSON.parse(String(init?.body));
  if (!body || typeof body !== 'object' || !('model' in body) || !stages.includes(body.model as AiStage)) throw new Error('missing model');
  return body.model as AiStage;
}
function wire(stage: AiStage) {
  const text = stage === 'story'
    ? `<thinking>提纲</thinking><正文>${worldNarrative}</正文><短期记忆>用餐</短期记忆><变量规划>[]</变量规划>`
    : stage === 'variables' ? variableReply(worldDraft().variables!.result) : JSON.stringify(worldResult());
  return stage === 'story'
    ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    : Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}

describe('失败自动重试', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('旧设置没有这两个字段时默认关闭，次数档是 3', () => {
    const old = defaultSettings() as { runtime: Record<string, unknown> };
    delete old.runtime.failureAutoRetry;
    delete old.runtime.maxAutoRetries;
    const parsed = SettingsSchema.parse(old);
    expect(parsed.runtime.failureAutoRetry).toBe(false);
    expect(parsed.runtime.maxAutoRetries).toBe(3);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), runtime: { ...defaultSettings().runtime, maxAutoRetries: 5 } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), runtime: { ...defaultSettings().runtime, maxAutoRetries: 10 } }).success).toBe(false);
  });

  it('开启后生成失败都会重试，不限于 500；密钥、额度、取消和存档冲突不会', () => {
    for (const error of [
      new AiError('server', 501),
      new AiError('server', 500),
      new AiError('network'),
      new AiError('timeout'),
      new AiError('empty'),
      new AiError('rate_limit', 429),
      new AiError('invalid_json'),
      new AiError('variable_text_syntax'),
      new AiError('schema_fields'),
      new AiError('invalid_output'),
      new AiError('invalid_output', undefined, { storyRule: 'narrative_short' }),
      new AiError('content_filter'),
      new AiError('stream_interrupted'),
      new AiError('output_limit'),
    ]) expect(extendedStageRetryable(error)).toBe(true);
    for (const error of [
      new AiError('cancelled'),
      new AiError('authorization', 401),
      new AiError('credentials'),
      new AiError('configuration'),
      new AiError('not_found', 404),
      new AiError('rate_limit', 429, { quota: true }),
      new AiError('candidate_conflict'),
      new AiError('storage'),
      new AiError('data_integrity'),
      new AiError('permission'),
      new AiError('invalid_output', undefined, { storyRule: 'credential_output' }),
      new AiError('invalid_output', undefined, { storyRule: 'request_basis' }),
      new AiError('invalid_output', undefined, { storyRule: 'draft_conflict' }),
      new AiError('invalid_output', undefined, { worldRule: 'secret_in_output' }),
    ]) expect(extendedStageRetryable(error)).toBe(false);
    const marked = new AiError('server', 503);
    manualRetryOnly.add(marked);
    expect(extendedStageRetryable(marked)).toBe(false);
    expect(planRetry(new AiError('invalid_output'), defaultSettings(), 1).action).toBe('stop');
  });

  it('最多自动重试 3 次，退避从 3 秒递增到 30 秒；过长的 Retry-After 停下', () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([3_000, 6_000, 12_000, 24_000, 30_000]);
    const settings = armed(3);
    expect(planRetry(new AiError('empty'), settings, 1)).toMatchObject({ action: 'wait', ms: 3_000, retryIndex: 1, max: 3 });
    expect(planRetry(new AiError('empty'), settings, 3)).toMatchObject({ action: 'wait', retryIndex: 3 });
    expect(planRetry(new AiError('empty'), settings, 4)).toMatchObject({ action: 'stop', reason: 'budget' });
    expect(planRetry(new AiError('rate_limit', 429, { retryAfterMs: 8_000 }), settings, 1)).toMatchObject({ action: 'wait', ms: 8_000 });
    expect(planRetry(new AiError('rate_limit', 429, { retryAfterMs: RETRY_AFTER_MAX_MS + 1 }), settings, 1)).toMatchObject({ action: 'stop', reason: 'retry_after' });
    expect(planRetry(new AiError('server', 503), defaultSettings(), 1)).toMatchObject({ action: 'wait', ms: 0, max: 1 });
    expect(planRetry(new AiError('server', 503), defaultSettings(), 2)).toMatchObject({ action: 'stop', reason: 'budget' });
  });

  it('一次运行冻结渠道、密钥和设置；等待重试时不放开阶段会话', async () => {
    const { config, vault, settings } = setup();
    const captured = captureRunInputs({ settings, config, vault });
    const model = captured.config.channels[0].defaultModel;
    config.channels[0].defaultModel = 'changed-later';
    vault.set(config.channels[0].id, 'other-key');
    settings.runtime.maxAutoRetries = 1;
    expect(captured.config.channels[0].defaultModel).toBe(model);
    expect(config.channels[0].defaultModel).toBe('changed-later');
    expect(captured.vault.get(config.channels[0].id)).toBe('mock-turn-key');
    expect(captured.settings.runtime.maxAutoRetries).toBe(3);
    expect(SettingsSchema.safeParse(captured.settings).success).toBe(true);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const running = withHeldStageLock('retry-lock', async () => { await held; });
    try {
      expect(() => reserveStageSession('retry-lock')).toThrow(DataError);
    } finally {
      release();
    }
    await running;
    const session = reserveStageSession('retry-lock');
    session.release();
  });

  it('等待期间可以取消，成功前的每一次失败都会记下来', async () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const settings = armed(3);
    const controller = new AbortController();
    let calls = 0;
    const pending = executeWithAutoRetry({
      settings,
      signal: controller.signal,
      run: async () => {
        calls += 1;
        throw new AiError('empty');
      },
      onFailure: (error) => { failures.push(error instanceof AiError ? error.code : 'other'); },
      onRetry: (notice) => { if (notice.count === 1) controller.abort(); },
    });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    expect(calls).toBe(1);
    expect(failures).toEqual(['empty']);
  });

  it('连续生成失败后在第 3 次重试成功，只重跑失败阶段', async () => {
    const repo = await SaveRepository.open('retry-feature', new IDBFactory());
    await repo.create(worldState());
    const draft = createTurnDraft('save-a', 0, 'turn-a', 'opening', '');
    await repo.saveDraft(draft, null);
    retryDelays.scale = 0;
    const counts = { story: 0, variables: 0, world: 0 };
    const failures: string[] = [];
    const coordinator = new TurnCoordinator(repo, new AiClient(async (_url, init) => {
      const stage = model(init);
      counts[stage] += 1;
      if (stage === 'variables' && counts.variables < 4) return new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } });
      return wire(stage);
    }));
    try {
      const result = await coordinator.generate({
        ...setup(),
        draft,
        onAttemptFailure: (_stage, error) => { failures.push(error instanceof AiError ? error.code : 'other'); },
      });
      expect(result.status).toBe('complete');
      expect(counts).toEqual({ story: 1, variables: 4, world: 1 });
      expect(failures).toHaveLength(3);
      expect((await repo.load('save-a')).turnNumber).toBe(0);
    } finally {
      retryDelays.scale = 1;
      coordinator.dispose();
    }
  });

  it('独立变量阶段也会自动重试，密钥错误不会', async () => {
    const repo = await SaveRepository.open('retry-manual', new IDBFactory());
    await repo.create(worldState());
    const input = setup();
    const opener = new TurnCoordinator(repo, new AiClient(async (_url, init) => wire(model(init))));
    const draft = createTurnDraft('save-a', 0, 'turn-b', 'opening', '');
    await repo.saveDraft(draft, null);
    const opened = { ...input.settings, runtime: { ...input.settings.runtime, useWorldStage: false } };
    const started = await opener.generate({ ...input, draft, settings: opened });
    expect(started.draft.stageStatus.story).toBe('ready');
    let calls = 0;
    const stage = new VariableStage(repo, new AiClient(async () => {
      calls += 1;
      if (calls === 1) return new Response('', { status: 401 });
      return wire('variables');
    }));
    const controller = new AbortController();
    await expect(executeWithAutoRetry({
      settings: input.settings,
      signal: controller.signal,
      run: () => stage.generate({ ...input, draft: started.draft, settings: input.settings }),
      onFailure: () => {},
      onRetry: () => {},
    })).rejects.toMatchObject({ code: 'authorization' });
    expect(calls).toBe(1);
    retryDelays.scale = 0;
    calls = 0;
    const flaky = new VariableStage(repo, new AiClient(async () => {
      calls += 1;
      return calls < 3 ? new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }) : wire('variables');
    }));
    try {
      const saved = await executeWithAutoRetry({
        settings: input.settings,
        signal: controller.signal,
        run: async () => {
          const current = await repo.loadDraft('save-a');
          return flaky.generate({ ...input, draft: current!, settings: input.settings });
        },
        onFailure: () => {},
        onRetry: () => {},
      });
      expect(saved.variables?.validation).toBe('validated');
      expect(calls).toBe(3);
    } finally {
      retryDelays.scale = 1;
      opener.dispose();
    }
  });
});
