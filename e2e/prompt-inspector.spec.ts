import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function seed(page: Page, ready = true) {
  await page.goto('/');
  return page.evaluate(async (ready) => {
    const fixturePath = '/src/tests/fixtures/ui.ts';
    const repoPath = '/src/services/storage/saveRepository.ts';
    const draftsPath = '/src/domain/drafts.ts';
    const { uiFixture } = await import(fixturePath);
    const { SaveRepository } = await import(repoPath);
    const { createTurnDraft, rerollStory } = await import(draftsPath);
    const state = uiFixture();
    const repo = await SaveRepository.open();
    repo.close();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('heijinwangchao');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(state);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
    const opened = await SaveRepository.open();
    if (ready) {
      const initial = createTurnDraft(
        state.saveId,
        state.revision,
        'inspector-e2e',
        'regular',
        '观察',
      );
      await opened.saveDraft(initial, null);
      await opened.saveDraft(
        rerollStory(initial, {
          turnKind: 'regular',
          narrative: '【旁白】你在街边观察。',
          summary: '',
          variableGuide: [],
        }),
        0,
      );
    }
    opened.close();
    return JSON.stringify(state);
  }, ready);
}
async function inspector(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await expect(page.getByRole('region', { name: '模块库' })).toBeVisible();
}
async function readFormal(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try {
      return JSON.stringify(await repo.load('ui-test'));
    } finally {
      repo.close();
    }
  });
}

test('无存档浏览真实模块、过滤与全文，缺少阶段请求时不伪造使用量', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5174')) external.push(request.url());
  });
  await page.goto('/');
  await inspector(page);
  await expect(page.getByText(/模块库 · 75\/75/)).toBeVisible();
  await page.getByText('开局与普通回合的模块差异', { exact: true }).click();
  await expect(page.getByRole('region', { name: '回合模式差异' })).toContainText(
    'stages.opening.story',
  );
  await expect(page.getByRole('region', { name: '回合模式差异' })).toContainText(
    'stages.regular.story',
  );
  await expect(page.getByRole('button', { name: '生成三阶段组装预览（不联网）' })).toBeDisabled();
  await expect(
    page.getByText('没有已选存档，无法组装游戏上下文。模块资源仍可浏览。'),
  ).toBeVisible();
  await page.getByLabel('搜索模块', { exact: true }).fill('writing.nsfw');
  await page.locator('.module-library-list button').click();
  await expect(page.getByRole('region', { name: '模块原文与排序' })).toContainText(
    'prompts/writing/nsfw.md',
  );
  await expect(page.getByRole('region', { name: '模块原文与排序' })).toContainText(
    '所属阶段常驻 · 不可关闭',
  );
  await expect(page.getByLabel('模块完整原文')).not.toContainText('正在读取');
  await expect(page.getByLabel('模块完整原文')).not.toBeEmpty();
  await page.getByLabel('搜索模块', { exact: true }).fill('');
  await page.getByRole('combobox', { name: '模块类型', exact: true }).selectOption('worldbook');
  await expect(page.locator('.module-library-list button')).toHaveCount(2);
  await page.getByRole('combobox', { name: '模块类型', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: '适用阶段筛选', exact: true }).selectOption('memory');
  await expect(page.locator('.module-library-list button')).toHaveCount(5);
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  await expect(page.getByText(/此阶段\/模式没有实际请求快照/)).toBeVisible();
  await expect(page.getByRole('button', { name: '主动查看完整内部上下文' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText('未提供');
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('真实存档六种模式预览、内部内容主动揭示、合法排序保存恢复及状态隔离', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const before = await seed(page);
  await page.reload();
  await inspector(page);
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('regular');
  await page.getByRole('button', { name: '下移 writing.conflict_pacing', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存提示词排序' })).toBeEnabled();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('variables');
  await expect(page.getByRole('button', { name: '保存提示词排序' })).toBeEnabled();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('story');
  const order = page.locator('.prompt-order-list li');
  await expect(order.first()).toContainText('identity.fusheng');
  await expect(page.locator('[data-module-id="identity.fusheng"]')).toContainText('固定');
  await page.getByRole('button', { name: '保存提示词排序' }).click();
  await page.getByRole('button', { name: '生成三阶段组装预览（不联网）' }).click();
  await expect(
    page.getByText('预览已组装；未发送 API 请求、未执行回合、未写入正式存档。'),
  ).toBeVisible();
  for (const stage of ['story', 'variables', 'world']) {
    await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption(stage);
    await expect(
      page.locator(`.prompt-order-list [data-module-id="stages.regular.${stage}"]`),
    ).toBeVisible();
    await expect(page.getByLabel('完整内部上下文', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '上下文与统计' })).not.toContainText(
      '秘密计划不可见',
    );
  }
  await page.screenshot({ path: testInfo.outputPath('prompt-inspector.png') });
  await page.getByRole('button', { name: '主动查看完整内部上下文' }).click();
  await page.getByRole('combobox', { name: '内部内容视图', exact: true }).selectOption('context');
  await expect(page.getByLabel('完整内部上下文', { exact: true })).toContainText('秘密计划不可见');
  await expect(page.getByLabel('完整内部上下文', { exact: true })).toContainText('OFFSCREEN_STATE');
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('story');
  await expect(page.getByLabel('完整内部上下文', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '主动查看完整内部上下文' }).click();
  await expect(page.getByLabel('完整内部上下文', { exact: true })).not.toContainText('不可见');
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('opening');
  await page.getByRole('button', { name: '生成三阶段组装预览（不联网）' }).click();
  await expect(
    page.getByText('预览已组装；未发送 API 请求、未执行回合、未写入正式存档。'),
  ).toBeVisible();
  await expect(page.locator('[data-module-id="stages.opening.story"]')).toBeVisible();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('variables');
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText('模式不匹配');
  expect(await readFormal(page)).toBe(before);
  await page.reload();
  await inspector(page);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('heijin.prompt-order.v1')!),
  );
  expect(saved.overrides['writing.conflict_pacing']).toBe(81);
  const ids = await page
    .locator('.prompt-order-list li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-module-id')));
  expect(ids.indexOf('writing.emotion_guard')).toBeLessThan(ids.indexOf('writing.conflict_pacing'));
  await page.getByRole('button', { name: '恢复默认顺序' }).click();
  const reset = await page
    .locator('.prompt-order-list li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-module-id')));
  expect(reset.indexOf('writing.conflict_pacing')).toBeLessThan(
    reset.indexOf('writing.emotion_guard'),
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /读取存档/ }).click();
  await page
    .getByRole('complementary', { name: '世界资料' })
    .getByRole('button', { name: /NPC/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).not.toContainText('不可见');
  expect(errors).toEqual([]);
});

