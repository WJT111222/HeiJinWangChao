import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools, openWorkflowDiagnostics, openStageRaw } from './helpers/gameLayout';

async function seed(page: Page, remoteLocation = false) {
  await page.goto('/');
  await page.evaluate(async remoteLocation => {
    const storage = '/src/services/storage/saveRepository.ts', fixtures = '/src/tests/fixtures/world.ts', drafts = '/src/domain/drafts.ts',
      configuration = '/src/services/ai/configuration.ts', credentials = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storage), { worldState } = await import(fixtures), { createTurnDraft } = await import(drafts),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configuration), { CredentialVault } = await import(credentials), { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://auto-settlement.mock.invalid/v1'; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-auto-settlement-key');
    const state = worldState();
    if (remoteLocation) state.locations.remote = { id: 'remote', name: '诊所' };
    const repo = await SaveRepository.open(); try { await repo.create(state); await repo.saveDraft(createTurnDraft('save-a', 0, 'auto-opening', 'opening', ''), null); } finally { repo.close(); }
  }, remoteLocation);
  await page.goto('/#game/save-a'); await page.reload(); await openGameTools(page);
}
async function stored(page: Page) { return page.evaluate(async () => { const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), repo = await SaveRepository.open(); try { return await repo.loadGame('save-a'); } finally { repo.close(); } }); }
async function mock(page: Page) {
  const calls: string[] = [], responses: { variables: string; world: string } = { variables: '', world: '' };
  const control: { bad?: boolean; hold?: Promise<void>; variables?: string; world?: string } = {};
  await page.route('https://auto-settlement.mock.invalid/**', async route => {
    const stage = String(route.request().postDataJSON().model); calls.push(stage);
    const turn = calls.filter(stage => stage === 'story').length;
    const variables = variableTextEnvelope(control.variables ?? `<说明>原始说明：第${turn}轮消费，保留换行。🟡</说明>\n<命令>\nset worldClock = "2026-10-18T08:${turn === 1 ? '10' : '20'}:00+08:00"\nadd economy.cash = -3000\n</命令>`);
    const world = control.world ?? (control.bad ? '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [ {"type":"SaveEvent","commandId":"missing-end","evidence":"{}","event":{"id":"review","title":"清点","status":"scheduled","startAt":"2026-10-19T08:00:00+08:00","actorRefs":[{"kind":"npc","id":"npc-a"}],"linkedTaskIds":[],"prerequisites":[],"blockers":[],"visibility":"hidden","impact":"minor","sourceTurnIds":["auto-opening"],"backgroundText":"值班清点","goalText":"完成清点"}} ], "visibleHooks": [], "unresolved": []\n}'
      : '{\n "worldCommands": [], "taskCommands": [], "eventCommands": [], "visibleHooks": [], "unresolved": []\n}');
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

test('完整原文可读，开局与下一条行动各自动结算一次，刷新和空待输入不调用模型', async ({ page }, info) => {
  await seed(page); const server = await mock(page);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await settled(page);
  let data = await stored(page); expect(data.state.turnNumber).toBe(1); expect(data.state.economy.cash).toBe(7000); expect(data.draft.userInput).toBe(''); expect(server.calls).toEqual(['story','variables','world']);
  await openStageRaw(page, 'variables');
  await expect(page.getByLabel('变量模型完整原文')).toHaveText(server.responses.variables, { useInnerText: false });
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.responses.variables);
  await openStageRaw(page, 'world'); expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
  await page.getByLabel('你的行动', { exact: true }).fill('继续在街边用餐'); await page.getByRole('button', { name: '发送', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  await settled(page); data = await stored(page); expect(data.state.turnNumber).toBe(2); expect(data.state.economy.cash).toBe(4000); expect(data.state.journal).toHaveLength(2); expect(data.draft.userInput).toBe(''); expect(server.calls).toHaveLength(6);
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(data); expect(server.calls).toHaveLength(6);
  await openStageRaw(page, 'variables'); await expect(page.locator('.stage-responses')).toContainText('本页面没有可恢复的模型原文');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('auto-settlement-raw-output.png') });
});
test('World字段错误可定位并查看完整失败原文，不提交；恢复仅请求World并自动结算', async ({ page }) => {
  await seed(page); const server = await mock(page); server.control.bad = true;
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(page.getByTestId('runtime-log')).toContainText('estimatedEndAt'); await expect(page.getByTestId('runtime-log')).toContainText('SaveEvent');
  const before = await stored(page); expect(before.state.revision).toBe(0); expect(before.draft.story).toBeDefined(); expect(before.draft.variables.validation).toBe('validated'); expect(before.draft.stageStatus.world).toBe('failed');
  await openStageRaw(page, 'world'); expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
  server.control.bad = false; await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  expect((await stored(page)).state.turnNumber).toBe(1); expect(server.calls).toEqual(['story','variables','world','world']);
});

test('发送下一条行动仅绑定草稿，commit日志必须等到三阶段完成才开始', async ({ page }) => {
  // 仅观察真实日志函数的调用，不替换返回值、工作流或存储行为。
  await page.route('**/src/ui/game/runtimeLog.ts*', async route => {
    // 仅本地 Vite 模块读取可重试一次 ECONNRESET；不重试任何模型或业务请求。
    const response = await route.fetch({ maxRetries: 1 }), source = await response.text();
    const anchor = 'const label = runtimeStageNames[stage];';
    expect(source).toContain(anchor);
    await route.fulfill({ response, body: source.replace(anchor, `${anchor}\n(window.__commitAudit ??= []).push({stage, kind});`) });
  });
  const commits = (kind: string) => page.evaluate(kind => {
    const events: unknown = Reflect.get(window, '__commitAudit');
    return Array.isArray(events) ? events.filter((entry: unknown) => entry && typeof entry === 'object' && 'stage' in entry && 'kind' in entry && entry.stage === 'commit' && entry.kind === kind).length : 0;
  }, kind);
  await seed(page); const server = await mock(page);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await settled(page);
  expect(await commits('started')).toBe(1); expect(await commits('completed')).toBe(1);
  let release!: () => void; server.control.hold = new Promise<void>(resolve => { release = resolve; });
  await page.getByLabel('你的行动', { exact: true }).fill('继续在街边用餐');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => server.calls.length).toBe(6);
  try {
    expect((await stored(page)).state.turnNumber).toBe(1);
    expect(await commits('started')).toBe(1); expect(await commits('completed')).toBe(1);
  } finally { release(); }
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2); await settled(page);
  expect(await commits('started')).toBe(2); expect(await commits('completed')).toBe(2);
  await page.reload(); await openGameTools(page); await settled(page); expect(server.calls).toHaveLength(6);
});

