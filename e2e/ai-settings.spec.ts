import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('真实浏览器加载原文、校验哈希并组装六种模式，记录模块顺序', async ({ page }, testInfo) => {
  await page.goto('/');
  const examples = await page.evaluate(async () => {
    const composerPath = '/src/prompts/composer.ts';
    const gamePath = '/src/tests/fixtures/game.ts';
    const settingsPath = '/src/ui/settings/model.ts';
    const draftsPath = '/src/domain/drafts.ts';
    const { composePrompt } = await import(composerPath);
    const { game } = await import(gamePath);
    const { defaultSettings } = await import(settingsPath);
    const { createTurnDraft, rerollStory } = await import(draftsPath);
    const state = game();
    const examples: {
      stage: string;
      mode: string;
      modules: { id: string; role: string; order: number }[];
      roles: string[];
      variablePending?: boolean;
    }[] = [];
    for (const mode of ['opening', 'regular']) {
      const draft = rerollStory(
        createTurnDraft(state.saveId, state.revision, 'example-turn', mode, '查看附近环境'),
        {
          turnKind: mode,
          narrative: '【旁白】街道依然安静。',
          summary: '观察环境',
          variableGuide: [],
        },
      );
      for (const stage of ['story', 'variables', 'world']) {
        const prompt = await composePrompt({
          state,
          settings: defaultSettings(),
          mode,
          stage,
          draft,
          userInput: '查看附近环境',
          domains: ['protagonist', 'economy'],
        });
        examples.push({
          stage,
          mode,
          modules: prompt.modules.map((m: { id: string; role: string; order: number }) => ({
            id: m.id,
            role: m.role,
            order: m.order,
          })),
          roles: prompt.messages.map((m: { role: string }) => m.role),
          variablePending: prompt.context.variablePending,
        });
      }
    }
    return examples;
  });
  expect(examples).toHaveLength(6);
  for (const example of examples) {
    const ids = example.modules.map((module) => module.id);
    expect(ids.filter((id) => id.startsWith('stages.'))).toEqual([
      `stages.${example.mode}.${example.stage}`,
    ]);
    expect(example.roles.at(-1)).toBe('user');
    if (example.stage === 'story') {
      expect(ids.slice(0, 3)).toEqual([
        'identity.fusheng',
        'worldbooks.heijin.worldview',
        'worldbooks.heijin.modern_underworld',
      ]);
      expect(ids.filter((id) => id === 'writing.nsfw')).toHaveLength(1);
      expect(ids.filter((id) => id === 'writing.intimacy_boundaries')).toHaveLength(1);
    } else expect(ids.some((id) => id.startsWith('writing.'))).toBe(false);
    if (example.stage === 'world') expect(example.variablePending).toBe(true);
  }
  const artifact = testInfo.outputPath('prompt-order.json');
  await writeFile(artifact, JSON.stringify(examples, null, 2));
  await testInfo.attach('prompt-order.json', { path: artifact, contentType: 'application/json' });
});

