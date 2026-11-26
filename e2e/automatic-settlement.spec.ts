import {stageFixtureReply} from '../src/tests/fixtures/variableReply';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { closeWorkflowSheet, openGameTools, openWorkflowDiagnostics, openStageRaw, openStageTab } from './helpers/gameLayout';

async function seed(page: Page, remoteLocation = false, organization = false) {
  await page.goto('/');
  await page.evaluate(async ([remoteLocation, organization]) => {
    const storage = '/src/services/storage/saveRepository.ts', fixtures = '/src/tests/fixtures/world.ts', drafts = '/src/domain/drafts.ts',
      configuration = '/src/services/ai/configuration.ts', gameFixtures = '/src/tests/fixtures/game.ts', credentials = '/src/services/ai/credentials.ts', settingsPath = '/src/ui/settings/model.ts';
    const { SaveRepository } = await import(storage), { worldState } = await import(fixtures), { createTurnDraft } = await import(drafts),
      { defaultAiConfig, newChannel, saveAiConfig } = await import(configuration), { CredentialVault } = await import(credentials), { defaultSettings, settingsKey } = await import(settingsPath);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false; localStorage.setItem(settingsKey, JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://auto-settlement.mock.invalid/v1'; channel.compatibility.jsonMode = true;
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' }; config.routes.entities = {mode:'independent',channelId:channel.id,modelId:'entities'}; config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' }; config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'mock-auto-settlement-key');
    const state = worldState();
    if (remoteLocation) state.locations.remote = { id: 'remote', name: '诊所' };
    if (organization) { const { organizations } = await import(gameFixtures); state.organizations['org-shop'] = { ...organizations[3], id: 'org-shop', name: '街口商行' }; }
    const repo = await SaveRepository.open(); try { await repo.create(state); await repo.saveDraft(createTurnDraft('save-a', 0, 'auto-opening', 'opening', ''), null); } finally { repo.close(); }
  }, [remoteLocation, organization] as const);
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
    const text = stage === 'story' ? `<thinking>保持当前行动连续。</thinking>\n<正文>第${turn}幕：主角在街边用餐，观察来往行人。</正文>\n<短期记忆>在街边用餐。</短期记忆>\n<变量规划>[]</变量规划>` : (stage === 'entities' || stage === 'variables') ? stageFixtureReply(stage,variables) : worldText;
    if (stage === 'variables') responses.variables = text;
    if (stage === 'world') { responses.world = text; if (control.hold) await control.hold; }
    await route.fulfill({ contentType: stage === 'story' ? 'text/event-stream' : 'application/json', body: stage === 'story'
      ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
      : JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) }).catch(() => undefined);
  });
  return { calls, control, responses };
}
const settled = (page: Page) => expect(page.getByRole('region', { name: '四阶段工作流' }).getByRole('status')).toContainText('本回合已结算');

async function expandSettlementSummary(page: Page, skipped: number) {
  await closeWorkflowSheet(page);
  const close = page.getByRole('button',{name:'收起四阶段详情',exact:true});
  if (await close.isVisible()) await close.click();
  const summary = page.getByText(`本回合已结算，跳过 ${skipped} 项更新`,{exact:true});
  await expect(summary).toBeVisible();
  await summary.click({timeout:10_000});
  return summary;
}