test('NPC场景ID诊断与World规则同时保留，逐阶段恢复后只结算一次', async ({ page }, info) => {
  await seed(page, true); const server = await mock(page);
  server.control.variables = '<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset npc[scene].locationId = null\n</命令>';
  server.control.bad = true;
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  const log = page.getByTestId('runtime-log');
  await expect(log).toContainText('在场 NPC 缺少明确地点（NPC：scene）');
  expect(server.calls).toEqual(['story', 'variables']);
  const initial = await stored(page); expect(initial.state.revision).toBe(0);
  expect(initial.draft.stageStatus.variables).toBe('failed'); expect(initial.draft.world).toBeUndefined();

  server.control.variables = '<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset protagonist.locationId = "remote"\nset npc[scene].locationId = "remote"\n</命令>';
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click();
  await expect(log).toContainText('estimatedEndAt'); await expect(log).toContainText('世界校验：event_plan');
  await expect(log).toContainText('（NPC：scene）');
  const worldFailed = await stored(page); expect(worldFailed.state).toEqual(initial.state);
  expect(worldFailed.draft.variables.validation).toBe('validated'); expect(worldFailed.draft.stageStatus.world).toBe('failed');
  expect(server.calls).toEqual(['story', 'variables', 'variables', 'world']);
  await expect(log).not.toContainText('mock-auto-settlement-key');
  await page.screenshot({ path: info.outputPath('world-and-npc-diagnostics.png') });

  server.control.bad = false;
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const committed = await stored(page); expect(committed.state.turnNumber).toBe(1); expect(committed.state.journal).toHaveLength(1);
  expect(committed.state.protagonist.locationId).toBe('remote'); expect(committed.state.npc.scene.locationId).toBe('remote');
  expect(committed.draft.userInput).toBe(''); expect(server.calls).toEqual(['story', 'variables', 'variables', 'world', 'world']);
  await expect(log).toContainText('世界校验：event_plan'); await expect(log).toContainText('（NPC：scene）');
  await page.reload(); await openGameTools(page); await settled(page); expect(server.calls).toHaveLength(5);
  expect(await stored(page)).toEqual(committed);
});

