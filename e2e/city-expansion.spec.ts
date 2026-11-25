import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';

const url = 'https://city-completion.mock.invalid/v1';
const intro = '江苏南部的江南城市，古城水巷与园林保留传统格局，工业园区和制造业集群规模庞大，老城慢生活与园区快节奏同城共存。';

async function start(page: Page) {
  await page.addInitScript((baseUrl) => {
    const channel = { id: 'city-story', name: '正文测试渠道', baseUrl, protocol: 'openai', defaultModel: 'story-city-mock',
      parameters: { temperature: 0.7, maxOutputTokens: 4000 }, compatibility: { temperature: true, maxOutputTokens: true, jsonMode: true, cotMode: 'confirmation', cotModels: [] } };
    localStorage.setItem('heijin.ai.v1', JSON.stringify({ version: 1, channels: [channel],
      routes: { story: { channelId: channel.id, modelId: 'story-city-mock' }, variables: { mode: 'follow-story' }, world: { mode: 'follow-story' }, memory: { mode: 'follow-story' } } }));
    sessionStorage.setItem('heijin.credential.v1:' + channel.id, 'fixture-city-key');
  }, url);
  await page.goto('/');
  await page.getByRole('button', { name: /开始新游戏/ }).click();
  await page.getByLabel('姓名', { exact: true }).fill('林舟');
  await page.getByLabel('年龄', { exact: true }).fill('30');
  await page.getByRole('radio', { name: '男性', exact: true }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: '专业与公共服务', exact: true }).click();
  await page.getByRole('radio', { name: /^教师/ }).check();
  await page.getByRole('button', { name: /下一步/ }).click();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { const [summary] = await repo.list(); return { summary, state: await repo.load(summary.saveId) }; } finally { repo.close(); }
  });
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test('八座官方城市与自定义城市：选省市、AI补全介绍一次、写入存档与游戏顶栏', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route(url + '/**', async route => {
    const body = route.request().postDataJSON();
    requests.push(JSON.parse(body.messages[1].content));
    await route.fulfill({ json: { choices: [{ message: { content: intro }, finish_reason: 'stop' }] } });
  });
  await start(page);
  await expect(page.getByRole('radio')).toHaveCount(9);
  for (const name of ['北京', '杭州', '长沙', '三亚']) {
    await page.getByRole('radio', { name, exact: true }).check();
    await expect(page.getByRole('radio', { name, exact: true })).toBeChecked();
  }
  await page.getByRole('radio', { name: '北京', exact: true }).check();
  await expect(page.locator('.city-card.selected')).toContainText('北京');
  await noOverflow(page);

  await page.getByRole('radio', { name: '自定义城市', exact: true }).check();
  const detail = page.getByRole('region', { name: '自定义城市' });
  await expect(detail).toBeVisible();
  await detail.getByPlaceholder(/搜索城市或省份/).fill('苏州');
  await detail.getByRole('button', { name: /^苏州/ }).click();
  await expect(detail.locator('.creation-city-chosen')).toContainText('苏州');
  await expect(detail.locator('.creation-city-chosen')).toContainText('江苏');
  await expect(page.locator('.city-card.selected')).toContainText('苏州');
  expect(requests).toHaveLength(0);

  await page.getByRole('button', { name: 'AI补全城市介绍', exact: true }).click();
  await expect(page.getByLabel('城市介绍（可选）')).toHaveValue(intro);
  expect(requests).toEqual([{ cityName: '苏州', cityRegion: '江苏', cityIntro: '' }]);
  await noOverflow(page);

  await page.getByRole('button', { name: /下一步/ }).click();
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.locator('.creation-review, .creation-card').first()).toContainText('苏州');
  await page.getByRole('button', { name: '确认并创建存档' }).click();
  await openGameTools(page, true);
  const { summary, state } = await stored(page);
  expect(state.openingCityId).toBe('cn-320500');
  expect(state.openingCityProfile).toEqual({ name: '苏州', region: '江苏', intro });
  expect(state.title).toBe('林舟 · 苏州');
  expect(state.locations['cn-320500']).toEqual({ id: 'cn-320500', name: '苏州', parentId: 'china' });
  expect(summary).toMatchObject({ openingCityId: 'cn-320500' });
  await expect(page.locator('.city-night')).toHaveAttribute('data-city', 'custom');
  expect(requests).toHaveLength(1);
});

test('搜到官方城市时直接选官方卡；换城会先确认清空已写介绍；没有介绍也能继续', async ({ page }) => {
  await start(page);
  await page.getByRole('radio', { name: '自定义城市', exact: true }).check();
  const detail = page.getByRole('region', { name: '自定义城市' });
  await detail.getByPlaceholder(/搜索城市或省份/).fill('杭州');
  await detail.getByRole('button', { name: /^杭州/ }).click();
  await expect(page.getByRole('radio', { name: '杭州', exact: true })).toBeChecked();

  await page.getByRole('radio', { name: '自定义城市', exact: true }).check();
  await detail.getByPlaceholder(/搜索城市或省份/).fill('昆山');
  await detail.getByRole('button', { name: /^昆山/ }).click();
  await expect(detail.locator('.creation-city-chosen')).toContainText('江苏 · 苏州');
  await page.getByLabel('城市介绍（可选）').fill('我自己写的介绍。');
  await detail.getByRole('button', { name: '更换城市', exact: true }).click();
  await detail.getByPlaceholder(/搜索城市或省份/).fill('宁波');
  await detail.getByRole('button', { name: /^宁波/ }).click();
  await expect(detail.getByRole('alertdialog', { name: '更换城市' })).toContainText('清空');
  await detail.getByRole('button', { name: '保留原城市', exact: true }).click();
  await detail.getByRole('button', { name: '取消更换', exact: true }).click();
  await expect(page.getByLabel('城市介绍（可选）')).toHaveValue('我自己写的介绍。');
  await detail.getByRole('button', { name: '更换城市', exact: true }).click();
  await detail.getByPlaceholder(/搜索城市或省份/).fill('宁波');
  await detail.getByRole('button', { name: /^宁波/ }).click();
  await detail.getByRole('button', { name: '确认更换', exact: true }).click();
  await expect(detail.locator('.creation-city-chosen')).toContainText('宁波');
  await expect(page.getByLabel('城市介绍（可选）')).toHaveValue('');
  await page.getByRole('button', { name: /下一步/ }).click();
  await expect(page.getByRole('heading', { name: '初始同伴', exact: true })).toBeVisible();
});

test('首页封面城市导航四个一排、两排', async ({ page, isMobile }) => {
  test.skip(isMobile, '手机首页没有封面城市导航');
  await page.goto('/');
  const buttons = page.getByRole('navigation', { name: '封面城市' }).getByRole('button');
  await expect(buttons).toHaveCount(8);
  const boxes = await Promise.all((await buttons.all()).map(button => button.boundingBox()));
  const rows = [...new Set(boxes.map(box => Math.round(box!.y)))];
  expect(rows).toHaveLength(2);
  expect(boxes.slice(0, 4).every(box => Math.round(box!.y) === rows[0])).toBe(true);
  await buttons.filter({ hasText: '三亚' }).click();
  await expect(page.locator('.home-experience')).toHaveAttribute('data-city', 'sy');
});
