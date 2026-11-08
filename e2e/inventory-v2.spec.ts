import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openWorldArchive } from './helpers/gameLayout';

async function seed(page: Page, empty = false) {
  await page.goto('/');
  await page.evaluate(async empty => {
    const repoPath = '/src/services/storage/saveRepository.ts', fixturePath = '/src/tests/fixtures/game.ts', draftPath = '/src/domain/drafts.ts';
    const { SaveRepository } = await import(repoPath), { game, npc, organizations } = await import(fixturePath), { createTurnDraft } = await import(draftPath);
    const state = game(), ownerRef = { kind: 'protagonist', id: 'hero' };
    state.npc.friend = npc('friend'); state.organizations['org-a'] = organizations[2];
    if (!empty) {
      const items = [
        { id: 'coat', name: '防寒外套', category: 'top', quantity: 1, description: '黑色加厚防寒外套，棉质面料柔软厚实。\n陪伴日常通勤，适合冬季穿着。', referenceValue: 12000, conditionText: '袖口轻微磨损，拉链完好', itemDetails: { material: '棉布', size: 'L', warmth: '适合冬季', batteryText: '不适用字段不展示' } },
        { id: 'shoes', name: '日常运动鞋', category: 'shoes', quantity: 1, description: '深灰色布面运动鞋。', referenceValue: 6500, itemDetails: { size: '42' } },
        { id: 'phone', name: '日常用手机', category: 'device', quantity: 1, description: '边框略旧的黑色手机。', referenceValue: null, itemDetails: { brandModel: '常用智能手机', functions: '联络与支付', batteryText: '约一半' } },
        { id: 'card', name: '居民身份证', category: 'document', quantity: 1, itemDetails: { 描述: '旧档保存的证件外观描述', issuer: '签发机构', purpose: '身份核验' } },
        { id: 'torch', name: '便携手电', category: 'tool', quantity: 2, description: '银灰色金属手电。', referenceValue: 9900, questItem: true, itemDetails: { purpose: '夜间照明', functionCondition: '开关正常' } },
        { id: 'food', name: '便携饼干', category: 'other', quantity: 3, description: '独立包装的小点心。', referenceValue: 800, itemDetails: { shelfLife: '包装标注期限内', remainingText: '三包' } },
        { id: 'gift', name: '纪念手册', category: 'other', quantity: 1, description: Array.from({ length: 55 }, (_, i) => `第${i + 1}页：与朋友出行时留下的手写记录，保存日常相处与旅途见闻。`).join('\n'), itemDetails: { 纪念文字: '留作纪念' } },
        { id: 'legacy', name: '工具包（旧档）', category: 'other', quantity: 1, itemDetails: { 描述: '旧记录未细分类的工具包' } },
      ];
      for (const item of items) state.items[item.id] = { conditionText: '保存完好', ownerRef, ...item };
      state.protagonist.currentWear = { topItemId: 'coat', shoesItemId: 'shoes', accessoryItemIds: [] };
    }
    state.items.npcItem = { id: 'npcItem', name: '同事私人物品', category: 'device', quantity: 1, ownerRef: { kind: 'npc', id: 'friend' }, conditionText: '完好' };
    state.items.orgItem = { id: 'orgItem', name: '组织文件', category: 'document', quantity: 1, ownerRef: { kind: 'organization', id: 'org-a' }, conditionText: '完好' };
    state.items.lost = { id: 'lost', name: '街边无主物品', category: 'other', quantity: 1, locationId: 'chongqing', conditionText: '遗落' };
    const repo = await SaveRepository.open();
    try { await repo.create(state); await repo.saveDraft(createTurnDraft(state.saveId, 0, 'inventory-opening', 'opening', ''), null); } finally { repo.close(); }
  }, empty);
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
}
async function saved(page: Page) { return page.evaluate(async () => {
  const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
  try { return await repo.loadGame('save-a'); } finally { repo.close(); }
}); }
async function open(page: Page) { await openWorldArchive(page); await page.getByRole('complementary', { name: '世界资料' }).getByRole('button', { name: /物品栏/ }).click(); return page.getByRole('dialog', { name: '物品栏', exact: true }); }
const categoryCounts = [['全部', 8], ['衣物穿戴', 2], ['电子设备', 1], ['证件文件', 1], ['工具与武器', 1], ['生活用品与杂物', 3]] as const;

