import { createServer } from 'node:http';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openWorkflowDiagnostics } from './helpers/gameLayout';

const narrative = '【旁白】十月中旬的重庆，连着下了两天秋雨。\n【吴杰涛】“你还没走啊？”\n【吴杰】“等雨小一点，我就走。”\n【旁白】门帘被风掀起，路灯在积水里晃了晃。\n【陈宁】\n“伞在门边。\n别忘了带。”\n【吴杰】“好，明天见。”';
const current = '【旁白】雨渐渐停了。\n【吴杰涛】“那我们明天见。”\n【吴杰】“明天见。”';
async function seed(page: Page, options: { history?: string; draft?: string; baseUrl?: string }) {
  await page.goto('/');
  await page.evaluate(async options => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/domain/drafts.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { createTurnDraft, rerollStory }, { completeDraft, submission }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    if (options.baseUrl) {
      const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = options.baseUrl;
      config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
      config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
      config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
      saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-reading-key');
    }
    const state = worldState(); state.protagonist.name = '吴杰';
    const repo = await SaveRepository.open();
    try {
      await repo.create(state);
      let draft;
      if (options.history) {
        const complete = await completeDraft(repo, { narrative: options.history, variables: { commands: [], rejectedSuggestions: [], unresolved: [] } });
        draft = (await repo.commitTurn(submission(complete, '看窗外'))).draft;
      } else { draft = createTurnDraft('save-a', 0, 'reading-opening', 'opening', ''); await repo.saveDraft(draft, null); }
      if (options.draft) await repo.saveDraft(rerollStory(draft, { turnKind: draft.turnKind, narrative: options.draft, summary: '等雨停。', variableGuide: [] }), draft.draftRevision);
    } finally { repo.close(); }
  }, options);
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function readingOrder(page: Page) {
  const first = page.getByTestId('story-reader').locator('.story-reading').first();
  await expect(first.locator('.story-speaker')).toHaveText(['吴杰涛', '吴杰', '陈宁', '吴杰']);
  await expect(first.locator('.story-narration')).toHaveText(['十月中旬的重庆，连着下了两天秋雨。', '门帘被风掀起，路灯在积水里晃了晃。']);
  expect(await first.locator(':scope > *').evaluateAll(elements => elements.map(el => el.classList.contains('story-dialogue') ? el.querySelector('.story-speaker')!.textContent : '旁白')))
    .toEqual(['旁白', '吴杰涛', '吴杰', '旁白', '陈宁', '吴杰']);
  await expect(first).not.toContainText('【');
  await expect(first.locator('.story-bubble').nth(2)).toHaveText('“伞在门边。\n别忘了带。”', { useInnerText: false });
  for (const row of await first.locator('.story-dialogue').all()) {
    const hero = await row.evaluate(el => el.classList.contains('story-dialogue-hero'));
    const name = await row.locator('.story-speaker').textContent();
    expect(hero).toBe(name === '吴杰');
    const avatar = (await row.locator('.story-avatar').boundingBox())!, bubble = (await row.locator('.story-bubble').boundingBox())!;
    const desktop = (page.viewportSize()?.width ?? 0) > 900;
    if (hero && !desktop) expect(avatar.x).toBeGreaterThan(bubble.x + bubble.width);
    else expect(avatar.x + avatar.width).toBeLessThan(bubble.x);
    await expect(row.locator('.story-avatar')).toHaveAttribute('aria-hidden', 'true');
    expect(await row.locator('.story-speaker').evaluate(el => getComputedStyle(el).textAlign)).toBe(hero && !desktop ? 'right' : 'start');
  }
}

test('历史与草稿共享阅读布局：PC剧本、手机原气泡，顺序和原文持久化不变', async ({ page }, info) => {
  let aiCalls = 0;
  page.on('request', request => { if (request.method() === 'POST') aiCalls++; });
  await seed(page, { history: narrative, draft: current });
  const before = await stored(page);
  expect(before.state.journal[0].story.narrative).toBe(narrative); expect(before.draft.story.narrative).toBe(current);
  await expect(page.getByTestId('story-reader').locator('.story-reading')).toHaveCount(2);
  await readingOrder(page);
  await page.getByTestId('story-reader').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('story-reading.png') });
  await page.reload(); await readingOrder(page); expect(await stored(page)).toEqual(before); expect(aiCalls).toBe(0);
});

