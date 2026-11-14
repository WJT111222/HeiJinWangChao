import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflow, workflowTrigger, workflowSummary, openWorkflowDiagnostics, openBoundInput, openWorkflowStage, openStageCandidates, openCandidateRaw, closeStageCandidates } from './helpers/gameLayout';

type Mode = 'opening' | 'ready' | 'off' | 'error' | 'settled';
async function seed(page: Page, mode: Mode) {
  await page.goto('/');
  await page.evaluate(async mode => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{SaveRepository},{worldState},{completeDraft},{createTurnDraft,TurnDraftSchema,startStageAttempt},{defaultSettings,settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault}] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(), state = worldState();
    state.openingCityId = 'chongqing'; state.title = '沈砚 · 重庆'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5;
    if (mode === 'off') settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig();channel.baseUrl='https://workflow.mock.invalid/v1';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'mock'};saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-key');
    if (mode === 'opening') await repo.saveDraft(createTurnDraft('save-a',0,'opening','opening',''),null);
    else {
      let draft = await completeDraft(repo);
      if (mode === 'settled') await repo.commitTurn({draft,nextAction:'',useVariableStage:true,useWorldStage:true});
      if (mode === 'off' || mode === 'error') {
        const previous = draft.draftRevision;
        draft = await repo.saveDraft(startStageAttempt(draft,['world'],{useVariableStage:true,useWorldStage:true}),previous);
        draft = TurnDraftSchema.parse({...draft,draftRevision:draft.draftRevision+1,world:undefined,stageStatus:{...draft.stageStatus,world:mode === 'error' ? 'failed' : 'pending'},failures:mode === 'error' ? [{stage:'world',attempt:2,storyRevision:draft.storyRevision,errorCode:'world_schema',retryable:true}] : []});
        await repo.saveDraft(draft,draft.draftRevision-1);
      }
    }
    repo.close();
  },mode);
  await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});
}
for (const mode of ['opening','ready','off','error','settled'] as const) test(`确认稿工作流：${mode} 布局、焦点、候选与原数据`,async({page},info)=>{
  await seed(page,mode);const before=await stored(page),desktop=info.project.name==='desktop';
  if(desktop)await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('button',{name:'重新 Roll',exact:true})).toHaveCount(0);
  const input=page.getByLabel('你的行动',{exact:true}),box=await input.boundingBox();await openWorkflow(page);
  await expect(page.locator('.workflow-stages > li')).toHaveCount(3);
  if(desktop){
    const pop=page.getByRole('region',{name:'三阶段详情',exact:true});await expect(pop).toBeVisible();
    expect(await input.boundingBox()).toEqual(box);
    expect(await pop.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(15, 18, 17)');
    await expect(workflowTrigger(page)).toHaveAttribute('aria-expanded','true');
    if(mode==='off'){await page.getByRole('button',{name:'前往阶段开关'}).click();await expect(page.getByRole('checkbox',{name:'动态世界',exact:true})).toBeFocused();}
    if(mode==='error'){await openWorkflowDiagnostics(page);await expect(pop).toContainText('world_schema');await openBoundInput(page);await expect(page.locator('.workflow-diagnostics')).toBeHidden();await expect(page.locator('.bound-input .prose')).toBeVisible();}
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-${mode}-desktop.png`});
    await page.keyboard.press('Escape');await expect(pop).toBeHidden();await expect(workflowTrigger(page)).toBeFocused();
    await openWorkflow(page);await page.getByRole('button',{name:'收起三阶段详情'}).click();await expect(workflowTrigger(page)).toBeFocused();
    await openWorkflow(page);await workflowTrigger(page).click();await expect(pop).toBeHidden();
    for(const size of [{width:1280,height:800},{width:1100,height:800}]){await page.setViewportSize(size);await openWorkflow(page);const r=(await pop.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(size.width);expect(r.y+r.height).toBeLessThanOrEqual(box!.y+10);await workflowTrigger(page).click();}
  }else{
    await expect(page.getByRole('dialog',{name:'三阶段工作流',exact:true})).toHaveAttribute('aria-modal','false');await expect(page.locator('.wf-hd')).toHaveCount(1);
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-${mode}-mobile.png`});
  }
  if(mode==='ready'){
    await openWorkflow(page);const modal=await openStageCandidates(page,'variables');await expect(modal).toBeVisible();
    await modal.getByRole('button',{name:'主动查看完整变量候选',exact:true}).click();await expect(modal.getByLabel('完整变量候选')).toContainText('SetWorldClock');
    // PC 候选在面板“候选”页；模型原文在同一阶段的“模型原文”页。移动端仍在只读弹窗内。
    await expect(await openCandidateRaw(page,'variables')).toContainText('本页面没有可恢复的模型原文');
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-variables-${info.project.name}.png`});
    if(!desktop){await closeStageCandidates(page);await expect(page.locator('.wf-rail .workflow-stages>li').nth(1).getByRole('button')).toBeFocused();}
    const world=await openStageCandidates(page,'world');
    await world.getByRole('button',{name:'主动查看完整世界候选',exact:true}).click();await expect(world.getByLabel('完整世界候选')).toContainText('worldCommands');
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-world-${info.project.name}.png`});await closeStageCandidates(page);
  }
  expect(await stored(page)).toEqual(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('生成中：浮层关闭不取消请求，显式取消后仍可恢复；reduced motion',async({page},info)=>{
  await seed(page,'opening');let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});let calls=0;
  await page.route('https://workflow.mock.invalid/**',async route=>{calls++;await hold;await route.fulfill({status:401,body:'mock'}).catch(()=>undefined);});
  await openWorkflow(page);await page.getByRole('button',{name:'自动生成开局',exact:true}).click();await expect.poll(()=>calls).toBe(1);
  await expect(page.locator('.workflow')).toHaveAttribute('data-state','busy');
  await page.emulateMedia({reducedMotion:'reduce'});
  if(info.project.name==='desktop'){
    await expect(page.locator('.wf-hd .dot')).toHaveCSS('animation-name','none');
    await page.screenshot({path:'docs/workflow-feedback/screenshots/react-busy-desktop.png'});
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'取消生成',exact:true})).toBeVisible();await openWorkflow(page);
  }
  await page.getByRole('button',{name:'取消自动执行',exact:true}).click();release();
  await expect(page.getByRole('button',{name:'继续未完成阶段',exact:true})).toBeEnabled();expect((await stored(page)).draft?.story).toBeUndefined();
});

