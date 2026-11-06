// 此文件故意不用 helpers/test：从未阅读公告的真实首次访问开始。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const key = 'heijin.notices.hidden-on.v1';
const disclaimerTitle = '黑金王朝 · 游玩须知与免责声明';
const disclaimer = (page: Page) => page.getByRole('dialog', { name: disclaimerTitle, exact: true });
const announcement = (page: Page) => page.getByRole('dialog', { name: '王朝公告', exact: true });
const day = new Date('2026-11-07T04:00:00Z');

test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(day);
  // 即使发生回归也不允许测试调用外部模型。
  await page.route('https://**/*', route => route.fulfill({ status: 503, body: 'offline mock' }));
});

async function finishNotices(page: Page) {
  await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
  await expect(announcement(page)).toBeVisible();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('首次访问按序展示完整内容；关闭后导航不重播，未勾选刷新会恢复', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://')) externalRequests.push(request.url()); });
  await page.goto('/');
  await expect(disclaimer(page)).toBeVisible();
  await expect(disclaimer(page).getByText('18+', { exact: true })).toBeVisible();
  await expect(disclaimer(page).getByRole('heading', { level: 3 })).toHaveCount(6);
  await expect(disclaimer(page).locator('label')).toHaveText('今日不再弹出');
  await expect(announcement(page)).toHaveCount(0);
  await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
  await expect(announcement(page).getByRole('heading', { name: '《黑金王朝》正式进入 Demo 试玩阶段' })).toBeVisible();
  await expect(announcement(page).getByRole('listitem')).toHaveCount(5);
  await expect(announcement(page).getByText('王朝尚在建设，命运已经开始。感谢你成为这片世界最早的探索者。')).toBeVisible();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '游戏首页', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(externalRequests).toEqual([]);
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
});

test('第一步勾选仍显示第二步；共享勾选可撤销且保留其他本地配置', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('unrelated.preference', 'keep'));
  await disclaimer(page).getByRole('checkbox', { name: '今日不再弹出' }).check();
  await expect(disclaimer(page)).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe('2026-11-07');
  await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
  await expect(announcement(page).getByRole('checkbox')).toBeChecked();
  await announcement(page).getByRole('checkbox').uncheck();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('unrelated.preference'))).toBe('keep');
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
});

test('第二步勾选当天刷新和新页面均免打扰，次日本地日期恢复', async ({ page, context }) => {
  await page.goto('/');
  await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
  await announcement(page).getByRole('checkbox').check();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const secondPage = await context.newPage();
  await secondPage.clock.setFixedTime(day);
  await secondPage.goto('/');
  await expect(secondPage.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
  await expect(secondPage.getByRole('dialog')).toHaveCount(0);
  await secondPage.close();
  await page.clock.setFixedTime(new Date('2026-11-07T16:00:00Z')); // 上海已是次日，UTC 仍同日
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
  await expect(disclaimer(page).getByRole('checkbox')).not.toBeChecked();
});

test('首页与设置手动查看只开指定公告；返回保留设置内容和焦点', async ({ page }) => {
  await page.goto('/');
  await finishNotices(page);
  for (const label of ['王朝公告', '游玩须知与免责声明']) {
    const trigger = page.getByRole('group', { name: '游玩信息' }).getByRole('button', { name: label, exact: true });
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '提示词', exact: true }).click();
  const length = settings.getByLabel('正文最低字数');
  await length.fill('2222');
  for (const label of ['游玩须知与免责声明', '王朝公告']) {
    const trigger = settings.getByRole('button', { name: label, exact: true });
    await trigger.click();
    const modal = label === '王朝公告' ? announcement(page) : disclaimer(page);
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /^关闭/ }).click();
    await expect(settings).toBeVisible();
    await expect(length).toHaveValue('2222');
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  }
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('手动查看可以取消已保存免打扰，不自动串联另一个弹窗', async ({ page }) => {
  await page.goto('/');
  await disclaimer(page).getByRole('checkbox').check();
  await finishNotices(page);
  await page.reload();
  await page.getByRole('button', { name: '王朝公告', exact: true }).click();
  await expect(announcement(page).getByRole('checkbox')).toBeChecked();
  await announcement(page).getByRole('checkbox').uncheck();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
});

