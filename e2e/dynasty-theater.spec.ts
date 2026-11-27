import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { openLibrary, openStoredSave } from './helpers/home';
import { openSettings } from './helpers/gameLayout';

const secret = 'sk-theater-browser-fixture';
const first = Array.from({ length: 580 }, (_, i) => `展厅第 ${i + 1} 扇窗透出一线微光。管理员把新购的蓝釉瓷杯摆进玻璃展柜，核对馆藏编号。\n\n`).join('');
const privateText = '剧场专属虚构正文';
const streamDelta = (text: string, reasoning_content?: string) => 'data: ' +
  JSON.stringify({ choices: [{ delta: { content: text, reasoning_content } }] }) + '\n\n';
type Wire = { model: string; stream: boolean; messages: { role: string; content: string }[] };

async function mock() {
  let mode: 'complete' | 'hold' | 'limit' | 'fail' = 'complete', text = first;
  const wires: { path: string; auth?: string; body: Wire }[] = [];
  let active = 0;
  const service = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'POST') { response.writeHead(404).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Wire;
    wires.push({ path: request.url ?? '', auth: request.headers.authorization, body });
    if (mode === 'fail') {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Mock 服务失败' } }));
      return;
    }
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        choices: [{ message: { content: text, reasoning_content: '独立的公开思考' }, finish_reason: mode === 'limit' ? 'length' : 'stop' }],
      }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(streamDelta('', '独立的公开思考'));
    response.write(streamDelta(text));
    if (mode === 'hold') { active++; response.once('close', () => { active--; }); return; }
    response.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: mode === 'limit' ? 'length' : 'stop' }] }) +
      '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + (service.address() as AddressInfo).port;
  return { endpoint, wires, active: () => active, set(nextText: string, nextMode: typeof mode = 'complete') { text = nextText; mode = nextMode; },
    close: () => { service.closeAllConnections(); return new Promise<void>((resolve, reject) => service.close(error => error ? reject(error) : resolve())); } };
}

async function seed(page: Page, endpoint: string, appearance: 'day' | 'night') {
  await page.goto('/');
  await page.evaluate(async ({ endpoint, appearance, secret }) => {
    const rp = '/src/services/storage/saveRepository.ts', gp = '/src/tests/fixtures/game.ts',
      sp = '/src/ui/settings/model.ts', ap = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts',
      dp = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(rp), { game } = await import(gp), { createTurnDraft } = await import(dp),
      { defaultSettings, settingsKey } = await import(sp), { defaultAiConfig, newChannel, saveAiConfig } = await import(ap),
      { CredentialVault } = await import(vp);
    const repo = await SaveRepository.open();
    const state = game('save-a');
    state.title = '剧场验收存档';
    state.openingTimePending = undefined; state.openingInitializationPending = undefined;
    state.revision = 1; state.turnNumber = 1;
    state.journal = [{ turnId: 'committed-opening', revision: 1, relatedActorRefs: [],
      story: { turnKind: 'opening', narrative: '正式主线在照相馆开门。', summary: '照相馆开门', variableGuide: [] } }];
    try {
      const entry = { state, draft: createTurnDraft(state.saveId, state.revision, 'next-turn', 'regular', '', false, false) };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    } finally { repo.close(); }
    const settings = defaultSettings();
    settings.display.appearance = appearance;
    settings.runtime.useEntityStage = false; settings.runtime.useVariableStage = false;
    settings.runtime.useWorldStage = false;
    settings.runtime.streamStory = true;
    settings.prompts.actionOptions = false;
    settings.prompts.minNarrativeChars = 1;
    settings.memory.automaticMaintenance = false;
    for (const setting of Object.values(settings.memory.summaries) as { automatic: boolean }[]) setting.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel();
    channel.name = '本地模拟'; channel.defaultModel = 'story-mock'; channel.baseUrl = endpoint + '/v1';
    channel.parameters = { temperature: 0.4, maxOutputTokens: 32100 };
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story-mock' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, secret, true);
  }, { endpoint, appearance, secret });
  await page.reload();
  await openStoredSave(page, '剧场验收存档');
  await expect(page.locator('.game-layout')).toBeVisible();
}

async function localOnly(context: BrowserContext, endpoint: string) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === endpoint || url.origin === 'http://127.0.0.1:5174') return route.continue();
    return route.abort('blockedbyclient');
  });
}

