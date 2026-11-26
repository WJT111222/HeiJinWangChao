import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { expect, test } from './helpers/test';

const story = '<正文>海风掀起码头上的白纸，守门人拾起纸条。</正文><短期记忆>拾起纸条</短期记忆><变量规划>[]</变量规划>';
const frame = (delta: object, finish_reason: string | null = null) =>
  'data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n';
const scenarios = ['held-finish', 'slow-output', 'slow-body', 'source-retry', 'disconnect-retry', 'idle-retry', 'retry-off', 'cancel', 'json'] as const;
for (const literary of [false, true]) for (const scenario of scenarios) {
  test((literary ? '1118 ' : '原生 ') + scenario, async ({ page }, info) => {
    const posts: { stream: boolean; tool: boolean; originalWorld: boolean; changedWorld: boolean; finishMs?: number; closeMs?: number; finish?: string; closed?: boolean }[] = [];
    let active: ServerResponse | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (ms: number, fn: () => void) => { timers.add(setTimeout(fn, ms)); };
    const server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let raw = ''; for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      const tool = body.tools?.some((t: { function?: { name: string } }) => t.function?.name === 'actual_content') === true;
      const seen: (typeof posts)[number] = { stream: body.stream === true, tool, originalWorld: raw.includes('stream-test-world-A'), changedWorld: raw.includes('stream-test-world-B') };
      const started = performance.now();
      posts.push(seen); active = res;
      res.on('close', () => { seen.closed = true; seen.closeMs = Math.round(performance.now() - started); });
      const text = (snippet: string) => res.write(frame({ content: snippet }));
      const finish = () => {
        if (tool) res.write(frame({ tool_calls: [{ index: 0, type: 'function', id: 'fixture-1', function: {
          name: 'actual_content', arguments: JSON.stringify({ content: story }) } }] }));
        else text(story);
        seen.finish = tool ? 'tool_calls' : 'stop';
        seen.finishMs = Math.round(performance.now() - started);
        res.write(frame({}, seen.finish));
      };
      if (scenario === 'json') {
        const message = tool ? { tool_calls: [{ id: 'fixture-1', type: 'function', function: { name: 'actual_content',
          arguments: JSON.stringify({ content: story }) } }] } : { content: story };
        seen.finish = tool ? 'tool_calls' : 'stop';
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message, finish_reason: seen.finish }] })); return;
      }
      res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders();
      if (posts.length === 1 && ['source-retry','disconnect-retry','retry-off','idle-retry','cancel'].includes(scenario)) {
        res.write(': connected\n\n');
        if (scenario === 'disconnect-retry' || scenario === 'source-retry' || scenario === 'retry-off') {
          text('<正文>第一次未完成'); later(120, () => res.destroy());
        }
        return;
      }
      if (scenario === 'slow-body') {
        text(story.slice(0, 9)); later(600, () => text(story.slice(9, 17)));
        later(1200, () => { text(story.slice(17)); seen.finish = 'stop'; res.end(frame({}, 'stop') + 'data: [DONE]\n\n'); });
      } else if (scenario === 'slow-output') {
        res.write(frame({ reasoning_content: '先核对公开资料。' }));
        later(610, () => res.write(frame({ reasoning_content: '再查看码头。' })));
        later(1210, () => { finish(); res.end('data: [DONE]\n\n'); });
      } else {
        finish();
        if (scenario === 'held-finish') later(40, () => res.write('data: {"choices":[],"usage":{"completion_tokens":7}}\n\n'));
        else res.end('data: [DONE]\n\n');
      }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const baseUrl = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    try {
      await page.addInitScript(enabled => localStorage.setItem('heijin.story-presets.v1', JSON.stringify({
        enabled, selected: enabled ? 'peinture-1118' : null, packages: {},
      })), literary);
      await page.goto('/');
      if (literary) await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(2);
      const run = page.evaluate(async ({ baseUrl, scenario }) => {
        const modules = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/talentPrompt.ts','/src/domain/drafts.ts',
          '/src/workflows/turnCoordinator.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/services/ai/failureDiagnostic.ts'];
        const [{ SaveRepository }, { talentPromptInput }, { createTurnDraft }, { TurnCoordinator }, { newChannel, defaultAiConfig },
          { CredentialVault }, { readFailureDiagnostic }] = await Promise.all(modules.map(path => import(path)));
        const repo = await SaveRepository.open(), coordinator = new TurnCoordinator(repo);
        try {
          const fixturePath = '/src/tests/fixtures/worldviewBrowser.ts', faultsPath = '/src/tests/fixtures/worldviewFaults.ts';
          let edit: Promise<void> | undefined;
          if (scenario === 'source-retry') await (await import(fixturePath)).book('stream-test-world-A');
          const { state, settings } = talentPromptInput('story', 'regular');
          Object.assign(settings.runtime, { streamStory: scenario !== 'json', streamIdleSeconds: 1, streamTotalSeconds: 12,
            timeoutSeconds: 5, useVariableStage: false, useWorldStage: false, failureAutoRetry: scenario !== 'retry-off', maxAutoRetries: 1 });
          const draft = createTurnDraft(state.saveId, state.revision, 'stream-review', 'regular', '阅读资料', false, false);
          const entry = { state, draft }; await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
          const config = defaultAiConfig(), ch = newChannel('openai'); ch.baseUrl = baseUrl; ch.defaultModel = 'gemini-fixture';
          config.channels = [ch]; config.routes.story = { channelId: ch.id, modelId: '' };
          const vault = new CredentialVault(sessionStorage,localStorage); vault.set(ch.id, 'fixture-only');
          window.addEventListener('review-cancel', () => coordinator.cancel(), { once: true });
          const failures: unknown[] = [];
          let error: string | undefined;
          const inspect = async () => {
            const { records } = await repo.exportRaw(state.saveId);
            return { revision: records.saves[0].value.revision, turn: records.saves[0].value.turnNumber, receipts: records.turnReceipts.length,
              candidate: records.drafts[0].value.story?.narrative ?? null };
          };
          let beforeCommit;
          try {
            const result = await coordinator.generate({ draft: await repo.loadDraft(state.saveId), config, settings, vault,
              onAttemptFailure: (_stage: string, e: unknown) => {
                failures.push(readFailureDiagnostic(e));
                if (scenario === 'source-retry') edit = (async () => {
                  await (await import(faultsPath)).officialOnly();
                  await (await import(fixturePath)).book('stream-test-world-B');
                })();
              } });
            beforeCommit = await inspect();
            await repo.commitTurn({ draft: result.draft, nextAction: '', useVariableStage: false, useWorldStage: false });
          } catch (e) { error = (e as {code: string}).code; }
          if (edit) await edit;
          return { initial: state.revision, initialTurn: state.turnNumber, beforeCommit, after: await inspect(), error, failures };
        } finally { coordinator.dispose(); repo.close(); }
      }, { baseUrl, scenario });
      if (scenario === 'cancel') {
        await expect.poll(() => posts.length).toBe(1);
        await page.evaluate(() => window.dispatchEvent(new Event('review-cancel')));
      }
      const result = await run;
      await writeFile(info.outputPath('wire-state.json'), JSON.stringify({ literary, scenario, device: info.project.name, posts, result }, null, 2));
      const ok = scenario !== 'retry-off' && scenario !== 'cancel';
      expect(posts).toHaveLength(['source-retry','disconnect-retry','idle-retry'].includes(scenario) ? 2 : 1);
      expect(posts.every(p => p.stream === (scenario !== 'json'))).toBe(true);
      if (ok) {
        expect(result.error).toBeUndefined();
        expect(result.beforeCommit).toMatchObject({ revision: result.initial, receipts: 0, candidate: '海风掀起码头上的白纸，守门人拾起纸条。' });
        expect(result.after).toMatchObject({ revision: result.initial + 1, turn: result.initialTurn + 1, receipts: 1 });
      } else {
        expect(result.error).toBe(scenario === 'cancel' ? 'cancelled' : 'stream_interrupted');
        expect(result.after).toMatchObject({ revision: result.initial, turn: result.initialTurn, receipts: 0, candidate: null });
      }
      if (scenario === 'source-retry') expect(posts.every(p => p.originalWorld && !p.changedWorld)).toBe(true);
      if (scenario === 'idle-retry') expect(result.failures[0]).toMatchObject({ timeoutKind: 'first_output', retry: { scheduled: true } });
    } finally {
      for (const timer of timers) clearTimeout(timer);
      active?.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
}
