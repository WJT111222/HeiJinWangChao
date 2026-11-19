import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { chooseCustomProfession } from './helpers/creation';
import { openWorkflow } from './helpers/gameLayout';
import { openingGuideTimes, openingGuideEntry, wrappedOpeningGuide, ordinaryGuideRaw } from '../src/tests/fixtures/storyGuide';

const narrative = '【旁白】主角走进资料室，核对今天的安排。';
const url = 'https://story-guide.mock.invalid/v1';
const variants = [
  { title: '旧版字符串', guide: JSON.stringify([openingGuideEntry(JSON.stringify(openingGuideTimes))]) },
  { title: '新版时间对象', guide: JSON.stringify([openingGuideEntry(openingGuideTimes)]) },
  { title: '真实嵌套引号', guide: '[' + wrappedOpeningGuide() + ']' },
  { title: '普通规划坏项', guide: '[' + ordinaryGuideRaw + ',' + JSON.stringify(openingGuideEntry(openingGuideTimes)) + ']', reference: true },
  { title: '时间倒退', guide: '[' + wrappedOpeningGuide({ ...openingGuideTimes, endAt: '2026-10-15T15:00:00+08:00' }) + ']', fails: true },
] as const;

async function startOpening(page: Page) {
  await page.goto('/');
  await page.evaluate(async baseUrl => {
    const sp = '/src/ui/settings/model.ts', cp = '/src/services/ai/configuration.ts', vp = '/src/services/ai/credentials.ts';
    const { defaultSettings, settingsKey } = await import(sp), { defaultAiConfig, newChannel, saveAiConfig } = await import(cp), { CredentialVault } = await import(vp);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
    settings.runtime.streamStory = true;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = baseUrl; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'only-a-story-guide-mock-key');
  }, url);
  await page.reload();
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟');
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByRole('radio', { name: '女性', exact: true }).check();
  const next = () => page.getByRole('button', { name: /下一步/ }).click();
  await next();
  await chooseCustomProfession(page);
  await page.getByLabel('职业名称', { exact: true }).fill('档案整理员');
  await next();
  await page.getByRole('button', { name: '跳过背景，继续' }).click();
  await page.getByRole('button', { name: '跳过同伴，继续' }).click();
  await page.getByRole('button', { name: '确认并创建存档', exact: true }).click();
  await expect(page.locator('.game-layout')).toBeVisible();
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { return await repo.loadGame(location.hash.slice(6)); } finally { repo.close(); }
  });
}

for (const variant of variants) test('开局变量规划：' + variant.title, async ({ page }) => {
  test.setTimeout(60_000);
  const calls: { stage: string; context: Record<string, unknown> }[] = [];
  await page.route(url + '/**', async route => {
    const body = route.request().postDataJSON(), stage = String(body.model);
    const messages: string = body.messages.map((message: { content: string }) => message.content).join('\n');
    const context = JSON.parse(messages.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]);
    calls.push({ stage, context });
    if (stage === 'story') {
      const content = '<正文>' + narrative + '</正文><短期记忆>核对今日安排。</短期记忆><变量规划>' + variant.guide + '</变量规划>';
      await route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })
        + '\n\ndata: [DONE]\n\n' });
      return;
    }
    const content = stage === 'variables'
      ? '<thinking>检查本幕。</thinking><说明>保留现有记录。</说明><命令>\nset protagonist.emotionText = "踏实"\n</命令>'
      : JSON.stringify({ worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
  });
  await startOpening(page);
  if ('fails' in variant) {
    await expect.poll(async () => (await stored(page)).draft.stageStatus.story).toBe('failed');
    const failed = await stored(page);
    expect(failed.state.turnNumber).toBe(0);
    expect(failed.state.openingTimePending).toBe(true);
    expect(failed.draft.story).toBeUndefined();
    if ((page.viewportSize()?.width ?? 0) <= 900) {
      const diagnostics = page.locator('.mobile-diagnostics-sheet');
      await diagnostics.getByRole('tab', { name: '模型原文', exact: true }).click();
      await diagnostics.getByText('查看三阶段模型完整原文与执行结果', { exact: true }).click();
      await diagnostics.getByText('正文模型原文 · 未通过验收', { exact: true }).click();
      await expect(diagnostics.getByText(/正文失败类型：opening_reversed · 开局结束时间早于开始时间/)).toBeVisible();
    } else {
      await openWorkflow(page);
      await expect(page.getByRole('alert').filter({ hasText: /结束时间早于开始时间/ }).first()).toBeVisible();
    }
    await page.reload();
    await expect(page.locator('.game-layout')).toBeVisible();
    expect(await stored(page)).toEqual(failed);
    expect(calls.map(call => call.stage)).toEqual(['story']);
    return;
  }
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  await expect(page.getByText('主角走进资料室，核对今天的安排。', { exact: false }).first()).toBeVisible();
  const saved = await stored(page);
  expect(saved.state.worldClock).toBe(openingGuideTimes.endAt);
  expect(saved.state.protagonist.emotionText).toBe('踏实');
  expect(saved.state.journal[0].story.narrative).toBe(narrative);
  expect(calls.map(call => call.stage)).toEqual(['story', 'variables', 'world']);
  expect(calls[1].context.VARIABLE_GUIDE).toEqual([openingGuideEntry(JSON.stringify(openingGuideTimes))]);
  if ('reference' in variant)
    expect(calls[1].context.VARIABLE_GUIDE_REFERENCES).toEqual([{ group: 'npc', text: ordinaryGuideRaw }]);
  else expect(calls[1].context).not.toHaveProperty('VARIABLE_GUIDE_REFERENCES');
  expect(calls[2].context.TIME_WINDOW).toEqual({ from: openingGuideTimes.startAt, to: openingGuideTimes.endAt });
  expect(calls[2].context).not.toHaveProperty('VARIABLE_GUIDE_REFERENCES');
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
  expect(await stored(page)).toEqual(saved);
  expect(calls).toHaveLength(3);
});