async function openTheater(page: Page) {
  await expect(page.locator('.game-layout')).toBeVisible();
  const mobile = page.locator('[data-mobile-tab="world"]');
  if (await mobile.isVisible()) await mobile.click();
  await page.getByRole('button', { name: '小剧场', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '王朝小剧场', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return { main: await repo.loadGame('save-a'), backup: await repo.exportBackup(['save-a']) }; }
    finally { repo.close(); }
  });
}

test('日间 · 自定义万字剧场、长文滚动、复制、续写、Roll、备份和主线隔离', async ({ page, context }, info) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seed(page, api.endpoint, 'day');
    const before = (await stored(page)).main;
    const panel = await openTheater(page);
    await expect(panel.getByText('档案尚空')).toBeVisible();
    expect(api.wires).toHaveLength(0);
    await panel.getByRole('button', { name: '新建小剧场' }).click();
    await panel.getByLabel('标题（选填）').fill('未开门的展厅');
    await panel.getByLabel('主题', { exact: true }).fill('博物馆管理员的非正史日常');
    await panel.getByRole('radio', { name: /^自定义/ }).check();
    await panel.getByLabel('目标字数').fill('18000');
    await panel.getByRole('radio', { name: '单独指定' }).check();
    await panel.getByLabel('选择渠道').selectOption({ label: '本地模拟 · openai' });
    await panel.getByLabel('模型 ID').fill('theater-mock');
    await panel.getByRole('button', { name: '新建并生成' }).click();
    await expect(panel.getByText('正文已保存。')).toBeVisible();
    await expect(panel.getByRole('article', { name: '小剧场正文' })).toContainText('展厅第 1 扇窗');
    expect(first.length).toBeGreaterThan(15000);
    expect(api.wires).toHaveLength(1);
    expect(api.wires[0]).toMatchObject({ path: '/v1/chat/completions', auth: 'Bearer ' + secret,
      body: { model: 'theater-mock', stream: true } });
    expect(api.wires[0].body.messages[1].content).toContain('"targetCharacters":18000');
    expect(api.wires[0].body.messages[1].content).toContain('照相馆开门');
    await expect(panel.locator('.theater-scroll')).toBeVisible();
    const viewport = panel.locator('.theater-scroll');
    expect(await viewport.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await panel.evaluate(element => element.scrollTop)).toBe(0);
    await viewport.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath('theater-day.png'), animations: 'disabled' });
    await panel.getByRole('button', { name: '下一段' }).click();
    await expect(panel.getByRole('article', { name: '小剧场正文' })).toContainText('展厅第 580 扇窗');
    await panel.getByRole('button', { name: '上一段' }).click();
    await expect(panel.getByRole('article', { name: '小剧场正文' })).toContainText('展厅第 1 扇窗');
    await panel.getByRole('button', { name: '复制全文' }).click();
    await expect(panel.getByText('已复制全文。')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    expect(api.wires).toHaveLength(1);

    api.set('锁门前，管理员最后看了一眼展柜。');
    await panel.getByRole('button', { name: '继续写作' }).click();
    await expect.poll(async () => (await stored(page)).backup[0].theaters[0].body).toContain('锁门前');
    expect(api.wires).toHaveLength(2);
    expect(api.wires[1].body.messages[1].content).toContain('"omitted":true');
    expect(api.wires[1].body.messages[1].content).toContain('展厅第 1 扇窗');

    api.set('失败片段', 'fail');
    await panel.getByRole('button', { name: '重新 Roll', exact: true }).click();
    await panel.getByRole('button', { name: '确认重新 Roll' }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    expect(api.wires).toHaveLength(3);
    expect((await stored(page)).backup[0].theaters[0].body).toContain('锁门前');

    api.set(privateText + '。雨势减弱，收工的管理员沿河散步。');
    await panel.getByRole('button', { name: '重新 Roll', exact: true }).click();
    await panel.getByRole('button', { name: '确认重新 Roll' }).click();
    await expect(panel.getByText('正文已保存。')).toBeVisible();
    expect(api.wires).toHaveLength(4);
    const after = await stored(page);
    expect(after.main).toEqual(before);
    expect(after.backup[0].theaters[0].body).toContain(privateText);
    expect(JSON.stringify(after.backup)).not.toMatch(new RegExp(secret + '|独立的公开思考'));
    await panel.getByRole('button', { name: '更多' }).click();
    await panel.getByRole('button', { name: '重命名' }).click();
    await panel.getByLabel('新标题').fill('沿河散步');
    await panel.getByRole('button', { name: '保存标题' }).click();
    await expect(panel.getByRole('heading', { name: '沿河散步' })).toBeVisible();
    await page.reload();
    const restored = await openTheater(page);
    await restored.getByRole('button', { name: '沿河散步' }).click();
    await expect(restored.getByRole('article', { name: '小剧场正文' })).toContainText(privateText);
    expect(api.wires).toHaveLength(4);

    // The next real Story request uses only Story modules and the committed timeline.
    await page.keyboard.press('Escape');
    await expect(restored).toBeHidden();
    api.set('<正文>他回到照相馆。太阳升起了。</正文><短期记忆>返回照相馆。</短期记忆><变量规划>[]</变量规划>');
    const action = page.getByRole('textbox', { name: '你的行动' });
    await action.fill('我回照相馆收整相片。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(() => api.wires.length).toBe(5);
    expect(JSON.stringify(api.wires[4].body)).toContain('我回照相馆收整相片');
    expect(JSON.stringify(api.wires[4].body)).not.toMatch(/THEATER_|剧场专属虚构正文|博物馆管理员的非正史日常/);
  } finally { await api.close(); }
});

