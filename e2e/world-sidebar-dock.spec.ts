import { expect, test } from './helpers/test';
import { seedNightSeal } from './helpers/nightSeal';

const order = ['NPC', '势力组织', '我的势力', '后宫', '地图', '物品栏', '世界事件', '历史时间轴', '记忆', '小剧场'];

test('电脑端世界资料栏：资料顺序，设置与返回首页固定在栏底', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await seedNightSeal(page);
  await page.goto('/#game/save-a'); await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  const sidebar = page.getByRole('complementary', { name: '世界资料' });
  const archive = sidebar.getByRole('navigation', { name: '世界资料分类' });
  const system = sidebar.getByRole('navigation', { name: '系统操作' });
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 640 }, { width: 1024, height: 520 }]) {
    await page.setViewportSize(size);
    await expect(archive.locator('button > span:last-child')).toHaveText(order);
    // 只滚动资料列表；两个系统按钮不随列表移动，不用滚动就能点到。
    const positions: number[] = [];
    for (const top of [0, 1e6]) {
      await archive.evaluate((el, value) => { el.scrollTop = value; }, top);
      for (const name of ['设置', '返回首页']) await expect(system.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
      positions.push((await system.boundingBox())!.y);
    }
    expect(positions[1]).toBe(positions[0]);
    expect(await sidebar.evaluate(el => el.scrollTop)).toBe(0);
    if (size.height <= 640) {
      expect(await archive.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await expect(archive.getByRole('button', { name: '小剧场' })).toBeInViewport({ ratio: 1 });
    }
    await info.attach(`sidebar-${size.width}x${size.height}`, { body: await page.screenshot(), contentType: 'image/png' });
    await archive.evaluate(el => { el.scrollTop = 0; });
  }
  await system.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
});