test('多个阶段错误完整保留；候选失败重试不重生成已有正文',async({page},info)=>{
  await seed(page,'ready');const initial=await stored(page);let calls=0;
  await page.route('https://workflow.mock.invalid/**',async route=>{calls++;await route.fulfill({status:401,body:'provider-private'});});
  await openWorkflowStage(page,'variables');await page.getByRole('button',{name:'重新生成变量候选',exact:true}).click();await expect.poll(()=>calls).toBe(1);
  await expect(page.getByRole('alert')).toBeVisible();
  await openWorkflowStage(page,'world');await page.getByRole('button',{name:'生成世界候选',exact:true}).click();await expect.poll(()=>calls).toBe(2);
  if(info.project.name==='desktop'){
    const group=page.locator('.workflow-errors');await expect(group).toHaveCount(1);await expect(group.locator('.wf-banner-msg > p')).toHaveCount(2);
    await expect(group).not.toContainText('provider-private');
    await page.screenshot({path:'docs/workflow-feedback/screenshots/react-multiple-errors-desktop.png'});
  }else await expect(page.getByRole('alert')).toHaveCount(2);
  expect((await stored(page)).state).toEqual(initial.state);expect((await stored(page)).draft?.story).toEqual(initial.draft?.story);
  await expect(page.getByRole('button',{name:'重新 Roll',exact:true})).toHaveCount(0);
});

