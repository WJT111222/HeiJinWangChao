import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openStageRaw } from './helpers/gameLayout';
import fixture from './fixtures/peinture-game.json' with { type: 'json' };

type Protocol = 'openai' | 'deepseek' | 'anthropic' | 'gemini';
const pack = 'peinture-1118';
const envelope =
  '<正文>船靠岸了，林舟沿着石阶往上走。</正文><短期记忆>林舟上岸</短期记忆><变量规划>[]</变量规划>';
const toolName = 'actual_content';
const args = { content: envelope };

function upstream(protocol: Protocol, stream: boolean) {
  const event = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n';
  let full: unknown;
  let sse: string;
  if (protocol === 'gemini') {
    full = {
      candidates: [
        { content: { parts: [{ functionCall: { name: toolName, args } }] }, finishReason: 'STOP' },
      ],
      usageMetadata: { candidatesTokenCount: 12 },
    };
    sse = event(full);
  } else if (protocol === 'anthropic') {
    const block = { type: 'tool_use', id: 'fixture-call', name: toolName, input: args };
    full = { content: [block], stop_reason: 'tool_use', usage: { output_tokens: 12 } };
    sse = [
      { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ]
      .map(event)
      .join('');
  } else {
    const call = {
      type: 'function',
      id: 'fixture-call',
      function: { name: toolName, arguments: JSON.stringify(args) },
    };
    full = {
      choices: [{ message: { tool_calls: [call] }, finish_reason: 'tool_calls' }],
      usage: { completion_tokens: 12 },
    };
    sse =
      event({ choices: [{ delta: { tool_calls: [{ index: 0, ...call }] } }] }) +
      event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { completion_tokens: 12 } }) +
      'data: [DONE]\n\n';
  }
  return stream ? { contentType: 'text/event-stream', body: sse } : { json: full };
}