test('源三标签截断保留正文；明确恢复后四操作自动结算并完整显示原文', async ({ page }, info) => {
  await seed(page); const server = await mock(page), before = await stored(page);
  server.control.variables = '<thinking>本轮状态分析。</thinking><说明>- 更新本幕变量。</说明><命令>set protagonist.emotionText = "安心"';
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(page.getByTestId('runtime-log')).toContainText('解析三个标签区块');
  const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft.story).toBeDefined(); expect(failed.draft.variables).toBeUndefined();
  expect(server.calls).toEqual(['story','variables']);
  server.control.variables = '<thinking>本轮变量变化分析结果。</thinking>\n<说明>\n- 用餐并更新技能记录。\n</说明>\n<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset protagonist = {"emotionText":"安心","skills":["驾驶","急救"]}\nadd economy.cash = -3000\npush protagonist.skills = "烹饪"\ndelete protagonist.skills[0]\n</命令>';
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const data = await stored(page); expect(data.state.turnNumber).toBe(1); expect(data.state.economy.cash).toBe(7000); expect(data.state.protagonist.skills).toEqual(['急救','烹饪']);
  expect(server.calls).toEqual(['story','variables','variables','world']); expect(data.draft.userInput).toBe('');
  await openStageRaw(page, 'variables');
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.control.variables);
  await page.screenshot({ path: info.outputPath('source-variable-protocol.png') });
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(data); expect(server.calls).toHaveLength(4);
});

