import { test, expect } from './helpers/test';
import { addChannel, aiTab, backToList, openAiSettings, saveAi } from './helpers/aiSettings';

// iOS 26 Safari 的悬浮工具栏约 80px 会盖住贴底抽屉的底部；键盘收起后视口偏移还可能把抽屉往下推。
// 选项很少时，选择抽屉也必须保持足够高度，让选项落在屏幕上半部分，而不是紧贴底边。
const SAFARI_TOOLBAR_ALLOWANCE = 120;

test('手机选择抽屉：选项远离屏幕底边；没有渠道时提示先添加渠道', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '贴底选择抽屉只在手机端出现');
  await page.goto('/');
  await page.locator('[data-settings-open]').first().click();
  const settings = await aiTab(page);
  const viewport = page.viewportSize()!;

  const trigger = settings.getByRole('combobox', { name: '正文生成渠道', exact: true });
  await expect(settings.getByText('还没有渠道：先在下方「我的渠道」点「＋ 添加渠道」', { exact: false })).toBeVisible();
  await trigger.click();
  const picker = page.getByRole('dialog', { name: '正文生成渠道', exact: true });
  await expect(picker).toBeVisible();
  // 等入场动画结束：抽屉仍贴在屏幕底边。
  await expect.poll(async () => { const box = (await picker.boundingBox())!; return Math.round(box.y + box.height); }).toBe(viewport.height);
  const sheet = (await picker.boundingBox())!;
  expect(sheet.height).toBeGreaterThanOrEqual(viewport.height * 0.5);
  const option = (await picker.getByRole('option').first().boundingBox())!;
  expect(option.y + option.height).toBeLessThanOrEqual(viewport.height - SAFARI_TOOLBAR_ALLOWANCE);
  const hint = picker.locator('.select-hint');
  await expect(hint).toContainText('还没有渠道');
  expect((await hint.boundingBox())!.y + (await hint.boundingBox())!.height).toBeLessThanOrEqual(viewport.height - SAFARI_TOOLBAR_ALLOWANCE);
  await expect(hint).not.toHaveAttribute('role', 'option');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // 有渠道之后不再提示，渠道出现在选项里。
  await addChannel(settings, { name: '测试渠道', url: 'https://relay.example.com/v1', key: 'sk-test' });
  await backToList(settings);
  await expect(settings.getByText('还没有渠道：先在下方', { exact: false })).toHaveCount(0);
  await trigger.click();
  await expect(picker.getByRole('option', { name: '测试渠道' })).toBeVisible();
  await expect(picker.locator('.select-hint')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('手机选择抽屉：选项多时可以用手指滑到底并选中最后一项；高亮项为纸页浅金、文字清楚', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', '贴底选择抽屉只在手机端出现');
  const ids = Array.from({ length: 48 }, (_, i) => `[AA]model-${String(i + 1).padStart(2, '0')}`);
  let generationPosts = 0;
  await page.route('https://relay.example.com/**', (route) => {
    if (route.request().method() === 'POST') { generationPosts++; return route.abort(); }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }) });
  });
  await page.goto('/');
  await page.locator('[data-settings-open]').first().click();
  const settings = await aiTab(page);
  await addChannel(settings, { name: '测试渠道', url: 'https://relay.example.com/v1', key: 'sk-test' });
  await backToList(settings);
  await settings.getByRole('combobox', { name: '正文生成渠道', exact: true }).click();
  await page.getByRole('dialog', { name: '正文生成渠道', exact: true }).getByRole('option', { name: '测试渠道' }).click();
  const model = settings.getByRole('combobox', { name: '正文生成模型', exact: true });
  await model.click();
  const picker = page.getByRole('dialog', { name: '正文生成模型', exact: true });
  await expect(picker.getByRole('option')).toHaveCount(48);
  const body = picker.locator('.modal-body');
  await expect.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // 高亮项：浅色底、深色字（不再是深色块）。
  const active = picker.locator('[role=option].option-active').first();
  await expect(active).toBeVisible();
  const colors = await active.evaluate((el) => {
    const lum = (value: string) => { const [r, g, b] = value.match(/[\d.]+/g)!.map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
    const style = getComputedStyle(el), sheet = getComputedStyle(el.closest('dialog')!);
    const [r, g, b, a = 1] = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
    const [sr, sg, sb] = sheet.backgroundColor.match(/[\d.]+/g)!.map(Number);
    const mixed = `rgb(${r * a + sr * (1 - a)},${g * a + sg * (1 - a)},${b * a + sb * (1 - a)})`;
    return { background: lum(mixed), text: lum(style.color) };
  });
  expect(colors.background).toBeGreaterThan(0.7);
  expect(colors.text).toBeLessThan(0.3);

  // 用真实触摸手势往上划，直到最后一项进入可见区域。
  const cdp = await page.context().newCDPSession(page);
  await picker.evaluate(element => Promise.allSettled(element.getAnimations().map(animation => animation.finished)));
  const bounds = (await body.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height * 0.85;
  const distance = bounds.height * 0.65;
  for (let round = 0; round < 12; round++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (await body.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)) break;
  }
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const last = picker.getByRole('option', { name: ids[47] });
  await expect(last).toBeInViewport();
  await last.click();
  await expect(picker).toHaveCount(0);
  await expect(model).toContainText(ids[47]);
  await page.screenshot({ path: info.outputPath('last-model-selected.png'), animations: 'disabled' });

  // 末项不仅在编辑态可见：通过原保存入口持久化，关闭、重新打开并刷新后仍为正式路由。
  await saveAi(settings);
  const savedRoute = await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('heijin.ai.v1')!);
    return { route: config.routes.story, channelId: config.channels[0].id };
  });
  expect(savedRoute.route).toEqual({ channelId: savedRoute.channelId, modelId: ids[47] });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  const reopened = await openAiSettings(page);
  await expect(reopened.getByRole('combobox', { name: '正文生成渠道', exact: true })).toContainText('测试渠道');
  await expect(reopened.getByRole('combobox', { name: '正文生成模型', exact: true })).toContainText(ids[47]);
  await expect(reopened.getByRole('combobox', { name: '正文生成模型', exact: true })).toHaveAttribute('value', ids[47]);
  await page.screenshot({ path: info.outputPath('last-model-saved-reopened.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(reopened).toHaveCount(0);
  await page.reload();
  const reloaded = await openAiSettings(page);
  await expect(reloaded.getByRole('combobox', { name: '正文生成模型', exact: true })).toContainText(ids[47]);
  await expect(reloaded.getByRole('combobox', { name: '正文生成模型', exact: true })).toHaveAttribute('value', ids[47]);
  expect(generationPosts).toBe(0);
});
