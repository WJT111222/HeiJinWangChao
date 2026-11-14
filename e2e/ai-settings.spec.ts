import { expect, test } from './helpers/test';
import { addChannel, backToList, chooseText, follow, openAiSettings, openChannel, saveAi, stageModel, testReply } from './helpers/aiSettings';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:api\.openai\.com|api\.anthropic\.com|api\.deepseek\.com|generativelanguage\.googleapis\.com)\//, (route) => route.fulfill({ json: { data: [], models: [] } }));
});

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
      `stages.${example.mode}.${example.stage}${example.stage === 'variables' ? '.text' : ''}`,
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

test('AI 多渠道：选服务商后自动获取模型、测试回复、阶段路由与密钥保存位置', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  await page.route('https://api.mock.invalid/**', async (route) => {
    const request = route.request();
    requests.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postData() ?? '' });
    const native = request.url().includes('/gemini/') ? 'gemini' : request.url().includes('/anthropic/') ? 'anthropic' : 'openai';
    const result = request.method() === 'GET'
      ? native === 'gemini' ? { models: [{ name: 'models/mock-model' }] } : { data: [{ id: 'mock-model' }] }
      : native === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }
        : native === 'anthropic' ? { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }
          : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] };
    await route.fulfill({ json: result });
  });
  await page.goto('/');
  const settings = await openAiSettings(page);
  const channels = [
    { name: 'Mock openai', preset: 'OpenAI 兼容', url: 'https://api.mock.invalid/openai/v1' },
    { name: 'Mock gemini', preset: 'OpenAI 兼容', url: 'https://api.mock.invalid/gemini/v1', format: 'Gemini 格式' },
    { name: 'Mock anthropic', preset: 'OpenAI 兼容', url: 'https://api.mock.invalid/anthropic/v1', format: 'Claude 格式' },
    { name: 'Mock deepseek', preset: 'DeepSeek', url: 'https://api.mock.invalid/deepseek/v1' },
  ];
  for (const [index, channel] of channels.entries()) {
    await addChannel(settings, { ...channel, key: undefined });
    const password = settings.getByLabel('API 密钥', { exact: true });
    await expect(password).toHaveAttribute('type', 'password');
    // 未保存时也能填好密钥后直接获取模型、测试回复。
    await password.fill('browser-mock-credential');
    await expect(settings.getByRole('status').filter({ hasText: '连接正常' }).first()).toBeVisible();
    await expect.poll(() => requests.length).toBe(index * 2 + 1);
    await testReply(settings);
    await expect(settings.getByRole('status').filter({ hasText: '收到了回复' }).first()).toBeVisible();
    await expect.poll(() => requests.length).toBe(index * 2 + 2);
  }
  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
    'GET https://api.mock.invalid/openai/v1/models',
    'POST https://api.mock.invalid/openai/v1/chat/completions',
    'GET https://api.mock.invalid/gemini/v1/models',
    'POST https://api.mock.invalid/gemini/v1/models/mock-model:generateContent',
    'GET https://api.mock.invalid/anthropic/v1/models?limit=100',
    'POST https://api.mock.invalid/anthropic/v1/messages',
    'GET https://api.mock.invalid/deepseek/v1/models',
    'POST https://api.mock.invalid/deepseek/v1/chat/completions',
  ]);
  for (const [index, header] of [[1, 'authorization'], [3, 'x-goog-api-key'], [5, 'x-api-key'], [7, 'authorization']] as const) {
    expect(requests[index].headers[header]).toContain('browser-mock-credential');
    expect(requests[index].url).not.toContain('browser-mock-credential');
    expect(requests[index].body).not.toContain('browser-mock-credential');
  }
  // 正文用第一个渠道（从列表选），变量单独用 Gemini 渠道（手动填写），其余跟随正文。
  await stageModel(settings, '正文生成', 'Mock openai', 'mock-model', 'list');
  await stageModel(settings, '变量管理', 'Mock gemini', 'variable-override');
  await expect(settings.getByRole('group', { name: '动态世界模型来源', exact: true }).getByRole('button', { name: '跟随正文', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // 第三个渠道关闭「记住密钥」，只在本次会话保留。
  await openChannel(settings, 'Mock anthropic');
  await settings.getByRole('switch', { name: '记住密钥' }).uncheck();
  await saveAi(settings);
  await page.keyboard.press('Escape');
  await page.reload();
  const again = await openAiSettings(page);
  await openChannel(again, 'Mock openai');
  await expect(again.getByLabel('API 密钥', { exact: true })).toHaveValue('browser-mock-credential');
  await backToList(again);
  await expect(again.getByRole('combobox', { name: '变量管理渠道', exact: true })).toContainText('Mock gemini');
  await expect(again.getByRole('combobox', { name: '变量管理模型', exact: true })).toHaveAttribute('value', 'variable-override');
  await expect(again.getByRole('combobox', { name: '正文生成模型', exact: true })).toHaveAttribute('value', 'mock-model');
  const stored = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  const config = stored.local.find(([key]) => key === 'heijin.ai.v1')?.[1] ?? '';
  expect(config).not.toContain('browser-mock-credential');
  expect(stored.local.filter(([key, value]) => key.startsWith('heijin.credential.v1:') && value === 'browser-mock-credential')).toHaveLength(3);
  expect(stored.session.filter(([key, value]) => key.startsWith('heijin.credential.v1:') && value === 'browser-mock-credential')).toHaveLength(1);
  // 删除：取消不改动；确认后保存才生效；删除正文用的渠道会阻止保存，直到重新选好模型或放弃修改。
  await openChannel(again, 'Mock deepseek');
  await again.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await backToList(again);
  await expect(again.getByRole('button', { name: /^编辑渠道：/ })).toHaveCount(4);
  await openChannel(again, 'Mock deepseek');
  await again.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
  await backToList(again);
  await expect(again.getByRole('button', { name: /^编辑渠道：/ })).toHaveCount(3);
  await openChannel(again, 'Mock openai');
  await again.getByRole('button', { name: '删除渠道', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除「Mock openai」？' })).toContainText('它正被「正文');
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
  await expect(again.getByRole('button', { name: '保存 AI 配置', exact: true })).toBeDisabled();
  await expect(again.getByRole('status').filter({ hasText: '正文生成还没选模型' })).toBeVisible();
  await again.getByRole('button', { name: '放弃修改', exact: true }).click();
  await backToList(again);
  await expect(again.getByRole('button', { name: /^编辑渠道：/ })).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('连接授权错误不展示服务详情，网络错误不误报密钥，取消测试有效', async ({ page }) => {
  let mode = 'authorization';
  await page.route('https://api.mock.invalid/**', async (route) => {
    if (mode === 'authorization') await route.fulfill({ status: 401, json: { error: 'browser-mock-credential secret service detail' } });
    else if (mode === 'network') await route.abort('failed');
    else await new Promise<void>((resolve) => { route.request().response().then(() => resolve()).catch(() => resolve()); });
  });
  await page.goto('/');
  const settings = await openAiSettings(page);
  await addChannel(settings, { name: 'Mock', url: 'https://api.mock.invalid/v1', key: 'browser-mock-credential' });
  await expect(settings.getByRole('status').filter({ hasText: '连接失败' }).first()).toContainText('授权错误');
  await expect(page.getByRole('dialog').first()).not.toContainText('secret service detail');
  await stageModel(settings, '正文生成', 'Mock', 'mock-model');
  await openChannel(settings, 'Mock');
  await testReply(settings);
  await expect(settings.getByRole('status').filter({ hasText: '测试失败' }).first()).toContainText('授权错误');
  mode = 'network';
  await testReply(settings);
  await expect(settings.getByRole('status').filter({ hasText: 'CORS' }).first()).toBeVisible();
  mode = 'hanging';
  await testReply(settings);
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await expect(settings.getByRole('status').filter({ hasText: '已取消测试' }).first()).toBeVisible();
  await expect(settings.getByRole('button', { name: '测试回复（可能产生少量费用）', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog').first()).not.toContainText('secret service detail');
});

test('最大输出：档位直接显示，旧渠道值与渠道隔离，新渠道默认 8K', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/services/ai/configuration.ts', vaultPath = '/src/services/ai/credentials.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(path), { CredentialVault } = await import(vaultPath);
    const config = defaultAiConfig(), first = newChannel(), second = newChannel();
    first.name = '旧4K渠道'; first.parameters.maxOutputTokens = 4096;
    second.name = '旧自定义渠道'; second.parameters.maxOutputTokens = 32768; config.channels = [first, second];
    config.routes.story = { channelId: first.id, modelId: 'mock-model' };
    saveAiConfig(localStorage, config); const vault = new CredentialVault(sessionStorage, localStorage);
    config.channels.forEach((channel: { id: string }) => vault.set(channel.id, 'mock-budget-key'));
  });
  await page.reload();
  const settings = await openAiSettings(page);
  await openChannel(settings, '旧4K渠道');
  const tiers = settings.getByRole('group', { name: '最大输出 Token 档位', exact: true });
  await expect(tiers.getByRole('button', { name: '4K', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tiers.getByRole('button', { name: '16K', exact: true }).click();
  await saveAi(settings);
  await openChannel(settings, '旧自定义渠道');
  await expect(tiers.getByRole('button', { name: '自定义', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByLabel('自定义最大输出 Token')).toHaveValue('32768');
  const values = await page.evaluate(async () => { const path = '/src/services/ai/configuration.ts', { readAiConfig } = await import(path);
    return readAiConfig(localStorage).channels.map((channel: { parameters: { maxOutputTokens: number } }) => channel.parameters.maxOutputTokens); });
  expect(values).toEqual([16384, 32768]);
  await addChannel(settings, { preset: 'OpenAI', key: 'new-mock-key' });
  await expect(tiers.getByRole('button', { name: '8K（推荐）', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await saveAi(settings);
  await page.keyboard.press('Escape'); await page.reload();
  const again = await openAiSettings(page);
  await openChannel(again, '旧4K渠道');
  await expect(tiers.getByRole('button', { name: '16K', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openChannel(again, '旧自定义渠道');
  await expect(tiers.getByRole('button', { name: '自定义', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByLabel('自定义最大输出 Token')).toHaveValue('32768');
});

test('最大输出：自定义合法范围与 4K/8K/16K 往返，只保存玩家明确设置', async ({ page }) => {
  await page.goto('/');
  const settings = await openAiSettings(page);
  await addChannel(settings, { preset: 'OpenAI', key: 'custom-mock-key' });
  await stageModel(settings, '正文生成', 'OpenAI 官方', 'mock-model');
  await openChannel(settings, 'OpenAI 官方');
  const tiers = settings.getByRole('group', { name: '最大输出 Token 档位', exact: true });
  await expect(tiers.getByRole('button', { name: '8K（推荐）', exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const name of ['4K', '8K（推荐）', '16K']) { await tiers.getByRole('button', { name, exact: true }).click(); await expect(tiers.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true'); }
  await tiers.getByRole('button', { name: '自定义', exact: true }).click();
  const custom = settings.getByLabel('自定义最大输出 Token', { exact: true }); await expect(custom).toHaveValue('16384');
  await custom.fill('12345');
  await saveAi(settings);
  for (const value of ['0', '1000001']) {
    await custom.fill(value); await settings.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
    await expect(settings.getByText(/配置无效：请核对/)).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels[0].parameters.maxOutputTokens)).toBe(12345);
  }
  await custom.fill('1000000'); await saveAi(settings);
  await page.keyboard.press('Escape'); await page.reload();
  const again = await openAiSettings(page);
  await openChannel(again, 'OpenAI 官方');
  await expect(tiers.getByRole('button', { name: '自定义', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByLabel('自定义最大输出 Token', { exact: true })).toHaveValue('1000000');
});

test('原生 DeepSeek 官方地址、四阶段独立选模与刷新恢复，纯设置不生成内容', async ({ page }, testInfo) => {
  const posts: string[] = [], models = ['mock-story', 'mock-variables', 'mock-world', 'mock-memory'];
  await page.route('https://api.deepseek.com/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') posts.push(request.url());
    expect(request.method()).toBe('GET');
    expect(request.url()).toBe('https://api.deepseek.com/models');
    expect(request.headers().authorization).toBe('Bearer fictional-review-key');
    await route.fulfill({ json: { object: 'list', data: models.map(id => ({ id })) } });
  });
  await page.goto('/');
  const settings = await openAiSettings(page);
  await addChannel(settings, { preset: 'DeepSeek' });
  await expect(settings.getByLabel('服务地址', { exact: true })).toHaveValue('https://api.deepseek.com');
  await expect(settings.getByLabel('服务地址', { exact: true })).toHaveAttribute('readonly', '');
  await expect(settings.getByLabel('渠道名称', { exact: true })).toHaveValue('DeepSeek 官方');
  await settings.getByLabel('渠道名称', { exact: true }).fill('DeepSeek 审查用 Mock');
  await settings.getByLabel('API 密钥', { exact: true }).fill('fictional-review-key');
  await expect(settings.getByRole('status').filter({ hasText: '连接正常' }).first()).toContainText('当前接口返回 4 个模型');
  const labels = ['正文生成', '变量管理', '动态世界', '记忆维护'];
  for (let i = 0; i < labels.length; i++) await stageModel(settings, labels[i], 'DeepSeek 审查用 Mock', models[i], 'list');
  await saveAi(settings);
  await page.keyboard.press('Escape');
  await page.reload();
  const again = await openAiSettings(page);
  for (let i = 0; i < labels.length; i++) {
    await expect(again.getByRole('combobox', { name: `${labels[i]}渠道`, exact: true })).toContainText('DeepSeek 审查用 Mock');
    await expect(again.getByRole('combobox', { name: `${labels[i]}模型`, exact: true })).toHaveAttribute('value', models[i]);
    if (i) await expect(again.getByRole('group', { name: `${labels[i]}模型来源`, exact: true }).getByRole('button', { name: '单独指定', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await openChannel(again, 'DeepSeek 审查用 Mock');
  await expect(again.getByLabel('API 密钥', { exact: true })).toHaveAttribute('type', 'password');
  await expect(again.getByLabel('API 密钥', { exact: true })).toHaveValue('fictional-review-key');
  await expect(again.getByLabel('服务地址', { exact: true })).toHaveValue('https://api.deepseek.com');
  expect(posts).toEqual([]);
  // 默认记住密钥：密钥单独存放，不写进 AI 配置。
  const data = await page.evaluate(() => ({ config: localStorage.getItem('heijin.ai.v1') ?? '', local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
  expect(data.config).not.toContain('fictional-review-key');
  expect(data.local).toContain('fictional-review-key');
  expect(data.session).not.toContain('fictional-review-key');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await testInfo.attach('deepseek-settings-key-masked', { body: await page.screenshot(), contentType: 'image/png' });
  await backToList(again);
  await again.getByRole('combobox', { name: '记忆维护模型', exact: true }).scrollIntoViewIfNeeded();
  await testInfo.attach('deepseek-settings-routes', { body: await page.screenshot(), contentType: 'image/png' });
});

test('换服务商：替换已填的中转地址前先确认；跟随正文可随时切换', async ({ page }) => {
  await page.goto('/');
  const settings = await openAiSettings(page);
  await addChannel(settings, { name: '我的中转', url: 'https://relay.mock.invalid/v1' });
  await settings.getByRole('group', { name: '服务商', exact: true }).getByRole('button', { name: 'Gemini', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(settings.getByLabel('服务地址', { exact: true })).toHaveValue('https://relay.mock.invalid/v1');
  await settings.getByRole('group', { name: '服务商', exact: true }).getByRole('button', { name: 'Gemini', exact: true }).click();
  await page.getByRole('button', { name: '替换地址', exact: true }).click();
  await expect(settings.getByLabel('服务地址', { exact: true })).toHaveValue('https://generativelanguage.googleapis.com/v1beta');
  await expect(settings.getByLabel('渠道名称', { exact: true })).toHaveValue('我的中转');
  await follow(settings, '动态世界', false);
  await expect(settings.getByRole('combobox', { name: '动态世界渠道', exact: true })).toBeVisible();
  await follow(settings, '动态世界', true);
  await expect(settings.getByRole('combobox', { name: '动态世界渠道', exact: true })).toHaveCount(0);
  await chooseText(settings, '正文生成渠道', '我的中转');
  await expect(settings.getByRole('button', { name: '保存 AI 配置', exact: true })).toBeDisabled();
});

// —— 保存失败不改变密钥；换服务商清理隐藏的旧模型；预设识别以地址为准 ——
async function seedVault(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const cp = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(cp), { CredentialVault } = await import(vp);
    const config = defaultAiConfig();
    config.channels = [['a', '甲渠道'], ['b', '乙渠道'], ['c', '丙渠道']].map(([id, name]) => ({ ...newChannel(), id, name, baseUrl: `https://${id}.mock.invalid/v1`, defaultModel: `${id}-model` }));
    config.routes.story = { channelId: 'a', modelId: 'a-model' };
    config.routes.world = { mode: 'follow-story', independent: { channelId: 'b', modelId: 'b-old' } };
    saveAiConfig(localStorage, config);
    const vault = new CredentialVault(sessionStorage, localStorage);
    vault.set('a', 'secret-a', true); vault.set('b', 'secret-b', false); vault.set('c', 'secret-c', true);
  });
  await page.reload();
}
const vaultDump = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const pick = (store: Storage) => Object.fromEntries(Object.entries(store).filter(([key]) => key === 'heijin.ai.v1' || key.startsWith('heijin.credential.v1:')).sort());
  return { local: pick(localStorage), session: pick(sessionStorage) };
});

test('保存失败（配置写入失败、密钥写到一半、删除失败）时，密钥值和存放位置都保持原样', async ({ page }) => {
  await page.route('https://*.mock.invalid/**', (route) => route.fulfill({ json: { data: [] } }));
  await seedVault(page);
  await page.evaluate(() => {
    const w = window as unknown as { failMode: string; credentialSets: number };
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    w.failMode = ''; w.credentialSets = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      // persistent：长期存储里的密钥一直写不进去（不会自动解除），删除仍然正常。
      if (w.failMode === 'persistent' && this === localStorage && key.startsWith('heijin.credential.v1:')) throw new DOMException('mock', 'QuotaExceededError');
      if (w.failMode === 'config' && key === 'heijin.ai.v1') { w.failMode = ''; throw new DOMException('mock', 'QuotaExceededError'); }
      if (w.failMode === 'partial' && key.startsWith('heijin.credential.v1:') && ++w.credentialSets === 2) { w.failMode = ''; throw new DOMException('mock', 'QuotaExceededError'); }
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key: string) {
      if (w.failMode === 'remove' && this === localStorage && key === 'heijin.credential.v1:c') { w.failMode = ''; throw new DOMException('mock', 'SecurityError'); }
      return remove.call(this, key);
    };
  });
  const settings = await openAiSettings(page);
  const before = await vaultDump(page);
  expect(before.local['heijin.credential.v1:a']).toBe('secret-a');
  expect(before.session['heijin.credential.v1:b']).toBe('secret-b');
  // 改甲的密钥、把乙改成记住（会从本次会话移到长期保存）、删除丙。
  await openChannel(settings, '甲渠道'); await settings.getByLabel('API 密钥', { exact: true }).fill('secret-a-new');
  await openChannel(settings, '乙渠道'); await settings.getByRole('switch', { name: '记住密钥' }).check();
  await openChannel(settings, '丙渠道'); await settings.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
  const status = settings.locator('.ai-save-bar').getByRole('status'), saveButton = settings.getByRole('button', { name: '保存 AI 配置', exact: true });
  for (const mode of ['config', 'partial', 'remove']) {
    await page.evaluate((value) => { const w = window as unknown as { failMode: string; credentialSets: number }; w.failMode = value; w.credentialSets = 0; }, mode);
    await saveButton.click();
    await expect(status).toContainText('保存失败');
    expect(await page.evaluate(() => (window as unknown as { failMode: string }).failMode)).toBe(''); // 确实触发了这一种失败
    expect(await vaultDump(page), mode).toEqual(before);
    await expect(saveButton).toBeEnabled(); // 修改仍未保存，可以重试
  }
  // 持续写入失败：丙已被删除、它的原值写不回去，必须如实提示没能完全恢复；甲、乙的旧密钥不能被回滚删掉。
  await page.evaluate(() => { (window as unknown as { failMode: string }).failMode = 'persistent'; });
  await saveButton.click();
  await expect(status).toContainText('没能完全恢复');
  await expect(status).not.toContainText('保持原样');
  const stuck = await vaultDump(page);
  expect(stuck.local['heijin.credential.v1:a']).toBe('secret-a');
  expect(stuck.session['heijin.credential.v1:b']).toBe('secret-b');
  expect(stuck.local['heijin.credential.v1:b']).toBeUndefined();
  expect(stuck.local['heijin.ai.v1']).toBe(before.local['heijin.ai.v1']);
  await page.evaluate(() => { (window as unknown as { failMode: string }).failMode = ''; });
  await saveAi(settings);
  const after = await vaultDump(page);
  expect(after.local['heijin.credential.v1:a']).toBe('secret-a-new');
  expect(after.local['heijin.credential.v1:b']).toBe('secret-b');
  expect(after.session['heijin.credential.v1:b']).toBeUndefined();
  expect(after.local['heijin.credential.v1:c']).toBeUndefined();
  expect(after.local['heijin.ai.v1']).not.toContain('secret-');
});

test('长期存储持续写不进去时，旧密钥原封不动并提示保持原样', async ({ page }) => {
  await page.route('https://*.mock.invalid/**', (route) => route.fulfill({ json: { data: [] } }));
  await seedVault(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (this === localStorage && key.startsWith('heijin.credential.v1:')) throw new DOMException('mock', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  const settings = await openAiSettings(page), before = await vaultDump(page);
  await openChannel(settings, '甲渠道'); await settings.getByLabel('API 密钥', { exact: true }).fill('secret-a-new');
  await settings.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(settings.locator('.ai-save-bar').getByRole('status')).toContainText('密钥和配置都保持原样');
  expect(await vaultDump(page)).toEqual(before);
});

test('换服务商只清掉指向这个渠道的隐藏旧模型，其他阶段的选择不动；DeepSeek 中转地址不显示为官方', async ({ page }) => {
  await page.route('https://*.mock.invalid/**', (route) => route.fulfill({ json: { data: [] } }));
  await seedVault(page);
  await page.evaluate(async () => {
    const cp = '/src/services/ai/configuration.ts', { readAiConfig, saveAiConfig } = await import(cp);
    const config = readAiConfig(localStorage);
    config.channels[2] = { ...config.channels[2], protocol: 'deepseek', baseUrl: 'https://c.mock.invalid/deepseek' };
    config.routes.variables = { mode: 'follow-story', independent: { channelId: 'b', modelId: 'b-variables' } };
    config.routes.memory = { mode: 'independent', channelId: 'c', modelId: 'c-memory' };
    saveAiConfig(localStorage, config);
  });
  await page.reload();
  const settings = await openAiSettings(page);
  // 旧配置里 DeepSeek 格式 + 第三方地址：按「OpenAI 兼容」显示，接口格式保留 DeepSeek。
  await openChannel(settings, '丙渠道');
  await expect(settings.getByRole('group', { name: '服务商', exact: true }).getByRole('button', { name: 'OpenAI 兼容', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('combobox', { name: '接口格式', exact: true })).toHaveAttribute('value', 'deepseek');
  await expect(settings).not.toContainText('官方地址已自动填写');
  // 乙渠道换成 Claude 官方：变量、动态世界隐藏着的乙渠道旧模型被清掉，渠道保留。
  await openChannel(settings, '乙渠道');
  await settings.getByRole('group', { name: '服务商', exact: true }).getByRole('button', { name: 'Claude', exact: true }).click();
  await page.getByRole('button', { name: '替换地址', exact: true }).click();
  await follow(settings, '变量管理', false);
  await expect(settings.getByRole('combobox', { name: '变量管理渠道', exact: true })).toHaveAttribute('value', 'b');
  await expect(settings.getByRole('combobox', { name: '变量管理模型', exact: true })).toHaveAttribute('value', '');
  await follow(settings, '动态世界', false);
  await expect(settings.getByRole('combobox', { name: '动态世界渠道', exact: true })).toHaveAttribute('value', 'b');
  await expect(settings.getByRole('combobox', { name: '动态世界模型', exact: true })).toHaveAttribute('value', '');
  // 正文（甲）和记忆（丙）不受影响。
  await expect(settings.getByRole('combobox', { name: '正文生成模型', exact: true })).toHaveAttribute('value', 'a-model');
  await expect(settings.getByRole('combobox', { name: '记忆维护模型', exact: true })).toHaveAttribute('value', 'c-memory');
  await expect(settings.locator('.ai-save-bar').getByRole('status')).toContainText('选了「单独指定」但还没选模型');
});

test('本地模型提示可以填占位密钥', async ({ page }) => {
  await page.goto('/');
  const settings = await openAiSettings(page);
  await addChannel(settings, { preset: '本地模型' });
  await expect(settings.getByLabel('服务地址', { exact: true })).toHaveValue('http://localhost:11434/v1');
  await expect(settings).toContainText('本地服务一般不需要真实密钥');
  await expect(settings.getByLabel('API 密钥', { exact: true })).toHaveAttribute('placeholder', '本地服务一般不校验，可填 ollama');
});

// 持续故障不会在第一次异常后自动解除；所有凭证均为隔离测试用值。
for (const mode of ['set', 'partial', 'remove', 'read'] as const) {
  test(`持续存储异常 ${mode}：原副本、精确回滚状态、未保存与成功重试`, async ({ page }, info) => {
    const posts: string[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://*.mock.invalid/**', route => {
      if (route.request().method() === 'POST') posts.push(route.request().url());
      return route.fulfill({ json: { data: [] } });
    });
    await seedVault(page);
    const before = await vaultDump(page), settings = await openAiSettings(page);
    await openChannel(settings, '甲渠道');
    await settings.getByLabel('API 密钥', { exact: true }).fill('secret-a-new');
    if (mode === 'remove') await settings.getByRole('switch', { name: '记住密钥' }).uncheck();
    if (mode === 'partial') {
      await openChannel(settings, '乙渠道'); await settings.getByRole('switch', { name: '记住密钥' }).check();
      await openChannel(settings, '丙渠道'); await settings.getByRole('button', { name: '删除渠道', exact: true }).click();
      await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
    }
    await page.evaluate(mode => {
      const control = { mode: mode as string, activated: false, hits: 0, mutations: [] as string[] };
      Reflect.set(window, '__vaultFault', control);
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      Storage.prototype.getItem = function(key) {
        if (control.mode === 'read' && key === 'heijin.credential.v1:a') {
          control.hits++; throw new DOMException('mock read denied', 'SecurityError');
        }
        return get.call(this, key);
      };
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('heijin.credential.v1:') || key === 'heijin.ai.v1') control.mutations.push(`set:${key}`);
        if (this === localStorage && ((control.mode === 'set' && key === 'heijin.credential.v1:a')
          || (control.mode === 'partial' && (key === 'heijin.credential.v1:b' || (control.activated && key === 'heijin.credential.v1:a'))))) {
          control.activated = true; control.hits++; throw new DOMException('mock write denied', 'QuotaExceededError');
        }
        return set.call(this, key, value);
      };
      Storage.prototype.removeItem = function(key) {
        if (key.startsWith('heijin.credential.v1:')) control.mutations.push(`remove:${key}`);
        if (control.mode === 'remove' && key === 'heijin.credential.v1:a') {
          control.hits++; throw new DOMException('mock remove denied', 'SecurityError');
        }
        return remove.call(this, key);
      };
    }, mode);
    const status = settings.locator('.ai-save-bar').getByRole('status'), save = settings.getByRole('button', { name: '保存 AI 配置', exact: true });
    await save.click(); await expect(status).toContainText('保存失败');
    if (mode === 'read') {
      await expect(status).toContainText('无法读取密钥存储');
      expect(await page.evaluate(() => Reflect.get(window, '__vaultFault').mutations)).toEqual([]);
    } else if (mode === 'partial' || mode === 'remove') {
      await expect(status).toContainText('没能完全恢复'); await expect(status).toContainText('甲渠道');
      await expect(status).toContainText('检查密钥存储状态'); await expect(status).not.toContainText('保持原样');
    }
    // Disarm only after the UI has handled a still-active, persistent fault.
    const fault = await page.evaluate(() => { const c = Reflect.get(window, '__vaultFault'); const copy = { hits: c.hits, mutations: [...c.mutations] }; c.mode = ''; return copy; });
    expect(fault.hits).toBeGreaterThan(0);
    const after = await vaultDump(page);
    expect(after.local['heijin.ai.v1']).toBe(before.local['heijin.ai.v1']);
    if (mode === 'set' || mode === 'read') expect(after).toEqual(before);
    if (mode === 'partial') {
      expect(after.local['heijin.credential.v1:a']).toBe('secret-a-new');
      expect(after.session['heijin.credential.v1:b']).toBe('secret-b');
      expect(after.local['heijin.credential.v1:b']).toBeUndefined();
      expect(after.local['heijin.credential.v1:c']).toBe('secret-c');
    }
    if (mode === 'remove') {
      expect(after.local['heijin.credential.v1:a']).toBe('secret-a');
      expect(after.session['heijin.credential.v1:a']).toBe('secret-a-new');
    }
    await expect(save).toBeEnabled(); await expect(settings).not.toContainText('secret-');
    await page.screenshot({ path: `docs/pr148-security/screenshots/${info.project.name}-${mode}-failure.png` });
    await saveAi(settings);
    const success = await vaultDump(page);
    expect(success.local['heijin.ai.v1']).not.toContain('secret-');
    expect(mode === 'remove' ? success.session['heijin.credential.v1:a'] : success.local['heijin.credential.v1:a']).toBe('secret-a-new');
    expect(mode === 'remove' ? success.local['heijin.credential.v1:a'] : success.session['heijin.credential.v1:a']).toBeUndefined();
    await page.screenshot({ path: `docs/pr148-security/screenshots/${info.project.name}-${mode}-saved.png` });
    await page.reload(); expect(await vaultDump(page)).toEqual(success);
    const reopened = await openAiSettings(page); await openChannel(reopened, '甲渠道');
    await expect(reopened.getByLabel('API 密钥', { exact: true })).toHaveValue('secret-a-new');
    await expect(reopened.getByRole('switch', { name: '记住密钥' })).toBeChecked({ checked: mode !== 'remove' });
    expect(posts).toEqual([]); expect(errors).toEqual([]);
  });
}

test('删除渠道后放弃不写凭证；明确保存才删除，重载保留其他渠道', async ({ page }) => {
  let posts = 0;
  await page.route('https://*.mock.invalid/**', route => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { data: [] } });
  });
  await seedVault(page); const before = await vaultDump(page), settings = await openAiSettings(page);
  await openChannel(settings, '丙渠道'); await settings.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click();
  expect(await vaultDump(page)).toEqual(before);
  await settings.getByRole('button', { name: '放弃修改', exact: true }).click();
  expect(await vaultDump(page)).toEqual(before);
  await openChannel(settings, '丙渠道'); await expect(settings.getByLabel('API 密钥', { exact: true })).toHaveValue('secret-c');
  await settings.getByRole('button', { name: '删除渠道', exact: true }).click();
  await page.getByRole('button', { name: '确认删除渠道', exact: true }).click(); await saveAi(settings);
  const after = await vaultDump(page);
  expect(after.local['heijin.credential.v1:c']).toBeUndefined(); expect(after.session['heijin.credential.v1:c']).toBeUndefined();
  expect(after.local['heijin.credential.v1:a']).toBe('secret-a'); expect(after.session['heijin.credential.v1:b']).toBe('secret-b');
  expect(JSON.parse(after.local['heijin.ai.v1']).channels.map((c: { id: string }) => c.id)).toEqual(['a', 'b']);
  await page.reload(); expect(await vaultDump(page)).toEqual(after); expect(posts).toBe(0);
});