test('旧无标签和损坏标签仍为普通小说文字，不执行HTML、不写入存档', async ({ page }) => {
  const old = '这是旧存档的正文。\n\n她读到纸上的【林舟】二字。\n【】标签损坏\n【吴杰\n<script>window.readingInjected = true</script>';
  await seed(page, { history: old, draft: old }); const before = await stored(page);
  const reader = page.getByTestId('story-reader'); await expect(reader.locator('.story-dialogue')).toHaveCount(0);
  expect(await reader.locator('.story-reading').first().textContent()).toBe(old);
  expect(await page.evaluate(() => Reflect.get(window, 'readingInjected'))).toBeUndefined();
  await page.reload(); expect(await stored(page)).toEqual(before);
});

test('窄屏长姓名、多行气泡与长文本可滚动，输入区仍可触达且不横向溢出', async ({ page }) => {
  await seed(page, { draft: `【旁白】${'雨声与脚步声交错。'.repeat(60)}\n【名字很长的临时来访者】“${'A'.repeat(160)}”\n【吴杰】“第一行。\n第二行。”` });
  for (const width of [320, 390, 820]) {
    await page.setViewportSize({ width, height: 650 });
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth)).toBe(true);
    expect(await page.getByTestId('story-reader').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByTestId('story-reader').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('story-reader').locator('.story-dialogue-hero')).toBeInViewport();
    await page.getByLabel('你的行动', { exact: true }).fill('保留输入');
    await expect(page.getByLabel('你的行动', { exact: true })).toBeInViewport();
  }
});

test('真实流式预览完成后切换气泡，Variables/World收到原标签，自动结算与原文查看不变', async ({ page }) => {
  const requests: { model: string; messages: { content: string }[] }[] = [];
  let finishStory: (() => void) | undefined;
  const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const prefix = '<thinking>沿用当前场景。</thinking><正文>';
  const suffix = '</正文><短期记忆>在门边等雨停，约定明天再见。</短期记忆><变量规划>[]</变量规划>';
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    let body = ''; for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body); requests.push(input);
    if (input.model === 'story') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders();
      response.write(frame(prefix + narrative.slice(0, 32)));
      finishStory = () => response.end(frame(narrative.slice(32) + suffix) + 'data: [DONE]\n\n');
    } else {
      const text = input.model === 'variables' ? '<thinking>没有状态变化。</thinking><说明>人物交谈。</说明><命令></命令>'
        : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('mock port missing');
    await seed(page, { baseUrl: `http://127.0.0.1:${address.port}/v1` }); await openGameTools(page);
    await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
    const preview = page.getByRole('article', { name: '流式正文预览' });
    await expect(preview).toContainText('【旁白】'); await expect(preview.locator('.story-dialogue')).toHaveCount(0);
    finishStory!();
    await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
    await expect(preview).toHaveCount(0); await readingOrder(page);
    expect(requests.map(request => request.model)).toEqual(['story', 'variables', 'world']);
    for (const request of requests.slice(1)) {
      const message = request.messages.find(message => message.content.startsWith('<GAME_CONTEXT>'))!;
      const context = JSON.parse(message.content.replace(/^<GAME_CONTEXT>\n/, '').replace(/\n<\/GAME_CONTEXT>$/, ''));
      expect(context.STORY_RESULT.narrative).toBe(narrative);
    }
    await openWorkflowDiagnostics(page); await page.getByText('查看三阶段模型完整原文与执行结果', { exact: true }).click();
    await page.getByText('正文模型原文', { exact: true }).click();
    expect(await page.getByLabel('正文模型完整原文').textContent()).toBe(prefix + narrative + suffix);
    const before = await stored(page); expect(before.state.journal[0].story.narrative).toBe(narrative);
    await page.reload(); await readingOrder(page); expect(await stored(page)).toEqual(before); expect(requests).toHaveLength(3);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
