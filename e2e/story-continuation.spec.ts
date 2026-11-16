import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';

// 正文被截断：保留已写部分（刷新后仍在），玩家点「续写正文」从断点接着写，拼接去重后照常结算；也可按「发送」放弃并重新生成。
const head = '<thinking>保持当前行动连续。</thinking>\n<正文>第一段：雨丝斜着落进货场，老周蹲在';
const tail = '老周蹲在缆桩边上，烟头一明一灭。</正文>\n<短期记忆>码头见老周。</短期记忆>\n<变量规划>[]</变量规划>';
const fresh = '<thinking>重新开始。</thinking>\n<正文>第二种写法：主角直接走进货场。</正文>\n<短期记忆>走进货场。</短期记忆>\n<变量规划>[]</变量规划>';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map((p) => import(p)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    settings.runtime.streamStory = true;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://continuation.mock.invalid/v1'; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-continuation-key');
    const repo = await SaveRepository.open(), state = worldState(); state.openingCityId = 'chongqing'; state.protagonist.name = '沈砚';
    await repo.create(state); const draft = await completeDraft(repo);
    await repo.commitTurn({ draft, nextAction: '', useVariableStage: true, useWorldStage: true }); repo.close();
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
type Message = { role: string; content: string };
const variables = variableTextEnvelope('<说明>码头见老周，无数值变化。</说明>\n<命令>\n</命令>');
const world = '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [], "visibleHooks": [], "unresolved": []\n}';
/** 正文：普通请求第一次返回截断内容；带「【续写】」的请求返回续写；之后的普通请求（重新生成）返回完整新正文。 */
async function mock(page: Page) {
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
    const chunk = continuing ? { choices: [{ delta: { content: tail }, finish_reason: 'stop' }] }
      : truncated ? { choices: [{ delta: { content: fresh }, finish_reason: 'stop' }] }
      : { choices: [{ delta: { content: head }, finish_reason: 'length' }] };
    if (!continuing) truncated = true;
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
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
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
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  expect(requests.slice(before).every((messages) => !String(messages.at(-1)?.content).includes('【续写】'))).toBe(true);
  const settled = await stored(page);
  expect(settled.state.journal.at(-1)!.story.narrative).toContain('第二种写法');
});