test('完整原文可读，开局与下一条行动各自动结算一次，刷新和空待输入不调用模型', async ({ page, isMobile }, info) => {
  test.skip(isMobile, '电脑端流程测试，手机界面由 mobile-* 专项覆盖');
  await seed(page); const server = await mock(page);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await settled(page);
  let data = await stored(page); expect(data.state.turnNumber).toBe(1); expect(data.state.economy.cash).toBe(7000); expect(data.draft.userInput).toBe(''); expect(server.calls).toEqual(['story','entities','variables','world']);
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
test('World字段错误定位为跳过，临时原文可读，合规更新一次结算', async ({page}) => {
  await seed(page); const server = await mock(page); server.control.bad = true;
  await page.getByRole('button', {name:'自动生成开局',exact:true}).click();
  await expandSettlementSummary(page,1);
  await expect(page.getByText(/动态世界第 1 条.*eventCommands\.0/u)).toBeVisible();
  const storedGame = await stored(page);
  expect(storedGame.state.events.review).toBeUndefined();
  expect(storedGame.state.turnNumber).toBe(1);
  expect(server.calls).toEqual(['story','entities','variables','world']);
  await openStageRaw(page,'world');
  expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
});

test('发送下一条行动仅绑定草稿，commit日志必须等到三阶段完成才开始', async ({ page, isMobile }) => {
  test.skip(isMobile, '电脑端流程测试，手机界面由 mobile-* 专项覆盖');
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

test('NPC场景位置与World字段错误各自隔离，独立主角状态照常结算', async ({page}) => {
  await seed(page, true); const server = await mock(page);
  const before=await stored(page);
  server.control.variables='<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset npc[scene].locationId = null\nset protagonist.emotionText = "安心"\n</命令>';
  server.control.bad=true;
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();
  await expandSettlementSummary(page,2);
  await expect(page.getByText(/变量第 2 条.*人物/u)).toBeVisible();
  await expect(page.getByText(/动态世界第 1 条.*事件/u)).toBeVisible();
  const settledGame=await stored(page);
  expect(settledGame.state.npc.scene).toEqual(before.state.npc.scene);
  expect(settledGame.state.protagonist.emotionText).toBe('安心');
  expect(settledGame.state.events.review).toBeUndefined();
  expect(server.calls).toEqual(['story','entities','variables','world']);
});

test('源三标签截断保留正文；明确恢复后四操作自动结算并完整显示原文', async ({ page, isMobile }, info) => {
  test.skip(isMobile, '电脑端流程测试，手机界面由 mobile-* 专项覆盖');
  await seed(page); const server = await mock(page), before = await stored(page);
  server.control.variables = '<thinking>本轮状态分析。</thinking><说明>- 更新本幕变量。</说明><命令>set protagonist.emotionText = "安心"';
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect(page.getByTestId('runtime-log')).toContainText('解析三个标签区块');
  const failed = await stored(page); expect(failed.state).toEqual(before.state); expect(failed.draft.story).toBeDefined(); expect(failed.draft.variables).toBeUndefined();
  expect(server.calls).toEqual(['story','entities','variables']);
  server.control.variables = '<thinking>本轮变量变化分析结果。</thinking>\n<说明>\n- 用餐并更新技能记录。\n</说明>\n<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset protagonist = {"emotionText":"安心","skills":["驾驶","急救"]}\nadd economy.cash = -3000\npush protagonist.skills = "烹饪"\ndelete protagonist.skills[0]\n</命令>';
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const data = await stored(page); expect(data.state.turnNumber).toBe(1); expect(data.state.economy.cash).toBe(7000); expect(data.state.protagonist.skills).toEqual(['急救','烹饪']);
  expect(server.calls).toEqual(['story','entities','variables','variables','world']); expect(data.draft.userInput).toBe('');
  await openStageRaw(page, 'variables');
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.control.variables);
  await page.screenshot({ path: info.outputPath('source-variable-protocol.png') });
  await page.reload(); await openGameTools(page); await settled(page); expect(await stored(page)).toEqual(data); expect(server.calls).toHaveLength(4);
});

test('候选写库配额失败显示具体步骤而非unknown，保留正文后只补失败阶段', async ({ page, isMobile }) => {
  test.skip(isMobile, '电脑端流程测试，手机界面由 mobile-* 专项覆盖');
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
  expect(server.calls).toEqual(['story','entities','variables']);
  await page.evaluate(() => Reflect.set(window, '__failSourceSave', false));
  await page.getByRole('button', { name: '继续未完成阶段', exact: true }).click(); await settled(page);
  const committed = await stored(page); expect(committed.state.turnNumber).toBe(1); expect(committed.state.economy.cash).toBe(7000);
  expect(server.calls).toEqual(['story','entities','variables','variables','world']);
});

test('时间诊断保留重排前文本编号，原文可读，独立更新刷新后仍在', async ({page}) => {
  await seed(page); const server=await mock(page), before=await stored(page);
  server.control.variables='<命令>\nset protagonist.emotionText = "从容"\nset npc[scene].lastInteractionAt = "2026-10-18T09:00:00+08:00"\nset worldClock = "2026-10-18T08:10:00+08:00"\n</命令>';
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();
  const summary=await expandSettlementSummary(page,1);
  await expect(page.getByText(/变量第 2 条.*人物.*时间/u)).toBeVisible();
  const committed=await stored(page);
  expect(committed.state.npc.scene.lastInteractionAt).toBe(before.state.npc.scene.lastInteractionAt);
  expect(committed.state.protagonist.emotionText).toBe('从容');
  await openStageRaw(page,'variables');
  expect(await page.getByLabel('变量模型完整原文').textContent()).toBe(server.responses.variables);
  await page.reload(); await expect(summary).toBeVisible(); expect(await stored(page)).toEqual(committed);
  expect(server.calls).toEqual(['story','entities','variables','world']);
});

test('认知与组织字段错误各自隔离，World外层不合法时只重试World', async ({page}) => {
  await seed(page); const server=await mock(page), before=await stored(page);
  server.control.variables='<命令>\npush npc[scene].knownInformation = {"text":"收到安排","source":"当面通知","learnedAt":"2026-10-18T08:00:00+08:00"}\n</命令>';
  const world = {worldCommands:[{type:'CreateOrganization',commandId:'create-community',evidence:'登记社区团队',organization:{
    id:'org-community',name:'社区团队',kind:'civil',description:'日常协调',protagonistRelation:'暂无往来',
    relationHistory:['不应预填的历史'],keyNpcIds:[],currentTaskIds:[],activities:[],
  }}],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]};
  server.control.world=JSON.stringify({...world,timelineCandidates:[{eventId:'invented'}]});
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).draft.stageStatus.world).toBe('failed');
  const failed=await stored(page);
  expect(failed.state).toEqual(before.state);
  expect(failed.draft.variables.result.settlement.skipped).toMatchObject([{commandIndex:0,category:'person'}]);
  const dialog=page.getByRole('dialog',{name:'重试与变更详情',exact:true});
  if(await dialog.isVisible()) await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  server.control.world=JSON.stringify(world);
  await openGameTools(page);
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect(page.getByText('本回合已结算，跳过 2 项更新',{exact:true})).toBeVisible();
  const saved=await stored(page);
  expect(saved.state.journal.at(-1)?.story).toEqual(failed.draft.story);
  expect(saved.state.npc.scene.knownInformation).toEqual(before.state.npc.scene.knownInformation);
  expect(saved.state.organizations['org-community']).toBeUndefined();
  expect(saved.state.timeline).toEqual(before.state.timeline);
  expect(server.calls).toEqual(['story','entities','variables','world','world']);
});