test('AI 多渠道、原生模型列表与连接测试、路由和会话凭证恢复', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: { url: string; method: string; headers: Record<string, string>; body: string }[] =
    [];
  await page.route('https://api.mock.invalid/**', async (route) => {
    const request = route.request();
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? '',
    });
    const native = request.url().includes('/gemini/')
      ? 'gemini'
      : request.url().includes('/anthropic/')
        ? 'anthropic'
        : 'openai';
    const result =
      request.method() === 'GET'
        ? native === 'gemini'
          ? { models: [{ name: 'models/mock-model' }] }
          : { data: [{ id: 'mock-model' }] }
        : native === 'gemini'
          ? { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }
          : native === 'anthropic'
            ? { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }
            : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const ids: string[] = [];
  for (const protocol of ['openai', 'gemini', 'anthropic']) {
    await page.getByRole('button', { name: '新增渠道', exact: true }).click();
    await page.getByLabel('渠道名称', { exact: true }).fill(`Mock ${protocol}`);
    await page.getByRole('combobox', { name: '协议', exact: true }).selectOption(protocol);
    await page
      .getByLabel('API Base URL', { exact: true })
      .fill(`https://api.mock.invalid/${protocol}/v1`);
    const password = page.getByLabel('API 密钥', { exact: true });
    await expect(password).toHaveAttribute('type', 'password');
    await password.fill('browser-mock-credential');
    await page.getByLabel('默认模型 ID', { exact: true }).fill('mock-model');
    expect(requests).toHaveLength(ids.length * 2);
    await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
    await expect(
      page.getByText('AI 配置已保存；尚未发起模型请求。', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await expect(page.getByText('已获取 1 个模型；也可手动填写。', { exact: true })).toBeVisible();
    await expect(page.locator('#ai-models option')).toHaveCount(1);
    await page.getByRole('button', { name: /测试连接（/ }).click();
    await expect(page.getByText(/连接测试成功，已收到模型文本响应/)).toBeVisible();
    ids.push(await page.getByRole('combobox', { name: '当前渠道', exact: true }).inputValue());
  }
  expect(requests).toHaveLength(6);
  expect(requests.map((request) => request.url)).toEqual([
    'https://api.mock.invalid/openai/v1/models',
    'https://api.mock.invalid/openai/v1/chat/completions',
    'https://api.mock.invalid/gemini/v1/models',
    'https://api.mock.invalid/gemini/v1/models/mock-model:generateContent',
    'https://api.mock.invalid/anthropic/v1/models?limit=100',
    'https://api.mock.invalid/anthropic/v1/messages',
  ]);
  for (const [index, header] of [
    [1, 'authorization'],
    [3, 'x-goog-api-key'],
    [5, 'x-api-key'],
  ] as const) {
    expect(requests[index].headers[header]).toContain('browser-mock-credential');
    expect(requests[index].url).not.toContain('browser-mock-credential');
    expect(requests[index].body).not.toContain('browser-mock-credential');
  }
  await page.getByLabel('变量管理跟随正文模型', { exact: true }).uncheck();
  await page.getByRole('combobox', { name: '变量管理渠道', exact: true }).selectOption(ids[1]);
  await page.getByLabel('变量管理模型 ID', { exact: true }).fill('variable-override');
  await expect(page.getByLabel('动态世界跟随正文模型', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('browser-mock-credential');
  await expect(page.getByRole('combobox', { name: '变量管理渠道', exact: true })).toHaveValue(
    ids[1],
  );
  await expect(page.getByLabel('变量管理模型 ID', { exact: true })).toHaveValue(
    'variable-override',
  );
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
  }));
  expect(stored.local).not.toContain('browser-mock-credential');
  expect(stored.session).toContain('browser-mock-credential');
  await page.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '当前渠道', exact: true }).locator('option'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: '当前渠道', exact: true }).locator('option'),
  ).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: '正文生成渠道', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('连接授权错误不展示服务详情，网络错误不误报密钥，取消请求有效', async ({ page }) => {
  let mode = 'authorization';
  await page.route('https://api.mock.invalid/**', async (route) => {
    if (mode === 'authorization')
      await route.fulfill({
        status: 401,
        json: { error: 'browser-mock-credential secret service detail' },
      });
    else if (mode === 'network') await route.abort('failed');
    else
      await new Promise<void>((resolve) => {
        route
          .request()
          .response()
          .then(() => resolve())
          .catch(() => resolve());
      });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '新增渠道', exact: true }).click();
  await page.getByLabel('API Base URL', { exact: true }).fill('https://api.mock.invalid/v1');
  await page.getByLabel('默认模型 ID', { exact: true }).fill('mock-model');
  await page.getByLabel('API 密钥', { exact: true }).fill('browser-mock-credential');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await page.getByRole('button', { name: /测试连接（/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '授权错误' })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('secret service detail');
  mode = 'network';
  await page.getByRole('button', { name: /测试连接（/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'CORS' })).toBeVisible();
  mode = 'hanging';
  await page.getByRole('button', { name: /测试连接（/ }).click();
  await page.getByRole('button', { name: '取消请求', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '取消' })).toBeVisible();
  await expect(page.getByRole('button', { name: /测试连接（/ })).toBeEnabled();
});
