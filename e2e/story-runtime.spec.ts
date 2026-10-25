import { openGameTools } from './helpers/gameLayout';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

type Plan = { chunks?: string[]; status?: number; gap?: number; delay?: number; reasoning?: string; finishReason?: string };
const story = '【旁白】公交车在街边缓缓停下。\n\n行人沿着站台散开，你仍站在原地。';
const result = (narrative = story) =>
  `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${narrative}</正文><短期记忆>等车</短期记忆><变量规划>[{"group":"time","observedFact":"内部指导绝不进入阅读区"}]</变量规划><行动选项>看看站台\n留在原地\n询问路线</行动选项>`;
let server: Server;
let baseUrl: string;
let plans: Plan[];
let requests: Record<string, unknown>[];
const timers = new Set<ReturnType<typeof setTimeout>>();
function later(work: () => void, ms: number) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    work();
  }, ms);
  timers.add(timer);
}
test.beforeEach(async () => {
  plans = [];
  requests = [];
  server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type,authorization');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push(JSON.parse(body));
    const plan = plans.shift() ?? {};
    later(() => {
      if (response.destroyed) return;
      if (plan.status) {
        response.writeHead(plan.status).end('mock-browser-key 供应商私有错误');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      const chunks = plan.chunks ?? [result()];
      if (plan.reasoning) response.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: plan.reasoning } }] }) + '\n\n');
      let index = 0;
      function send() {
        if (response.destroyed) return;
        if (index === chunks.length) {
          response.end(
            'data: ' +
              JSON.stringify({
                choices: plan.finishReason ? [{ delta: {}, finish_reason: plan.finishReason }] : [],
                usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
              }) +
              '\n\ndata: [DONE]\n\n',
          );
          return;
        }
        response.write(
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] }) +
            '\n\n',
        );
        later(send, plan.gap ?? 15);
      }
      send();
    }, plan.delay ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('缺少测试端口');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});