test('#186 World重复写入Variables本轮组织字段：以Variables为准剔除，阶段不失败，只在诊断页说明', async ({ page }, info) => {
  await seed(page, false, true); const server = await mock(page);
  server.control.variables = '<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset organizations[org-shop].state = {"operatingStatus":"正文确认：今晚照常营业"}\n</命令>';
  server.control.world = JSON.stringify({ worldCommands: [{ type: 'UpdateOrganization', commandId: 'world-shop', evidence: '后台推演', organizationId: 'org-shop', expectedRevision: 0,
    changes: { operatingStatus: '模型另写：暂停营业', ownershipText: '股权结构不变' } }], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click(); await settled(page);
  const committed = await stored(page);
  expect(committed.state.organizations['org-shop']).toMatchObject({ operatingStatus: '正文确认：今晚照常营业', ownershipText: '股权结构不变' });
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world']);
  await openWorkflowDiagnostics(page); await expect(page.getByTestId('runtime-log')).not.toContainText('scene_write_conflict');
  // 模型原文保持原样（含被忽略的字段），处理说明只出现在“校验结果”。
  await openStageRaw(page, 'world'); expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
  await openStageTab(page, 'world', '校验结果');
  const notes = page.locator('.wf-stage .stage-notes');
  await expect(notes).toContainText('程序处理说明'); await expect(notes).toContainText('operatingStatus 的值与变量阶段不同，以变量阶段为准');
  await expect(page.getByLabel('动态世界规范化结果')).not.toContainText('模型另写');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('world-scene-write-notes.png') });
});

for (const group of ['taskCommands','eventCommands'] as const) {
  test(`#190 ${group} 的非法分组命令跳过，独立 World 字段仍保存`,async ({page},info)=>{
    await seed(page,false,true);const server=await mock(page);
    server.control.variables='<命令>\nset worldClock = "2026-10-18T08:10:00+08:00"\nset organizations[org-shop].state = {"operatingStatus":"正文确认照常营业"}\n</命令>';
    const repeated={type:'UpdateOrganization',commandId:'repeated-shop',evidence:'后台',organizationId:'org-shop',expectedRevision:0,changes:{operatingStatus:'World重复值'}};
    const independent={...repeated,commandId:'independent-shop',changes:{ownershipText:'World独立合法字段'}};
    server.control.world=JSON.stringify({worldCommands:[repeated,independent],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[],[group]:[{...repeated,commandId:'wrong-group'}]});
    await page.getByRole('button',{name:'自动生成开局',exact:true}).click();
    await expandSettlementSummary(page,1);
    await expect(page.getByText(`${group}.0`,{exact:false})).toBeVisible();
    const saved=await stored(page);
    expect(saved.state.organizations['org-shop']).toMatchObject({operatingStatus:'正文确认照常营业',ownershipText:'World独立合法字段'});
    expect(saved.state.revision).toBe(1);expect(saved.state.journal).toHaveLength(1);
    expect(server.calls).toEqual(['story','entities','variables','world']);
    await openStageRaw(page,'world');
    expect(await page.getByLabel('动态世界模型完整原文').textContent()).toBe(server.responses.world);
    expect(await stored(page)).toEqual(saved);
    await page.screenshot({path:info.outputPath(`world-skipped-${group}.png`)});
  });
}

