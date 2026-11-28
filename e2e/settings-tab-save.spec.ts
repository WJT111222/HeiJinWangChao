import { expect, test } from './helpers/test';
import { openAiSettings, openChannel } from './helpers/aiSettings';

test('两个标签同时保存不同渠道，同字段冲突保留输入，放弃后读取最新值', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/services/ai/configuration.ts';
    const { defaultAiConfig, newChannel, saveAiConfig } = await import(path);
    const config = defaultAiConfig();
    config.channels = ['a', 'b'].map(id => ({ ...newChannel(), id, name: id, defaultModel: 'fixture' }));
    config.routes.story = { channelId: 'a', modelId: 'fixture' };
    saveAiConfig(localStorage, config);
  });
  const other = await context.newPage();
  await other.goto('/');
  const [first, second] = await Promise.all([openAiSettings(page), openAiSettings(other)]);
  const rows = [first, second];
  await Promise.all(rows.map((root, i) => openChannel(root, i ? 'b' : 'a')));
  const names = rows.map(root => root.getByLabel('渠道名称', { exact: true }));
  const saves = rows.map(root => root.getByRole('button', { name: '保存 AI 配置', exact: true }));
  await Promise.all(names.map((name, i) => name.fill(i ? '乙' : '甲')));
  await Promise.all(saves.map(button => button.click()));
  for (const root of rows) await expect(root.locator('.ai-save-bar [role=status]')).toContainText('已保存');
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('heijin.ai.v1')!).channels.map((item: {name:string}) => item.name));
  expect(await read()).toEqual(['甲', '乙']);

  // Reopen both editors on an identical baseline before the competing edit.
  await Promise.all([page.reload(), other.reload()]);
  const a = await openAiSettings(page), b = await openAiSettings(other);
  for (const root of [a, b]) await openChannel(root, '甲');
  await a.getByLabel('渠道名称', { exact: true }).fill('先保存');
  await b.getByLabel('渠道名称', { exact: true }).fill('本页待处理');
  // Failing the coordination receipt must roll back the config just like a vault/config write failure.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'heijin.ai.settings-receipt.v1') {
        Storage.prototype.setItem = original;
        throw new DOMException('fixture', 'QuotaExceededError');
      }
      original.call(this, key, value);
    };
  });
  await a.getByRole('button', { name: '保存 AI 配置' }).click();
  await expect(a.locator('.ai-save-bar [role=status]')).toContainText('保存失败');
  expect(await read()).toEqual(['甲', '乙']);
  await expect(a.getByLabel('渠道名称', { exact: true })).toHaveValue('先保存');
  await a.getByRole('button', { name: '保存 AI 配置' }).click();
  await expect(a.locator('.ai-save-bar [role=status]')).toContainText('已保存');
  await b.getByRole('button', { name: '保存 AI 配置' }).click();
  await expect(b.locator('.ai-save-bar [role=status]')).toContainText('其他标签页');
  await expect(b.getByLabel('渠道名称', { exact: true })).toHaveValue('本页待处理');
  expect(await read()).toEqual(['先保存', '乙']);
  await b.getByRole('button', { name: '放弃修改' }).click();
  await expect(b.getByLabel('渠道名称', { exact: true })).toHaveValue('先保存');
});

test('连续交替保存必须先读到上一标签已发布的值', async ({ page, context }) => {
  const other = await context.newPage();
  const pages = [page, other];
  await Promise.all(pages.map(tab => tab.goto('/')));
  await Promise.all(pages.map(tab => tab.evaluate(async () => {
    const path = '/src/ui/settings/aiDraftMerge.ts';
    const { withAiSaveLock } = await import(path);
    for (let i = 0; i < 50; i++) {
      await withAiSaveLock((publish: () => void) => {
        const previous = Number(localStorage.getItem('review-save-sequence'));
        localStorage.setItem('review-save-sequence', String(previous + 1));
        publish();
      });
    }
  })));
  for (const tab of pages) {
    await expect.poll(() => tab.evaluate(() => localStorage.getItem('review-save-sequence'))).toBe('100');
  }
});