test('六筛选、种数、只看主角物品，详情键盘可达且原存档/草稿不变', async ({ page }, info) => {
  await seed(page); const before = await saved(page); let requests = 0;
  await page.route('**/*', async route => { if (route.request().method() === 'POST') { requests++; await route.abort(); } else await route.continue(); });
  const dialog = await open(page), nav = dialog.getByRole('navigation', { name: '物品分类' });
  await expect(nav.getByRole('button', { name: '全部，8种物品', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.inventory-tile')).toHaveCount(8);
  await expect(dialog).not.toContainText('同事私人物品'); await expect(dialog).not.toContainText('组织文件'); await expect(dialog).not.toContainText('街边无主物品');
  await expect(dialog).not.toContainText('袖口轻微磨损'); await expect(dialog).not.toContainText('参考价值'); await expect(dialog).not.toContainText('持有人');
  await page.screenshot({ path: info.outputPath('inventory-grid.png') });
  for (const [label, count] of categoryCounts) {
    await nav.getByRole('button', { name: `${label}，${count}种物品`, exact: true }).click();
    await expect(dialog.locator('.inventory-tile')).toHaveCount(count);
  }
  await expect(dialog).toContainText('工具包（旧档）');
  await nav.getByRole('button', { name: '衣物穿戴，2种物品', exact: true }).click();
  const coat = dialog.getByRole('button', { name: /防寒外套/ });
  await expect(coat).toContainText('已装备'); await coat.focus(); await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { name: '防寒外套' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: '关闭资料界面' })).toBeInViewport({ ratio: 1 });
  await expect(dialog).toContainText('黑色加厚防寒外套'); await expect(dialog).toContainText('120.00 元');
  await expect(dialog).toContainText('袖口轻微磨损，拉链完好'); await expect(dialog).toContainText('材质');
  await expect(dialog).not.toContainText('不适用字段不展示'); await expect(dialog).not.toContainText('位置：未记录');
  await page.screenshot({ path: info.outputPath('inventory-detail.png') });
  await expect(dialog.getByRole('button', { name: '关闭资料界面' })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: '返回背包' }).click(); await expect(coat).toBeFocused();
  await nav.getByRole('button', { name: '工具与武器，1种物品', exact: true }).click(); await expect(dialog.locator('.inventory-tile')).toContainText('×2'); await expect(dialog.locator('.inventory-tile')).toContainText('任务');
  await nav.getByRole('button', { name: '证件文件，1种物品', exact: true }).click(); await dialog.getByRole('button', { name: /居民身份证/ }).click();
  await expect(dialog).toContainText('待估价'); await expect(dialog).toContainText('旧档保存的证件外观描述');
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); expect(await saved(page)).toEqual(before);
  await page.reload(); await openGameTools(page); await open(page); await expect(page.locator('.inventory-tile')).toHaveCount(8);
  expect(await saved(page)).toEqual(before); expect(requests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('长详情可滚动且关闭按钮可达，窄屏不横溢，空分类和空背包正常', async ({ page }) => {
  await seed(page); const dialog = await open(page);
  await dialog.getByRole('button', { name: /纪念手册/ }).click();
  await expect(dialog.getByRole('button', { name: '关闭资料界面' })).toBeInViewport({ ratio: 1 });
  const body = dialog.locator('.modal-body');
  expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByRole('button', { name: '关闭资料界面' })).toBeInViewport();
  await expect(dialog.getByText('留作纪念', { exact: true })).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '关闭资料界面' }).click(); await expect(dialog).not.toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
    try { await repo.delete('save-a', (await repo.load('save-a')).revision); } finally { repo.close(); }
  });
  await seed(page, true); const empty = await open(page);
  await expect(empty).toContainText('背包里暂时没有物品');
  await empty.getByRole('button', { name: '电子设备，0种物品', exact: true }).click(); await expect(empty).toContainText('此分类暂无物品');
});