test('#193 刷新后只重试World，取消、重复点击与跨标签竞争不重跑上游或重复结算', async ({ page, context, isMobile }, info) => {
  test.setTimeout(90_000);
  await seed(page, false, true);
  const server = await mock(page);
  await page.getByRole('button', {name:'自动生成开局',exact:true}).click();
  await settled(page);
  const baseline = await stored(page);
  const boundAction = '在报亭买一份报纸，看看街边情况';
  const worldChange = {type:'UpdateOrganization',commandId:'org-background',evidence:'合成背景行动',
    organizationId:'org-shop',expectedRevision:baseline.state.revision,changes:{operatingStatus:'上午盘点后开门'}};
  const task = {id:'stock-check-a',actorRef:{kind:'organization',id:'org-shop'},goal:'内部盘点合成样品',
    startAt:'2026-10-18T08:10:00+08:00',dueAt:'2026-10-18T09:00:00+08:00',status:'active',prerequisites:[],blockers:[]};
  const planned = {type:'SaveTask',commandId:'background-task',evidence:'合成内部说明',task};
  const valid = {worldCommands:[worldChange],taskCommands:[planned],eventCommands:[],visibleHooks:[],unresolved:[]};
  server.control.world = '{"worldCommands": [';
  await page.getByLabel('你的行动',{exact:true}).fill(boundAction);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async () => (await stored(page)).draft.stageStatus.world).toBe('failed');
  const failed = await stored(page);
  expect(failed.state).toEqual(baseline.state);
  expect(failed.draft).toMatchObject({userInput:boundAction,stageStatus:{story:'ready',variables:'ready',world:'failed'},
    variables:{validation:'validated'}});
  expect(failed.draft.world).toBeUndefined();
  expect(server.calls).toEqual(['story','entities','variables','world','story','entities','variables','world']);
  const modal = page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'重试与变更详情',exact:true})});
  if (!isMobile) await openWorkflowDiagnostics(page);
  const log = isMobile ? modal.getByTestId('runtime-log') : page.getByTestId('runtime-log');
  await expect(log).toContainText('invalid_json');
  await expect(log).not.toContainText('内部盘点合成样品');
  if (isMobile) await modal.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  await page.reload();
  await openGameTools(page);
  expect(await stored(page)).toEqual(failed);
  expect(server.calls).toHaveLength(6);
  const hint = page.locator(isMobile ? '.wf-ft .workflow-fee' : '.workflow-primary small');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('本次仅重试动态世界，保留已通过的正文和变量。重新请求可能产生模型费用。');
  await page.screenshot({path:info.outputPath('world-only-retry.png')});
  const retry = page.getByRole('button',{name:'继续未完成阶段',exact:true});
  const other = await context.newPage();
  let release!: () => void;
  server.control.hold = new Promise<void>(done => { release=done; });
  server.control.world = JSON.stringify(valid);
  try {
    const credential = await page.evaluate(() => Object.entries(sessionStorage)
      .find(([key]) => key.startsWith('heijin.credential.v1:')));
    expect(credential).toBeDefined();
    await other.addInitScript(([key,value]) => sessionStorage.setItem(key,value),credential!);
    const second = await mock(other);
    await other.goto('/#game/save-a');
    await openGameTools(other);
    await retry.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await expect.poll(() => server.calls.slice(6)).toEqual(['world']);
    await other.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
    await expect(other.getByText(/此存档已有阶段请求/).first()).toBeVisible();
    expect(second.calls).toEqual([]);
    expect((await stored(other)).state).toEqual(failed.state);
    await page.getByRole('button',{name:'取消自动执行',exact:true}).click();
    server.control.hold = undefined;
    release();
    await expect(retry).toBeEnabled();
    const cancelled = await stored(page);
    expect(cancelled.state).toEqual(failed.state);
    expect(cancelled.draft).toMatchObject({userInput:boundAction,story:failed.draft.story,variables:failed.draft.variables});
    expect(cancelled.draft.world).toBeUndefined();
    expect(server.calls).toHaveLength(7);
    await retry.click();
    await settled(page);
    const committed = await stored(page);
    expect(committed.state.revision).toBe(baseline.state.revision+1);
    expect(committed.state.journal).toHaveLength(baseline.state.journal.length+1);
    expect(committed.state.journal.at(-1)?.turnId).toBe(failed.draft.turnId);
    expect(committed.state.journal.at(-1)?.story).toEqual(failed.draft.story);
    expect(committed.state.tasks['stock-check-a'].status).toBe('active');
    expect(committed.state.tasks['stock-check-b']).toBeUndefined();
    expect(committed.state.organizations['org-shop'].operatingStatus).toBe('上午盘点后开门');
    expect(server.calls).toEqual(['story','entities','variables','world','story','entities','variables','world','world','world']);
    await page.reload();
    await openGameTools(page);
    expect(await stored(page)).toEqual(committed);
    expect(server.calls).toHaveLength(8);
    expect(second.calls).toEqual([]);
  } finally {
    release();
    await other.close();
  }
});