test('全局运行偏好错误浮条、撤回确认和未保存设置：焦点与移动端样式',async({page},info)=>{
  await seed(page,'settled');
  await page.evaluate(async () => { const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/turn.ts']; const [{SaveRepository},{completeDraft,elapsedVariables}]=await Promise.all(paths.map(p=>import(p))); const repo=await SaveRepository.open(); try { const waiting=await repo.loadDraft('save-a'); await repo.bindTurnAction(waiting,'继续观察',true,true); const draft=await completeDraft(repo,{variables:await elapsedVariables(repo,'经过十分钟，主角完成用餐。',600)}); await repo.commitTurn({draft,nextAction:'',useVariableStage:true,useWorldStage:true}); } finally {repo.close();} });
  await page.reload();await openWorkflow(page);const before=await stored(page);
  await page.evaluate(async()=>{const p='/src/ui/settings/model.ts',{settingsKey}=await import(p),original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===settingsKey)throw new Error('mock-storage');return original.call(this,key,value);};});
  const box=await page.getByLabel('你的行动',{exact:true}).boundingBox();await page.getByRole('checkbox',{name:'变量管理',exact:true}).click();await expect(page.getByRole('checkbox',{name:'变量管理',exact:true})).toBeChecked();
  const notice=page.locator('.app-error');await expect(notice).toContainText('运行偏好保存失败，请检查浏览器存储权限。');
  if(info.project.name==='desktop'){await expect(notice).toHaveCSS('position','fixed');expect(await page.getByLabel('你的行动',{exact:true}).boundingBox()).toEqual(box);}
  await page.screenshot({path:`docs/workflow-feedback/screenshots/react-global-error-${info.project.name}.png`});await notice.getByRole('button',{name:'关闭提示'}).click();await expect(notice).toHaveCount(0);
  await page.getByRole('button',{name:/^撤回（/}).click();const undo=page.getByRole('dialog',{name:'撤回上一回合',exact:true});await expect(undo).toContainText('此操作不调用 AI');
  await page.screenshot({path:`docs/workflow-feedback/screenshots/react-undo-${info.project.name}.png`});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^撤回（/})).toBeFocused();
  await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'设置',exact:true});await settings.getByRole('button',{name:'AI 连接',exact:true}).click();
  await settings.getByRole('button',{name:'＋ 添加渠道',exact:true}).click();await settings.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  const unsaved=page.getByRole('dialog',{name:'AI 配置尚未保存',exact:true});await expect(unsaved).toBeVisible();await page.screenshot({path:`docs/workflow-feedback/screenshots/react-unsaved-${info.project.name}.png`});
  await page.keyboard.press('Escape');await expect(unsaved).toHaveCount(0);await expect(settings).toBeVisible();expect(await stored(page)).toEqual(before);
});

for(const failure of ['load','list','selection'] as const)test(`全局${failure}真实错误路径保留文案和关闭操作`,async({page},info)=>{
  await seed(page,'ready');const before=await stored(page);
  if(failure==='load')await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p);SaveRepository.prototype.loadGame=async()=>{throw new Error('mock-read');};location.hash='';});
  else if(failure==='list')await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p);SaveRepository.prototype.list=async()=>{throw new Error('mock-list');};location.hash='';});
  else await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='heijin.selected.v1')throw new Error('mock-selected');return original.call(this,key,value);};location.hash='';});
  if(failure!=='list'){
    await expect(page.locator('.home-experience')).toBeVisible();await page.locator('.btn-library').click();
    await page.locator('.save-card').getByRole('button',{name:/读取存档/}).click();
  }
  const alert=page.locator('.app-error');await expect(alert).toHaveAttribute('role','alert');
  await expect(alert).toContainText(failure==='load'?'无法读取此存档':failure==='list'?'存档列表暂时无法访问':'已选择存档，但浏览器未能保存最近选择');
  if(info.project.name==='desktop')await expect(alert).toHaveCSS('position','fixed');
  await alert.getByRole('button',{name:'关闭提示',exact:true}).click();await expect(alert).toHaveCount(0);
  const after=await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open();try{return {state:await r.load('save-a'),draft:await r.loadDraft('save-a')};}finally{r.close();}});
  expect(after.state).toEqual(before.state);expect(after.draft).toEqual(before.draft);
});