test('夜间 · 跨标签锁、实际停止、保留与另存未完篇，操作零额外请求', async ({ page, context }, info) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await seed(page, api.endpoint, 'night');
    const before = (await stored(page)).main;
    const panel = await openTheater(page);
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 568 });
    api.set('第一段已写出，河面映着旧电车的灯。', 'hold');
    await panel.getByRole('button', { name: '新建小剧场' }).click();
    await panel.getByLabel('主题', { exact: true }).fill('雨夜电车');
    await panel.getByRole('button', { name: '新建并生成' }).click();
    await expect(panel.getByRole('article')).toContainText('第一段已写出');
    await expect.poll(api.active).toBe(1);
    await page.screenshot({ path: info.outputPath('theater-night.png'), animations: 'disabled' });

    const other = await context.newPage();
    await other.goto(page.url());
    await expect(other.locator('.game-layout')).toBeVisible();
    const otherPanel = await openTheater(other);
    await otherPanel.getByRole('button', { name: '雨夜电车', exact: true }).click();
    await otherPanel.getByRole('button', { name: '生成正文', exact: true }).click();
    await expect(otherPanel.getByRole('alert')).toContainText('其他标签');
    expect(api.wires).toHaveLength(1);
    await other.close();

    await panel.getByRole('button', { name: '停止生成' }).click();
    await expect.poll(api.active).toBe(0);
    await expect(panel.getByText('生成已停止。', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '保留已写部分' }).click();
    await expect(panel.getByText('已保留这段正文，可手动续写。')).toBeVisible();
    expect((await stored(page)).backup[0].theaters[0]).toMatchObject({ status: 'stopped', body: expect.stringContaining('第一段已写出') });

    api.set('另一条分支开篇。', 'limit');
    await panel.getByRole('button', { name: '重新 Roll', exact: true }).click();
    await panel.getByRole('button', { name: '确认重新 Roll' }).click();
    await panel.getByRole('button', { name: '另存为未完篇' }).click();
    await expect(panel.getByRole('heading', { name: '雨夜电车（未完篇）' })).toBeVisible();
    expect(api.wires).toHaveLength(2);
    await panel.getByRole('button', { name: '返回列表' }).click();
    const originals = panel.getByRole('button', { name: '雨夜电车', exact: true });
    await expect(originals).toBeVisible();
    await expect(panel.getByRole('button', { name: '雨夜电车（未完篇）', exact: true })).toBeVisible();
    await originals.click();
    await expect(panel.getByRole('article')).toContainText('第一段已写出');
    await panel.getByRole('button', { name: '更多' }).click();
    await panel.getByRole('button', { name: '删除小剧场', exact: true }).click();
    await panel.getByRole('button', { name: '确认删除小剧场' }).click();
    await expect(panel.getByRole('button', { name: '雨夜电车（未完篇）' })).toBeVisible();
    await expect(originals).toHaveCount(0);
    expect(api.wires).toHaveLength(2);
    expect((await stored(page)).main).toEqual(before);
  } finally { await api.close(); }
});