test('候选写库配额失败显示具体步骤而非unknown，保留正文后只补失败阶段', async ({ page }) => {
  await seed(page); const server = await mock(page), before = await stored(page);
  await page.evaluate(async () => {
    const path = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(path), original = SaveRepository.prototype.saveDraft;
    Reflect.set(window, '__failSourceSave', true);
    SaveRepository.prototype.saveDraft = async function(this: unknown, ...args: unknown[]) {
      const next = args[0], status = next && typeof next === 'object' && 'stageStatus' in next ? next.stageStatus : undefined;
      if (Reflect.get(window, '__failSourceSave') && status && typeof status === 'object' && 'variables' in status && status.variables === 'ready')
        throw new DOMException('private-storage-detail', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  const log = page.getByTestId('runtime-log'); await expect(log).toContainText('错误码：storage'); await expect(log).toContainText('保存变量候选');
  await expect(log).not.toContainText('private-storage-detail');
  const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft.story).toBeDefined(); expect(failed.draft.stageStatus.variables).toBe('failed');
  expect(server.calls).toEqual(['story','variables']);
  await page.evaluate(() => Reflect.set(window, '__failSourceSave', false));
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const committed = await stored(page); expect(committed.state.turnNumber).toBe(1); expect(committed.state.economy.cash).toBe(7000);
  expect(server.calls).toEqual(['story','variables','variables','world']);
});

test('时间诊断保留重排前文本编号；失败原文可读，恢复自动结算且刷新不重发', async ({ page }) => {
  await seed(page); const server = await mock(page), before = await stored(page);
  server.control.variables = '<命令>\nset protagonist.emotionText = "从容"\nset npc[scene].lastInteractionAt = "2026-10-18T09:00:00+08:00"\nset worldClock = "2026-10-18T08:10:00+08:00"\n</命令>';
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await openWorkflowDiagnostics(page);
  const log = page.getByTestId('runtime-log');
  await expect(log).toContainText('错误码：time_data'); await expect(log).toContainText('命令序号：第 2 条');
  await expect(log).toContainText('命令类型：UpdateNpc'); await expect(log).toContainText('NPC 互动时间晚于执行时的游戏时钟');
  await expect(log).not.toContainText('相关命令：'); await expect(log).not.toContainText('mock-auto-settlement-key');
  const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft.story).toBeDefined(); expect(failed.draft.variables).toBeUndefined();
  expect(server.calls).toEqual(['story', 'variables']);
  await openStageRaw(page, 'variables');
  await expect(page.locator('.stage-responses')).toContainText('第2条命令：NPC 互动时间');
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.responses.variables);
  server.control.variables = server.control.variables.replace('09:00:00', '08:10:00');
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const committed = await stored(page); expect(committed.state.turnNumber).toBe(1); expect(committed.state.npc.scene.lastInteractionAt).toBe('2026-10-18T08:10:00+08:00');
  expect(server.calls).toEqual(['story', 'variables', 'variables', 'world']);
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(committed); expect(server.calls).toHaveLength(4);
});

test('认知格式、时间线对象和组织历史逐项拒绝，明确修正后保留Story并一次结算', async ({ page }) => {
  await seed(page); const server = await mock(page), before = await stored(page);
  server.control.variables = '<命令>\npush npc[scene].knownInformation = {"text":"收到安排","source":"当面通知","learnedAt":"2026-10-18T08:00:00+08:00"}\n</命令>';
  const world = { worldCommands: [{ type: 'CreateOrganization', commandId: 'create-community', evidence: '登记社区团队', organization: {
    id: 'org-community', name: '社区团队', kind: 'civil', description: '日常协调', protagonistRelation: '暂无往来', relationHistory: ['不应预填的历史'], keyNpcIds: [], currentTaskIds: [], activities: [],
  } }], taskCommands: [], eventCommands: [], visibleHooks: [], timelineCandidates: [{ eventId: 'invented' }], unresolved: [] };
  server.control.world = JSON.stringify(world);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await openWorkflowDiagnostics(page);
  const log = page.getByTestId('runtime-log'); await expect(log).toContainText('npc[id].knownInformation.knowledgeKind');
  const story = (await stored(page)).draft.story; expect(story).toBeDefined(); expect((await stored(page)).state).toEqual(before.state);
  server.control.variables = '<命令>\npush npc[scene].knownInformation = {"text":"收到安排","knowledgeKind":"reported","knowledgeSource":"当面通知","visibility":"npc_private"}\n</命令>';
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await expect(log).toContainText('schema_fields');
  // 旧 Variables 错误也含 schema_fields；等待本次 World 错误，才更换下一次响应。
  await expect(log.getByRole('listitem').filter({ hasText: '动态世界' })).toContainText('错误码：schema_fields');
  expect(server.calls).toEqual(['story', 'variables', 'variables', 'world']);
  expect((await stored(page)).state).toEqual(before.state); expect((await stored(page)).draft.variables.validation).toBe('validated');
  Reflect.deleteProperty(world, 'timelineCandidates'); server.control.world = JSON.stringify(world);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await expect(log).toContainText('organization_initialization');
  expect((await stored(page)).state).toEqual(before.state);
  world.worldCommands[0].organization.relationHistory = []; server.control.world = JSON.stringify(world);
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const committed = await stored(page); expect(committed.state.turnNumber).toBe(1); expect(committed.state.journal[0].story).toEqual(story);
  expect(committed.state.npc.scene.knownInformation).toEqual([{ text: '[转述]收到安排', source: '当面通知', learnedAt: '2026-10-18T08:00:00+08:00' }]);
  expect(committed.state.npc['npc-a'].memories).toEqual(before.state.npc['npc-a'].memories); expect(committed.state.timeline).toEqual([]);
  expect(server.calls).toEqual(['story', 'variables', 'variables', 'world', 'world', 'world']);
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(committed); expect(server.calls).toHaveLength(6);
});
