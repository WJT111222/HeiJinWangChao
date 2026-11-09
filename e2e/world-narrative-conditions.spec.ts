import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';
import type { worldConditions } from '../src/tests/fixtures/worldConditions';

async function seed(page: Page) {
  await page.goto('/');
  const fixture: Pick<ReturnType<typeof worldConditions>, 'response' | 'task' | 'event'> = await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/worldConditions.ts',
      '/src/domain/drafts.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts', '/src/ui/settings/model.ts'];
    const [{ SaveRepository }, { worldConditions }, { createTurnDraft, rerollStory },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }, { defaultSettings, settingsKey }] = await Promise.all(paths.map(p => import(p)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 1;
    for (const config of Object.values(settings.memory.summaries) as { automatic: boolean }[]) config.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel();
    channel.baseUrl = 'https://conditions.mock.invalid/v1'; channel.defaultModel = 'mock-world';
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'mock-world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-conditions-only');
    const a = worldConditions(), repo = await SaveRepository.open();
    try {
      await repo.create(a.state);
      const initial = createTurnDraft(a.state.saveId, 0, a.draft.turnId, 'opening', '');
      await repo.saveDraft(initial, null); await repo.saveDraft(rerollStory(initial, a.draft.story), 0);
      await repo.saveDraft({ ...a.draft, draftRevision: 2 }, 1);
    } finally { repo.close(); }
    return { response: a.response, task: a.task, event: a.event };
  });
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
  return fixture;
}
const stored = (page: Page) => page.evaluate(async () => {
  const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open();
  try { return await repo.loadGame('save-a'); } finally { repo.close(); }
});

for (const failFirst of [false, true]) test(`blocked任务与active事件保留阻碍，${failFirst ? '非法引用失败后仅重试World' : '直接自动结算'}，刷新不重复调用`, async ({ page }, info) => {
  const fixture = await seed(page), initial = await stored(page);
  let invalid = failFirst, calls = 0;
  await page.route('https://conditions.mock.invalid/**', async route => {
    calls++;
    const response = structuredClone(fixture.response);
    if (invalid) {
      const command = response.taskCommands[0];
      if (command.type !== 'SaveTask') throw Error('fixture type');
      command.task.actorRef = { kind: 'npc', id: 'absent-synthetic-npc' };
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) }, finish_reason: 'stop' }] }) });
  });
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  if (failFirst) {
    await expect(page.getByTestId('runtime-log')).toContainText('actor_permission');
    await expect(page.getByTestId('runtime-log')).toContainText('taskCommands.0');
    const failed = await stored(page);
    expect(failed.state).toEqual(initial.state); expect(failed.draft.story).toEqual(initial.draft.story);
    expect(failed.draft.variables).toEqual(initial.draft.variables); expect(failed.draft.world).toBeUndefined();
    expect(calls).toBe(1); await page.reload(); await openGameTools(page); expect(calls).toBe(1);
    invalid = false;
    await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  }
  await expect(page.getByRole('region', { name: '三阶段工作流' }).getByRole('status')).toContainText('本回合已结算');
  const saved = await stored(page);
  expect(saved.state.tasks[fixture.task.id]).toMatchObject({ status: 'blocked', blockers: fixture.task.blockers, prerequisites: fixture.task.prerequisites, linkedEventId: fixture.event.id });
  expect(saved.state.events[fixture.event.id]).toMatchObject({ status: 'active', blockers: fixture.event.blockers, prerequisites: fixture.event.prerequisites });
  expect(saved.state.journal).toHaveLength(1); expect(saved.state.journal[0].story.narrative).toBe(initial.draft.story.narrative);
  expect(saved.state.npc.npc_fixture_lin.onScene).toBe(false); expect(saved.state.npc.npc_fixture_xu).toEqual(initial.state.npc.npc_fixture_xu);
  expect(calls).toBe(failFirst ? 2 : 1);
  await page.screenshot({ path: info.outputPath('narrative-conditions-settled.png') });
  await page.reload(); await openGameTools(page);
  expect((await stored(page)).state).toEqual(saved.state); expect(calls).toBe(failFirst ? 2 : 1);
  await expect(page.getByLabel('你的行动', { exact: true })).toHaveValue('');
});
