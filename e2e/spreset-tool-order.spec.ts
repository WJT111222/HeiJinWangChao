import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { callId, companionText, orderResponse, orderSamples, publicThought, scene } from '../src/tests/fixtures/toolOrder';
import { expect, test } from './helpers/test';

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true]) test(protocol + (stream ? ' SSE' : ' JSON') + ' 原始块顺序决定交付', async ({ page }, info) => {
    const samples = orderSamples(protocol, stream);
    const posts = samples.map(() => 0);
    const server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      const index = Number(req.url?.split('/')[1]);
      if (req.method !== 'POST' || !samples[index]) { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      posts[index]++;
      if (!Buffer.concat(chunks).includes('submit_scene')) { res.writeHead(400).end(); return; }
      const { body, mime } = orderResponse(protocol, stream, samples[index]);
      res.writeHead(200, { 'Content-Type': mime }).end(body);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await page.goto('/?spreset=prototype');
      const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
      const outcomes = await page.evaluate(async ({ protocol, stream, base, count }) => {
        const [{ SaveRepository }, { StoryStage }, { createTurnDraft }, { talentPromptInput },
          { newChannel, defaultAiConfig }, { CredentialVault }, { stageResponses }] = await Promise.all([
          '/src/services/storage/saveRepository.ts', '/src/workflows/storyStage.ts', '/src/domain/drafts.ts',
          '/src/tests/fixtures/talentPrompt.ts', '/src/services/ai/configuration.ts',
          '/src/services/ai/credentials.ts', '/src/services/ai/stageResponses.ts',
        ].map(path => import(path)));
        const repo = await SaveRepository.open(), stage = new StoryStage(repo);
        const finishes: { text: string; call?: { id: string; args: { content: string } } }[] = [];
        const receipts: ({ id: string; bytes: number } | null)[] = [];
        const send = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]) {
          const m = args[0] as { session?: string; operation?: string; input: typeof finishes[number] } | null;
          if (m?.session && m.operation === 'finish') {
            finishes.push(m.input);
            this.addEventListener('message', event => {
              if (event.data?.result) receipts.push(event.data.result.receipt);
            }, { once: true });
          }
          return Reflect.apply(send, this, args);
        };
        try {
          const results = [];
          for (let i = 0; i < count; i++) {
            const { state, settings, userInput } = talentPromptInput('story', 'regular');
            Object.assign(settings.runtime, { streamStory: stream, useVariableStage: false, useEntityStage: false, useWorldStage: false });
            state.saveId = 'order-' + i;
            const draft = createTurnDraft(state.saveId, state.revision, 'order', 'regular', userInput, false, false);
            const backup = { state, draft };
            await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
            const channel = newChannel(protocol), config = defaultAiConfig();
            channel.baseUrl = base + '/' + i; channel.defaultModel = 'order-fixture';
            config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
            const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'synthetic');
            const start = finishes.length, issued = receipts.length;
            let error: string | undefined, candidate: string | undefined;
            try {
              await stage.generate({ draft: await repo.loadDraft(state.saveId), settings, config, vault });
            } catch (failure) { error = (failure as { code?: string }).code; }
            const saved = await repo.loadDraft(state.saveId);
            const candidateState = await repo.load(state.saveId);
            if (saved?.story) {
              candidate = saved.story.narrative;
              await repo.commitTurn({ draft: saved, nextAction: '', useEntityStage: false, useVariableStage: false, useWorldStage: false });
            }
            const end = await repo.load(state.saveId), record = stageResponses.getSnapshot()[0];
            results.push({ error, candidate, finishes: finishes.slice(start), receipts: receipts.slice(issued),
              raw: record.text, thought: record.nativeReasoning ?? '', afterSave: [candidateState.turnNumber - state.turnNumber, candidateState.revision - state.revision],
              afterCommit: [end.turnNumber - state.turnNumber, end.revision - state.revision] });
          }
          return results;
        } finally { MessagePort.prototype.postMessage = send; stage.dispose(); repo.close(); }
      }, { protocol, stream, base, count: samples.length });
      await info.attach('tool-order', { contentType: 'application/json',
        body: JSON.stringify(samples.map((s, i) => ({ ...s, posts: posts[i], ...outcomes[i] }))) });
      for (const [i, sample] of samples.entries()) {
        const r = outcomes[i], text = companionText(sample);
        const ok = sample.expected === 'tool' || sample.expected === 'text';
        expect(posts[i], sample.name).toBe(1);
        expect(r.afterSave, sample.name).toEqual([0, 0]);
        expect(r.afterCommit, sample.name).toEqual(ok ? [1, 1] : [0, 0]);
        expect(r.candidate, sample.name).toBe(ok ? '林舟核对藏品。\n\n  目录上还有一行。' : undefined);
        expect(r.error, sample.name).toBe(ok ? undefined : 'invalid_output');
        expect(r.thought, sample.name).toBe(sample.packets.flat().includes('thought') ? publicThought : '');
        expect(r.receipts, sample.name).toEqual(sample.expected === 'tool' ? [{ id: callId, bytes: Buffer.byteLength(scene) }]
          : sample.expected === 'text' ? [null] : []);
        if (sample.expected === 'competing') expect(r.finishes, sample.name).toHaveLength(0);
        else {
          expect(r.finishes, sample.name).toHaveLength(1);
          expect(r.finishes[0].text, sample.name).toBe(sample.expected === 'tool' ? '' : text);
          expect(r.finishes[0].call?.args.content, sample.name).toBe(sample.expected === 'text' ? undefined : scene);
        }
        if (ok) expect(r.raw, sample.name).toBe(text + (sample.expected === 'tool' ? scene : ''));
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
}
