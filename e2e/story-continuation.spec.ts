import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// 正文被截断：保留已写部分（刷新后仍在），玩家点「续写正文」从断点接着写，拼接去重后照常结算；也可按「发送」放弃并重新生成。
const head = '<thinking>保持当前行动连续。</thinking>\n<正文>第一段：雨丝斜着落进货场，老周蹲在';
const tail = '老周蹲在缆桩边上，烟头一明一灭。</正文>\n<短期记忆>码头见老周。</短期记忆>\n<变量规划>[]</变量规划>';
const fresh = '<thinking>重新开始。</thinking>\n<正文>第二种写法：主角直接走进货场。</正文>\n<短期记忆>走进货场。</短期记忆>\n<变量规划>[]</变量规划>';

async function seed(page: Page, baseUrl = 'https://continuation.mock.invalid/v1') {
  await page.goto('/');
  await page.evaluate(async (baseUrl) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map((p) => import(p)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    settings.runtime.streamStory = true;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = baseUrl; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-continuation-key');
    const repo = await SaveRepository.open(), state = worldState(); state.openingCityId = 'chongqing'; state.protagonist.name = '沈砚';
    await repo.create(state); const draft = await completeDraft(repo);
    await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true }); repo.close();
  }, baseUrl);
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
type Message = { role: string; content: string };
const variables = variableTextEnvelope('<说明>码头见老周，无数值变化。</说明>\n<命令>\n</命令>');
const world = '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [], "visibleHooks": [], "unresolved": []\n}';
/**
 * 正文请求依次取下一条预设回复：{ text, finish }；finish 为 length 表示被截断。
 * 默认：第一次截断、续写写完、之后的普通请求（重新生成）返回完整新正文。
 */