test('普通回合天气与环境结算后重载，下一次 Story 使用已保存的两个字段', async ({ page }) => {
  await seed(page);
  const server = await mock(page);
  await page.getByRole('button', { name: '自动生成开局', exact: true }).click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(1);
  const scene = { weatherText: '小雨，微风，略有凉意', environmentText: '商业街人流渐密，店铺灯牌陆续亮起。' };
  server.control.variables = '<命令>\n' + Object.entries(scene)
    .map(([field, value]) => `set ${field} = ${JSON.stringify(value)}`).join('\n') + '\n</命令>';
  await closeWorkflowSheet(page);
  const action = page.getByLabel('你的行动', { exact: true });
  const send = page.getByRole('button', { name: '发送', exact: true });
  await action.fill('穿过商业街');
  await send.click();
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(2);
  await page.reload();
  expect((await stored(page)).state).toMatchObject(scene);
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world', 'story', 'entities', 'variables', 'world']);

  server.control.variables = '<命令></命令>';
  await action.fill('在街口等人');
  const next = page.waitForRequest(request => request.url().includes('auto-settlement.mock.invalid')
    && request.method() === 'POST' && request.postDataJSON().model === 'story');
  await send.click();
  const messages: { role: string; content: string }[] = (await next).postDataJSON().messages;
  const context = messages.find(m => m.role === 'user' && m.content.startsWith('<GAME_CONTEXT>'))!;
  expect(JSON.parse(context.content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)).SAVE_STATE).toMatchObject(scene);
  await expect.poll(async () => (await stored(page)).state.turnNumber).toBe(3);
  expect((await stored(page)).state).toMatchObject(scene);
  expect(server.calls).toEqual(['story', 'entities', 'variables', 'world', 'story', 'entities', 'variables', 'world', 'story', 'entities', 'variables', 'world']);
});

test('后宫 Variables 开局登记、下一轮非法双正宫拒绝；刷新保留且没有第四次调用',async({page})=>{
  await seed(page);const server=await mock(page);
  const person=(id:string)=>'set npc['+id+'] = '+JSON.stringify({kind:'ordinary',identityKey:'identity-'+id,name:'家庭成员'+id,
    age:26,gender:'female',aliases:[],skills:[],onScene:true,locationId:'chongqing',affinity:20,relationshipText:'共同生活',memories:[],knownInformation:[]});
  const join=(id:string,to:number)=>({op:'join',npcId:id,identityKey:'identity-'+id,to,reason:'双方确认了家庭安排'});
  const changes=(list:unknown[])=>'set harem.changes = '+JSON.stringify(list);
  server.control.variables='<命令>\n'+[person('family-a'),person('family-b'),changes([join('family-a',100),join('family-b',70)])].join('\n')+'\n</命令>';
  await page.getByRole('button',{name:'自动生成开局',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  const before=(await stored(page)).state.harem;
  expect(before?.members['family-a'].changes[0].to).toBe(100);
  expect(server.calls).toEqual(['story','entities','variables','world']);
  await closeWorkflowSheet(page);
  server.control.variables='<命令>\n'+changes([{op:'score',npcId:'family-b',from:70,to:100,reason:'合成无效候选'}])+'\n</命令>';
  await page.getByLabel('你的行动',{exact:true}).fill('继续商议安排');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(2);
  await page.reload();expect((await stored(page)).state.harem).toEqual(before);
  expect(server.calls).toEqual(['story','entities','variables','world','story','entities','variables','world']);
});