test('设置可编辑与恢复独立提示词，非流式请求沿用冻结值', async ({ page, context }) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await seed(page, api.endpoint, 'day');
    await openSettings(page);
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await settings.getByRole('button', { name: '提示词管理', exact: true }).click();
    await settings.locator('summary').filter({ hasText: '小剧场提示词' }).click();
    await settings.getByLabel('小剧场创作提示词').fill('测试创作规则，只使用这份独立提示词。');
    await settings.getByRole('button', { name: '保存本地设置' }).click();
    await settings.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    const panel = await openTheater(page);
    api.set('日已西斜。');
    await panel.getByRole('button', { name: '新建小剧场' }).click();
    await panel.getByLabel('主题', { exact: true }).fill('日暮');
    await panel.getByLabel('流式显示正文').uncheck();
    await panel.getByRole('button', { name: '新建并生成' }).click();
    await expect(panel.getByText('正文已保存。')).toBeVisible();
    expect(api.wires).toHaveLength(1);
    expect(api.wires[0].body.stream).toBe(false);
    expect(api.wires[0].body.messages[0].content).toBe('测试创作规则，只使用这份独立提示词。');
    await page.keyboard.press('Escape');
    await openSettings(page);
    await settings.getByRole('button', { name: '提示词管理', exact: true }).click();
    await settings.locator('summary').filter({ hasText: '小剧场提示词' }).click();
    await settings.getByRole('button', { name: '恢复小剧场默认提示词' }).click();
    await settings.getByRole('button', { name: '保存本地设置' }).click();
    await settings.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    const saved = await openTheater(page);
    await saved.getByRole('button', { name: '日暮', exact: true }).click();
    await saved.getByRole('button', { name: '继续写作' }).click();
    await expect(saved.getByText('正文已保存。')).toBeVisible();
    expect(api.wires).toHaveLength(2);
    expect(api.wires[1].body.messages[0].content).toBe(api.wires[0].body.messages[0].content);
  } finally { await api.close(); }
});

test('备份标记跟随小剧场，另一标签的存档馆即时刷新，V2 导入恢复', async ({ page, context, isMobile }) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await seed(page, api.endpoint, 'day');
    const mainBefore = (await stored(page)).main.state;
    const library = await context.newPage();
    await library.goto('/');
    await openLibrary(library);
    if (isMobile) {
      const ticket = library.locator('.mh-ticket-wrap').filter({ hasText: '剧场验收存档' });
      await library.getByRole('button', { name: '第 1 张', exact: true }).click();
      await expect(ticket).toHaveAttribute('aria-current', 'true');
    }
    const badge = library.locator(isMobile ? '.mh-backup' : '.save-card .backup-line').first();
    const download = async () => {
      const event = library.waitForEvent('download');
      await library.getByRole('button', { name: '导出备份', exact: true }).first().click();
      const file = await (await event).path();
      if (!file) throw new Error('备份未下载');
      await expect(badge).toHaveText('已备份 · 今天');
      return file;
    };
    await expect(badge).toHaveText('从未备份');
    await download();

    const panel = await openTheater(page);
    api.set('独立档案的已保存正文。');
    await panel.getByRole('button', { name: '新建小剧场' }).click();
    await panel.getByLabel('主题', { exact: true }).fill('独立档案');
    await panel.getByRole('button', { name: '新建并生成' }).click();
    await expect(panel.getByText('正文已保存。')).toBeVisible();
    await expect(badge).toHaveText('备份后小剧场有变动');
    const file = await download();

    await panel.getByRole('button', { name: '更多' }).click();
    await panel.getByRole('button', { name: '重命名' }).click();
    await panel.getByLabel('新标题').fill('另一份档案名');
    await panel.getByRole('button', { name: '保存标题' }).click();
    await expect(panel.getByRole('heading', { name: '另一份档案名' })).toBeVisible();
    await expect(badge).toHaveText('备份后小剧场有变动');
    await download();
    // 以此主题新建：带上原主题与设置进入新建页，不发请求、不改动原篇。
    await panel.getByRole('button', { name: '更多' }).click();
    await panel.getByRole('button', { name: '以此主题新建' }).click();
    await expect(panel.getByLabel('主题', { exact: true })).toHaveValue('独立档案');
    await expect(panel.getByLabel('标题（选填）')).toHaveValue('另一份档案名');
    await expect(panel.getByRole('radio', { name: '跟随主线' })).toBeChecked();
    await expect(panel.getByRole('complementary', { name: '本场设定' })).toContainText('主线第');
    await panel.getByRole('button', { name: '返回列表' }).click();
    await expect(panel.locator('.theater-list > li')).toHaveCount(1);
    await expect(badge).toHaveText('已备份 · 今天');
    await panel.getByRole('button', { name: '另一份档案名', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '另一份档案名' })).toBeVisible();
    await panel.getByRole('button', { name: '更多' }).click();
    await panel.getByRole('button', { name: '删除小剧场', exact: true }).click();
    await panel.getByRole('button', { name: '确认删除小剧场' }).click();
    await expect(panel.getByText('档案尚空')).toBeVisible();
    await expect(badge).toHaveText('备份后小剧场有变动');

    const importButton = library.getByRole('button', { name: '导入备份', exact: true });
    if (isMobile) {
      const chooser = library.waitForEvent('filechooser');
      await importButton.click();
      await (await chooser).setFiles(file);
    } else {
      await importButton.click();
      await library.locator('.backup-import-dialog input[type=file]').setInputFiles(file);
    }
    await library.getByRole('button', { name: '覆盖并导入' }).click();
    await expect(badge).toHaveText('已备份 · 今天');
    const recovered = await stored(library);
    expect(recovered.main.state).toEqual(mainBefore);
    expect(recovered.backup[0].theaters).toEqual([expect.objectContaining({ title: '独立档案', body: '独立档案的已保存正文。' })]);
    expect(api.wires).toHaveLength(1);
  } finally { await api.close(); }
});

