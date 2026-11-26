import { malformedSceneResponse } from '../src/tests/fixtures/spresetTerminal';
import { test, expect } from './helpers/test';

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) test(protocol + (stream ? ' SSE' : ' JSON') + ' 异常终端调用无收据、无候选、无结算', async ({ page }, info) => {
    const faults = ['duplicate', 'foreign-end'] as const;
    let posts = 0;
    await page.route('https://spreset.mock.invalid/**', async route => {
      const fault = faults[posts++];
      if (!fault || route.request().method() !== 'POST') return route.abort();
      const response = malformedSceneResponse(protocol, stream, fault);
      return route.fulfill({ contentType: stream ? 'text/event-stream' : 'application/json', body: await response.text() });
    });
    await page.goto('/?spreset=prototype');
    const results = await page.evaluate(async ({ protocol, stream, faults }) => {
      const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }, { StoryStage }, { newChannel, defaultAiConfig }, { CredentialVault }] =
        await Promise.all(['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/talentPrompt.ts', '/src/domain/drafts.ts',
          '/src/workflows/storyStage.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'].map(path => import(path)));
      let finishes = 0, receipts = 0;
      const post = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]) {
        const message = args[0] as { operation?: string; session?: string } | null;
        if (message?.operation === 'finish' && message.session) {
          finishes++;
          this.addEventListener('message', event => { if (event.data?.result?.receipt) receipts++; }, { once: true });
        }
        return Reflect.apply(post, this, args);
      };
      const repo = await SaveRepository.open(), stage = new StoryStage(repo);
      const config = defaultAiConfig(), channel = newChannel(protocol);
      channel.baseUrl = 'https://spreset.mock.invalid'; channel.defaultModel = 'synthetic';
      config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
      const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'fixture-only');
      try {
        const outcomes = [];
        for (const fault of faults) {
          const { settings, state } = talentPromptInput('story', 'regular');
          Object.assign(settings.runtime, { streamStory: stream, useVariableStage: false, useWorldStage: false });
          state.saveId = 'c2-integrity-' + fault;
          const initial = createTurnDraft(state.saveId, state.revision, 'fixture', 'regular', '核对展柜', false, false);
          const entry = { state, draft: initial };
          await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
          const before = await repo.loadDraft(state.saveId), count = finishes, issued = receipts;
          let error, candidate = false;
          try {
            const generated = await stage.generate({ draft: before, settings, config, vault });
            candidate = Boolean((await repo.loadDraft(state.saveId))?.story);
            await repo.commitTurn({ draft: generated, nextAction: '', useVariableStage: false, useWorldStage: false });
          } catch (e) { error = (e as {code?: string}).code; }
          const saved = await repo.load(state.saveId), draft = await repo.loadDraft(state.saveId);
          outcomes.push({ fault, error, processorFinishes: finishes - count, receipts: receipts - issued, candidate: candidate || Boolean(draft?.story),
            revisionDelta: saved.revision - state.revision, turnDelta: saved.turnNumber - state.turnNumber });
        }
        return outcomes;
      } finally { MessagePort.prototype.postMessage = post; stage.dispose(); repo.close(); }
    }, { protocol, stream, faults });
    await info.attach('terminal-boundary', { contentType: 'application/json', body: JSON.stringify({ protocol, stream, posts, results }) });
    expect(posts).toBe(faults.length);
    for (const result of results) expect.soft(result, result.fault).toMatchObject({
      error: expect.any(String), processorFinishes: 0, receipts: 0, candidate: false, revisionDelta: 0, turnDelta: 0,
    });
  });
}