// Synthetic save and opening draft produced with game() and createTurnDraft(); no production test hooks.
async function prepare(page: Page, protocol: Protocol, stream: boolean, active: boolean, actionOptions = false) {
  const sent: string[] = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'peinture.mock.invalid') {
      sent.push(route.request().postData() ?? '');
      if (
        protocol === 'openai' &&
        !stream &&
        !route
          .request()
          .postDataJSON()
          .tools?.some((t: { function: { name: string } }) => t.function.name === toolName)
      )
        return route.fulfill({
          json: {
            choices: [
              {
                message: { content: '<wave_delivery>' + envelope + '</wave_delivery>' },
                finish_reason: 'stop',
              },
            ],
          },
        });
      return route.fulfill(upstream(protocol, stream));
    }
    return ['localhost', '127.0.0.1'].includes(u.hostname) || u.protocol === 'blob:'
      ? route.continue()
      : route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).first().waitFor();
  await page.evaluate(
    async ({ fixture, protocol, stream, active, pack, actionOptions }) => {
      const db = await new Promise<IDBDatabase>((ok, fail) => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => ok(request.result);
        request.onerror = () => fail(request.error);
      });
      try {
        const tx = db.transaction(['saves', 'drafts'], 'readwrite');
        for (const { name, records } of fixture.rows)
          for (const value of records) {
            tx.objectStore(name).put(value);
            const other = structuredClone(value);
            other.saveId = 'peinture-second';
            if ('protagonist' in other) other.protagonist.name = '顾乙';
            tx.objectStore(name).put(other);
          }
        await new Promise<void>((ok, fail) => {
          tx.oncomplete = () => ok();
          tx.onabort = () => fail(tx.error);
        });
      } finally {
        db.close();
      }
      fixture.config.channels[0].protocol = protocol;
      fixture.settings.runtime.streamStory = stream;
      fixture.settings.prompts.actionOptions = actionOptions;
      localStorage.setItem('heijin.ai.v1', JSON.stringify(fixture.config));
      localStorage.setItem(fixture.settingsKey, JSON.stringify(fixture.settings));
      sessionStorage.setItem('heijin.credential.v1:fixture-channel', 'fixture-only');
      if (active)
        localStorage.setItem(
          'heijin.story-presets.v1',
          JSON.stringify({ enabled: true, selected: pack, packages: {} }),
        );
    },
    { fixture, protocol, stream, active, pack, actionOptions },
  );
  await page.reload();
  return sent;
}
async function generate(page: Page, id = 'peinture-smoke') {
  await page.goto('/#game/' + id);
  await openGameTools(page);
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((ok) => {
          const r = indexedDB.open('heijinwangchao');
          r.onsuccess = () => ok(r.result);
        });
        try {
          return await new Promise<string>((ok) => {
            const r = db.transaction('drafts').objectStore('drafts').get(id);
            r.onsuccess = () => ok(r.result?.story?.narrative ?? r.result?.failures?.at(-1)?.code ?? '');
          });
        } finally {
          db.close();
        }
      }, id),
    )
    .toBe('船靠岸了，林舟沿着石阶往上走。');
}
for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  for (const stream of [false, true])
    test(protocol + ' ' + (stream ? 'SSE' : 'JSON') + ' 正式游戏、主脚本和候选', async ({ page }) => {
      const sent = await prepare(page, protocol, stream, true);
      await generate(page);
      expect(sent).toHaveLength(1);
      const body = JSON.parse(sent[0]);
      const names =
        protocol === 'gemini'
          ? body.tools[0].functionDeclarations.map((t: { name: string }) => t.name)
          : protocol === 'anthropic'
            ? body.tools.map((t: { name: string }) => t.name)
            : body.tools.map((t: { function: { name: string } }) => t.function.name);
      expect(names).toEqual(expect.arrayContaining(['wave_context_reference', toolName]));
      expect(sent[0]).toContain('林舟');
    });
}
async function runtimeSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const back = dialog.getByRole('button', { name: '返回设置', exact: true });
  if (await back.isVisible()) await back.click();
  await dialog.getByRole('button', { name: '运行', exact: true }).click();
  return dialog;
}
async function editPreset(page: Page) {
  const settings = await runtimeSettings(page);
  await settings.getByRole('button', { name: '王朝预设设置' }).click();
  return page.getByRole('dialog', { name: '王朝预设设置' });
}
test('设置保存、重开、恢复默认和关闭，每次仅生成一次', async ({ page }, info) => {
  test.slow(); // Two saves, two real opening drafts and multiple full page reloads.
  const sent = await prepare(page, 'openai', false, false);
  let settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption(pack);
  await Promise.all([
    page.waitForNavigation(),
    settings.getByRole('button', { name: '保存预设并刷新' }).click(),
  ]);
  let panel = await editPreset(page);
  await panel.getByText('局势与节奏', { exact: true }).click();
  const pace = panel.getByLabel('推进速度');
  const initial = await pace.inputValue();
  const temp = await panel.getByLabel('温度').inputValue();
  await panel.getByLabel('正文交付').selectOption('text');
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await panel.getByRole('button', { name: '关闭预设设置' }).click();
  await settings.getByRole('button', { name: '王朝预设设置' }).click();
  await expect(panel.getByLabel('正文交付')).toHaveValue('text');
  await panel.getByLabel('正文交付').selectOption('native');
  await panel.getByText('局势与节奏', { exact: true }).click();
  await pace.selectOption('wave-pace-fast');
  await panel.getByLabel('温度').fill('0');
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  expect(await panel.evaluate((d) => d.scrollWidth <= d.clientWidth + 1)).toBe(true);
  await panel.getByText('采样与输出', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.reload();
  panel = await editPreset(page);
  await panel.getByText('局势与节奏', { exact: true }).click();
  await expect(panel.getByLabel('推进速度')).toHaveValue('wave-pace-fast');
  await expect(panel.getByLabel('温度')).toHaveValue('0');
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page);
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).temperature).toBe(0);
  expect(sent[0]).toContain('当前推进速度：疾步向前');
  await page.goto('/');
  panel = await editPreset(page);
  page.once('dialog', (d) => d.accept());
  await panel.getByRole('button', { name: '恢复默认' }).click();
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await page.reload();
  panel = await editPreset(page);
  await panel.getByText('局势与节奏', { exact: true }).click();
  await expect(panel.getByLabel('推进速度')).toHaveValue(initial);
  await expect(panel.getByLabel('温度')).toHaveValue(temp);
  await page.goto('/');
  await generate(page, 'peinture-second');
  expect(sent[1]).toContain('顾乙');
  expect(sent).toHaveLength(2);
  expect(JSON.parse(sent[1]).temperature).toBe(Number(temp));
  expect(sent[1]).not.toContain('当前推进速度：疾步向前');
  await page.goto('/');
  settings = await runtimeSettings(page);
  await settings.getByLabel('正文预设').selectOption('');
  await Promise.all([
    page.waitForNavigation(),
    settings.getByRole('button', { name: '保存预设并刷新' }).click(),
  ]);
  await expect(page.locator('iframe[data-tavern-script]')).toHaveCount(0);
  expect(sent).toHaveLength(2);
});

