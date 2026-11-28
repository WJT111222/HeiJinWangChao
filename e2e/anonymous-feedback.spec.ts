import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflowDiagnostics, openWorkflowStage } from './helpers/gameLayout';
import type { FeedbackPayload } from '../src/services/feedback/contract';

const key = 'fictional-feedback-credential-0X42';
const receipt = '91fa45a1-2f76-4e31-9af7-b353519154aa';
const endpoint = '**/api/feedback';
const aiEndpoint = 'https://feedback-ai.mock.invalid/v1/chat/completions';
type RequestBody = { submissionId: string; feedback: FeedbackPayload };

async function loadSave(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}
async function seed(page: Page, daylight: boolean) {
  await page.goto('/');
  await page.evaluate(async ({ key, daylight }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/ui/settings/model.ts',
      '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/domain/drafts.ts', '/src/tests/fixtures/turn.ts'];
    const [{ SaveRepository }, { worldState, worldDraft }, { defaultSettings, settingsKey },
      { newChannel, defaultAiConfig, saveAiConfig }, { CredentialVault }, { createTurnDraft }, { saveFixtureStory }] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      await repo.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'opening', '合成动作不上传', true, true, false), null);
      await saveFixtureStory(repo, { ...worldDraft(false, 'opening'), userInput: '合成动作不上传' }, 0);
    } finally { repo.close(); }
    const settings = defaultSettings(); settings.runtime.useEntityStage = false;
    settings.display.appearance = daylight ? 'day' : 'night';
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel('deepseek'), config = defaultAiConfig();
    channel.baseUrl = 'https://feedback-ai.mock.invalid/v1';
    channel.defaultModel = 'synthetic-feedback-model';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: '' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, key);
  }, { key, daylight });
  await page.goto('/#game/save-a');
  await page.reload();
  await expect(page.locator('.game-layout')).toBeVisible();
}
async function failVariable(page: Page, count: number) {
  const mobileDiagnostics = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
  if (await mobileDiagnostics.isVisible()) await mobileDiagnostics.getByRole('button', { name: '关闭资料界面' }).click();
  await openWorkflowStage(page, 'variables');
  await page.getByRole('button', { name: '生成变量候选', exact: true }).click();
  await expect.poll(async () => (await loadSave(page)).draft?.failures.length).toBe(count);
}
async function openReport(page: Page, mobile: boolean) {
  if (mobile) {
    const dialog = page.getByRole('dialog', { name: '重试与变更详情', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: /^运行日志/ }).click();
  } else {
    await openWorkflowDiagnostics(page);
  }
  const button = page.getByRole('button', { name: '上报错误', exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  return page.getByRole('dialog', { name: '上报错误', exact: true });
}

test('错误日志统一上报：完整日志、可选字段严格分离、原文清除后仍可提交', async ({ page, isMobile }, info) => {
  await page.route('https://**', route => route.abort());
  let modelCalls = 0;
  await page.route(aiEndpoint, route => {
    modelCalls++;
    return route.fulfill({ json: { choices: [{
      message: { content: `收到的合成原文 ${modelCalls} ${key}`, reasoning_content: `公开思考 ${modelCalls}` },
      finish_reason: 'length',
    }] } });
  });
  const uploads: RequestBody[] = [];
  await page.route(endpoint, route => {
    uploads.push(route.request().postDataJSON() as RequestBody);
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ status: 201, json: { id: receipt } });
  });
  await seed(page, isMobile);
  await expect(page.locator('html')).toHaveAttribute('data-appearance', isMobile ? 'day' : 'night');
  await failVariable(page, 1);
  await failVariable(page, 2);
  const before = await loadSave(page);
  let form = await openReport(page, isMobile);
  const content = () => form.getByRole('checkbox', { name: '附带最近保留的报错环节模型原文' });
  const reasoning = () => form.getByRole('checkbox', { name: '附带最近保留的报错环节公开思考' });
  const showPreview = () => form.getByText('预览上传内容', { exact: true }).click();
  const preview = () => form.getByRole('textbox', { name: '上传内容预览' }).inputValue();
  await expect(content()).not.toBeChecked();
  await expect(reasoning()).not.toBeChecked();
  await expect(form).toContainText('2 条错误日志');
  await showPreview();
  expect(JSON.parse(await preview())).not.toHaveProperty('attachments');
  await reasoning().check();
  let projected = JSON.parse(await preview());
  expect(projected.attachments).toEqual([{ errorRef: 2, reasoning: '公开思考 2' }, { errorRef: 1, reasoning: '公开思考 1' }]);
  await reasoning().uncheck();
  await content().check();
  await form.getByText('预览上传内容', { exact: true }).click();
  await form.screenshot({ path: info.outputPath('error-report.png') });
  await showPreview();
  await form.getByRole('textbox', { name: '补充说明（选填）' }).fill('变量候选未生成 ' + key + ' save-a');
  projected = JSON.parse(await preview());
  expect(projected.attachments).toEqual([
    { errorRef: 2, content: '收到的合成原文 2 [密钥已隐藏]' },
    { errorRef: 1, content: '收到的合成原文 1 [密钥已隐藏]' },
  ]);
  expect(projected.errors).toHaveLength(2);
  expect(projected.errors[0]).toMatchObject({ stage: 'variables', code: 'output_limit', model: 'synthetic-feedback-model', protocol: 'deepseek' });
  expect(uploads).toHaveLength(0);
  expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await form.getByText('预览上传内容', { exact: true }).click();
  await form.getByRole('button', { name: '提交错误报告' }).click();
  await expect(form.getByRole('status')).toContainText(receipt);
  expect(uploads[0].feedback).toEqual(projected);
  expect(uploads[0].feedback).toMatchObject({ version: 'V1.0', build: 'development' });
  for (const marker of [key, 'save-a', 'turn-a', 'saveRef', 'turnRef', '合成动作不上传', '公开思考', 'GAME_CONTEXT']) {
    expect(JSON.stringify(uploads)).not.toContain(marker);
  }
  expect(await loadSave(page)).toEqual(before);
  await form.getByRole('button', { name: '关闭错误上报' }).click();
  form = await openReport(page, isMobile);
  await reasoning().check();
  await form.getByRole('button', { name: '提交错误报告' }).click();
  await expect(form.getByRole('status')).toContainText(receipt);
  expect(uploads[1].feedback.kind === 'error' && uploads[1].feedback.attachments).toEqual([
    { errorRef: 2, reasoning: '公开思考 2' }, { errorRef: 1, reasoning: '公开思考 1' },
  ]);
  await form.getByRole('button', { name: '关闭错误上报' }).click();
  await page.evaluate(async () => {
    const path = '/src/services/ai/stageResponses.ts';
    (await import(path)).stageResponses.clear();
  });
  form = await openReport(page, isMobile);
  await content().check();
  await reasoning().check();
  await expect(form).toContainText('没有可附带的对应内容');
  await form.getByRole('button', { name: '提交错误报告' }).click();
  await expect(form.getByRole('status')).toContainText(receipt);
  expect(uploads[2].feedback).not.toHaveProperty('attachments');
  expect(await loadSave(page)).toEqual(before);
  expect(modelCalls).toBe(2);
});

