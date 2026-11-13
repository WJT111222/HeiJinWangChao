import { goHome } from './helpers/gameLayout';
// 此文件故意不用 helpers/test：从未阅读公告的真实首次访问开始。
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const key = 'heijin.notices.hidden-on.v1';
const disclaimerTitle = '黑金王朝 · 游玩须知与免责声明';
const disclaimer = (page: Page) => page.getByRole('dialog', { name: disclaimerTitle, exact: true });
const announcement = (page: Page) => page.getByRole('dialog', { name: '王朝公告', exact: true });
const day = new Date('2026-11-07T04:00:00Z');
const approvedDisclaimer = readFileSync(new URL('../src/tests/fixtures/disclaimer-v1.md', import.meta.url), 'utf8')
  .trim().split('\n\n');

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

test('完整定稿实际分段渲染：开头、架空社会声明与开发者落款', async ({ page }) => {
  await page.goto('/');
  const modal = disclaimer(page);
  await expect(modal).toBeVisible();
  const content = modal.getByLabel('免责声明内容');
  const expected = approvedDisclaimer.filter(block => !/^#{1,2} /.test(block) && block !== '---')
    .map(block => block.replace(/^### /, '').replaceAll('**', ''));
  expect(await content.locator('p, h3').allTextContents()).toEqual(expected);
  expect(await content.locator('strong').allTextContents()).toEqual(
    approvedDisclaimer.filter(block => block.startsWith('**')).map(block => block.replaceAll('**', '')),
  );
  await expect(content.getByText('欢迎来到《黑金王朝》。', { exact: true })).toBeInViewport();
  const worldStatement = content.getByText('《黑金王朝》采用「真实地理，架空社会」的世界观设定。', { exact: true });
  await worldStatement.scrollIntoViewIfNeeded();
  await expect(worldStatement).toBeInViewport();
  const noImputation = content.getByText('本作品无意影射、评价或指控任何现实中的特定人物、政治组织、政府机构、企业或社会团体。', { exact: true });
  await noImputation.scrollIntoViewIfNeeded();
  await expect(noImputation).toBeInViewport();
  await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(content.getByText('感谢你阅读以上说明。', { exact: true })).toBeInViewport();
  await expect(content.getByText('愿你在这个架空世界中，书写一段真正属于自己的人生。', { exact: true })).toBeInViewport();
  await expect(content.getByText('《黑金王朝》开发者', { exact: true })).toBeInViewport();
  await expect(modal.locator('.notice-footer')).toHaveText('今日不再弹出');
  await finishNotices(page);
});

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
  await expect(announcement(page).getByRole('heading', { name: '《黑金王朝》0.9 开发里程碑 · 世界事件与历史更新' })).toBeVisible();
  await expect(announcement(page).getByRole('listitem')).toHaveCount(5);
  await expect(announcement(page).getByText('记忆总结 V2 已支持短期转中期、中期转长期和 NPC 个人经历总结；自动维护可关闭，手动「立即总结」仍可用，已提交的历史原文保留可追溯。')).toBeVisible();
  await expect(announcement(page).getByText('新增多回合撤回：可按完整快照恢复最近已结算的回合，每份存档最多保留 5 个恢复点；没有重做功能，也不能撤销已产生的第三方 AI 调用费用。')).toBeVisible();
  await expect(announcement(page).getByText('重大纪事时间轴已区分世界与主角的人生历史；传闻仍是传闻，日期不明确的往事不会被伪装成精确时间。')).toBeVisible();
  await expect(announcement(page).getByText('世界事件 V2 已支持主事件、多个并行子事件、固定时刻结算和后续阶段；Story 可根据剧情决定主角介入、获知或不参与，事件档案保留已结束阶段的结果。')).toBeVisible();
  await expect(announcement(page).getByText('「夜幕金印」已更新桌面和手机阅读布局、角色对白气泡及只读世界事件档案；目前仍为 0.9 开发阶段，真实模型长篇试玩、手机真机体验和正式 V1.0 发行尚待验收。')).toBeVisible();
  await expect(announcement(page).getByText('王朝还在建设，城市已经有了自己的生活。感谢你在这里留下每一段经历。')).toBeVisible();
  await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await expect(page.getByLabel('姓名', { exact: true })).toBeVisible();
  await goHome(page);
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
  // Focus the close control before keyboard activation; an asynchronously hovered weather popover yields to archive focus.
  const closeSettings=settings.getByRole('button', { name: '关闭资料界面' });await closeSettings.focus();await closeSettings.press('Enter');
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
  const finalSection = disclaimer(page).getByRole('heading', { name: '六、虚构与现实的边界' });
  await finalSection.scrollIntoViewIfNeeded();
  await expect(finalSection).toBeInViewport();
  await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(disclaimer(page).getByText('《黑金王朝》开发者', { exact: true })).toBeInViewport();
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

test.describe('同一天发布新公告', () => {
  const remote = (version: string) => JSON.stringify({ version, title: '王朝公告', theme: `《黑金王朝》测试公告 ${version}`,
    updates: [`这是 ${version} 的更新。`], message: '测试寄语。' });
  async function serve(page: Page, body: () => string | undefined) {
    await page.route('**/api/announcement', route => {
      const value = body();
      return value ? route.fulfill({ status: 200, contentType: 'application/json', body: value }) : route.fulfill({ status: 503, body: 'down' });
    });
  }

  test('勾选免打扰后同一天出了新版本：刷新只弹新公告；同一版本、远程失败都不弹；次日照常', async ({ page }) => {
    let current: string | undefined = remote('甲');
    await serve(page, () => current);
    await page.goto('/');
    await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
    await expect(announcement(page)).toContainText('测试公告 甲');
    await announcement(page).getByRole('checkbox').check();
    await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
    expect(await page.evaluate(() => localStorage.getItem('heijin.notices.hidden-version.v1'))).toBe('甲');

    await page.reload();
    await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    current = undefined; // 远程不可用，回退内置公告不算新公告
    await page.reload();
    await expect(page.getByRole('button', { name: /开始新游戏/ })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    current = remote('乙');
    await page.reload();
    await expect(announcement(page)).toContainText('测试公告 乙');
    await expect(disclaimer(page)).toHaveCount(0);
    await expect(announcement(page).getByRole('checkbox')).not.toBeChecked();
    await announcement(page).getByRole('button', { name: '关闭王朝公告' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.clock.setFixedTime(new Date('2026-11-07T16:00:00Z')); // 上海次日
    await page.reload();
    await expect(disclaimer(page)).toBeVisible();
  });

  test('公告加载前在须知页勾选，免打扰绑定到随后加载出的远程版本', async ({ page }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/announcement', async route => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: remote('丙') });
    });
    await page.goto('/');
    await disclaimer(page).getByRole('checkbox', { name: '今日不再弹出' }).check();
    release();
    await disclaimer(page).getByRole('button', { name: '关闭免责声明' }).click();
    await expect(announcement(page)).toContainText('测试公告 丙');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('heijin.notices.hidden-version.v1'))).toBe('丙');
  });
});
