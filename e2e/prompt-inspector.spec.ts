import { openWorldArchive } from './helpers/gameLayout';
import { openLibrary } from './helpers/home';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import manifest from '../prompts/manifest.json' with { type: 'json' };

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
async function inspector(page: Page, advanced = true) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await expect(page.getByRole('region', { name: '模块库' })).toBeVisible();
  if (advanced) await openAdvanced(page);
}
async function openAdvanced(page: Page) {
  await page.getByRole('button', { name: '高级', exact: true }).click();
  await expect(page.getByRole('region', { name: '高级' })).toBeVisible();
}
async function backToList(page: Page) {
  await page.getByRole('region', { name: '高级' }).getByRole('button', { name: /返回列表/ }).click();
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

test('无存档浏览真实模块、过滤与全文，缺少阶段请求时不伪造使用量', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url());
  });
  await page.goto('/');
  await inspector(page, false);
  const moduleCount = manifest.modules.length;
  const variableModules = manifest.modules.filter((item) => item.category === 'variable_group');
  const variableDomains = new Set(variableModules.map((item) => item.domain)).size;
  const groups = page.getByRole('group', { name: '提示词分类' });
  await expect(groups.getByRole('button', { name: /^全部/ })).toContainText(String(moduleCount));
  await expect(page.locator('.pm-list [data-prompt-id]')).toHaveCount(moduleCount - variableModules.length);
  await expect(page.locator('.pm-list [data-domain]')).toHaveCount(variableDomains);
  await openAdvanced(page);
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
  await backToList(page);
  await page.getByLabel('搜索模块', { exact: true }).fill('writing.nsfw');
  await expect(page.locator('.pm-list [data-prompt-id]')).toHaveCount(1);
  await page.locator('.pm-list [data-prompt-id="writing.nsfw"] .pm-open').click();
  const source = page.getByRole('region', { name: '模块原文' });
  await expect(source).toContainText('prompts/writing/nsfw.md');
  await expect(source).toContainText('所属阶段常驻 · 不可关闭');
  await expect(page.getByLabel('模块完整原文')).not.toContainText('正在读取');
  await expect(page.getByLabel('模块完整原文')).not.toBeEmpty();
  await source.getByRole('button', { name: /返回列表/ }).click();
  await page.getByLabel('搜索模块', { exact: true }).fill('');
  await groups.getByRole('button', { name: /^参考资料/ }).click();
  await expect(page.locator('.pm-list [data-prompt-id]')).toHaveCount(
    manifest.modules.filter((item) => ['documentation', 'example', 'reference'].includes(item.category)).length,
  );
  await groups.getByRole('button', { name: /^记忆/ }).click();
  await expect(page.locator('.pm-list [data-prompt-id]')).toHaveCount(5);
  await groups.getByRole('button', { name: /^变量规则/ }).click();
  await page.getByRole('button', { name: '查看主角常规更新规则', exact: true }).click();
  await expect(source).toContainText('主角 · 变量规则');
  await expect(source.getByRole('button', { name: '文本变量', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await source.getByRole('button', { name: 'JSON 变量', exact: true }).click();
  await expect(source).toContainText('variableGroups.protagonist.update');
  await expect(source).not.toContainText('variableGroups.protagonist.update.text');
  for (const format of ['json', 'text'] as const) {
    await source.getByRole('button', { name: format === 'json' ? 'JSON 变量' : '文本变量', exact: true }).click();
    const id = `variableGroups.protagonist.update${format === 'text' ? '.text' : ''}`;
    const expected = await page.evaluate(async id => {
      const path = '/src/prompts/loader.ts';
      return (await import(path)).readPromptResource(id);
    }, id);
    await expect(page.getByLabel('模块完整原文')).toHaveText(expected);
    await screenshot(page, `source-${format}`);
  }
  for (const label of ['初始化', '场外规则', '常规更新']) {
    await source.getByRole('group', { name: '规则阶段' }).getByRole('button', { name: label, exact: true }).click();
    await expect(source.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('模块完整原文')).not.toBeEmpty();
  }
  await source.getByRole('button', { name: '高级', exact: true }).click();
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
  await expect(page.locator('.stage-stat-cards')).toContainText('离线预览');
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText('当前模型上下文窗口未知，无法确认请求是否超限。');
  await page.getByText('展开数据分类、召回预算与重复诊断', { exact: true }).click();
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText('召回预算只影响旧journal原文，不影响完整正式世界状态。');
  await expect(page.getByRole('region', { name: '上下文与统计' })).toContainText('字符差额 0，字节差额 0');
  for (const stage of ['story', 'variables', 'world']) {
    await page.getByRole('combobox', { name: '检查阶段', exact: true }).selectOption(stage);
    await expect(
      page.locator(`.prompt-order-list [data-module-id="stages.regular.${stage}${stage === 'variables' ? '.text' : ''}"]`),
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
  await expect(page.getByLabel('完整内部上下文', { exact: true })).toContainText('秘密计划不可见');
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
  await openLibrary(page);await page.getByRole('button', { name: /读取存档/ }).click();
  await expect(page.locator('.game-layout')).toBeVisible();
  await openWorldArchive(page);
  await page
    .getByRole('complementary', { name: '世界资料' })
    .getByRole('button', { name: /NPC/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'NPC', exact: true })).toContainText('隐藏人物不可见');
  expect(await readFormal(page)).toBe(before);
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
                visibleHooks: [],
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

for (const count of [300, 1000]) test(`${count} NPC 真实快照按需 Worker 分析、动画帧继续、结果与原算法一致且复用缓存`, async ({ page }, testInfo) => {
  await seed(page);
  await page.reload();
  let workers = 0;
  page.on('worker', () => workers++);
  const capture = await page.evaluate(async count => {
    const fixturePath = '/src/tests/fixtures/contextScale.ts';
    const composerPath = '/src/prompts/composer.ts';
    const configPath = '/src/services/ai/configuration.ts';
    const credentialsPath = '/src/services/ai/credentials.ts';
    const snapshotPath = '/src/services/ai/snapshot.ts';
    const clientPath = '/src/services/ai/client.ts';
    const { contextScaleFixture } = await import(fixturePath);
    const { composePrompt } = await import(composerPath);
    const { newChannel, defaultAiConfig } = await import(configPath);
    const { CredentialVault } = await import(credentialsPath);
    const { requestSnapshot } = await import(snapshotPath);
    const { AiClient } = await import(clientPath);
    const source = contextScaleFixture(count);
    source.state.saveId = 'ui-test';
    source.draft.saveId = 'ui-test';
    const prompt = await composePrompt({ ...source, stage: 'story', mode: 'regular', userInput: source.draft.userInput });
    const channel = { ...newChannel(), defaultModel: 'worker-scale-mock' };
    const config = defaultAiConfig(); config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    const vault = new CredentialVault(sessionStorage, localStorage); vault.set(channel.id, 'worker-scale-secret');
    let calls = 0;
    const before = performance.now();
    await new AiClient(async () => {
      calls++;
      return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 2 } });
    }).generate(requestSnapshot(config, 'story', vault), prompt.messages, { inspection: { kind: 'stage', mode: 'regular', saveId: 'ui-test', revision: source.state.revision, modules: prompt.modules } });
    return { calls, captureAndMockResponseMs: performance.now() - before };
  }, count);
  expect(workers).toBe(0);
  expect(capture.calls).toBe(1);
  await inspector(page);
  await page.getByRole('combobox', { name: '回合模式', exact: true }).selectOption('regular');
  await page.getByRole('combobox', { name: '数据来源', exact: true }).selectOption('actual');
  const context = page.getByRole('region', { name: '上下文与统计' });
  expect(workers).toBe(0);
  await page.getByText('展开数据分类、召回预算与重复诊断', { exact: true }).click();
  await expect(context).toContainText('正在分析…');
  await backToList(page);
  await page.getByLabel('搜索模块', { exact: true }).fill('writing');
  await expect(page.getByLabel('搜索模块', { exact: true })).toHaveValue('writing');
  await openAdvanced(page);
  const progress = await page.evaluate(async () => {
    const storePath = '/src/services/ai/inspection.ts', analysisPath = '/src/prompts/budgetAnalysis.ts';
    const { requestInspections } = await import(storePath);
    const { budgetAnalysis } = await import(analysisPath);
    const analysis = budgetAnalysis(requestInspections.getSnapshot()[0].messages);
    let frames = 0;
    const start = performance.now();
    await new Promise<void>(resolve => {
      function frame() { frames++; if (analysis.getSnapshot().status === 'running') requestAnimationFrame(frame); else resolve(); }
      requestAnimationFrame(frame);
    });
    return { frames, analysisMs: performance.now() - start };
  });
  expect(progress.frames).toBeGreaterThan(1);
  await expect(context).toContainText('分析完成（本会话内存缓存）。');
  await expect(context).toContainText('字符差额 0，字节差额 0');
  expect(workers).toBe(1);
  const equality = await page.evaluate(async () => {
    const storePath = '/src/services/ai/inspection.ts', analysisPath = '/src/prompts/budgetAnalysis.ts', purePath = '/src/prompts/budgetInspection.ts';
    const { requestInspections } = await import(storePath);
    const { budgetAnalysis } = await import(analysisPath);
    const { inspectBudget } = await import(purePath);
    const snapshot = requestInspections.getSnapshot()[0];
    const state = budgetAnalysis(snapshot.messages).getSnapshot();
    // Test-only oracle runs after the real Worker completes; production has no main-thread fallback.
    return state.status === 'complete' && JSON.stringify(state.result) === JSON.stringify(inspectBudget(snapshot.messages));
  });
  expect(equality).toBe(true);
  await page.getByText('展开数据分类、召回预算与重复诊断', { exact: true }).click();
  await page.getByText('展开数据分类、召回预算与重复诊断', { exact: true }).click();
  await expect(context).toContainText('分析完成（本会话内存缓存）。');
  expect(workers).toBe(1);
  await writeFile(testInfo.outputPath('worker-measurement.json'), JSON.stringify({ count, ...capture, ...progress, workers, equality }, null, 2));
  await page.getByRole('button', { name: '清空内存请求记录' }).click();
  await expect(page.getByText(/此阶段\/模式没有实际请求快照/)).toBeVisible();
});

const promptSwitches = manifest.modules.filter((item) =>
  ['noControl', 'naturalProse', 'actionOptions', 'realWorld'].includes(item.toggle?.split(':')[0] ?? ''),
);
const evidenceDir = 'docs/pr124-review/screenshots';
async function screenshot(page: Page, name: string) {
  if (name === 'preview-invalidated') {
    await page.getByText('写作偏好已修改，请重新组装预览。', { exact: true })
      .evaluate(element => element.scrollIntoView({ block: 'center' }));
  }
  await page.screenshot({ path: `${evidenceDir}/${page.viewportSize()!.width}-${name}.png`, animations: 'disabled', scale: 'css' });
}

test('四开关显式保存：双页联动、未保存刷新丢弃、保存刷新持久化与再次编辑提示', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.abort());
  await page.goto('/');
  const before = await page.evaluate(() => localStorage.getItem('heijin.settings.v1'));
  await inspector(page, false);
  const groups = page.getByRole('group', { name: '提示词分类' });
  expect(promptSwitches).toHaveLength(4);
  await groups.getByRole('button', { name: /^写作设定/ }).click();
  await screenshot(page, 'list');
  for (const item of promptSwitches) {
    await page.locator(`[data-prompt-id="${item.id}"] input`).uncheck();
    await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地设置尚未保存');
  }
  expect(await page.evaluate(() => localStorage.getItem('heijin.settings.v1'))).toBe(before);
  await expect(page.locator('.local-save-bar').getByRole('status')).toBeInViewport();
  await expect(page.getByRole('button', { name: '保存本地设置', exact: true })).toBeInViewport();
  await screenshot(page, 'unsaved');
  await page.getByRole('button', { name: '提示词', exact: true }).click();
  for (const label of ['NoControl（防抢话）', '自然文风修复', '行动选项', '真实世界模式']) {
    await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
  }
  await page.getByRole('button', { name: '提示词管理', exact: true }).click();
  await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地设置尚未保存');
  await page.reload();
  await inspector(page, false);
  for (const item of promptSwitches) await expect(page.locator(`[data-prompt-id="${item.id}"] input`)).toBeChecked();
  for (const item of promptSwitches) {
    const row = page.locator(`[data-prompt-id="${item.id}"]`);
    await row.locator('.pm-open').click();
    const source = page.getByRole('region', { name: '模块原文' });
    await source.getByRole('checkbox').uncheck();
    await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地设置尚未保存');
    await source.getByRole('button', { name: /返回列表/ }).click();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
  }
  const save = page.getByRole('button', { name: '保存本地设置', exact: true });
  await save.click();
  await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地偏好已保存');
  await screenshot(page, 'saved');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('heijin.settings.v1')!).prompts);
  for (const field of ['noControl', 'naturalProse', 'actionOptions', 'realWorld']) expect(saved[field]).toBe(false);
  await page.reload();
  await inspector(page, false);
  for (const item of promptSwitches) await expect(page.locator(`[data-prompt-id="${item.id}"] input`)).not.toBeChecked();
  await page.locator(`[data-prompt-id="${promptSwitches[0].id}"] input`).check();
  await save.click();
  await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地偏好已保存');
  await page.locator(`[data-prompt-id="${promptSwitches[0].id}"] input`).uncheck();
  await expect(page.locator('.local-save-bar').getByRole('status')).toContainText('本地设置尚未保存');
  await expect(page.locator('.local-save-bar').getByRole('status')).toHaveClass(/l-info/);
  expect(errors).toEqual([]);
});

