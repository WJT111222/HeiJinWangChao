import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { openGameTools, openStageSwitches, openWorkflowDiagnostics } from './helpers/gameLayout';

async function seed(page: Page) {
  await page.goto('/');
  return page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/issue194.ts',
      '/src/tests/fixtures/eventStages.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { issue194 }, { stageCommand }, { defaultAiConfig, newChannel, saveAiConfig },
      { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 1;
    for (const value of Object.values(settings.memory.summaries) as { automatic: boolean }[]) value.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel();
    channel.baseUrl = 'https://event-entry-194.mock.invalid/v1';
    channel.defaultModel = 'entry-handoff-mock';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config);
    new CredentialVault(sessionStorage, localStorage).set(channel.id, 'event-entry-mock-only');
    const { state, draft, response, successor } = issue194();
    const repo = await SaveRepository.open();
    try {
      const entry = { state, draft };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    } finally { repo.close(); }
    return { response, successor: stageCommand(successor) };
  });
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path);
    const repo = await SaveRepository.open();
    try { return await repo.loadGame('save-a'); } finally { repo.close(); }
  });
}

test('到期已呈现入场缺少后继时安全拒绝，主动重试后一次正式结算', async ({ page, isMobile }) => {
  const { response, successor } = await seed(page);
  const calls: { model: string; messages: { content: string }[] }[] = [];
  await page.route('https://event-entry-194.mock.invalid/**', async route => {
    expect(route.request().method()).toBe('POST');
    calls.push(route.request().postDataJSON());
    const reply = calls.length === 1 ? response : { ...response, eventCommands: [...response.eventCommands, successor] };
    await route.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] }) });
  });
  await page.goto('/#game/save-a');
  await page.reload();
  await openGameTools(page);
  const before = await stored(page);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  const mobileDiagnostics = page.locator('dialog.mobile-diagnostics-sheet');
  if (isMobile) await expect(mobileDiagnostics).toBeVisible();
  else await openWorkflowDiagnostics(page);
  const log = isMobile
    ? mobileDiagnostics.getByRole('tabpanel', { name: /运行日志/ }).getByTestId('runtime-log')
    : page.getByRole('region', { name: '运行诊断', exact: true }).getByTestId('runtime-log');
  await expect(log).toContainText('event_entry');
  await expect(log).toContainText('缺少承接原安排的后继互动');
  await expect(log).toContainText('eventCommands.0.event.protagonistEntry');
  await expect(log).not.toContainText('请核对样本清单');
  await expect(log).not.toContainText('event-entry-mock-only');
  const failed = await stored(page);
  expect(failed.state).toEqual(before.state);
  expect(failed.draft.story).toEqual(before.draft.story);
  expect(failed.draft.variables).toEqual(before.draft.variables);
  expect(failed.draft.world).toBeUndefined();
  expect(calls.map(call => call.model)).toEqual(['world']);
  const message = calls[0].messages.find(item => item.content.startsWith('<GAME_CONTEXT>'));
  const match = message?.content.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);
  expect(match).toBeTruthy();
  expect(JSON.parse(match![1]).EVENT_SCHEDULE.due).toEqual([expect.objectContaining({
    eventId: 'handoff-source', fixedEndAt: '2026-05-17T14:00:00+08:00',
    entryHandoff: { status: 'presented', channel: '电话', cue: '请核对样本清单', locationId: 'chongqing' },
  })]);

  if (isMobile) {
    await mobileDiagnostics.getByRole('button', { name: '关闭资料界面', exact: true }).click();
    await expect(mobileDiagnostics).not.toBeVisible();
  }
  await openStageSwitches(page);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber + 1);
  const saved = await stored(page);
  expect(saved.state.revision).toBe(before.state.revision + 1);
  expect(saved.state.events['handoff-source']).toMatchObject({
    status: 'resolved', resolvedAt: '2026-05-17T14:00:00+08:00', protagonistEntry: { status: 'invalidated' },
  });
  expect(saved.state.events['handoff-next'].protagonistEntry).toEqual({
    ...before.state.events['handoff-source'].protagonistEntry, id: expect.stringMatching(/^stage-entry:\d+$/),
  });
  expect(saved.state.protagonist).toEqual(before.state.protagonist);
  await page.reload();
  expect((await stored(page)).state).toEqual(saved.state);
  expect(calls.map(call => call.model)).toEqual(['world', 'world']);
});