test('直接打开存档仍显示两步公告，关闭与从游戏设置查看不改存档、不调用模型', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://')) externalRequests.push(request.url()); });
  await page.goto('/');
  const before = await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/world.ts';
    const { SaveRepository } = await import(repoPath), { worldState } = await import(fixturePath);
    const repo = await SaveRepository.open();
    try { return await repo.create(worldState()); } finally { repo.close(); }
  });
  await page.goto(`/#game/${before.saveId}`);
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
  await finishNotices(page);
  await expect(page.getByTestId('story-reader')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '王朝公告', exact: true }).click();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await settings.getByRole('button', { name: '关闭资料界面' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await page.evaluate(async (saveId) => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return await repo.load(saveId); } finally { repo.close(); }
  }, before.saveId);
  expect(after).toEqual(before);
  expect(externalRequests).toEqual([]);
});

test('键盘焦点局限于当前弹窗，Escape 按顺序关闭', async ({ page }) => {
  await page.goto('/');
  await expect(disclaimer(page).getByRole('button', { name: '关闭免责声明' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(disclaimer(page).getByRole('checkbox')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(disclaimer(page).getByRole('button', { name: '关闭免责声明' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(announcement(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('localStorage 不可访问时仍能完成顺序并使用首页', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await disclaimer(page).getByRole('checkbox').check();
  await finishNotices(page);
  await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeEnabled();
  expect(errors).toEqual([]);
  await page.reload();
  await expect(disclaimer(page)).toBeVisible();
});

for (const method of ['setItem', 'removeItem'] as const) {
  test(`localStorage ${method} 失败时当前复选框与关闭仍可操作`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(({ key, method }) => {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(k: string, value?: string) {
        if (k === key) throw new DOMException('blocked', 'QuotaExceededError');
        return original.call(this, k, value ?? '');
      };
    }, { key, method });
    await disclaimer(page).getByRole('checkbox').check();
    await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
    await expect(announcement(page).getByRole('checkbox')).toBeChecked();
    await announcement(page).getByRole('checkbox').uncheck();
    await expect(announcement(page).getByRole('checkbox')).not.toBeChecked();
    await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('长内容内部滚动，窄屏关闭和复选框可触达；截图', async ({ page }, info) => {
  await page.goto('/');
  await expect(disclaimer(page)).toBeVisible();
  expect(await disclaimer(page).locator('.notice-footer label').evaluate(node => getComputedStyle(node).flexDirection)).toBe('row');
  await page.screenshot({ path: info.outputPath('disclaimer.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  const content = disclaimer(page).getByLabel('免责声明内容');
  expect(await content.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(disclaimer(page).getByRole('heading', { name: '6. 玩家自主选择' })).toBeInViewport();
  await expect(disclaimer(page).getByRole('checkbox')).toBeInViewport();
  await expect(disclaimer(page).getByRole('button', { name: '关闭免责声明' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
  expect(await announcement(page).getByLabel('公告内容').evaluate(node => node.scrollTop)).toBe(0);
  await page.screenshot({ path: info.outputPath('announcement-narrow.png') });
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test.describe('西半球本地日历与 UTC 不同', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('按设备当日保存，跨 UTC 日但本地仍同一天时继续免打扰', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-07T07:30:00Z')); // 当地 11 月 6 日 23:30
    await page.goto('/');
    await disclaimer(page).getByRole('checkbox').check();
    expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe('2026-11-06');
    await finishNotices(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-11-07T08:01:00Z'));
    await page.reload();
    await expect(disclaimer(page)).toBeVisible();
  });
});
