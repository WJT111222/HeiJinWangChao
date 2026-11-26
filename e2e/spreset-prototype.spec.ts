import { createHash } from 'node:crypto';
import { estimateTokens } from '../src/prompts/statistics';
import { expect, test } from './helpers/test';

const narrative = '林舟在博物馆核对蓝釉瓷杯。';
const envelope = '<正文>' + narrative + '</正文><短期记忆>核对瓷杯。</短期记忆><变量规划>[]</变量规划>';
const content = '<think>合成兼容文本</think>' + envelope;
type Protocol = 'openai' | 'deepseek' | 'anthropic' | 'gemini';

function reply(protocol: Protocol, stream: boolean) {
  const args = { content }, fn = { name: 'submit_scene', arguments: JSON.stringify(args) };
  let json: unknown, events: unknown[];
  if (protocol === 'anthropic') {
    const tool = { id: 'fixture-tool', type: 'tool_use', name: fn.name, input: args };
    json = { type: 'message', content: [tool], stop_reason: 'tool_use' };
    events = [{ type: 'message_start', message: { role: 'assistant', content: [] } },
      { type: 'content_block_start', index: 0, content_block: { ...tool, input: {} } },
      ...[fn.arguments.slice(0, 8), fn.arguments.slice(8)].map(partial_json => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })),
      { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' }];
  } else if (protocol === 'gemini') {
    json = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: fn.name, args } }] }, finishReason: 'STOP' }] };
    events = [json];
  } else {
    const tool = { id: 'fixture-tool', type: 'function', function: fn };
    json = { choices: [{ message: { role: 'assistant', tool_calls: [tool] }, finish_reason: 'tool_calls' }] };
    events = [{ choices: [{ delta: { tool_calls: [{ ...tool, index: 0, function: { name: fn.name, arguments: fn.arguments.slice(0, 8) } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fn.arguments.slice(8) } }] }, finish_reason: 'tool_calls' }] }];
  }
  return stream ? { contentType: 'text/event-stream', body: events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')
    + (protocol === 'openai' || protocol === 'deepseek' ? 'data: [DONE]\n\n' : '') } : { json };
}

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) test(protocol + (stream ? ' SSE' : ' JSON') + ' 正式正文及结算', async ({ page }, info) => {
    const wires: string[] = [], external: string[] = [], replies: Buffer[] = [];
    let workers = 0;
    page.on('worker', worker => { if (worker.url().startsWith('blob:null/')) workers++; });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'spreset.mock.invalid' && route.request().method() === 'POST') {
        wires.push(route.request().postData()!);
        const fixture = reply(protocol, stream);
        const bytes = Buffer.from(fixture.body ?? JSON.stringify(fixture.json), 'utf8');
        replies.push(bytes);
        return route.fulfill({ contentType: stream ? 'text/event-stream' : 'application/json', body: bytes });
      }
      if (url.hostname === '127.0.0.1' && route.request().method() === 'POST') {
        external.push(url.pathname); return route.abort();
      }
      if (url.hostname === '127.0.0.1' || url.protocol === 'blob:') return route.continue();
      external.push(url.origin);
      return route.abort();
    });
    await page.goto('/?spreset=prototype');
    const incoming = page.waitForResponse(response => new URL(response.url()).hostname === 'spreset.mock.invalid');
    const result = await page.evaluate(async ({ protocol, stream }) => {
      const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts',
        '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
      const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }, { StoryStage }, { newChannel, defaultAiConfig }, { CredentialVault }] =
        await Promise.all(paths.map(path => import(path)));
      const input = talentPromptInput('story', 'regular');
      Object.assign(input.settings.runtime, { streamStory: stream, useVariableStage: false, useWorldStage: false });
      input.userInput = '我在博物馆核对蓝釉瓷杯。';
      const draft = createTurnDraft(input.state.saveId, input.state.revision, 'spreset-story', 'regular', input.userInput, false, false);
      const repo = await SaveRepository.open(), stage = new StoryStage(repo);
      try {
        const backup = { state: input.state, draft };
        await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
        const config = defaultAiConfig(), channel = newChannel(protocol);
        channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'c2-synthetic';
        channel.parameters.temperature = 0.42; channel.parameters.maxOutputTokens = 4321;
        config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
        const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'c2-fixture-credential');
        const before = await repo.load(draft.saveId);
        await stage.generate({ draft: await repo.loadDraft(draft.saveId), settings: input.settings, config, vault });
        const saved = await repo.loadDraft(draft.saveId);
        const afterCandidate = (await repo.load(draft.saveId)).revision;
        const committed = await repo.commitTurn({ draft: saved, nextAction: '', useVariableStage: false, useWorldStage: false });
        const after = await repo.load(draft.saveId);
        const { stageResponses } = await import('/src/services/ai/stageResponses.ts' as string);
        const observed = stageResponses.getSnapshot()[0];
        return { before: before.revision, afterCandidate, turnDelta: after.turnNumber - before.turnNumber, revisionDelta: after.revision - before.revision,
          writing: saved.storyWriting, observed: { transport: observed.diagnostics.transport, finish: observed.diagnostics.finishReasons,
            complete: observed.diagnostics.complete, raw: observed.text, saved: observed.candidateSaved }, candidate: saved.story.narrative, committed: after.journal.at(-1).story.narrative, replayed: committed.replayed };
      } finally { stage.dispose(); repo.close(); }
    }, { protocol, stream });
    expect(wires).toHaveLength(1); expect(workers).toBe(1); expect(external).toEqual([]);
    const response = await incoming;
    expect(replies).toHaveLength(1);
    const [bytes] = replies;
    expect(response.status()).toBe(200);
    expect(result.observed).toEqual({ transport: stream ? 'sse' : 'json', complete: true, saved: true, raw: content,
      finish: [protocol === 'gemini' ? 'STOP' : protocol === 'anthropic' ? 'tool_use' : 'tool_calls'] });
    const wire = JSON.parse(wires[0]);
    const name = protocol === 'gemini' ? wire.tools[0].functionDeclarations[0].name : protocol === 'anthropic' ? wire.tools[0].name : wire.tools[0].function.name;
    expect(name).toBe('submit_scene');
    const choice = protocol === 'gemini' ? wire.toolConfig.functionCallingConfig.mode : protocol === 'anthropic' ? wire.tool_choice.type : wire.tool_choice;
    expect(choice.toLowerCase()).toBe('auto');
    expect(wire.temperature ?? wire.generationConfig?.temperature).toBe(0.42);
    expect(wire.max_tokens ?? wire.max_completion_tokens ?? wire.generationConfig?.maxOutputTokens).toBe(4321);
    expect(wires[0]).toContain('我在博物馆核对蓝釉瓷杯。');
    expect(wires[0]).not.toContain('c2-fixture-credential');
    expect(result.afterCandidate).toBe(result.before);
    expect(result).toMatchObject({ turnDelta: 1, revisionDelta: 1, writing: { source: 'preset', id: 'spreset-c2', configurationVersion: 4 },
      candidate: narrative, committed: narrative, replayed: false });
    await info.attach('c2-wire', { contentType: 'application/json', body: JSON.stringify({ protocol, stream, name, choice, posts: wires.length,
      endpoint: new URL(response.url()).pathname, responseBytes: bytes.length,
      responseSha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(wires[0]), toolSchemaEstimate: estimateTokens(JSON.stringify(wire.tools)), requestEstimate: estimateTokens(wires[0]), sha256: createHash('sha256').update(wires[0]).digest('hex'), ...result }) });
  });
}