test('设置反馈不发送日志，网络失败保留输入，同一尝试使用相同编号重试', async ({ page, isMobile }, info) => {
  const uploads: RequestBody[] = [];
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://**', route => route.abort());
  await page.route(endpoint, async route => {
    uploads.push(route.request().postDataJSON() as RequestBody);
    if (uploads.length === 1) return route.abort('failed');
    await responseGate;
    return route.fulfill({ status: 201, json: { id: receipt } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  if (isMobile) {
    await page.getByRole('button', { name: '外观与提示音', exact: true }).click();
    await page.getByRole('radio', { name: /日间/ }).check();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'day');
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
  }
  await page.getByRole('button', { name: '生成阶段', exact: true }).click();
  const saveSettings = page.getByRole('button', { name: '保存本地设置', exact: true });
  await expect(saveSettings).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: '返回设置', exact: true }).click();
  await page.getByRole('button', { name: '反馈建议', exact: true }).click();
  await expect(saveSettings).toHaveCount(0);
  await page.getByLabel('反馈类型').selectOption('experience');
  const input = page.getByLabel('反馈内容');
  await input.fill('合成反馈：希望保留阅读进度。');
  expect(uploads).toHaveLength(0);
  await page.locator('.settings-layout').screenshot({ path: info.outputPath('suggestion.png') });
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('内容已保留');
  await expect(input).toHaveValue('合成反馈：希望保留阅读进度。');
  await page.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交中…' })).toBeDisabled();
  release();
  await expect(page.getByRole('status').filter({ hasText: receipt })).toBeVisible();
  expect(uploads).toHaveLength(2);
  expect(uploads[1]).toEqual(uploads[0]);
  expect(Object.keys(uploads[0].feedback).sort()).toEqual(['browser', 'build', 'category', 'device', 'kind', 'text', 'version']);
  expect(uploads[0].feedback).toMatchObject({
    kind: 'suggestion', category: 'experience', text: '合成反馈：希望保留阅读进度。',
    version: 'V1.0', build: 'development',
  });
  await expect(page.getByRole('button', { name: '提交反馈', exact: true })).toBeDisabled();
});