test.afterEach(async () => {
  timers.forEach(clearTimeout);
  timers.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function seed(page: Page, mode: 'opening' | 'regular' | 'none' = 'opening') {
  await page.goto('/');
  const before = await page.evaluate(
    async ({ baseUrl, mode }) => {
      const creationPath = '/src/ui/creation/model.ts';
      const repositoryPath = '/src/services/storage/saveRepository.ts';
      const settingsPath = '/src/ui/settings/model.ts';
      const configPath = '/src/services/ai/configuration.ts';
      const vaultPath = '/src/services/ai/credentials.ts';
      const draftsPath = '/src/domain/drafts.ts';
      const orderPath = '/src/prompts/order.ts';
      const { createProfileSave, newCreation } = await import(creationPath);
      const { SaveRepository } = await import(repositoryPath);
      const { defaultSettings, settingsKey } = await import(settingsPath);
      const { defaultAiConfig, newChannel, saveAiConfig } = await import(configPath);
      const { CredentialVault } = await import(vaultPath);
      const { createTurnDraft } = await import(draftsPath);
      const { savePromptOrder } = await import(orderPath);
      const settings = defaultSettings();
      settings.prompts.minNarrativeChars = 10;
      localStorage.setItem(settingsKey, JSON.stringify(settings));
      const config = defaultAiConfig(),
        channel = newChannel();
      channel.baseUrl = baseUrl;
      channel.defaultModel = 'browser-story-mock';
      config.channels = [channel];
      config.routes.story = { channelId: channel.id, modelId: '' };
      saveAiConfig(localStorage, config);
      new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-browser-key');
      savePromptOrder(localStorage, { 'writing.conflict_pacing': 81, 'writing.emotion_guard': 80 });
      const form = newCreation();
      // 此套专门验证既有固定时钟草稿的流式/恢复；新待定开局另有真实创角回归。
      delete form.openingTimePending;
      form.worldClock = '2026-10-18T08:00:00+08:00';
      form.saveId = 'story-e2e-a';
      form.person = {
        name: '正文测试角色',
        age: '30',
        gender: '女',
        appearance: '短发',
        personality: '冷静',
      };
      form.profession = '教师';
      const repo = await SaveRepository.open();
      const state = await createProfileSave(repo, form, settings, localStorage);
      if (mode !== 'opening') {
        await repo.deleteDraft(state.saveId, 0);
        if (mode === 'regular')
          await repo.saveDraft(
            createTurnDraft(state.saveId, 0, 'existing-regular', 'regular', '绑定的本回合行动'),
            null,
          );
      }
      form.saveId = 'story-e2e-b';
      form.person.name = '另一个存档角色';
      await createProfileSave(repo, form, settings, localStorage);
      repo.close();
      return JSON.stringify(state);
    },
    { baseUrl, mode },
  );
  await page.goto('/#game/story-e2e-a'); await openGameTools(page);
  await page.reload(); await openGameTools(page);
  await expect(page.getByRole('heading', { name: '正文测试角色' })).toBeVisible();
  return before;
}
async function stored(page: Page, id = 'story-e2e-a') {
  return page.evaluate(async (id) => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try {
      return { state: JSON.stringify(await repo.load(id)), draft: await repo.loadDraft(id) };
    } finally {
      repo.close();
    }
  }, id);
}
async function generated(page: Page) {
  await expect(page.getByRole('region', { name: '三阶段工作流' })).toContainText(
    '正文已生成 · 未正式结算',
  );
}
test('真实开局流式分片、资料面板不打断、只展示正文，草稿刷新与行动复制、快照统计', async ({
  page,
}, info) => {
  const before = await seed(page);
  plans.push({
    chunks: [
      '<thinking>按真实场景续写，不代替玩家决定。',
      '</thinking>',
      '<正',
      '文>【旁白】公交车',
      '在街边缓缓停下。\n\n',
      '行人沿着站台散开，你仍站在原地。<',
      '/正文><短期记忆>等车</短期记忆><变量',
      '规划>[{"group":"time","observedFact":"内部指导绝不进入阅读区"}]</变量规划><行动选项>看看站台\n留在原地\n询问路线</行动选项>',
    ],
    gap: 200,
  });
  await page.getByLabel('你的行动').fill('仅编辑输入，不能覆盖空开局偏好');
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await expect(page.getByRole('article', { name: '流式正文预览' })).toContainText('公交车');
  expect((await stored(page)).draft.story).toBeUndefined();
  await openGameTools(page);
  await page
    .getByRole('complementary', { name: '世界资料' })
    .getByRole('button', { name: /NPC/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await generated(page);
  const reader = page.getByTestId('story-reader');
  await expect(reader).toContainText(story);
  await expect(reader).not.toContainText('内部指导');
  await expect(reader).not.toContainText('<正文>');
  expect(requests).toHaveLength(1);
  const body = JSON.stringify(requests[0]);
  expect(body).toContain('PLAYER_ACTION');
  expect(body).not.toContain('仅编辑输入');
  expect(body).toContain('开局');
  const saved = await stored(page);
  expect(saved.state).toBe(before);
  expect(saved.draft.userInput).toBe('');
  expect(saved.draft.story.summary).toBe('等车');
  expect(saved.draft.storyRevision).toBe(1);
  await page.getByRole('button', { name: '看看站台', exact: true }).click();
  await expect(page.getByLabel('你的行动')).toHaveValue('看看站台');
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const internal = page.getByRole('region', { name: '上下文与统计' });
  await expect(internal).toContainText('browser-story-mock');
  await expect(internal).toContainText('stages.opening.story');
  await expect(internal).toContainText('42');
  await expect(internal).toContainText('49');
  await expect(internal).not.toContainText('mock-browser-key');
  await expect(internal.getByLabel('完整内部上下文')).toHaveCount(0);
  const order = await internal.locator('li').allTextContents();
  expect(order.join()).toContain('writing.conflict_pacing');
  expect(order.findIndex((value) => value.includes('writing.emotion_guard'))).toBeLessThan(
    order.findIndex((value) => value.includes('writing.conflict_pacing')),
  );
  await page.keyboard.press('Escape');
  await page.reload(); await openGameTools(page);
  await generated(page);
  await expect(page.getByTestId('story-reader')).toContainText(story);
  expect((await stored(page)).state).toBe(before);
  await page.screenshot({ path: info.outputPath('story-runtime.png'), fullPage: true });
});
test('重新 Roll 授权失败、短正文及非法格式保留旧草稿，成功后同回合替换', async ({ page }) => {
  const before = await seed(page);
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await generated(page);
  const old = (await stored(page)).draft;
  for (const plan of [
    { status: 401 },
    { chunks: [result('短')] },
    { chunks: ['<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>缺少完整结构</正文>'] },
  ]) {
    plans.push(plan);
    await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toContainText('mock-browser-key');
    await expect(page.getByRole('alert')).not.toContainText('供应商私有错误');
    await expect(page.getByTestId('story-reader')).toContainText(story);
    expect((await stored(page)).draft).toEqual(old);
  }
  const replacement = '【旁白】新的公交车已经到站。\n\n路边的人们安静地等候着。';
  plans.push({ chunks: [result(replacement)] });
  await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect(page.getByTestId('story-reader')).toContainText(replacement);
  await generated(page);
  const after = await stored(page);
  expect(after.draft.turnId).toBe(old.turnId);
  expect(after.draft.userInput).toBe(old.userInput);
  expect(after.draft.storyRevision).toBe(2);
  expect(after.state).toBe(before);
});
test('快速重复点击、取消重试、迟到请求与切档隔离、刷新保留旧正文', async ({ page }) => {
  const before = await seed(page);
  plans.push({ delay: 2000 });
  await page
    .getByRole('button', { name: '生成开局正文', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole('button', { name: '取消生成', exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  expect((await stored(page)).draft.story).toBeUndefined();
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await generated(page);
  const old = (await stored(page)).draft;
  plans.push({ delay: 1500 });
  await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await page.getByRole('button', { name: '切换存档', exact: true }).click();
  await page
    .locator('.save-card')
    .filter({ hasText: '另一个存档角色' })
    .getByRole('button', { name: /读取存档/ })
    .click();
  await openGameTools(page, true);
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  await generated(page);
  expect((await stored(page)).draft).toEqual(old);
  expect((await stored(page, 'story-e2e-b')).draft.storyRevision).toBe(1);
  expect((await stored(page)).state).toBe(before);
  await page.goto('/#game/story-e2e-a'); await openGameTools(page);
  await generated(page);
  plans.push({ delay: 1200 });
  await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect.poll(() => requests.length).toBe(5);
  await page.reload(); await openGameTools(page);
  await generated(page);
  expect((await stored(page)).draft).toEqual(old);
});
test('已有 regular 草稿生成正确模式，没有草稿时不自动创建下一回合', async ({ page }) => {
  const before = await seed(page, 'regular');
  await page.getByLabel('你的行动').fill('编辑文本不会替换绑定输入');
  await page.getByRole('button', { name: '生成本回合正文', exact: true }).click();
  await generated(page);
  expect(JSON.stringify(requests[0])).toContain('绑定的本回合行动');
  expect(JSON.stringify(requests[0])).not.toContain('编辑文本不会替换绑定输入');
  expect((await stored(page)).draft.story.turnKind).toBe('regular');
  expect((await stored(page)).state).toBe(before);
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    const draft = await repo.loadDraft('story-e2e-a');
    await repo.deleteDraft('story-e2e-a', draft.draftRevision);
    repo.close();
  });
  await page.reload(); await openGameTools(page);
  await expect(page.getByText(/没有可执行的回合草稿/)).toBeVisible();
  await expect(page.getByRole('button', { name: '生成开局正文', exact: true })).toBeDisabled();
  expect((await stored(page)).draft).toBeUndefined();
  expect(requests).toHaveLength(1);
});
test('长篇流式阅读自动跟随、手动上滚暂停、恢复跟随，移动端无横向溢出', async ({ page }) => {
  await seed(page);
  const long = '【旁白】雨落在站台上，行人安静等候。\n\n'.repeat(140);
  plans.push({
    chunks: [
      '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>' + long,
      '新到的车辆停在站台旁。',
      '</正文><短期记忆>等候</短期记忆><变量规划>[]</变量规划><行动选项>看看站台\n留在原地\n询问路线</行动选项>',
    ],
    gap: 900,
  });
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click();
  const reader = page.getByTestId('story-reader');
  await expect(reader).toContainText('雨落在站台');
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await reader.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByRole('button', { name: '跟随最新正文 ↓', exact: true })).toBeVisible();
  await expect(reader).toContainText('新到的车辆');
  expect(await reader.evaluate((el) => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '跟随最新正文 ↓', exact: true }).click();
  await expect.poll(() => reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await generated(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(reader).not.toContainText('变量规划');
});


test('P6：原生公开内容与项目规划只主动查看，正文/存档隔离，刷新清除临时资料', async ({ page }) => {
  const before = await seed(page);
  plans.push({ reasoning: '公开原生标记 mock-browser-key', chunks: [result().replace('本轮创作提纲：保持人物与场景连续，按行动呈现事实。', '私人规划标记，不是正文事实。')] });
  await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  const reader = page.getByTestId('story-reader'); await expect(reader).toContainText(story);
  await expect(reader).not.toContainText('私人规划标记'); await expect(reader).not.toContainText('公开原生标记');
  const inspection = page.locator('.story-inspection'); await expect(inspection.locator('pre')).toHaveCount(0);
  const saved = await stored(page); expect(saved.state).toBe(before); expect(JSON.stringify(saved.draft)).not.toContain('私人规划标记');
  await inspection.getByText('本次生成的叙事规划与原生输出（临时调试）', { exact: true }).click();
  await inspection.getByText('项目叙事规划 · thinking', { exact: true }).click(); await expect(inspection).toContainText('私人规划标记');
  await inspection.getByText('供应商公开返回的原生内容', { exact: true }).click(); await expect(inspection).toContainText('公开原生标记');
  await expect(inspection).not.toContainText('mock-browser-key'); expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(1);
  const messages = requests[0].messages as { role: string; content: string }[];
  expect(messages.slice(-3).map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
  expect(messages.filter((message) => message.content.includes('### Step 0｜'))).toHaveLength(1);
  await page.reload(); await openGameTools(page); await inspection.getByText('本次生成的叙事规划与原生输出（临时调试）', { exact: true }).click();
  await expect(inspection).toContainText('没有对应请求的临时内容'); await expect(reader).toContainText(story);
  expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('P6：截断Roll不覆盖旧正文，明确预算诊断；无原生输出依然成功', async ({ page }) => {
  await seed(page); plans.push({}); await page.getByRole('button', { name: '生成开局正文', exact: true }).click(); await generated(page);
  const saved = await stored(page);
  plans.push({ reasoning: '只有临时原生内容', finishReason: 'length', chunks: ['<thinking>长规划尚未结束'] });
  await page.getByRole('button', { name: '重新 Roll', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('达到输出上限'); expect(await stored(page)).toEqual(saved); expect(requests).toHaveLength(2);
  await expect(page.getByTestId('story-reader')).toContainText(story);
  plans.push({}); await page.getByRole('button', { name: '重新 Roll', exact: true }).click(); await generated(page);
  expect((await stored(page)).draft.storyRevision).toBe(saved.draft.storyRevision + 1); expect(requests).toHaveLength(3);
  const inspection = page.locator('.story-inspection'); await inspection.locator(':scope > summary').click();
  await inspection.getByText('供应商公开返回的原生内容', { exact: true }).click(); await expect(inspection).toContainText('供应商未提供');
});