test('失败与取消只结束本次 Worker，旧候选及正式档保持可读', async ({ page }) => {
  await page.goto('/?spreset=prototype');
  const cases = ['success', 'limited', 'refused', 'wrong', 'incomplete', 'invalid-story', 'broken', 'cancel'] as const;
  const posts: string[] = [], relays: string[] = [];
  await page.route('**/api/ai-relay**', route => { relays.push(route.request().method()); return route.abort(); });
  await page.route('https://spreset.mock.invalid/**', async route => {
    const kind = cases[posts.length];
    posts.push(kind);
    if (kind === 'cancel') {
      await page.evaluate(() => window.dispatchEvent(new Event('c2-cancel-request')));
      return route.abort();
    }
    if (kind === 'broken') return route.abort('connectionreset');
    if (kind === 'success') return route.fulfill({ json: { choices: [{ message: { content: envelope }, finish_reason: 'stop' }] } });
    if (kind === 'refused') return route.fulfill({ json: { choices: [{ message: { refusal: 'fixture' }, finish_reason: 'content_filter' }] } });
    const args = kind === 'incomplete' ? '{"content":' : JSON.stringify({ content: kind === 'invalid-story' ? '没有标签' : envelope });
    const message = { tool_calls: [{ id: 'issued', type: 'function', function: { name: kind === 'wrong' ? 'other_tool' : 'submit_scene', arguments: args } }] };
    return route.fulfill({ json: { choices: [{ message, finish_reason: kind === 'limited' ? 'length' : 'tool_calls' }] } });
  });
  const result = await page.evaluate(async count => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts',
      '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }, { StoryStage }, { newChannel, defaultAiConfig }, { CredentialVault }] =
      await Promise.all(paths.map(path => import(path)));
    const input = talentPromptInput('story', 'regular');
    Object.assign(input.settings.runtime, { streamStory: true, useVariableStage: false, useWorldStage: false });
    const draft = createTurnDraft(input.state.saveId, input.state.revision, 'c2-errors', 'regular', input.userInput, false, false);
    const repo = await SaveRepository.open(), stage = new StoryStage(repo);
    const stop = () => stage.cancel();
    window.addEventListener('c2-cancel-request', stop);
    try {
      const backup = { state: input.state, draft };
      await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
      const config = defaultAiConfig(), channel = newChannel('openai');
      channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'synthetic';
      config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
      const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fixture-only');
      const generate = (draft: unknown) => stage.generate({ draft, settings: input.settings, config, vault, onFailureSaved: () => {} });
      await generate(await repo.loadDraft(draft.saveId));
      const candidate = await repo.loadDraft(draft.saveId);
      const baseline = JSON.stringify(await repo.load(draft.saveId)), errors = [];
      for (let i = 1; i < count; ++i) {
        let code: string | undefined;
        try { await generate(candidate); } catch (error) { code = (error as {code?: string}).code; }
        errors.push({ code, candidatePreserved: JSON.stringify(await repo.loadDraft(draft.saveId)) === JSON.stringify(candidate),
          statePreserved: JSON.stringify(await repo.load(draft.saveId)) === baseline });
      }
      const saved = await repo.loadDraft(draft.saveId);
      let canCommit = false;
      if (saved.stageStatus.story === 'ready') {
        await repo.commitTurn({ draft: saved, nextAction: '', useVariableStage: false, useWorldStage: false });
        canCommit = (await repo.load(draft.saveId)).journal.at(-1).story.narrative === candidate.story.narrative;
      }
      return { errors, narrative: candidate.story.narrative, canCommit, retainedStatus: saved.stageStatus.story };
    } finally { window.removeEventListener('c2-cancel-request', stop); stage.dispose(); repo.close(); }
  }, cases.length);
  expect(result.retainedStatus).toBe('ready');
  expect(posts).toEqual(cases); expect(relays).toEqual([]);
  expect(result.narrative).toBe(narrative);
  expect(result.canCommit).toBe(true);
  expect(result.errors).toEqual(['output_limit', 'content_filter', 'invalid_output', 'invalid_json', 'invalid_output', 'network', 'cancelled']
    .map(code => ({ code, candidatePreserved: true, statePreserved: true })));
});

