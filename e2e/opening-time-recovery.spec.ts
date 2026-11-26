import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { closeWorkflowSheet, openWorkflowDiagnostics, openStageSwitches } from './helpers/gameLayout';

const saveId = 'synthetic-opening-recovery';
const opening = '2015-07-08T14:00:00+08:00', ending = '2015-07-08T14:02:00+08:00';
const text = '<正文>林舟走到站台，在雨棚下停住。</正文><短期记忆>林舟来到站台。</短期记忆>';
const validStory = `${text}<变量规划>${JSON.stringify([{ group: 'time', subjectHint: 'time:opening', observedFact: { startAt: opening, endAt: ending } }])}</变量规划>`;

async function prepare(page: Page, retained = false) {
  const calls: string[] = [];
  let missing = !retained;
  await page.route('https://**', route => route.abort());
  await page.route('https://opening-recovery.mock.invalid/v1/chat/completions', async route => {
    const { model, messages } = route.request().postDataJSON();
    calls.push(model);
    const content = model === 'story' ? (retained || missing ? text : validStory)
      : `<thinking>选定开局时钟。</thinking><说明></说明><命令>\nset worldClock = "${opening}"\nset worldClock = "${ending}"\n</命令>`;
    if (model === 'story' && !retained) expect(messages.at(-1).content).toContain('<变量规划>必填');
    await route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
  });
  await page.goto('/');
  await page.evaluate(async ({ saveId, retained }) => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/ui/settings/model.ts', '/src/ui/creation/model.ts',
      '/src/domain/drafts.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/workflows/turnCoordinator.ts'];
    const [{ SaveRepository }, { defaultSettings, settingsKey }, { newCreation, buildCreationState }, { createTurnDraft },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { TurnCoordinator }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings(); settings.runtime.useEntityStage = false;
    settings.prompts.minNarrativeChars = 1;
    settings.prompts.actionOptions = false;
    settings.runtime.streamStory = false;
    settings.runtime.useVariableStage = retained;
    settings.runtime.useWorldStage = false;
    const channel = newChannel();
    channel.baseUrl = 'https://opening-recovery.mock.invalid/v1';
    const config = defaultAiConfig();
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    const vault = new CredentialVault(sessionStorage, localStorage);
    vault.set(channel.id, 'synthetic-mock-only');
    saveAiConfig(localStorage, config);
    const repo = await SaveRepository.open();
    const state = buildCreationState({ ...newCreation(), saveId, person: { name: '林舟', age: '30', gender: '女性', appearance: '', personality: '' }, profession: '教师' }, settings);
    try {
      await repo.create(state);
      const draft = createTurnDraft(saveId, 0, 'synthetic-opening', 'opening', '', retained, false, false);
      await repo.saveDraft(draft, null);
      if (retained) {
        const runner = new TurnCoordinator(repo);
        try {
          const outcome = await runner.generate({ draft, settings, config, vault });
          if (outcome.status !== 'complete') throw Error('Invalid retained candidate fixture');
        } finally { runner.dispose(); }
      }
    } finally { repo.close(); }
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, { saveId, retained });
  await page.goto(`/#game/${saveId}`);
  await page.reload();
  await expect(page.getByTestId('story-reader')).toBeVisible();
  return { calls, supplyValidStory: () => { missing = false; } };
}

async function stored(page: Page) {
  return page.evaluate(async (id) => {
    const path = '/src/services/storage/saveRepository.ts';
    const { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return await repo.loadGame(id); } finally { repo.close(); }
  }, saveId);
}

const recovery = (page: Page) => page.getByRole('note', { name: '开局时间恢复' });
const action = (page: Page) => page.locator('.composer-workflow-action');

async function openReport(page: Page, mobile: boolean) {
  await openWorkflowDiagnostics(page);
  if (mobile) {
    await page.getByRole('button', { name: '重试与变更详情', exact: true }).click();
    await page.getByRole('tab', { name: /^运行日志/ }).click();
  }
  await page.getByRole('button', { name: '上报错误', exact: true }).click();
  return page.getByRole('dialog', { name: '上报错误', exact: true });
}