test('四开关取消旧组装：列表与原文修改立即失效，迟到成功不覆盖新任务，重新组装才有效', async ({ page }) => {
  // Observe completion of the real assembler in this test only; production stays unchanged.
  await page.route('**/src/prompts/preview.ts', async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain('async function buildStagePreviews(');
    await route.fulfill({ response, body: source.replace('async function buildStagePreviews(', 'async function buildStagePreviewsForTest(') + '\nexport async function buildStagePreviews(...args) { try { return await buildStagePreviewsForTest(...args); } finally { window.__pr124Builds = (window.__pr124Builds || 0) + 1; } }' });
  });
  await page.route('https://**', route => route.abort());
  const before = await seed(page);
  await page.reload();
  await inspector(page);
  await page.getByRole('combobox', { name: '预览存档', exact: true }).selectOption('ui-test');
  const assemble = page.getByRole('button', { name: '生成三阶段组装预览（不联网）', exact: true });
  await assemble.click();
  await expect(page.getByText('已按此配置组装预览，尚未发送。', { exact: true })).toBeVisible();
  await screenshot(page, 'advanced');
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const target = window as unknown as { __pr124Loads: Array<() => void>; __pr124Restore: () => void };
    target.__pr124Loads = [];
    const original = SaveRepository.prototype.load;
    target.__pr124Restore = () => { SaveRepository.prototype.load = original; };
    SaveRepository.prototype.load = async function (id: string) {
      const value = await original.call(this, id);
      await new Promise<void>(resolve => target.__pr124Loads.push(resolve));
      return value;
    };
  });
  let completed = 1;
  for (const [index, item] of promptSwitches.entries()) {
    await assemble.click();
    await expect(page.getByRole('button', { name: '组装中…', exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pr124Loads: unknown[] }).__pr124Loads.length)).toBe(1);
    await backToList(page);
    const row = page.locator(`[data-prompt-id="${item.id}"]`);
    if (index % 2) {
      await row.locator('.pm-open').click();
      await page.getByRole('region', { name: '模块原文' }).getByRole('checkbox').uncheck();
      await screenshot(page, 'source-unsaved');
    } else await row.getByRole('checkbox').uncheck();
    await openAdvanced(page);
    await expect(page.getByText('已按此配置组装预览，尚未发送。', { exact: true })).toHaveCount(0);
    await expect(page.locator('.stage-stat-cards')).not.toContainText('离线预览');
    await expect(page.getByText('写作偏好已修改，请重新组装预览。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '主动查看完整内部上下文' })).toHaveCount(0);
    if (!index) await screenshot(page, 'preview-invalidated');
    await assemble.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pr124Loads: unknown[] }).__pr124Loads.length)).toBe(2);
    // Finish the superseded job first, while the current job remains blocked.
    await page.evaluate(() => (window as unknown as { __pr124Loads: Array<() => void> }).__pr124Loads.shift()!());
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pr124Builds: number }).__pr124Builds)).toBe(++completed);
    await expect(page.getByRole('button', { name: '组装中…', exact: true })).toBeDisabled();
    await expect(page.getByText('已按此配置组装预览，尚未发送。', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __pr124Loads: Array<() => void> }).__pr124Loads.shift()!());
    await expect.poll(() => page.evaluate(() => (window as unknown as { __pr124Builds: number }).__pr124Builds)).toBe(++completed);
    await expect(page.getByText('已按此配置组装预览，尚未发送。', { exact: true })).toBeVisible();
    await expect(page.locator(`[data-module-id="${item.id}"]`)).toHaveCount(0);
    await expect(page.getByLabel('完整内部上下文', { exact: true })).toHaveCount(0);
  }
  await page.evaluate(() => (window as unknown as { __pr124Restore: () => void }).__pr124Restore());
  expect(await readFormal(page)).toBe(before);
});
