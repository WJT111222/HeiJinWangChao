import { expect, test, type Page } from '@playwright/test';

/**
 * 世界书管理面板（真实 Chromium + Vite 开发服务器 + 真实 IndexedDB），电脑端与手机端各跑一遍：
 * - 两个标签页从同一版本开始编辑同一本书，A 先保存后 B 保存：B 明确提示冲突、保留草稿，书库保留 A 的内容；
 * - 含逗号量词的正则关键词在追加普通关键词、保存、重新载入、导出后保持完整。
 */
const book = { name: '街巷志', entries: {
  '0': { uid: 0, key: ['/街角[0-9]{1,2}/'], comment: '街角', content: '街角有一盏路灯。' },
  '1': { uid: 1, key: ['茶楼'], comment: '茶楼', content: '茶楼在东街。' },
} };
const HARNESS = '/src/tests/support/worldbook-harness.html';
const entry = (page: Page, title: string) => page.locator('.wb-entry').filter({ has: page.locator('.wb-entry-title strong', { hasText: new RegExp(`^${title}$`) }) });
const latest = (page: Page) => page.evaluate(() => window.__worldbookLatest!());

test('多标签页编辑冲突与正则关键词无损编辑', async ({ context }) => {
  test.setTimeout(120_000);
  const a = await context.newPage();
  await a.goto(HARNESS);
  await a.locator('input[type=file]').setInputFiles({ name: '街巷志.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
  await expect(a.locator('.wb-detail')).toBeVisible();

  const b = await context.newPage();
  await b.goto(HARNESS);
  await b.getByText('街巷志', { exact: true }).click();
  await expect(b.locator('.wb-detail')).toBeVisible();

  for (const page of [a, b]) await entry(page, '茶楼').locator('.wb-entry-title').click();
  await entry(a, '茶楼').getByRole('textbox', { name: '内容' }).fill('A：茶楼在西街。');
  await entry(b, '茶楼').getByRole('textbox', { name: '内容' }).fill('B：茶楼在北街。');
  await a.getByRole('button', { name: '保存修改' }).click();
  await expect(a.getByText('已保存修改', { exact: false })).toBeVisible();
  await expect(a.locator('.wb-savebar')).toHaveCount(0);

  await b.getByRole('button', { name: '保存修改' }).click();
  await expect(b.locator('.wb-savebar[data-conflict]')).toBeVisible();
  await expect(b.getByText('已保存修改', { exact: false })).toHaveCount(0);
  await expect(entry(b, '茶楼').getByRole('textbox', { name: '内容' })).toHaveValue('B：茶楼在北街。'); // 草稿保留
  expect((await latest(a)).entries.find((e) => e.comment === '茶楼')!.content).toBe('A：茶楼在西街。'); // 不覆盖 A
  await b.getByRole('button', { name: '放弃我的修改，读取最新版本' }).click();
  await expect(entry(b, '茶楼').locator('.wb-entry-preview')).toHaveText('A：茶楼在西街。');

  // 正则关键词：追加普通关键词 → 保存 → 重新载入 → 导出
  await entry(a, '街角').locator('.wb-entry-title').click();
  const keys = entry(a, '街角').getByRole('textbox', { name: '关键词', exact: true });
  await expect(keys).toHaveValue('/街角[0-9]{1,2}/');
  await keys.fill('/街角[0-9]{1,2}/，茶楼');
  await a.getByRole('button', { name: '保存修改' }).click();
  await expect(a.locator('.wb-savebar')).toHaveCount(0); // 保存完成、暂存清空（提示文字可能是上一次保存留下的）
  await a.reload();
  const saved = await latest(a);
  expect(saved.entries.find((e) => e.comment === '街角')!.keys).toEqual(['/街角[0-9]{1,2}/', '茶楼']);
  expect(saved.exported.find((e) => e.comment === '街角')!.key).toEqual(['/街角[0-9]{1,2}/', '茶楼']);
});

test('多标签页世界书旧删除确认失败，取消和刷新后重新确认有效', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await a.goto(HARNESS);
  await a.locator('input[type=file]').setInputFiles({ name: '街巷志.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(book)) });
  const details = a.locator('.wb-detail');
  await details.getByRole('button', { name: '删除整本', exact: true }).click();
  const confirm = details.getByRole('button', { name: '确认删除整本', exact: true });
  await details.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await details.getByRole('button', { name: '删除整本', exact: true }).click();
  await b.goto(HARNESS);
  await b.getByText('街巷志', { exact: true }).click();
  await entry(b, '茶楼').locator('.wb-entry-title').click();
  await entry(b, '茶楼').getByRole('textbox', { name: '内容' }).fill('另一标签已保存的新版本');
  await b.getByRole('button', { name: '保存修改' }).click();
  await expect(b.getByText('已保存修改', { exact: false })).toBeVisible();
  await confirm.click();
  await expect(a.getByText('这本书刚在其他页面被修改过', { exact: false })).toBeVisible();
  expect((await latest(a)).entries.find(e => e.comment === '茶楼')?.content).toBe('另一标签已保存的新版本');

  await a.reload();
  await a.getByText('街巷志', { exact: true }).click();
  await details.getByRole('button', { name: '删除整本', exact: true }).click();
  await confirm.click();
  await expect(details).not.toBeVisible();
  await expect(latest(a)).rejects.toThrow('书库为空');
});
