import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openWorkflow, workflowTrigger } from './helpers/gameLayout';

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
    if(mode==='off'){await page.getByRole('button',{name:'展开高级设置'}).click();await expect(page.getByRole('checkbox',{name:'动态世界',exact:true})).toBeFocused();}
    if(mode==='error'){await page.getByRole('button',{name:'重试与变更详情',exact:true}).click();await expect(pop).toContainText('world_schema');await page.getByRole('button',{name:'本回合已绑定输入（只读）',exact:true}).click();await expect(page.locator('.workflow-diagnostics')).not.toHaveAttribute('open');}
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-${mode}-desktop.png`});
    await page.keyboard.press('Escape');await expect(pop).toBeHidden();await expect(workflowTrigger(page)).toBeFocused();
    await openWorkflow(page);await page.getByRole('button',{name:'收起三阶段详情'}).click();await expect(workflowTrigger(page)).toBeFocused();
    await openWorkflow(page);await workflowTrigger(page).click();await expect(pop).toBeHidden();
    for(const size of [{width:1280,height:800},{width:1100,height:800}]){await page.setViewportSize(size);await openWorkflow(page);const r=(await pop.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(size.width);expect(r.y+r.height).toBeLessThanOrEqual(box!.y+10);await workflowTrigger(page).click();}
  }else{
    await expect(page.locator('details.workflow-disclosure')).toHaveAttribute('open');await expect(page.locator('.wf-hd')).toHaveCount(0);
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-${mode}-mobile.png`});
  }
  if(mode==='ready'){
    await openWorkflow(page);await page.getByRole('button',{name:'查看变量候选（未结算）',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'变量候选 · 未正式结算',exact:true});await expect(modal).toBeVisible();
    await modal.getByRole('button',{name:'主动查看完整变量候选',exact:true}).click();await expect(modal.getByLabel('完整变量候选')).toContainText('SetWorldClock');
    await expect(modal).toContainText('本页没有可恢复的模型原文');await page.screenshot({path:`docs/workflow-feedback/screenshots/react-variables-${info.project.name}.png`});
    await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'查看变量候选（未结算）',exact:true})).toBeFocused();
    await page.getByRole('button',{name:'查看世界候选（未结算）',exact:true}).click();const world=page.getByRole('dialog',{name:'世界候选 · 未正式结算',exact:true});
    await world.getByRole('button',{name:'主动查看完整世界候选',exact:true}).click();await expect(world.getByLabel('完整世界候选')).toContainText('worldCommands');
    await page.screenshot({path:`docs/workflow-feedback/screenshots/react-world-${info.project.name}.png`});await page.keyboard.press('Escape');
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
  await openWorkflow(page);await page.getByRole('button',{name:'重新生成变量候选',exact:true}).click();await expect.poll(()=>calls).toBe(1);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'生成世界候选',exact:true}).click();await expect.poll(()=>calls).toBe(2);
  if(info.project.name==='desktop'){
    const group=page.locator('.workflow-errors');await expect(group).toHaveCount(1);await expect(group.locator('.feedback-message')).toHaveCount(2);
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
  await settings.getByRole('button',{name:'新增渠道',exact:true}).click();await settings.getByRole('button',{name:'关闭资料界面',exact:true}).click();
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
