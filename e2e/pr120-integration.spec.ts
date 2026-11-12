import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { variableReply } from '../src/tests/fixtures/variableReply';
import { mkdirSync, writeFileSync } from 'node:fs';

type Mode = 'opening' | 'ready' | 'off' | 'error' | 'settled';
async function seed(page: Page, mode: Mode) {
  await page.goto('/');
  await page.evaluate(async mode => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/tests/fixtures/world.ts','/src/tests/fixtures/turn.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{SaveRepository},{worldState},{completeDraft},{createTurnDraft,TurnDraftSchema,startStageAttempt},{defaultSettings,settingsKey},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault}] = await Promise.all(paths.map(path => import(path)));
    const repo = await SaveRepository.open(), state = worldState();
    state.openingCityId = 'chongqing'; state.title = '沈砚 · 重庆'; state.protagonist.name = '沈砚';
    await repo.create(state);
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    if (mode === 'off') settings.runtime.useWorldStage = false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig();channel.baseUrl='https://workflow.mock.invalid/v1';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'story'};config.routes.variables={mode:'independent',channelId:channel.id,modelId:'variables'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-key');
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

const trigger=(page:Page)=>page.locator('.workflow-toggle');
const panel=(page:Page)=>page.getByRole('region',{name:'三阶段详情',exact:true});
async function stage(page:Page,name:string){
 const back=page.getByRole('button',{name:'返回三阶段列表'});if(await back.isVisible())await back.click();
 await panel(page).getByRole('navigation',{name:'三阶段导航'}).getByRole('button',{name:new RegExp(name)}).click();
}
test('整合：双层导航、候选/原文/诊断、非模态输入边界与四尺寸真实截图',async({page},info)=>{
 test.setTimeout(60000);let calls=0;await page.route('https://workflow.mock.invalid/**',route=>{calls++;return route.abort();});
 await seed(page,'ready');const before=await stored(page),mobile=info.project.name==='mobile';mkdirSync('docs/pr120-integration/screenshots',{recursive:true});
 for(const [width,height] of mobile?[[390,844],[392,640],[392,420]]:[[901,900],[1440,900]]){
  await page.setViewportSize({width,height});await trigger(page).click();
  if(mobile){const dialog=page.getByRole('dialog',{name:'三阶段工作流',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toHaveAttribute('aria-modal','false');expect(await dialog.evaluate(e=>e.matches(':modal'))).toBe(false);}
  if(mobile){await expect(page.getByRole('dialog',{name:'三阶段工作流',exact:true}).getByRole('button',{name:'收起三阶段详情',exact:true})).toBeInViewport({ratio:1});await page.screenshot({animations:'disabled',path:`docs/pr120-integration/screenshots/home-${width}x${height}.png`});writeFileSync(`docs/pr120-integration/home-${width}.json`,JSON.stringify(await page.getByRole('dialog',{name:'三阶段工作流',exact:true}).evaluate(el=>[el,...el.querySelectorAll('.modal-heading,.modal-body,.wf-mobile-content,.wf-hd,.wf-main,.wf-ft')].map(e=>({className:e.className,y:e.getBoundingClientRect().y,height:e.getBoundingClientRect().height,scrollTop:e.scrollTop,overflow:getComputedStyle(e).overflow}))),null,2));}
  await stage(page,'变量管理');await panel(page).getByRole('tab',{name:/^候选/}).click();
  await expect(panel(page).getByLabel('完整变量候选')).toHaveCount(0);
  await panel(page).getByRole('button',{name:'主动查看完整变量候选'}).click();await expect(panel(page).getByLabel('完整变量候选')).toContainText('SetWorldClock');
  if(mobile){await expect(page.getByRole('dialog',{name:'三阶段工作流',exact:true}).getByRole('button',{name:'收起三阶段详情',exact:true})).toBeInViewport({ratio:1});await expect(panel(page).getByRole('button',{name:'完成本回合结算',exact:true})).toBeInViewport({ratio:1});expect(await panel(page).locator('.wf-main').evaluate(e=>{e.scrollTop=e.scrollHeight;const y=e.scrollTop;e.scrollTop=0;return y>0;})).toBe(true);}
  await page.screenshot({animations:'disabled',path:`docs/pr120-integration/screenshots/${width}x${height}.png`});
  await panel(page).getByRole('tab',{name:'模型原文',exact:true}).click();await expect(panel(page).getByRole('region',{name:'模型原文',exact:true})).toContainText('没有可恢复');
  if(mobile)await panel(page).getByRole('button',{name:'返回三阶段列表'}).click();
  await panel(page).getByRole('button',{name:/运行诊断/}).click();await expect(panel(page).getByRole('region',{name:'运行诊断',exact:true})).toContainText('本次页面尚无错误');
  if(mobile){
   const input=page.getByLabel('你的行动',{exact:true});await input.click();await page.keyboard.type('实际点击后的输入');await expect(input).toHaveValue('实际点击后的输入');await page.keyboard.type('多行行动输入仍保持可用。'.repeat(8));
   await page.getByRole('button',{name:'行动输入',exact:true}).focus();await page.keyboard.press('Enter');await expect(input).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeFocused();
   const row=page.locator('.composer-action-row'),drawer=page.getByRole('dialog',{name:'三阶段工作流',exact:true});expect((await drawer.boundingBox())!.y+(await drawer.boundingBox())!.height).toBeLessThanOrEqual((await row.boundingBox())!.y);await input.fill('');
  }
  await page.keyboard.press('Escape');await expect(panel(page)).toBeHidden();await expect(trigger(page)).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 if(mobile){await trigger(page).click();await page.setViewportSize({width:901,height:900});await expect(panel(page).locator('.wf-stage')).toBeVisible();await page.keyboard.press('Escape');await page.setViewportSize({width:392,height:640});}
 if(mobile){
  for(const close of ['button','shade','drag']){
   await trigger(page).click();await expect(panel(page)).toHaveAttribute('data-level','home');
   if(close==='button')await page.getByRole('button',{name:'收起三阶段详情'}).click();
   else if(close==='shade')await page.getByRole('button',{name:'收起工作流暗区'}).click();
   else {const input=page.getByLabel('你的行动',{exact:true});await input.click();await page.keyboard.type('拖动只应关闭抽屉');const send=page.getByRole('button',{name:'发送',exact:true});await expect(send).toBeEnabled();const box=(await page.getByRole('button',{name:'收起三阶段工作流',exact:true}).boundingBox())!,target=(await send.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:8});await page.mouse.up();await expect(input).toHaveValue('拖动只应关闭抽屉');}
   await expect(panel(page)).toBeHidden();await expect(trigger(page)).toBeFocused();if(close==='drag')await page.getByLabel('你的行动',{exact:true}).fill('');
  }
 }
 expect(calls).toBe(0);expect(await stored(page)).toEqual(before);
});
test('整合：抽屉打开时真实输入发送、失败恢复、取消和原子结算/刷新',async({page},info)=>{
 test.skip(info.project.name!=='mobile','手机非模态交互');test.setTimeout(60000);await page.setViewportSize({width:392,height:640});await seed(page,'settled');
 const calls:string[]=[];let fail=true,hold=true,release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
 await page.route('https://workflow.mock.invalid/**',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:{data:[]}});return;}
  const body=route.request().postDataJSON(),kind=body.model;calls.push(kind);
  if(kind==='story'&&hold)await wait;
  const context=JSON.parse(body.messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>')).content.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));
  const content=kind==='story'?'<thinking>承接现状。</thinking><正文>【旁白】主角在街边观察周围，街道上人来人往。</正文><短期记忆>主角观察街道。</短期记忆><变量规划>[]</变量规划>':kind==='variables'?variableReply({commands:[{type:'SetWorldClock',commandId:'clock',worldClock:new Date(Date.parse(context.SAVE_STATE.worldClock)+60000).toISOString(),evidence:'主角在街边观察周围，街道上人来人往。'}],rejectedSuggestions:[],unresolved:[]}):fail?'{invalid':JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
  await route.fulfill(kind==='story'?{contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\ndata: [DONE]\n\n`}:{json:{choices:[{message:{content},finish_reason:'stop'}]}}).catch(()=>undefined);
 });
 const before=await stored(page);await trigger(page).click();const input=page.getByLabel('你的行动',{exact:true});await expect(page.getByRole('dialog',{name:'三阶段工作流',exact:true})).toBeVisible();await page.setViewportSize({width:392,height:420});await input.click();await page.keyboard.type('观察街道');await expect(input).toHaveValue('观察街道');await page.screenshot({animations:'disabled',path:'docs/pr120-integration/screenshots/send-open-392x420.png'});await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport({ratio:1});await page.getByRole('button',{name:'发送',exact:true}).click();await page.setViewportSize({width:392,height:640});await expect.poll(()=>calls.length).toBe(1);
 await expect(panel(page)).toBeVisible();await expect(page.locator('.workflow')).toHaveAttribute('data-state','busy');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();await panel(page).getByRole('button',{name:'取消自动执行',exact:true}).click();release();hold=false;
 await expect(panel(page).getByRole('button',{name:'继续未完成阶段',exact:true})).toBeEnabled();expect((await stored(page)).state).toEqual(before.state);
 await panel(page).getByRole('button',{name:'继续未完成阶段',exact:true}).click();await expect.poll(async()=>(await stored(page)).draft?.stageStatus.world).toBe('failed');
 await panel(page).getByRole('button',{name:'打开 AI 设置',exact:true}).click();const settings=page.getByRole('dialog',{name:'设置',exact:true});await expect(settings).toBeVisible();await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);await expect(page.getByRole('dialog',{name:'三阶段工作流',exact:true})).toBeVisible();
 await stage(page,'动态世界');await expect(panel(page).getByRole('button',{name:'生成世界候选',exact:true})).toBeEnabled();fail=false;
 await panel(page).getByRole('button',{name:'继续未完成阶段',exact:true}).click();await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(before.state.turnNumber+1);
 const settled=await stored(page);expect(settled.state.revision).toBe(before.state.revision+1);await expect(panel(page)).toBeVisible();expect(calls).toEqual(['story','story','variables','world','world']);await page.keyboard.press('Escape');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();expect((await stored(page)).state).toEqual(settled.state);expect(calls).toHaveLength(5);
 // A second deliberate send, still without closing the drawer, takes exactly 3 stages.
 await trigger(page).click();await input.click();await page.keyboard.type('继续观察街道');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(before.state.turnNumber+2);expect((await stored(page)).state.revision).toBe(before.state.revision+2);expect(calls).toEqual(['story','story','variables','world','world','story','variables','world']);await expect(panel(page)).toBeVisible();
});
