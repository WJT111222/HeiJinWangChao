import type { Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { openGameTools, openStageSwitches, openWorkflowDiagnostics } from './helpers/gameLayout';

async function seed(page: Page, notification = false) {
  await page.goto('/');
  return page.evaluate(async notification => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/issue194.ts',
      '/src/tests/fixtures/eventStages.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts', '/src/domain/drafts.ts'];
    const [{ SaveRepository }, { issue194 }, { stageCommand }, { defaultAiConfig, newChannel, saveAiConfig },
      { CredentialVault }, { defaultSettings, settingsKey }, { createTurnDraft }] = await Promise.all(paths.map(path => import(path)));
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 1;
    settings.prompts.actionOptions = false;
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
    const { state, draft, response, successor, terminal } = issue194();
    if (notification) {
      const event = state.events['handoff-source'];
      const cue = '汇报三家分店谈判的结果，无需回应。';
      event.entryIntent = 'notification';
      event.protagonistEntry.cue = cue;
      event.continuation.entry.cue = cue;
      response.eventCommands = [stageCommand({ ...terminal, entryIntent: 'notification' })];
    }
    const repo = await SaveRepository.open();
    try {
      const entry = { state, draft: notification
        ? createTurnDraft(state.saveId, state.revision, draft.turnId, 'regular', '') : draft };
      await repo.importBackup(entry, (await repo.compareBackup(entry)).confirmation);
    } finally { repo.close(); }
    return { response, successor: stageCommand(successor) };
  }, notification);
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

test('工作结果纯通知从 Story 收悉走完整三阶段、刷新和撤回', async ({ page }) => {
  const { response } = await seed(page, true);
  const calls: string[] = [];
  await page.route('https://event-entry-194.mock.invalid/**', async route => {
    expect(route.request().method()).toBe('POST');
    const { model, messages } = route.request().postDataJSON();
    calls.push(model);
    const wire = messages.find((message: {content: string}) => message.content.startsWith('<GAME_CONTEXT>')).content;
    const context = JSON.parse(wire.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)[1]);
    const evidence = '主角听完语音，收悉三家分店的谈判结果。';
    const receipt = { eventId:'handoff-source', entryId:'entry:1:1', action:'acknowledged' };
    if (model === 'story') {
      expect(context.EVENT_PARTICIPATION).toContainEqual({
        eventId:receipt.eventId, entryId:receipt.entryId, status:'presented', entryIntent:'notification',
      });
      const guide = [{group:'event', observedFact:'收悉工作汇报',textEvidence:evidence,eventInteraction:receipt}];
      const reply = `<thinking>按玩家行动听取工作汇报。</thinking><正文>十分钟后，${evidence}</正文><短期记忆>主角已经收悉三家分店的谈判汇报。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;
      await route.fulfill({contentType:'text/event-stream',
        body:`data: ${JSON.stringify({choices:[{delta:{content:reply}}]})}

data: [DONE]

`});
      return;
    }
    let text: string;
    if (model === 'variables') {
      expect(context.STORY_RESULT.variableGuide[0].eventInteraction).toEqual(receipt);
      text = '<thinking>只落实本幕经过的时间。</thinking><说明>工作汇报收悉由程序处理。</说明><命令>set worldClock = "2026-05-17T14:00:00+08:00"</命令>';
    } else {
      expect(model).toBe('world');
      expect(context.SAVE_STATE.events['handoff-source']).toMatchObject({
        status:'active', entryIntent:'notification', protagonistEntry:{status:'acknowledged', textEvidence:evidence},
      });
      const due = context.EVENT_SCHEDULE.due.find((item: {eventId: string}) => item.eventId === 'handoff-source');
      expect(due).toMatchObject({fixedEndAt:'2026-05-17T14:00:00+08:00'});
      expect(due).not.toHaveProperty('entryHandoff');
      expect(response.eventCommands).toHaveLength(1);
      text = JSON.stringify(response);
    }
    await route.fulfill({contentType:'application/json',
      body:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });

  await page.goto('/#game/save-a');
  await page.reload();
  const before = await stored(page);
  await page.getByLabel('你的行动', { exact:true }).fill('听完这段谈判结果汇报');
  await page.getByRole('button', { name:'发送', exact:true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber + 1);
  const saved = (await stored(page)).state;
  expect(saved.revision).toBe(before.state.revision + 1);
  expect(saved.events['handoff-source']).toMatchObject({
    status:'resolved', resolvedAt:'2026-05-17T14:00:00+08:00', continuation:{direction:'end'},
    protagonistEntry:{status:'acknowledged',handledTurnId:saved.journal.at(-1).turnId},
  });
  expect(saved.protagonist).toEqual(before.state.protagonist);
  expect(saved.economy).toEqual(before.state.economy);
  expect(Object.keys(saved.events)).toEqual(Object.keys(before.state.events));
  expect(calls).toEqual(['story','variables','world']);

  await page.reload();
  await expect(page.getByRole('button', { name:'撤回（1）',exact:true })).toBeVisible();
  expect((await stored(page)).state).toEqual(saved);
  await page.getByRole('button', { name:'撤回（1）',exact:true }).click();
  await page.getByRole('button', { name:'确认撤回',exact:true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(before.state.turnNumber);
  const restored = (await stored(page)).state;
  expect(restored.events).toEqual(before.state.events);
  expect(restored.journal).toEqual(before.state.journal);
  expect(restored.worldClock).toBe(before.state.worldClock);
  expect(calls).toEqual(['story','variables','world']);
});
