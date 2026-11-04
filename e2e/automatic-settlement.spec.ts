import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const storage = '/src/services/storage/saveRepository.ts', fixtures = '/src/tests/fixtures/world.ts', drafts = '/src/domain/drafts.ts',
      configuration = '/src/services/ai/configuration.ts', credentials = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storage), { worldState } = await import(fixtures), { createTurnDraft } = await import(drafts),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configuration), { CredentialVault } = await import(credentials), { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://auto-settlement.mock.invalid/v1'; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-auto-settlement-key');
    const repo = await SaveRepository.open(); try { await repo.create(worldState()); await repo.saveDraft(createTurnDraft('save-a', 0, 'auto-opening', 'opening', ''), null); } finally { repo.close(); }
  });
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
}
async function stored(page: Page) { return page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }
async function mock(page: Page) {
  const calls: string[] = [], responses: { variables: string; world: string } = { variables: '', world: '' };
  const control: { bad?: boolean; hold?: Promise<void> } = {};
  await page.route('https://auto-settlement.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    const turn = calls.filter(stage => stage === 'story').length;
    const variables = `<说明>原始说明：第${turn}轮消费，保留换行。🟡</说明>\n<命令>\nset worldClock = "2026-10-18T08:${turn === 1 ? '10' : '20'}:00+08:00"\nadd economy.cash = -3000\n</命令>`;
    const world = control.bad ? '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [ {"type":"SaveEvent","commandId":"missing-end","evidence":"{}","event":{"id":"review","title":"清点","status":"scheduled","startAt":"2026-10-19T08:00:00+08:00","actorRefs":[{"kind":"npc","id":"npc-a"}],"linkedTaskIds":[],"prerequisites":[],"blockers":[],"visibility":"hidden","impact":"minor","sourceTurnIds":["auto-opening"],"backgroundText":"值班清点","goalText":"完成清点"}} ], "futureEvents": [], "visibleHooks": [], "timelineCandidates": [], "unresolved": []\n}'
      : '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [], "futureEvents": [], "visibleHooks": [], "timelineCandidates": [], "unresolved": []\n}';
    const worldText = world.replace('"evidence":"{}"', `"evidence":${JSON.stringify(JSON.stringify({ version: 1, kind: 'planned', at: '2026-10-18T08:05:00+08:00', sources: ['npc:npc-a'], fact: '计划进行内部清点。', rationale: '根据日常工作安排准备清点。' }))}`);
    const text = stage === 'story' ? `<thinking>保持当前行动连续。</thinking>\n<正文>第${turn}幕：主角在街边用餐，观察来往行人。</正文>\n<短期记忆>在街边用餐。</短期记忆>\n<变量规划>[]</变量规划>` : stage === 'variables' ? variables : worldText;
    if (stage === 'variables') responses.variables = text;
    if (stage === 'world') { responses.world = text; if (control.hold) await control.hold; }
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) }).catch(() => undefined);
  });
  return { calls, control, responses };
}
const settled = (page: Page) => expect(page.getByRole('region', { name: '三阶段工作流' }).getByRole('status')).toContainText('本回合已结算');
async function rawPanel(page: Page) { await page.getByText('查看三阶段模型完整原文与执行结果', { exact: true }).click(); }

test('完整原文可读，开局与下一条行动各自动结算一次，刷新和空待输入不调用模型', async ({ page }, info) => {
  await seed(page); const server = await mock(page);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await settled(page);
  let data = await stored(page); expect(data.state.turnNumber).toBe(1); expect(data.state.economy.cash).toBe(7000); expect(data.draft.userInput).toBe(''); expect(server.calls).toEqual(['story','variables','world']);
  await rawPanel(page); await page.getByText('变量模型原文', { exact: true }).click();
  await expect(page.getByLabel('变量模型完整原文')).toHaveText(server.responses.variables, { useInnerText: false });
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.responses.variables);
  await page.getByText('动态世界模型原文', { exact: true }).click(); expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
  await page.getByLabel('你的行动', { exact: true }).fill('继续在街边用餐'); await page.getByRole('button', { name: '发送', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  await settled(page); data = await stored(page); expect(data.state.turnNumber).toBe(2); expect(data.state.economy.cash).toBe(4000); expect(data.state.journal).toHaveLength(2); expect(data.draft.userInput).toBe(''); expect(server.calls).toHaveLength(6);
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(data); expect(server.calls).toHaveLength(6);
  await rawPanel(page); await page.getByText('变量模型原文', { exact: true }).click(); await expect(page.locator('.stage-responses')).toContainText('本页面没有可恢复的模型原文');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('auto-settlement-raw-output.png') });
});
test('World字段错误可定位并查看完整失败原文，不提交；恢复仅请求World并自动结算', async ({ page }) => {
  await seed(page); const server = await mock(page); server.control.bad = true;
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(page.getByTestId('runtime-log')).toContainText('estimatedEndAt'); await expect(page.getByTestId('runtime-log')).toContainText('SaveEvent');
  const before = await stored(page); expect(before.state.revision).toBe(0); expect(before.draft.story).toBeDefined(); expect(before.draft.variables.validation).toBe('validated'); expect(before.draft.stageStatus.world).toBe('failed');
  await rawPanel(page); await page.getByText('动态世界模型原文 · 未通过验收', { exact: true }).click(); expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
  server.control.bad = false; await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  expect((await stored(page)).state.turnNumber).toBe(1); expect(server.calls).toEqual(['story','variables','world','world']);
});