test('刷新与预设切换清除实验会话，非正文阶段继续使用原有传输', async ({ page }) => {
  const policy = await page.request.get('/experiments/spreset/sandbox.html');
  expect(policy.headers()['content-security-policy']).toContain("connect-src 'none'");
  const wires: string[] = [];
  let workers = 0;
  page.on('worker', () => workers++);
  await page.route('https://spreset.mock.invalid/**', route => {
    wires.push(route.request().postData()!);
    return route.fulfill({ json: { choices: [{ message: { content: 'fixture' }, finish_reason: 'stop' }] } });
  });
  await page.goto('/?spreset=prototype');
  const selection = () => page.evaluate(async () => {
    const { captureAssistantSelection } = await import('/src/presets/library.ts' as string);
    return captureAssistantSelection()?.definition?.id ?? null;
  });
  expect(await selection()).toBe('spreset-c2');
  await page.evaluate(async () => {
    const paths = ['/src/services/ai/client.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/services/ai/snapshot.ts'];
    const [{ AiClient }, { newChannel }, { CredentialVault }, { channelSnapshot }] = await Promise.all(paths.map(path => import(path)));
    const channel = newChannel('openai');
    channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'synthetic';
    const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fixture-only');
    for (const stage of ['entities', 'variables', 'world', 'memory', 'theater']) {
      const snapshot = channelSnapshot(channel, vault, channel.defaultModel, stage);
      await new AiClient().generate(snapshot, [{ role: 'user', content: stage }], { stream: false, spresetPrototype: true });
    }
  });
  expect(wires).toHaveLength(5);
  for (const body of wires) { expect(JSON.parse(body)).not.toHaveProperty('tools'); expect(body).not.toContain('submit_scene'); }
  expect(workers).toBe(0);
  await page.goto('/');
  expect(await selection()).toBeNull();
  await page.goto('/?spreset=prototype&safe=1');
  expect(await selection()).toBeNull();
  await page.evaluate(async () => {
    const { savePresetSettings } = await import('/src/presets/settings.ts' as string);
    savePresetSettings({ enabled: true, selected: 'peinture-1118', packages: {} });
  });
  await page.goto('/?spreset=prototype');
  expect(await selection()).toBe('peinture-1118');
});

