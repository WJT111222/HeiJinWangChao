import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { toolReply } from './helpers/literaryTool';

const body = '<正文>林舟在灯下翻开账册。</正文><短期记忆>翻开账册。</短期记忆><变量规划>[]</变量规划>';
const direction = '镜头停在褪色的书签上。';
async function activate(page: Page, appearance: 'day' | 'night' = 'night') {
  await page.goto('/');
  await page.evaluate(async (appearance) => {
    const { settingsKey, defaultSettings } = await import('/src/ui/settings/model.ts' as string);
    const settings = defaultSettings();
    settings.display.appearance = appearance;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const { savePresetSettings } = await import('/src/presets/settings.ts' as string);
    savePresetSettings({ enabled: true, selected: 'meowssiah', packages: {} });
  }, appearance);
  await page.reload();
}
async function control(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const back = settings.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await settings.getByRole('button', { name: '文学预设', exact: true }).click();
  await settings.getByRole('button', { name: '神域控制台', exact: true }).click();
  return page.getByRole('dialog', { name: '神域控制台', exact: true });
}

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true])
    test(protocol + (stream ? ' SSE' : ' JSON') + ' 文学菜单到正式正文', async ({ page }, info) => {
      const wires: string[] = [];
      const paths: string[] = [];
      const reply = toolReply(
        protocol,
        stream,
        { game_content: body, think_nya: '合成作者附注', comment: '合成猫猫悄悄话' },
        'soliumbra_reply',
      );
      const usageFixture =
        protocol === 'openai' && !stream
          ? {
              usage: {
                prompt_tokens: 120,
                completion_tokens: 30,
                total_tokens: 150,
                prompt_tokens_details: { cached_tokens: 40 },
              },
            }
          : {};
      const responseBody = reply.body ?? JSON.stringify({ ...(reply.json as object), ...usageFixture });
      const server = createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174');
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        wires.push(Buffer.concat(chunks).toString('utf8'));
        paths.push(new URL(req.url!, 'http://127.0.0.1').pathname);
        res.writeHead(200, { 'Content-Type': reply.contentType ?? 'application/json' }).end(responseBody);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        await activate(page, info.project.name === 'desktop' ? 'day' : 'night');
        const dialog = await control(page);
        await dialog.getByLabel('自定义创作要求').fill(direction);
        await dialog.getByRole('button', { name: '📝纯五感写实', exact: true }).click();
        await dialog.getByRole('button', { name: '采样与用量' }).click();
        await dialog.getByLabel('Top P').fill('0.71');
        await dialog.getByRole('button', { name: '保存文学配置' }).click();
        await expect(dialog.getByRole('status')).toContainText('文学配置已保存');
        expect(wires).toHaveLength(0);
        if (protocol === 'openai' && !stream) {
          await dialog.getByRole('button', { name: '创作菜单', exact: true }).click();
          await dialog.getByRole('heading', { name: '角色控制', exact: true }).scrollIntoViewIfNeeded();
          await expect(page.locator('html')).toHaveAttribute(
            'data-appearance',
            info.project.name === 'desktop' ? 'day' : 'night',
          );
          await info.attach('神域控制台', {
            contentType: 'image/png',
            body: await page.screenshot({ animations: 'disabled' }),
          });
        }
        const result = await page.evaluate(
          async ({ protocol, stream, base }) => {
            const paths = [
              '/src/services/storage/saveRepository.ts',
              '/src/tests/fixtures/talentPrompt.ts',
              '/src/domain/drafts.ts',
              '/src/workflows/storyStage.ts',
              '/src/services/ai/configuration.ts',
              '/src/services/ai/credentials.ts',
            ];
            const [
              { SaveRepository },
              { talentPromptInput },
              { createTurnDraft },
              { StoryStage },
              { newChannel, defaultAiConfig },
              { CredentialVault },
            ] = await Promise.all(paths.map((p) => import(p)));
            const input = talentPromptInput('story', 'regular');
            const { recordPhone, schedulePhone } = await import('/src/domain/phone.ts' as string);
            const lastTurn = input.state.journal.at(-1)!.turnId;
            recordPhone(input.state, 'npc-a', {
              messageId: 'oracle-delivered', sender: 'npc', medium: 'text', text: '合成来信：书签已放在柜台。',
            }, lastTurn, false);
            schedulePhone(input.state, {
              npcId: 'npc-a', messageId: 'oracle-future', text: '合成未投递：邮局下周开门。',
              dueAt: new Date(Date.parse(input.state.worldClock) + 86_400_000).toISOString(),
            }, lastTurn);
            Object.assign(input.settings.runtime, {
              streamStory: stream,
              useEntityStage: false,
              useVariableStage: false,
              useWorldStage: false,
            });
            const draft = createTurnDraft(
              input.state.saveId,
              input.state.revision,
              'cat-story',
              'regular',
              '核对书签',
              false,
              false,
              false,
            );
            const config = defaultAiConfig(),
              channel = newChannel(protocol);
            channel.baseUrl = base;
            channel.defaultModel = 'fixture';
            config.channels = [channel];
            config.routes.story = { channelId: channel.id, modelId: '' };
            const vault = new CredentialVault(sessionStorage, localStorage);
            vault.set(channel.id, 'mock-credential');
            const repo = await SaveRepository.open(),
              stage = new StoryStage(repo);
            const deliveries: unknown[] = [];
            const post = MessagePort.prototype.postMessage;
            MessagePort.prototype.postMessage = function (
              ...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]
            ) {
              const packet = args[0] as { session?: string; operation?: string } | null;
              if (packet?.session && packet.operation === 'finish')
                this.addEventListener('message', (event) => deliveries.push(event.data?.result), {
                  once: true,
                });
              return Reflect.apply(post, this, args);
            };
            try {
              const backup = { state: input.state, draft };
              await repo.importBackup(backup, (await repo.compareBackup(backup)).confirmation);
              await repo.writeOracleNote(
                draft.saveId,
                await repo.readOracleNote(draft.saveId),
                '保留窗边的倒影',
                true,
              );
              const before = await repo.load(draft.saveId);
              const saved = await stage.generate({
                draft: await repo.loadDraft(draft.saveId),
                settings: input.settings,
                config,
                vault,
              });
              const candidateRevision = (await repo.load(draft.saveId)).revision;
              await repo.commitTurn({
                draft: saved,
                nextAction: '',
                useEntityStage: false,
                useVariableStage: false,
                useWorldStage: false,
              });
              const after = await repo.load(draft.saveId);
              const { stageResponses } = await import('/src/services/ai/stageResponses.ts' as string);
              const observation = stageResponses.getSnapshot()[0];
              const { requestInspections } = await import('/src/services/ai/inspection.ts' as string);
              const sampleUsage = requestInspections.getSnapshot()[0].statistics.actual;
              return {
                sampleUsage,
                raw: observation.displayText,
                extracted: observation.text,
                reasoning: observation.nativeReasoning,
                deliveries,
                source: saved.storyWriting,
                body: saved.story.narrative,
                note: (await repo.readOracleNote(draft.saveId)).note,
                candidateDelta: candidateRevision - before.revision,
                turnDelta: after.turnNumber - before.turnNumber,
                revisionDelta: after.revision - before.revision,
              };
            } finally {
              MessagePort.prototype.postMessage = post;
              stage.dispose();
              repo.close();
            }
          },
          { protocol, stream, base },
        );
        const id = protocol === 'gemini' ? 'gemini-call-0' : 'fixture-tool';
        expect(result.deliveries).toEqual([
          { output: body, receipt: { id, bytes: Buffer.byteLength(body), result: '{"ok":true}' } },
        ]);
        expect(result.raw).toContain('合成猫猫悄悄话');
        expect(result.extracted).toBe(body);
        expect(result.reasoning ?? '').not.toContain('合成作者附注');
        expect(wires).toHaveLength(1);
        const raw = wires[0],
          wire = JSON.parse(raw);
        expect(raw).toContain(direction);
        expect(raw.split('合成来信：书签已放在柜台。')).toHaveLength(2);
        expect(raw).not.toContain('合成未投递：邮局下周开门。');
        expect(raw).toContain('保留窗边的倒影');
        expect(raw).toContain('完全聚焦五感');
        expect(raw).not.toContain('catgodml');
        expect(raw).not.toContain('mock-credential');
        expect(raw).toContain('soliumbra_reply');
        expect(raw).not.toContain('submit_scene');
        expect(wire.top_p ?? wire.generationConfig?.topP).toBe(0.71);
        if (protocol === 'openai' && !stream)
          expect(result.sampleUsage).toMatchObject({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 40 });
        expect(result).toMatchObject({
          source: { source: 'preset', id: 'meowssiah', configurationVersion: 4 },
          body: '林舟在灯下翻开账册。',
          note: null,
          candidateDelta: 0,
          turnDelta: 1,
          revisionDelta: 1,
        });
        await info.attach('oracle-wire', {
          contentType: 'application/json',
          body: JSON.stringify({
            protocol,
            stream,
            request: wire,
            httpPath: paths[0],
            responseBytes: Buffer.byteLength(responseBody),
            sha256: createHash('sha256').update(raw).digest('hex'),
            responseSha256: createHash('sha256').update(responseBody).digest('hex'),
            posts: wires.length,
            ...result,
          }),
        });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
}

