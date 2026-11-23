import { expect, test } from './helpers/test';
import { openAiSettings, addChannel, testReply } from './helpers/aiSettings';

const glm = 'https://open.bigmodel.cn/api/paas/v4';
test('GLM 开关保存；真实设置连接用同域 GET 发现模型，POST 测试回复只回退一次', async ({ page }) => {
  const calls: string[] = [];
  await page.route('https://**/*', (route) => {
    calls.push('direct ' + route.request().method() + ' ' + route.request().url());
    return route.abort('failed');
  });
  await page.route('**/api/ai-relay?*', (route) => {
    const r = route.request();
    calls.push('relay ' + r.method() + ' ' + new URL(r.url()).searchParams.get('target'));
    return route.fulfill({
      json:
        r.method() === 'GET'
          ? { data: [{ id: 'glm-mock' }] }
          : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] },
    });
  });
  await page.goto('/');
  let settings = await openAiSettings(page);
  const label = '启用跨域自动中转（推荐开启）';
  await expect(settings.getByLabel(label)).toBeChecked();
  await settings.getByLabel(label).uncheck();
  await page.reload();
  settings = await openAiSettings(page);
  await expect(settings.getByLabel(label)).not.toBeChecked();
  await settings.getByLabel(label).check();
  expect(calls).toEqual([]);
  await addChannel(settings, { name: '合成 GLM', url: glm, key: 'synthetic-glm-key' });
  await expect(settings.getByRole('status').filter({ hasText: '连接正常' }).first()).toBeVisible();
  await testReply(settings);
  await expect(settings.getByRole('status').filter({ hasText: '收到了回复' }).first()).toBeVisible();
  expect(calls).toEqual([
    'direct GET ' + glm + '/models',
    'relay GET ' + glm + '/models',
    'direct POST ' + glm + '/chat/completions',
    'relay POST ' + glm + '/chat/completions',
  ]);
});