// ── PC 三阶段面板 v2：键盘、ARIA、开关与结算状态（PR #117 第二轮） ──
const workflowPop = (page: Page) => page.getByRole('region', { name: '三阶段详情', exact: true });
const railItems = (page: Page) => workflowPop(page).locator('.wf-rail .workflow-stages > li > .wf-ri');
async function countRequests(page: Page) {
  const counter = { calls: 0 };
  await page.route('https://workflow.mock.invalid/**', async route => { counter.calls++; await route.abort(); });
  return counter;
}

test('PC 收起条三段可 Tab 聚焦，Enter/Space/点击打开对应阶段且不发请求', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PC 专用');
  await seed(page, 'ready'); const before = await stored(page), counter = await countRequests(page);
  const pop = workflowPop(page), segments = workflowSummary(page).locator('.rail > button'), rail = railItems(page);
  await expect(segments).toHaveCount(3); await expect(pop).toBeHidden();
  for (const segment of await segments.all()) await expect(segment).not.toHaveAttribute('tabindex', '-1');
  await workflowTrigger(page).focus(); await page.keyboard.press('Shift+Tab'); await expect(segments.nth(2)).toBeFocused();
  await expect(segments.nth(2)).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Shift+Tab'); await expect(segments.nth(1)).toBeFocused();
  await page.keyboard.press('Enter'); await expect(pop).toBeVisible();
  await expect(rail.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(pop.getByRole('tablist', { name: '变量管理内容', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(pop).toBeHidden(); await expect(workflowTrigger(page)).toBeFocused();
  await segments.nth(2).focus(); await page.keyboard.press('Space'); await expect(pop).toBeVisible();
  await expect(rail.nth(2)).toHaveAttribute('aria-current', 'true');
  await segments.nth(0).click(); await expect(rail.nth(0)).toHaveAttribute('aria-current', 'true');
  expect(counter.calls).toBe(0); expect(await stored(page)).toEqual(before);
});

test('PC 标签页：鼠标、Tab、方向键与 Home/End；候选明细和完整 JSON 需主动展开', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PC 专用');
  await seed(page, 'ready'); const before = await stored(page), counter = await countRequests(page), pop = workflowPop(page);
  await openWorkflowStage(page, 'variables');
  const tabs = pop.getByRole('tablist', { name: '变量管理内容', exact: true }), panel = pop.getByRole('tabpanel');
  const overview = tabs.getByRole('tab', { name: '概览', exact: true }), candidates = tabs.getByRole('tab', { name: /^候选/ });
  const raw = tabs.getByRole('tab', { name: '模型原文', exact: true }), normalized = tabs.getByRole('tab', { name: '校验结果', exact: true });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(overview).toHaveAttribute('aria-selected', 'true'); await expect(overview).toHaveAttribute('tabindex', '0');
  for (const other of [candidates, raw, normalized]) { await expect(other).toHaveAttribute('aria-selected', 'false'); await expect(other).toHaveAttribute('tabindex', '-1'); }
  await expect(panel).toHaveAttribute('aria-labelledby', (await overview.getAttribute('id'))!);
  for (const item of [overview, candidates, raw, normalized]) await expect(item).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
  // 概览只显示计数与版本，候选明细（可能含 NPC 内部资料）不在 DOM 中。
  await expect(panel).toContainText('合法命令'); await expect(panel.locator('.wf-cmds')).toHaveCount(0); await expect(panel.getByLabel('完整变量候选')).toHaveCount(0);
  await overview.focus(); await page.keyboard.press('ArrowRight');
  await expect(candidates).toBeFocused(); await expect(candidates).toHaveAttribute('aria-selected', 'true'); await expect(overview).toHaveAttribute('aria-selected', 'false');
  await expect(panel).toHaveAttribute('aria-labelledby', (await candidates.getAttribute('id'))!);
  await expect(panel.locator('.wf-cmds li').first()).toBeVisible(); await expect(panel.getByLabel('完整变量候选')).toHaveCount(0);
  await page.keyboard.press('Tab'); await expect(panel).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(candidates).toBeFocused();
  await page.keyboard.press('End'); await expect(normalized).toBeFocused(); await expect(normalized).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); await expect(overview).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(normalized).toBeFocused();
  await page.keyboard.press('Home'); await expect(overview).toBeFocused(); await expect(overview).toHaveAttribute('aria-selected', 'true');
  await panel.getByRole('button', { name: '查看候选明细 →', exact: true }).click();
  await expect(candidates).toBeFocused(); await expect(candidates).toHaveAttribute('aria-selected', 'true');
  const reveal = panel.getByRole('button', { name: '主动查看完整变量候选', exact: true });
  await expect(reveal).toHaveAttribute('aria-expanded', 'false'); await reveal.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByLabel('完整变量候选')).toContainText('SetWorldClock');
  await panel.getByRole('button', { name: '隐藏完整变量候选', exact: true }).click(); await expect(panel.getByLabel('完整变量候选')).toHaveCount(0);
  await raw.click(); await expect(raw).toHaveAttribute('aria-selected', 'true');
  await expect(pop.getByRole('region', { name: '模型原文', exact: true })).toBeVisible();
  await openWorkflowStage(page, 'story');
  const storyTabs = pop.getByRole('tablist', { name: '正文生成内容', exact: true });
  await expect(storyTabs.getByRole('tab')).toHaveText(['概览', '模型原文', '校验结果']);
  await storyTabs.getByRole('tab', { name: '概览', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(storyTabs.getByRole('tab', { name: '校验结果', exact: true })).toBeFocused();
  await expect(storyTabs.getByRole('tab', { name: '叙事规划', exact: true })).toHaveCount(0);
  await openWorkflowStage(page, 'world');
  const worldTabs = pop.getByRole('tablist', { name: '动态世界内容', exact: true });
  await worldTabs.getByRole('tab', { name: /^候选/ }).click();
  await expect(panel.getByLabel('完整世界候选')).toHaveCount(0);
  await panel.getByRole('button', { name: '主动查看完整世界候选', exact: true }).click(); await expect(panel.getByLabel('完整世界候选')).toContainText('worldCommands');
  expect(counter.calls).toBe(0); expect(await stored(page)).toEqual(before);
});

test('PC 阶段开关独立于导航；“前往阶段开关”聚焦对应开关；面板无键盘陷阱，收起后焦点回到详情', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PC 专用');
  await seed(page, 'off'); const before = await stored(page), counter = await countRequests(page), pop = workflowPop(page), rail = railItems(page);
  await openWorkflow(page);
  const variables = pop.getByRole('checkbox', { name: '变量管理', exact: true }), world = pop.getByRole('checkbox', { name: '动态世界', exact: true });
  await expect(variables).toBeChecked(); await expect(world).not.toBeChecked();
  for (const index of [0, 1, 2, 0]) {
    await rail.nth(index).click(); await expect(rail.nth(index)).toHaveAttribute('aria-current', 'true');
    await expect(variables).toBeChecked(); await expect(world).not.toBeChecked();
  }
  await pop.getByRole('note', { name: '阶段设置提示', exact: true }).getByRole('button', { name: '前往阶段开关', exact: true }).click();
  await expect(world).toBeFocused(); await expect(rail.nth(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Space'); await expect(world).toBeChecked(); await expect(world).toBeFocused();
  await expect(rail.nth(2)).toHaveAttribute('aria-current', 'true');
  await rail.nth(0).click(); await variables.click(); await expect(variables).not.toBeChecked(); await expect(rail.nth(0)).toHaveAttribute('aria-current', 'true');
  await variables.click(); await expect(variables).toBeChecked(); await expect(rail.nth(0)).toHaveAttribute('aria-current', 'true');
  await world.focus(); let left = false;
  for (let i = 0; i < 40 && !left; i++) { await page.keyboard.press('Tab'); left = !(await pop.evaluate(el => el.contains(document.activeElement))); }
  expect(left).toBe(true);
  await openWorkflow(page); await world.focus(); await page.keyboard.press('Escape');
  await expect(pop).toBeHidden(); await expect(workflowTrigger(page)).toBeFocused();
  expect(counter.calls).toBe(0); expect(await stored(page)).toEqual(before);
});

for (const mode of ['ready', 'settled'] as const) test(`PC 未结算候选与正式结算清晰区分：${mode}`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PC 专用');
  await seed(page, mode); const before = await stored(page), counter = await countRequests(page), pop = workflowPop(page), stage = pop.locator('.wf-stage');
  const status = workflowSummary(page).getByRole('status');
  if (mode === 'ready') {
    await expect(status).toContainText('候选已完成 · 等待结算');
    await openWorkflowStage(page, 'variables'); await expect(stage).toContainText('未正式结算');
    await openWorkflowStage(page, 'world'); await expect(stage).toContainText('程序校验通过 · 仍未正式结算');
    await expect(pop.locator('.wf-ft').getByRole('button', { name: '完成本回合结算', exact: true })).toBeEnabled();
  } else {
    await expect(status).toContainText('本回合已结算 · 等待行动');
    await openWorkflow(page);
    for (const item of await pop.locator('.workflow-stages > li').all()) await expect(item).toContainText('已结算');
    for (const target of ['variables', 'world'] as const) {
      await openWorkflowStage(page, target); await expect(stage).toContainText('本回合已结算'); await expect(stage).not.toContainText('未正式结算');
    }
    await expect(page.getByRole('button', { name: '完成本回合结算', exact: true })).toHaveCount(0);
    await expect(pop.locator('.wf-ft')).toContainText('发送新行动后开始下一回合');
  }
  expect(counter.calls).toBe(0); expect(await stored(page)).toEqual(before);
});

test('PC 失败状态：阶段标记、恢复入口、单阶段重试与诊断均可达', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'PC 专用');
  await seed(page, 'error'); const before = await stored(page), counter = await countRequests(page), pop = workflowPop(page);
  await expect(workflowSummary(page).getByRole('status')).toContainText('动态世界生成失败 · 查看详情');
  await openWorkflow(page);
  await expect(pop.locator('.workflow-stages > li').nth(2)).toContainText('失败 · 可重试');
  await expect(pop.locator('.wf-ft').getByRole('button', { name: '继续未完成阶段', exact: true })).toBeEnabled();
  await openWorkflowStage(page, 'world');
  await expect(pop.locator('.wf-stage .wf-pill[data-s="fail"]')).toHaveText('失败 · 可重试');
  await expect(pop.getByRole('button', { name: '生成世界候选', exact: true })).toBeEnabled();
  await openWorkflowDiagnostics(page); await expect(pop.locator('.workflow-diagnostics')).toContainText('world_schema');
  expect(counter.calls).toBe(0); expect(await stored(page)).toEqual(before);
});

