import { mkdir } from 'node:fs/promises';
import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedRoster, rosterGame } from './helpers/npcRoster';
import { openWorldArchive } from './helpers/gameLayout';

async function seed(page:Page,extra=0) {
  await seedRoster(page);
  await page.evaluate(async extra=>{
    const paths=['/src/tests/fixtures/organizations.ts','/src/domain/drafts.ts'];
    const [{organizationArchiveState},{createTurnDraft}]=await Promise.all(paths.map(path=>import(path))),state=organizationArchiveState(extra);
    await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('heijinwangchao');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['saves','drafts'],'readwrite');tx.objectStore('saves').put(state);tx.objectStore('drafts').put(createTurnDraft(state.saveId,state.revision,'org-browser-turn','regular',''));tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
  },extra);
  await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function open(page:Page){await expect(page.locator('.game-layout')).toBeVisible();await openWorldArchive(page);await page.getByRole('complementary',{name:'世界资料'}).getByRole('button',{name:/势力组织/}).click();return page.getByRole('dialog',{name:'势力组织',exact:true});}
async function noOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);const dialog=page.getByRole('dialog',{name:'势力组织',exact:true});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);}

test('PC三宽度/手机三宽度真实档案截图：未知身份、长概况、低频状态、只读查看不解锁',async({page},info)=>{
  const widths=info.project.name==='desktop'?[1280,1440,1650]:[320,360,390];
  const calls:string[]=[];await page.route('https://summary.mock.invalid/**',r=>{calls.push(r.request().url());return r.abort();});
  await seed(page);const before=await rosterGame(page);
  await mkdir('docs/screenshots/organization-final',{recursive:true});
  for(const width of widths){
    await page.setViewportSize({width,height:info.project.name==='desktop'?900:844});const dialog=await open(page);
    await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();
    const detail=dialog.getByRole('region',{name:'组织详情',exact:true});
    await expect(detail.getByRole('heading',{name:'澄川工贸',exact:true})).toBeVisible();
    await expect(detail).toContainText('闻所未闻');await expect(detail).toContainText('经营稳定，正在推进业务整合');
    await expect(detail).toContainText('实际控制人：未知');await expect(detail).toContainText('顾行远');
    await expect(detail.getByRole('button',{name:'顾行远',exact:true})).toHaveCount(0);
    await detail.getByText('阅读完整组织概况',{exact:true}).click();
    await expect(detail).toContainText(before.state.organizations['org-business'].description);
    await detail.getByText('阅读完整组织概况',{exact:true}).click();
    await noOverflow(page);
    // Show the current state and manager identities in the real React view.
    await detail.evaluate(pane=>{const heading=[...pane.querySelectorAll('h4')].find(h=>h.textContent==='当前状况')!;pane.scrollTop+=heading.getBoundingClientRect().top-pane.getBoundingClientRect().top-(window.innerWidth<=900?65:12);});
    if(info.project.name==='desktop')await expect(dialog.getByLabel('搜索组织',{exact:true})).toBeInViewport();
    await page.screenshot({path:`docs/screenshots/organization-final/${info.project.name}-${width}.png`});
    await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  }
  expect(await rosterGame(page)).toEqual(before);expect(calls).toEqual([]);
});