test('A 档在途操作卸载，B 档独立结算，刷新后核对两个正式档', async ({ page }) => {
  await page.goto('/?spreset=prototype');
  const requests: string[] = [], closed: Promise<void>[] = [];
  page.on('worker', worker => { if (worker.url().startsWith('blob:null/')) closed.push(worker.waitForEvent('close').then(() => undefined)); });
  await page.route('https://spreset.mock.invalid/**', async route => {
    requests.push(route.request().postData()!);
    if (requests.length === 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('c2-leave-first-save')));
      return route.abort();
    }
    return route.fulfill(reply('openai', true));
  });
  const state = await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts',
      '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }, { StoryStage }, { newChannel, defaultAiConfig }, { CredentialVault }] =
      await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      const config = defaultAiConfig(), channel = newChannel('openai');
      channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'synthetic';
      config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
      const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fixture-only');
      const baseline = [];
      for (const saveId of ['c2-save-A', 'c2-save-B']) {
        const input = talentPromptInput('story', 'regular');
        input.state.saveId = saveId;
        const draft = createTurnDraft(saveId, input.state.revision, 'fixture-turn', 'regular', '访问展柜-' + saveId, false, false);
        const entry = { state: input.state, draft };
        await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
        const stored = await repo.loadDraft(saveId), state = await repo.load(saveId);
        baseline.push({ turn: state.turnNumber, revision: state.revision, draft: JSON.stringify(stored) });
        Object.assign(input.settings.runtime, { streamStory: true, useVariableStage: false, useWorldStage: false });
        const stage = new StoryStage(repo);
        const leave = () => stage.dispose();
        window.addEventListener('c2-leave-first-save', leave, { once: true });
        try {
          const generated = await stage.generate({ draft: stored, settings: input.settings, config, vault });
          await repo.commitTurn({ draft: generated, nextAction: '', useVariableStage: false, useWorldStage: false });
        } catch (e) { if (saveId !== 'c2-save-A' || (e as {code?: string}).code !== 'cancelled') throw e; }
        finally { window.removeEventListener('c2-leave-first-save', leave); stage.dispose(); }
      }
      return baseline;
    } finally { repo.close(); }
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain('访问展柜-c2-save-A'); expect(requests[1]).toContain('访问展柜-c2-save-B');
  expect(requests[1]).not.toContain('访问展柜-c2-save-A');
  expect(closed).toHaveLength(2);
  await Promise.all(closed);
  await page.reload();
  const stored = await page.evaluate(async () => {
    const { SaveRepository } = await import('/src/services/storage/saveRepository.ts' as string);
    const repo = await SaveRepository.open();
    try {
      const a = await repo.load('c2-save-A'), b = await repo.load('c2-save-B');
      return { a: { turn: a.turnNumber, revision: a.revision, draft: JSON.stringify(await repo.loadDraft(a.saveId)) },
        b: { turn: b.turnNumber, revision: b.revision, narrative: b.journal.at(-1).story.narrative } };
    } finally { repo.close(); }
  });
  expect(stored.a).toEqual(state[0]);
  expect(stored.b).toEqual({ turn: state[1].turn + 1, revision: state[1].revision + 1, narrative });
});
