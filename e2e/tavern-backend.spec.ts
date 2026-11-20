import { test, expect } from './helpers/test';
import preset from '../src/presets/resources/peinture-manifest.json' with { type: 'json' };

test('启动捕获的传输、预设 Story 包装、候选保存与重新生成取消', async ({ page }) => {
  await page.addInitScript(() => {
    const previous = window.fetch.bind(window);
    const observed: { model: string; messages: { content: string }[]; tools?: unknown[] }[] = [];
    Object.assign(window, { observed });
    window.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url, location.href).pathname === '/api/backends/chat-completions/generate' &&
          (init?.method ?? (input instanceof Request ? input.method : 'GET')) === 'GET') return new Response('GET passed through');
      if (!url.startsWith('https://tavern.mock.invalid/')) return previous(input, init);
      const data = JSON.parse(String(init?.body));
      observed.push(data);
      if (observed.length === 2) return new Promise((_resolve, reject) => {
        window.dispatchEvent(new Event('mock-waiting'));
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled','AbortError')), { once: true });
      });
      return data.tools
        ? Response.json({ choices: [{ message: { tool_calls: [{ id: 'fixture-id', type: 'function', function: {
          name: 'deliver', arguments: JSON.stringify({ scene: '街边电车驶过，主角在站台等候。' }) } }] }, finish_reason: 'tool_calls' }], usage: { completion_tokens: 27 } })
        : Response.json({ choices: [{ message: { content: '原生传输' }, finish_reason: 'stop' }] });
    };
  });
  // The synthetic listeners below replace the bundled scripts; select this mode before the page host starts.
  await page.addInitScript(p => {
    localStorage.setItem('heijin.story-presets.v1', JSON.stringify({ enabled: true, selected: p.id, packages: {
      [p.id]: { version: p.version, entries: {}, scripts: Object.fromEntries(Object.keys(p.scriptEditions).map(id => [id,{enabled:false}])) },
    } }));
  }, preset);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const paths = ['/src/main.tsx','/src/workflows/storyStage.ts','/src/services/storage/saveRepository.ts',
      '/src/domain/drafts.ts','/src/tests/fixtures/game.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts',
      '/src/services/ai/credentials.ts','/src/presets/tavern/events.ts',
      '/src/services/ai/client.ts','/src/services/ai/snapshot.ts','/src/services/ai/stageResponses.ts'];
    const [, { StoryStage }, { SaveRepository }, { createTurnDraft }, { game }, { defaultSettings },
      { newChannel, defaultAiConfig }, { CredentialVault }, { tavernEvents },
      { AiClient }, { channelSnapshot }, { stageResponses }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open('tavern-browser-fixture'), state = await repo.create(game());
    const draft = createTurnDraft(state.saveId, state.revision, 'browser-test', 'opening', '');
    await repo.saveDraft(draft, null);
    const settings = defaultSettings(); settings.runtime.streamStory = false; settings.prompts.minNarrativeChars = 5;
    settings.prompts.actionOptions = false;
    const channel = newChannel('openai'), config = defaultAiConfig(), vault = new CredentialVault(sessionStorage,localStorage);
    channel.baseUrl = 'https://tavern.mock.invalid/v1'; channel.defaultModel = 'fixture-model';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    vault.set(channel.id, 'fixture-only-key');
    const expectedMax = channel.parameters.maxOutputTokens;
    const order: string[] = [], stage = new StoryStage(repo);
    const hooks = [
      tavernEvents.on('generation_started',(op: string) => order.push(op)),
      tavernEvents.on('GENERATION_AFTER_COMMANDS',() => order.push('commands')),
      tavernEvents.on('chat_completion_prompt_ready',() => order.push('prompt')),
      tavernEvents.on('generate_after_data',() => order.push('data')),
      tavernEvents.on('chat_completion_settings_ready', async (d: { messages: { role: string; content: string }[] }) => {
        await Promise.resolve(); channel.defaultModel = 'changed-after-start'; order.push('ready'); d.messages.push({ role: 'user', content: '监听器修改' });
      }),
      tavernEvents.on('generation_ended', () => order.push('end')),
      tavernEvents.on('generation_stopped', () => order.push('cancel')),
    ];
    const previous = window.fetch.bind(window);
    const passthrough = await (await previous('/api/backends/chat-completions/generate')).text();
    let wraps = 0;
    window.fetch = async (input, init) => {
      wraps++; order.push('fetch');
      if (input !== '/api/backends/chat-completions/generate') throw new Error('native request entered wrapper');
      const data = JSON.parse(String(init?.body));
      data.messages.push({ role: 'user', content: '包装器修改' });
      data.model = 'ignore-this-model'; data.max_tokens = 3;
      data.tools = [{ type: 'function', function: { name: 'deliver', parameters: { type: 'object' } } }];
      const req = new Request(new URL(input, location.href), { ...init, body: JSON.stringify(data) });
      const upstream = await previous(req);
      const json = await upstream.json();
      const scene = JSON.parse(json.choices[0].message.tool_calls[0].function.arguments).scene;
      const content = '<正文>' + scene + '</正文><短期记忆>在站台等车</短期记忆><变量规划>[]</变量规划>';
      return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 999 } });
    };
    try {
      const generation = stage.generate({ config, settings, vault, draft });
      channel.defaultModel = 'changed-before-web-lock';
      const generated = await generation;
      const trace = stageResponses.getSnapshot()[0].diagnostics.tavern;
      channel.defaultModel = 'fixture-model';
      const waiting = new Promise(resolve => window.addEventListener('mock-waiting',resolve,{ once:true }));
      const attempt = stage.generate({ config, settings, vault, draft: generated }).catch((e: { code: string }) => e.code);
      await waiting; stage.cancel();
      const cancelled = await attempt;
      const after = await repo.loadDraft(state.saveId);
      const native = [];
      for (const kind of ['story','variables','world','memory']) {
        const response = await new AiClient().generate(channelSnapshot(channel, vault, 'native-' + kind, kind), [{ role: 'user', content: 'test' }]);
        native.push(response.text);
      }
      const observed = (window as unknown as { observed: { model: string; max_tokens?: number; messages: { content: string }[] }[] }).observed;
      return { order, wraps, cancelled, native, passthrough, count: observed.length, sent: observed[0].messages.slice(-2).map(m => m.content),
        model: observed[0].model, maxUnchanged: (observed[0].max_tokens ?? (observed[0] as { max_completion_tokens?: number }).max_completion_tokens) === expectedMax, narrative: after.story.narrative,
        revision: after.draftRevision === generated.draftRevision, formal: (await repo.load(state.saveId)).revision === state.revision, trace };
    } finally { window.fetch = previous; hooks.forEach(h => h.stop()); repo.close(); }
  });
  expect(result).toMatchObject({ passthrough: 'GET passed through', wraps: 2, count: 6, model: 'fixture-model', sent: ['监听器修改','包装器修改'],
    cancelled: 'cancelled', narrative: '街边电车驶过，主角在站台等候。', revision: true, formal: true,
    native: Array(4).fill('原生传输'), trace: { calls: 1, complete: true, upstreamFinish: 'tool_calls', upstreamUsage: { outputTokens: 27 } } });
  expect(result.maxUnchanged).toBe(true);
  expect(result.order).toEqual(['normal','commands','prompt','data','ready','fetch','end',
    'regenerate','commands','prompt','data','ready','fetch','cancel','end']);
});