test('离开守护覆盖关闭、Escape、视口切换及页面切换，原文和未完篇均保留', async ({ page, context, isMobile }) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await seed(page, api.endpoint, 'night');
    const panel = await openTheater(page);
    const leave = page.getByRole('dialog', { name: '离开小剧场？', exact: true });
    api.set('旧电车载着最后一个归客。', 'hold');
    await panel.getByRole('button', { name: '新建小剧场' }).click();
    await panel.getByLabel('主题', { exact: true }).fill('最后一班电车');
    await panel.getByRole('button', { name: '新建并生成' }).click();
    await expect(panel.getByRole('article')).toContainText('旧电车载着最后一个归客');
    await panel.getByRole('button', { name: '关闭资料界面' }).click();
    await expect(leave.getByRole('button', { name: '继续生成' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(leave).toBeHidden();
    await expect(panel.getByRole('button', { name: '停止生成' })).toBeVisible();
    await expect.poll(api.active).toBe(1);
    await page.keyboard.press('Escape');
    await leave.getByRole('button', { name: '停止并查看正文' }).click();
    await expect.poll(api.active).toBe(0);
    await panel.getByRole('button', { name: '保留已写部分' }).click();
    await expect(panel.getByText('已保留这段正文，可手动续写。')).toBeVisible();

    api.set('新版本仍在雨夜。', 'limit');
    await panel.getByRole('button', { name: '重新 Roll', exact: true }).click();
    await panel.getByRole('button', { name: '确认重新 Roll' }).click();
    await expect(panel.getByRole('button', { name: '另存为未完篇', exact: true })).toBeVisible();
    const originalViewport = page.viewportSize();
    if (!originalViewport) throw new Error('缺少浏览器视口');
    await page.setViewportSize(isMobile ? { width: 1000, height: 720 } : { width: 390, height: 700 });
    await expect(panel.getByRole('article')).toContainText('新版本仍在雨夜');
    await page.setViewportSize(originalViewport);
    await expect(panel.getByRole('article')).toContainText('新版本仍在雨夜');

    const leaveFromAnotherEntry = () => isMobile
      ? page.evaluate(() => { history.back(); })
      : page.getByRole('button', { name: 'NPC', exact: true }).click();
    await leaveFromAnotherEntry();
    await expect(leave.getByRole('button', { name: '另存为未完篇并离开' })).toBeVisible();
    await leave.getByRole('button', { name: '留在小剧场' }).click();
    await expect(panel.getByRole('article')).toContainText('新版本仍在雨夜');
    // The canceled browser back restored the current hash in its history slot.
    if (isMobile) await page.evaluate(() => { location.hash = ''; });
    else await leaveFromAnotherEntry();
    await leave.getByRole('button', { name: '另存为未完篇并离开' }).click();
    await expect(panel).toBeHidden();
    if (isMobile) await expect(page.locator('.mobile-home')).toBeVisible();
    else await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toBeVisible();
    const after = await stored(page);
    expect(after.backup[0].theaters).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '最后一班电车', body: '旧电车载着最后一个归客。', status: 'stopped' }),
      expect.objectContaining({ title: '最后一班电车（未完篇）', body: '新版本仍在雨夜。', status: 'partial' }),
    ]));
    expect(after.backup[0].theaters).toHaveLength(2);
    expect(api.wires).toHaveLength(2);

    if (isMobile) await openStoredSave(page, '剧场验收存档');
    const reopened = await openTheater(page);
    await reopened.getByRole('button', { name: '最后一班电车', exact: true }).click();
    api.set('这段未完稿会被放弃。', 'limit');
    await reopened.getByRole('button', { name: '继续写作', exact: true }).click();
    await reopened.getByRole('button', { name: '保留已写部分' }).waitFor();
    await reopened.getByRole('button', { name: '返回列表' }).click();
    await leave.getByRole('button', { name: '放弃并离开' }).click();
    await expect(reopened.getByRole('button', { name: '最后一班电车', exact: true })).toBeVisible();
    expect((await stored(page)).backup).toEqual(after.backup);
    expect(api.wires).toHaveLength(3);
  } finally { await api.close(); }
});