test('手机非模态抽屉：两层导航、统一候选原文、诊断与只读绑定输入',async({page},info)=>{
 test.skip(info.project.name!=='mobile','手机专用');await seed(page,'ready');const before=await stored(page);
 await openWorkflow(page);const sheet=page.getByRole('dialog',{name:'三阶段工作流',exact:true});await expect(sheet).toHaveAttribute('aria-modal','false');
 await expect(sheet.locator('.workflow-stages>li')).toHaveCount(3);await expect(sheet.getByRole('checkbox')).toHaveCount(2);
 const candidate=await openStageCandidates(page,'variables');await expect(candidate.getByLabel('完整变量候选')).toHaveCount(0);
 await candidate.getByRole('button',{name:'主动查看完整变量候选'}).click();await expect(candidate.getByLabel('完整变量候选')).toContainText('SetWorldClock');
 await expect(await openCandidateRaw(page,'variables')).toContainText('没有可恢复');await openWorkflowDiagnostics(page);await expect(sheet.getByRole('region',{name:'运行诊断',exact:true})).toContainText('本次页面尚无错误');
 await openBoundInput(page);await expect(sheet.locator('.bound-input')).toBeVisible();
 await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(workflowTrigger(page)).toBeFocused();expect(await stored(page)).toEqual(before);
});