test('已发送阶段快照保留原请求数据与真实 usage，默认隐藏秘密且始终去密钥，刷新不持久化', async ({
  page,
}, testInfo) => {
  const before = await seed(page);
  await page.reload();
  let transmitted = '';
  await page.route('https://inspector.mock.invalid/**', async (route) => {
    transmitted = route.request().postData() ?? '';
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                worldCommands: [],
                taskCommands: [],
                eventCommands: [],
                futureEvents: [],
                visibleHooks: [],
                timelineCandidates: [],
                unresolved: [],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      },
    });
  });
  await page.evaluate(async () => {
    const repoPath = '/src/services/storage/saveRepository.ts';
    const runtimePath = '/src/services/ai/runtime.ts';
    const configPath = '/src/services/ai/configuration.ts';
    const credentialsPath = '/src/services/ai/credentials.ts';
    const settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(repoPath);
    const { runStageRequest } = await import(runtimePath);
    const { newChannel, defaultAiConfig, saveAiConfig } = await import(configPath);
    const { CredentialVault } = await import(credentialsPath);
    const { defaultSettings } = await import(settingsPath);
    const channel = {
      ...newChannel(),
      baseUrl: 'https://inspector.mock.invalid/v1',
      defaultModel: 'mock-before',
    };
    const config = defaultAiConfig();
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: '' };
    saveAiConfig(localStorage, config);
    const vault = new CredentialVault(sessionStorage, localStorage);
    vault.set(channel.id, 'e2e-inspection-key');
    const repo = await SaveRepository.open();
    try {
      const state = await repo.load('ui-test');
      const draft = await repo.loadDraft('ui-test');
      await runStageRequest(
        {
          state,
          draft,
          settings: defaultSettings(),
          stage: 'world',
          mode: 'regular',
          userInput: '',
          domains: ['economy'],
        },
        config,
        vault,
      );
      config.channels[0].defaultModel = 'mock-after';
      saveAiConfig(localStorage, config);
    } finally {
      repo.close();
    }
  });
  const snapshotExample = await page.evaluate(async () => {
    const path = '/src/services/ai/inspection.ts';
    const { requestInspections } = await import(path);
    const record = requestInspections.getSnapshot()[0];
    return {
      source: 'Mock HTTP intercepted by Playwright',
      route: record.route,
      status: record.status,
      mode: record.scope.mode,
      stage: record.stage,
      modules: record.scope.modules,
      statistics: record.statistics,
    };
  });
  await writeFile(
    testInfo.outputPath('request-summary.json'),
    JSON.stringify(snapshotExample, null, 2),
  );
  expect(transmitted).toContain('秘密计划不可见');
  expect(transmitted).not.toContain('e2e-inspection-key');
  await inspector(page);
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('regular');
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('world');
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const context = page.getByRole('region', { name: '上下文与统计' });
  await expect(context).toContainText('mock-before');
  await expect(context).not.toContainText('mock-after');
  await expect(context).toContainText('42');
  await expect(context).toContainText('49');
  await expect(context).not.toContainText('秘密计划不可见');
  await page.getByRole('button', { name: '主动查看完整内部上下文' }).click();
  await page.getByRole('combobox', { name: '内部内容视图', exact: true }).selectOption('body');
  await expect(page.getByLabel('完整内部上下文', { exact: true })).toContainText('秘密计划不可见');
  await expect(context).not.toContainText('e2e-inspection-key');
  await expect(context).not.toContainText('Authorization');
  expect(await readFormal(page)).toBe(before);
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain('秘密计划不可见');
  expect(persisted).not.toContain('e2e-inspection-key');
  await page.reload();
  await inspector(page);
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  await expect(page.getByText(/此阶段\/模式没有实际请求快照/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('无正文草稿的阶段预览诚实失败，七项写作偏好不因管理中心改变', async ({ page }) => {
  await seed(page, false);
  await page.reload();
  await inspector(page);
  await page.getByRole('button', { name: '生成三阶段组装预览（不联网）' }).click();
  await expect(
    page.getByText('预览已组装；未发送 API 请求、未执行回合、未写入正式存档。'),
  ).toBeVisible();
  await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption('variables');
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText(
    '缺少已选定的正文草稿',
  );
  await page.getByRole('button', { name: '提示词', exact: true }).click();
  await expect(page.locator('.settings-fields > label')).toHaveCount(7);
  await expect(page.getByLabel('叙事人称')).toHaveValue('third');
});