test('搜索/过滤/分页和返回焦点；组织→NPC→组织、组织间与事件跳转，零请求零写档',async({page})=>{
  const calls:string[]=[];await page.route('https://summary.mock.invalid/**',r=>{calls.push(r.request().url());return r.abort();});
  await seed(page,25);const before=await rosterGame(page);let dialog=await open(page);
  await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(20);
  await dialog.getByRole('button',{name:'下一页组织',exact:true}).click();await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(9);
  await dialog.getByLabel('搜索组织',{exact:true}).fill('澄川');await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();
  let detail=dialog.getByRole('region',{name:'组织详情',exact:true});
  await expect(detail.getByRole('region',{name:'组织当前任务',exact:true})).toContainText('核对新车间交接清单');
  await expect(detail.getByRole('region',{name:'组织当前任务',exact:true})).not.toContainText('已经完成的旧交接任务');
  await detail.getByRole('button',{name:'林澄',exact:true}).click();
  const npc=page.getByRole('dialog',{name:'NPC',exact:true});await expect(npc.getByRole('heading',{name:'林澄',exact:true})).toBeVisible();
  await npc.getByRole('button',{name:'澄川工贸',exact:true}).click();dialog=page.getByRole('dialog',{name:'势力组织',exact:true});detail=dialog.getByRole('region',{name:'组织详情',exact:true});
  await expect(detail.getByRole('heading',{name:'澄川工贸',exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'旧城互助会',exact:true}).click();await expect(detail.getByRole('heading',{name:'旧城互助会',exact:true})).toBeVisible();
  if(await dialog.getByRole('button',{name:'← 返回组织名录',exact:true}).isVisible())await dialog.getByRole('button',{name:'← 返回组织名录',exact:true}).click();
  await dialog.getByLabel('搜索组织',{exact:true}).fill('澄川');await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();
  await detail.getByRole('button',{name:'业务整合与新车间交接',exact:true}).click();
  const event=page.getByRole('dialog',{name:'世界事件',exact:true});await expect(event.getByRole('heading',{name:'业务整合与新车间交接',exact:true})).toBeVisible();
  await event.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  dialog=await open(page);await dialog.getByLabel('组织类别',{exact:true}).selectOption('government');await expect(dialog.getByRole('button',{name:/查看组织：/})).toHaveCount(1);
  await dialog.getByLabel('搜索组织',{exact:true}).fill('没有这种组织');await expect(dialog).toContainText('暂无符合条件的组织');
  await dialog.getByLabel('搜索组织',{exact:true}).fill('');await dialog.getByRole('button',{name:'查看组织：江岸公共事务处',exact:true}).click();
  if(await dialog.getByRole('button',{name:'← 返回组织名录',exact:true}).isVisible()){
    await dialog.getByRole('button',{name:'← 返回组织名录',exact:true}).click();await expect(dialog.getByRole('button',{name:'查看组织：江岸公共事务处',exact:true})).toBeFocused();
  }
  await noOverflow(page);expect(await rosterGame(page)).toEqual(before);expect(calls).toEqual([]);
});

test('真实三阶段Mock结案更新组织→刷新档案与已结束事件→撤回，主角财务和NPC无副作用',async({page})=>{
  await seed(page);const before=await rosterGame(page),calls:string[]=[];
  await page.route('https://summary.mock.invalid/**',async route=>{
    const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
    const raw=body.messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>')).content,context=JSON.parse(raw.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));
    if(stage==='story'){const text='<thinking>承接现有世界。</thinking><正文>【旁白】日常工作继续，远处企业的业务整合已经完成。</正文><短期记忆>整合已完成。</短期记忆><变量规划>[]</变量规划>';await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`});return;}
    let content:string;
    if(stage==='variables')content=`<thinking>实际经过一分钟。</thinking><说明></说明><命令>set worldClock = "${new Date(Date.parse(context.SAVE_STATE.worldClock)+60000).toISOString()}"</命令>`;
    else{
      const event=context.SAVE_STATE.events['org-active'],now=context.SAVE_STATE.worldClock;
      content=JSON.stringify({worldCommands:[{type:'UpdateOrganization',commandId:'org-update',evidence:'本轮业务整合结案',organizationId:'org-business',expectedRevision:context.BASE_SAVE_REVISION,changes:{operatingStatus:'业务整合正式完成',leadership:[{position:'总经理',publicName:'沈向南'}],assetsEstimate:80000000,liquidityEstimate:600000},financialBasis:{at:now,note:'整合后各自估计，不是玩家收入'}}],taskCommands:[],eventCommands:[{type:'SaveEvent',commandId:'org-close',evidence:'业务整合完成',event:{...event,status:'resolved',resolvedAt:now,resolutionText:'新车间交接完成，后续维护任务继续。',outcome:'success',sourceTurnIds:[...event.sourceTurnIds,context.TURN_CONTEXT.turnId],continuation:{direction:'end',reason:'本次整合结束'}}}],visibleHooks:[],unresolved:[]});
    }
    await route.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}});
  });
  await page.getByLabel('你的行动',{exact:true}).fill('继续日常工作');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await rosterGame(page)).state.turnNumber,{timeout:20000}).toBe(before.state.turnNumber+1);
  const saved=await rosterGame(page);expect(saved.state.npc).toEqual(before.state.npc);expect(saved.state.economy).toEqual(before.state.economy);expect(calls).toEqual(['story','variables','world']);
  await page.reload();let dialog=await open(page);await dialog.getByRole('button',{name:'查看组织：澄川工贸',exact:true}).click();
  const detail=dialog.getByRole('region',{name:'组织详情',exact:true});await expect(detail).toContainText('业务整合正式完成');await expect(detail).toContainText('沈向南');
  await detail.getByText('已结束事件 · 2',{exact:true}).click();await detail.getByRole('button',{name:'业务整合与新车间交接',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'世界事件',exact:true});await expect(dialog).toContainText('新车间交接完成，后续维护任务继续。');await dialog.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  const directory=page.getByRole('dialog',{name:'世界资料',exact:true});if(await directory.isVisible())await directory.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  await page.getByRole('button',{name:/^撤回（1）$/}).click();await page.getByRole('dialog',{name:'撤回上一回合',exact:true}).getByRole('button',{name:'确认撤回',exact:true}).click();
  await expect.poll(async()=>(await rosterGame(page)).state.turnNumber).toBe(before.state.turnNumber);const undone=await rosterGame(page);
  expect(undone.state.organizations).toEqual(before.state.organizations);expect(undone.state.events).toEqual(before.state.events);expect(undone.state.npc).toEqual(before.state.npc);expect(calls).toHaveLength(3);
});