test('保存失败保留编辑，脚本正文交付偏好随下一次请求生效', async ({ page }) => {
  const sent = await prepare(page, 'openai', false, true);
  await page.goto('/#game/peinture-smoke');
  await openGameTools(page);
  await page.getByRole('button', { name: '王朝预设设置', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '王朝预设设置' });
  await panel.getByText('兼容与预览', { exact: true }).click();
  await panel.getByRole('button', { name: '估算已保存配置' }).click();
  await expect(panel.getByRole('status')).toContainText('本地估算');

  await panel.getByLabel('正文交付').selectOption('text');
  await panel.getByLabel('还原额外转义').check();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'heijin.story-presets.v1') {
        Storage.prototype.setItem = set;
        throw new Error('合成存储失败');
      }
      set.call(this, k, v);
    };
  });
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('alert')).toContainText('合成存储失败');
  await expect(panel.getByLabel('正文交付')).toHaveValue('text');
  await expect(panel.getByRole('status')).toHaveCount(0);
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已保存');
  await page.goto('/');
  await editPreset(page);
  await expect(panel.getByLabel('还原额外转义')).toBeChecked();
  expect(sent).toHaveLength(0);
  await page.goto('/');
  await generate(page, 'peinture-second');
  expect(sent[0]).toContain('顾乙');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('<wave_delivery>');
  expect(JSON.parse(sent[0]).tools.map((t: { function: { name: string } }) => t.function.name)).not.toContain(
    toolName,
  );
});

for (const format of ['json', 'sse', 'interrupted', 'invalid-story'] as const) {
  test('实际正文标记及本次诊断 ' + format, async ({ page, context }, testInfo) => {
    const requestedStream = format !== 'sse';
    const sent = await prepare(page, 'openai', requestedStream, true, true);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#game/peinture-smoke');
    await openGameTools(page);
    await page.getByRole('button', { name: '王朝预设设置', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '王朝预设设置' });
    await panel.getByLabel('正文交付').selectOption('text');
    await panel.getByRole('button', { name: '保存调整' }).click();
    await expect(panel.getByRole('status')).toContainText('已保存');
    await panel.getByRole('button', { name: '关闭预设设置' }).click();

    const narrative = ('雨停后，林舟收起伞，望着写有“北岸”的路牌。\n').repeat(80).trim();
    const story = envelope.replace('船靠岸了，林舟沿着石阶往上走。', narrative)
      + '<行动选项>留在原地\n看看周围\n询问站台</行动选项>';
    const content = '<wave_delivery>' + (format === 'invalid-story' ? story.replace('[]', 'not JSON') : story) + '</wave_delivery>';
    const json = format === 'json' || format === 'invalid-story';
    await page.route('https://peinture.mock.invalid/**', route => {
      sent.push(route.request().postData()!);
      const data = { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 123 } };
      const chunk = { choices: [{ delta: { content }, finish_reason: format === 'interrupted' ? null : 'stop' }] };
      return route.fulfill({
        contentType: format === 'sse' ? 'application/json' : 'text/plain',
        body: json ? JSON.stringify(data) : 'data: ' + JSON.stringify(chunk) + '\n\n',
      });
    });
    await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
    const success = format === 'json' || format === 'sse';
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(ok => {
        const request = indexedDB.open('heijinwangchao');
        request.onsuccess = () => ok(request.result);
      });
      try {
        return await new Promise<string>(ok => {
          const request = db.transaction('drafts').objectStore('drafts').get('peinture-smoke');
          request.onsuccess = () => ok(request.result.story?.narrative ?? (request.result.failures.length ? 'failed' : ''));
        });
      } finally { db.close(); }
    })).toBe(success ? narrative : 'failed');
    if (!success && testInfo.project.name === 'mobile') {
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: '重试与变更详情' }) });
      await dialog.getByRole('tab', { name: '模型原文' }).click();
      await dialog.getByText('查看三阶段模型完整原文与执行结果', { exact: true }).click();
      await dialog.locator('summary').filter({ hasText: /^正文模型原文/ }).click();
    } else {
      await openStageRaw(page, 'story');
    }
    await page.getByRole('button', { name: '复制本次诊断' }).click();
    const report = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(report).toMatchObject({
      protocol: 'openai', tavern: { requestedStream, normalized: json ? 'json' : 'sse', calls: 1, complete: format !== 'interrupted' },
      candidateSaved: success, storyValidated: success,
    });
    if (format === 'interrupted') expect(report).toMatchObject({ code: 'stream_interrupted', fieldPath: 'tavern.upstream.missing_finish', failureLayer: 'upstream' });
    if (format === 'invalid-story') expect(report).toMatchObject({ failureLayer: 'story_validation', tavern: { rawFinish: 'stop', restored: true } });
    if (json) expect(report.tavern.upstreamUsage.outputTokens).toBe(123);
    expect(JSON.stringify(report)).not.toMatch(/林舟|fixture-only|peinture-smoke|wave_delivery/);
    expect(sent).toHaveLength(1);
    await testInfo.attach('本次诊断', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  });
}