test('缺少开局时间时保留正文并阻止结算，刷新后可主动重新 Roll', async ({ page, isMobile }, info) => {
  const mock = await prepare(page);
  const before = await stored(page);
  await expect(action(page)).toHaveAccessibleName('生成开局正文');
  await action(page).click();
  await expect(recovery(page)).toContainText('缺少结构化开局时间，正文已保留');
  await expect(page.getByTestId('story-reader')).toContainText('林舟走到站台');
  await expect(action(page)).toHaveAccessibleName('重新 Roll 开局正文');
  await expect(page.getByRole('button', { name: '完成本回合结算', exact: true })).toHaveCount(0);
  const blocked = await stored(page);
  expect(blocked.state).toEqual(before.state);
  await page.screenshot({ path: info.outputPath(`opening-blocked-${info.project.name}.png`) });
  const report = await openReport(page, isMobile);
  await report.getByRole('checkbox', { name: '附带最近保留的报错环节模型原文' }).check();
  await report.getByRole('checkbox', { name: '附带最近保留的报错环节公开思考' }).check();
  await report.getByText('预览上传内容', { exact: true }).click();
  const preview = JSON.parse(await report.getByRole('textbox', { name: '上传内容预览' }).inputValue());
  expect(preview.errors).toEqual([expect.objectContaining({ stage: 'commit', code: 'time_data', domainRule: 'opening_time_unavailable',
    diagnostic: expect.objectContaining({ phase: 'commit_validation', openingTime: {
      pending: true, useVariableStage: false, useWorldStage: false, clockSource: 'none', reason: 'opening_missing',
    } }),
  })]);
  expect(preview).not.toHaveProperty('attachments');
  expect(JSON.stringify(preview)).not.toContain(saveId);
  expect(JSON.stringify(preview)).not.toContain('走到站台');
  await page.reload();
  await expect(recovery(page)).toBeVisible();
  expect(await stored(page)).toEqual(blocked);
  expect(mock.calls).toEqual(['story']);
  mock.supplyValidStory();
  await action(page).click();
  await expect(action(page)).toHaveAccessibleName('完成本回合结算');
  const rerolled = await stored(page);
  expect(rerolled.draft.storyRevision).toBe(blocked.draft.storyRevision + 1);
  expect(rerolled.state).toEqual(before.state);
  await action(page).click();
  await expect.poll(async () => (await stored(page)).state.worldClock).toBe(ending);
  expect((await stored(page)).state.journal).toHaveLength(1);
  expect(mock.calls).toEqual(['story', 'story']);
});

test('关闭 Variables 排除其时钟，重新启用并主动继续时零请求复用', async ({ page }, info) => {
  const mock = await prepare(page, true);
  const before = await stored(page);
  await expect(action(page)).toHaveAccessibleName('完成本回合结算');
  await openStageSwitches(page);
  await page.locator('#workflow-runtime-switches input[data-stage="variables"]').uncheck();
  await closeWorkflowSheet(page);
  await expect(recovery(page)).toContainText('重新启用变量管理，继续时重新校验并尝试复用已有候选');
  expect(mock.calls).toEqual(['story', 'variables']);
  await recovery(page).getByRole('button', { name: '前往变量开关' }).click();
  await page.locator('#workflow-runtime-switches input[data-stage="variables"]').check();
  await closeWorkflowSheet(page);
  await expect(recovery(page)).toHaveCount(0);
  await expect(action(page)).toHaveAccessibleName('完成本回合结算');
  await expect(page.locator('#action-recovery-guidance')).toContainText('继续时会重新校验已有变量候选');
  expect(await stored(page)).toEqual(before);
  expect(mock.calls).toEqual(['story', 'variables']);
  await page.screenshot({ path: info.outputPath(`opening-reuse-${info.project.name}.png`) });
  await action(page).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  const committed = (await stored(page)).state;
  expect(committed.worldClock).toBe(ending);
  expect(committed.journal[0].scene.worldClock).toBe(opening);
  expect(mock.calls).toEqual(['story', 'variables']);
});

test('缺少时钟且没有候选时，启用设置不发请求，主动补算只调用 Variables', async ({ page }) => {
  const mock = await prepare(page);
  await action(page).click();
  await expect(recovery(page)).toContainText('启用变量管理后主动补算时间');
  const before = await stored(page);
  await recovery(page).getByRole('button', { name: '前往变量开关' }).click();
  await page.locator('#workflow-runtime-switches input[data-stage="variables"]').check();
  await closeWorkflowSheet(page);
  await expect(recovery(page)).toHaveCount(0);
  await expect(action(page)).toHaveAccessibleName('继续生成变量');
  expect(await stored(page)).toEqual(before);
  expect(mock.calls).toEqual(['story']);
  await action(page).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  const settled = await stored(page);
  expect(settled.state.worldClock).toBe(ending);
  expect(settled.state.journal[0].story).toEqual(before.draft.story);
  expect(mock.calls).toEqual(['story', 'variables']);
});