test('双标签设置冲突、取消与方案回读均为零请求', async ({ page, context }) => {
  const requests: string[] = [];
  await context.route('**/*', (route) => {
    if (route.request().method() === 'POST') {
      requests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await activate(page);
  const other = await context.newPage();
  await other.goto('/');
  const first = await control(page),
    second = await control(other);
  await first.getByLabel('自定义创作要求').fill('保留屋檐的雨声。');
  await first.getByRole('button', { name: '我的方案', exact: true }).click();
  await first.getByLabel('方案名称').fill('雨夜');
  await first.getByRole('button', { name: '另存方案' }).click();
  const download = page.waitForEvent('download');
  await first.getByRole('button', { name: '导出 JSON' }).click();
  const exported = await readFile((await (await download).path())!);
  await first.getByRole('button', { name: '保存文学配置' }).click();
  await expect(first.getByText('文学配置已保存', { exact: true })).toBeVisible();
  await second.getByLabel('自定义创作要求').fill('另一个页面');
  await second.getByRole('button', { name: '保存文学配置' }).click();
  await expect(second.getByRole('status')).toContainText('配置已在另一处更新');
  await second.getByRole('button', { name: '关闭', exact: true }).click();
  await second.getByRole('button', { name: '放弃更改' }).click();
  await other.reload();
  const reread = await control(other);
  await expect(reread.getByLabel('自定义创作要求')).toHaveValue('保留屋檐的雨声。');
  await reread.getByRole('button', { name: '恢复发行默认值' }).click();
  await expect(reread.getByLabel('自定义创作要求')).toHaveValue('');
  await reread.getByRole('button', { name: '我的方案', exact: true }).click();
  await reread.getByRole('button', { name: '雨夜', exact: true }).click();
  await reread.getByRole('button', { name: '创作菜单', exact: true }).click();
  await expect(reread.getByLabel('自定义创作要求')).toHaveValue('保留屋檐的雨声。');
  await reread.getByRole('button', { name: '恢复发行默认值' }).click();
  await reread.getByRole('button', { name: '我的方案', exact: true }).click();
  await reread
    .getByLabel('导入方案')
    .setInputFiles({ name: '神域文学方案.json', mimeType: 'application/json', buffer: exported });
  await expect(reread.getByText('已载入，可编辑后保存', { exact: true })).toBeVisible();
  await reread.getByRole('button', { name: '创作菜单', exact: true }).click();
  await expect(reread.getByLabel('自定义创作要求')).toHaveValue('保留屋檐的雨声。');
  expect(requests).toEqual([]);
});
