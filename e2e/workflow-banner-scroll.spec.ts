import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflowDiagnostics, openWorkflowStage } from './helpers/gameLayout';

// 三阶段详情：错误横幅可以关闭；鼠标停在错误日志上也能用滚轮滚动整个诊断区。
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts', '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft }, { defaultSettings, settingsKey }, { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(), state = worldState();
    state.openingCityId = 'chongqing'; state.title = '沈砚 · 重庆'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://workflow.mock.invalid/v1';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock' }; saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-key');
    await completeDraft(repo);
    repo.close();
  });
  await page.goto('/#game/save-a'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}

test('电脑端：错误横幅可关闭，新错误会重新出现；日志上滚轮可以滚动诊断区', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '电脑端三阶段详情');
  await page.setViewportSize({ width: 1440, height: 760 });
  await seed(page);
  let calls = 0;
  await page.route('https://workflow.mock.invalid/**', async route => { calls++; await route.fulfill({ status: calls % 2 ? 401 : 500, body: 'provider-private' }); });

  // 连续失败几次，让错误日志超过一屏。
  await openWorkflowStage(page, 'variables');
  for (let i = 1; i <= 4; i++) {
    await page.getByRole('button', { name: /^(重新)?生成变量候选$/ }).click();
    await expect.poll(() => calls).toBe(i);
  }
  const banner = page.locator('.workflow-errors');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: '关闭错误提示' }).click();
  await expect(banner).toHaveCount(0);

  // 新的一次失败（第 5 次）会让横幅重新出现。
  await page.getByRole('button', { name: /^(重新)?生成变量候选$/ }).click();
  await expect.poll(() => calls).toBe(5);
  await expect(banner).toBeVisible();

  await openWorkflowDiagnostics(page);
  const body = page.locator('.wf-dt-body');
  await expect(page.locator('.runtime-log li')).toHaveCount(5);
  expect(await body.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(50);
  // 把第一条日志滚到诊断区顶部，再把鼠标停在诊断区正中（正好压在日志内容上）滚动。
  const start = await page.locator('.runtime-log ol').evaluate(list => {
    const body = list.closest('.wf-dt-body')!;
    body.scrollTop = list.getBoundingClientRect().top - body.getBoundingClientRect().top;
    return body.scrollTop;
  });
  const area = (await body.boundingBox())!;
  const point = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.runtime-log li')), point)).toBe(true);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(start);
  await page.screenshot({ path: test.info().outputPath('diagnostics-scrolled.png') });
});