type Reply = { text: string; finish: 'stop' | 'length' };
async function mock(page: Page, replies?: Reply[]) {
  const requests: Message[][] = [];
  let truncated = false;
  await page.route('https://continuation.mock.invalid/**', async (route) => {
    const body = route.request().postDataJSON(), stage = String(body.model);
    if (stage !== 'story') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: stage === 'variables' ? variables : world }, finish_reason: 'stop' }] }) }).catch(() => undefined);
      return;
    }
    const messages = body.messages as Message[]; requests.push(messages);
    const continuing = String(messages.at(-1)?.content).includes('【续写】');
    const reply = replies ? replies.shift()! : continuing ? { text: tail, finish: 'stop' } : truncated ? { text: fresh, finish: 'stop' } : { text: head, finish: 'length' };
    if (!continuing) truncated = true;
    const chunk = { choices: [{ delta: { content: reply.text }, finish_reason: reply.finish }] };
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n` }).catch(() => undefined);
  });
  return requests;
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } });
}
async function closeDiagnostics(page: Page) {
  const sheet = page.locator('dialog.mobile-diagnostics-sheet[open]');
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await expect(sheet).toBeHidden(); }
}
/** 三阶段结算在本地并行负载下可能超过默认 5 秒。 */
const settle = { timeout: 20_000 };
const continueButton = (page: Page) => page.getByRole('button', { name: '续写正文', exact: true });
async function truncate(page: Page) {
  await page.locator('#player-input').fill('去码头找老周');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).draft?.storyPartial?.text ?? '').toContain('老周蹲在');
  await closeDiagnostics(page);
}

test('正文被截断后保留已写部分，刷新仍在；续写从断点接着写，去重拼接后正常结算', async ({ page }) => {
  await seed(page); const requests = await mock(page);
  await truncate(page);
  const failed = await stored(page);
  expect(failed.draft).toMatchObject({ stageStatus: { story: 'failed' }, storyPartial: { continuations: 0 } });
  expect(failed.state.turnNumber).toBe(1);
  const reader = page.getByTestId('story-reader');
  await expect(reader.getByText('正文未写完', { exact: false })).toBeVisible();
  await expect(reader).toContainText('雨丝斜着落进货场，老周蹲在');
  await expect(continueButton(page)).toBeEnabled();
  const before = requests.length;

  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); await closeDiagnostics(page);
  await expect(page.getByTestId('story-reader')).toContainText('老周蹲在');
  await expect(continueButton(page)).toBeEnabled();
  expect(requests.length).toBe(before);

  await continueButton(page).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber, settle).toBe(2);
  const request = requests.at(-1)!;
  expect(request.at(-2)).toMatchObject({ role: 'assistant' });
  expect(request.at(-2)!.content).toBe(head);
  expect(request.at(-1)!.content).toContain('【续写】');
  // 续写请求前面的上下文与原请求相同（缓存前缀不变）；唯一差别是上下文末尾的草稿版本号（失败保存后加一）。
  const normalize = (messages: Message[]) => JSON.stringify(messages).replace(/\\"draftRevision\\":\d+/gu, '\\"draftRevision\\":N');
  expect(normalize(request.slice(0, -2))).toBe(normalize(requests[0]));
  const settled = await stored(page);
  const narrative = settled.state.journal.at(-1)!.story.narrative;
  expect(narrative).toContain('老周蹲在缆桩边上，烟头一明一灭。');
  expect(narrative).not.toContain('老周蹲在老周蹲在');
  expect(settled.draft?.storyPartial).toBeUndefined();
  await expect(page.getByTestId('story-reader').getByText('正文未写完', { exact: false })).toHaveCount(0);
});

test('截断后也可以按「发送」放弃已写部分，从头重新生成', async ({ page }) => {
  await seed(page); const requests = await mock(page);
  await truncate(page);
  await expect(page.locator('#player-input')).toHaveValue('去码头找老周');
  const before = requests.length;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber, settle).toBe(2);
  expect(requests.slice(before).every((messages) => !String(messages.at(-1)?.content).includes('【续写】'))).toBe(true);
  const settled = await stored(page);
  expect(settled.state.journal.at(-1)!.story.narrative).toContain('第二种写法');
});

test('连续截断：第二次续写又断了，第三次接着「第一次 + 第二次」的结尾写', async ({ page }) => {
  await seed(page);
  const requests = await mock(page, [
    { text: head, finish: 'length' },
    { text: '老周蹲在缆桩边上，烟头', finish: 'length' },
    { text: '边上，烟头一明一灭。</正文>\n<短期记忆>码头见老周。</短期记忆>\n<变量规划>[]</变量规划>', finish: 'stop' },
  ]);
  await truncate(page);
  await continueButton(page).click();
  await expect.poll(async () => (await stored(page)).draft?.storyPartial?.continuations).toBe(1);
  const second = await stored(page);
  expect(second.draft?.storyPartial?.text).toBe(`${head}缆桩边上，烟头`);
  await closeDiagnostics(page);
  await expect(page.getByTestId('story-reader')).toContainText('老周蹲在缆桩边上，烟头');
  await continueButton(page).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber, settle).toBe(2);
  expect(requests).toHaveLength(3);
  expect(requests[2]!.at(-2)!.content).toBe(`${head}缆桩边上，烟头`);
  const narrative = (await stored(page)).state.journal.at(-1)!.story.narrative;
  expect(narrative).toContain('老周蹲在缆桩边上，烟头一明一灭。');
  expect(narrative).not.toMatch(/老周蹲在老周蹲在|烟头烟头/u);
});

test('续写次数用完：已写部分仍显示、可复制，刷新后也在；不能再续写，可按「发送」重新生成', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  await seed(page); const requests = await mock(page);
  await truncate(page);
  await page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { const draft = (await repo.loadDraft('save-a'))!;
      await repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1, storyPartial: { ...draft.storyPartial!, continuations: 3 } }, draft.draftRevision, undefined, draft);
    } finally { repo.close(); }
  });
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); await closeDiagnostics(page);
  const reader = page.getByTestId('story-reader');
  await expect(reader).toContainText('雨丝斜着落进货场，老周蹲在');
  await expect(reader).toContainText('已续写 3 次，不能再续写');
  await expect(continueButton(page)).toHaveCount(0);
  await reader.getByRole('button', { name: '复制已写内容' }).click();
  await expect(reader.getByRole('button', { name: /已复制|复制失败/u })).toBeVisible();
  const before = requests.length;
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber, settle).toBe(2);
  expect(requests.slice(before).every((messages) => !String(messages.at(-1)?.content).includes('【续写】'))).toBe(true);
});

test('放弃这段：只清掉没写完的正文，不发请求、不撤回上一回合，原行动留在输入框', async ({ page }) => {
  await seed(page); const requests = await mock(page);
  await truncate(page);
  const failed = await stored(page), before = requests.length;
  await page.getByTestId('story-reader').getByRole('button', { name: '放弃这段' }).click();
  await expect.poll(async () => (await stored(page)).draft?.storyPartial).toBeUndefined();
  const discarded = await stored(page);
  expect(discarded.state).toEqual(failed.state);
  expect(discarded.draft).toMatchObject({ stageStatus: { story: 'failed' }, failures: failed.draft!.failures, userInput: failed.draft!.userInput });
  expect(requests.length).toBe(before);
  await expect(page.getByTestId('story-reader').getByText('正文未写完', { exact: false })).toHaveCount(0);
  await expect(continueButton(page)).toHaveCount(0);
  await expect(page.locator('#player-input')).toHaveValue('去码头找老周');
  await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible(); await closeDiagnostics(page);
  await expect(page.getByTestId('story-reader').getByText('正文未写完', { exact: false })).toHaveCount(0);
  expect(requests.length).toBe(before);
});

/** 续写的真实分段流式：模型把旧结尾约 300 字整段重写一遍，阅读区任何时刻都不能先显示重复段。 */
test.describe('续写流式显示', () => {
  const ending = '老周把烟头按灭在缆桩上，抬眼看了看你，像是早就等着这一刻，慢慢开口说道：';
  const longHead = '<thinking>保持当前行动连续。</thinking>\n<正文>' + '码头的灯一盏接一盏地亮起来，雨水顺着铁皮檐往下淌，远处货轮的汽笛压着江面。'.repeat(6) + ending;
  const repeated = longHead.slice(-300);
  const continuation = '<thinking>接着写。</thinking>\n<正文>' + repeated + '“货今晚到不了。”他把手插进口袋。</正文>\n<短期记忆>码头见老周。</短期记忆>\n<变量规划>[]</变量规划>';
  let server: Server, baseUrl = '';
  const frame = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
  test.beforeEach(async () => {
    server = createServer(async (req, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw), stage = String(body.model);
      if (stage !== 'story') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: stage === 'variables' ? variables : world }, finish_reason: 'stop' }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
      if (!String((body.messages as Message[]).at(-1)?.content).includes('【续写】')) { res.end(frame(longHead, 'length') + 'data: [DONE]\n\n'); return; }
      for (let i = 0; i < continuation.length; i += 9) { res.write(frame(continuation.slice(i, i + 9))); await new Promise((r) => setTimeout(r, 15)); }
      res.end(frame('', 'stop') + 'data: [DONE]\n\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing mock address');
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });
  test.afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  test('重复了约 300 字旧结尾、分小段到达：阅读区始终不出现重复段，结算后正文只有一份', async ({ page }) => {
    await seed(page, baseUrl);
    await page.locator('#player-input').fill('去码头找老周');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect.poll(async () => (await stored(page)).draft?.storyPartial?.text ?? '').toContain('慢慢开口说道');
    await closeDiagnostics(page);
    await page.evaluate((marker) => {
      const record = { max: 0, sawNew: false };
      (window as unknown as { __dup: typeof record }).__dup = record;
      const check = () => { const text = document.querySelector('[data-testid="story-reader"]')?.textContent ?? '';
        record.max = Math.max(record.max, text.split(marker).length - 1); if (text.includes('货今晚到不了')) record.sawNew = true; };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, '像是早就等着这一刻');
    await continueButton(page).click();
    await expect.poll(async () => (await stored(page)).state.turnNumber, settle).toBe(2);
    const seen = await page.evaluate(() => (window as unknown as { __dup: { max: number; sawNew: boolean } }).__dup);
    expect(seen.sawNew).toBe(true);
    expect(seen.max).toBe(1);
    const narrative = (await stored(page)).state.journal.at(-1)!.story.narrative;
    expect(narrative.split('像是早就等着这一刻').length - 1).toBe(1);
    expect(narrative).toContain('“货今晚到不了。”他把手插进口袋。');
  });
});