test('旧设置的新建默认值与自定义剧场、手机共用草稿及真实出站', async ({ page, context }) => {
  const api = await mock();
  try {
    await localOnly(context, api.endpoint);
    await seed(page, api.endpoint, 'day');
    const panel = await openTheater(page);
    await panel.getByRole('button',{name:'新建小剧场'}).click();
    await expect(panel.locator('[name="theater-length"][value="medium"]')).toBeChecked();
    await expect(panel.locator('[name="theater-perspective"][value="follow"]')).toBeChecked();
    await page.keyboard.press('Escape');
    await openSettings(page);
    const settings = page.getByRole('dialog',{ name:'设置',exact:true });
    const {settingsCategory} = await import('./helpers/aiSettings');
    await settingsCategory(page,'手机');
    const limit = settings.getByRole('group',{name:'每条群消息最多回复人数'});
    await expect(limit.getByRole('button',{name:'不限'})).toHaveAttribute('aria-pressed','true');
    await expect(settings.getByLabel('贷款到期提醒天数')).toHaveValue('3');
    await limit.getByRole('button',{name:'2 人'}).click();
    await settings.getByLabel('贷款到期提醒天数').fill('0');
    await settingsCategory(page,'小剧场');
    await expect(page.getByRole('dialog',{name:'本地偏好尚未保存'})).toHaveCount(0);
    await settings.getByRole('button',{name:'自定义',exact:true}).click();
    await settings.getByLabel('目标字数').fill('1780');
    await settings.getByRole('button',{name:'第一人称',exact:true}).click();
    await settings.getByRole('button',{name:'保存本地设置'}).click();
    await settings.getByRole('button',{name:'关闭资料界面'}).click();
    await page.evaluate(async () => {
      const path = '/src/services/ai/configuration.ts';
      const {readAiConfig,saveAiConfig} = await import(path);
      const config = readAiConfig(localStorage);
      config.routes.theater = {mode:'independent',channelId:config.channels[0].id,modelId:'theater-default'};
      saveAiConfig(localStorage,config);
    });
    await page.reload();
    await openTheater(page);
    await panel.getByRole('button',{name:'新建小剧场'}).click();
    await expect(panel.locator('[name="theater-length"][value="custom"]')).toBeChecked();
    await expect(panel.getByLabel('目标字数')).toHaveValue('1780');
    await expect(panel.locator('[name="theater-perspective"][value="first"]')).toBeChecked();
    await expect(panel.getByText(/theater-default/).first()).toBeVisible();
    await panel.getByLabel('目标字数').fill('1500');
    await panel.getByLabel('主题',{exact:true}).fill('窗边的花');
    await panel.getByLabel('流式显示正文').uncheck();
    expect(api.wires).toHaveLength(0);
    await panel.getByRole('button',{name:'新建并生成'}).click();
    await expect(panel.getByText('正文已保存。')).toBeVisible();
    expect(api.wires.map(w => w.body.model)).toEqual(['theater-default']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!))).toMatchObject({
      theater:{length:'custom', customChars:1780,perspective:'first'},phone:{loanReminderDays:0,groupReplyLimit:2},
    });
  } finally { await api.close(); }
});
