import {test,expect} from './helpers/test';
import type {Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {settingsTextContrast} from './helpers/settingsContrast';
async function seed(page: Page, turns = 7) {
  await page.goto('/');
  await page.evaluate(async turns => {
    const paths = ['/src/services/storage/saveRepository.ts', '/src/tests/fixtures/world.ts', '/src/tests/fixtures/turn.ts',
      '/src/ui/settings/model.ts', '/src/services/ai/configuration.ts', '/src/services/ai/credentials.ts'];
    const [{ SaveRepository }, { worldState }, { completeDraft, elapsedVariables, submission }, { defaultSettings, settingsKey },
      { defaultAiConfig, newChannel, saveAiConfig }, { CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const repo = await SaveRepository.open();
    try {
      await repo.create(worldState());
      for (let i = 1; i <= turns; i++) {
        const game = await repo.loadGame('save-a'); if (game.draft) await repo.bindTurnAction(game.draft, `合成行动${i}`, true, true);
        await repo.commitTurn(submission(await completeDraft(repo, { variables: await elapsedVariables(repo, '正常经过时间', 60), narrative: '【旁白】这是一段合成历史小说。街边的灯火与人物交谈均为隔离测试内容。'.repeat(120) }), ''));
      }
    } finally { repo.close(); }
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const setting of Object.values(settings.memory.summaries) as { automatic: boolean }[]) setting.automatic = false;
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    const config = defaultAiConfig(), channel = newChannel(); channel.baseUrl = 'https://history.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['variables', 'world', 'memory']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage, config); new CredentialVault(sessionStorage, localStorage).set(channel.id, 'synthetic-history-key');
  }, turns);
  await page.reload();
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/services/storage/saveRepository.ts', { SaveRepository } = await import(p), repo = await SaveRepository.open();
    try { return { ...await repo.loadGame('save-a'), raw: await repo.exportRaw('save-a'), history: await repo.history.list('save-a'), undo: await repo.undoStatus('save-a') }; }
    finally { repo.close(); }
  });
}
async function open(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) > 900) {
    await expect(page.locator('.home-experience')).toBeVisible();
    const button = page.getByRole('button', { name: '存档馆', exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: '历史存档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '历史存档', exact: true })).toBeVisible();
  await expect(page.getByText('正在读取历史元数据…')).toHaveCount(0);
}

for(const appearance of ['night','day'])for(const short of [false,true])test(`历史档案视觉 ${appearance} short=${short}`,async({page},info)=>{
 test.setTimeout(120000);const mobile=info.project.name==='mobile';await page.setViewportSize(mobile?short?{width:375,height:667}:{width:390,height:844}:short?{width:901,height:600}:{width:1440,height:900});
 await seed(page);await page.evaluate(a=>{document.documentElement.dataset.appearance=a},appearance);let posts=0;await page.route('**/*',async r=>{if(r.request().method()==='POST'){posts++;throw Error('Unexpected model request')}const u=new URL(r.request().url());if(['localhost','127.0.0.1'].includes(u.hostname))return r.continue();return r.abort()});
 await open(page);const root=page.locator('dialog.history-saves'),metrics:unknown[]=[];const contrasts:Awaited<ReturnType<typeof settingsTextContrast>>[]=[];const buttonChecks:{text:string;ratio:number;minHeight:number}[]=[];
 async function capture(name:string){await page.screenshot({path:info.outputPath(`${appearance}-${short?'short':'normal'}-${name}.png`)});buttonChecks.push(...await root.locator('button').evaluateAll(elements=>{
 const parse=(s:string)=>s.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];
 const lum=(c:number[])=>c.slice(0,3).reduce((v,n,i)=>v+(n/255<=.04045?n/255/12.92:((n/255+.055)/1.055)**2.4)*[.2126,.7152,.0722][i],0);
 return elements.filter(e=>e.getClientRects().length&&!e.matches(':disabled')).flatMap(e=>{const st=getComputedStyle(e),border=parse(st.borderTopColor);if(border[3]===0||parseFloat(st.borderTopWidth)===0)return[];
 let parent=e.parentElement;while(parent&&parse(getComputedStyle(parent).backgroundColor)[3]===0)parent=parent.parentElement;
 const bg=parse(parent?getComputedStyle(parent).backgroundColor:'rgb(255,255,255)'),a=lum(border),b=lum(bg);return[{text:e.textContent??'',ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minHeight:e.getBoundingClientRect().height}];});}));const contrast=await settingsTextContrast(root);contrasts.push(contrast);metrics.push({name,...await root.evaluate(el=>{const body=el.querySelector('.modal-body')!,r=el.getBoundingClientRect();return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},body:{scroll:body.scrollHeight,client:body.clientHeight,width:body.scrollWidth,clientWidth:body.clientWidth},pageWidth:document.documentElement.scrollWidth,viewport:innerWidth}})});}
 await root.getByRole('button',{name:'自动历史',exact:true}).focus();await expect(root.getByRole('button',{name:'自动历史',exact:true})).toBeFocused();
 await capture('automatic');await page.getByRole('button',{name:'关闭资料界面',exact:true}).click();
 await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',f='/src/tests/fixtures/turn.ts',{SaveRepository}=await import(p),{completeDraft,elapsedVariables,submission}=await import(f),r=await SaveRepository.open();try{
  await r.history.create('save-a','雨夜转折 · 被珍藏的旧人生');const n=(await r.history.list('save-a')).nodes.find((n:{kind:string;turnNumber:number})=>n.kind==='automatic'&&n.turnNumber===2);const preview=await r.history.preview('save-a',n);await r.history.restore(preview.confirmation,'合成新时间线',true,true);
  for(let i=0;i<5;i++){const g=await r.loadGame('save-a');if(!g.draft.userInput)await r.bindTurnAction(g.draft,'合成行动',true,true);await r.commitTurn(submission(await completeDraft(r,{variables:await elapsedVariables(r,'正常经过时间',60)}),''));}
  for(let i=0;i<23;i++)await r.history.create('save-a',`收藏 ${i+1} · 重要人生节点与很长的自定义名称用于窄屏换行检查`);
 }finally{r.close()}});
 await open(page);await page.getByRole('button',{name:'手动收藏',exact:true}).click();await expect(root.locator('.history-node-list>li')).toHaveCount(20);const before=await read(page);
 await capture('manual');await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(root.locator('.history-node-list>li')).toHaveCount(4);await capture('page2-old');
 const old=root.locator('.history-node-list>li').filter({hasText:'雨夜转折'});if(!await old.count())await page.getByRole('button',{name:'上一页',exact:true}).click();await old.scrollIntoViewIfNeeded();await old.getByRole('button',{name:'删除收藏',exact:true}).click();await capture('delete');await page.getByRole('button',{name:'保留收藏',exact:true}).click();
 await old.getByRole('button',{name:/预览第/}).click();await root.getByRole('heading',{name:'雨夜转折',exact:false}).scrollIntoViewIfNeeded();await capture('preview');
 await root.locator('.history-story').evaluate(el=>el.lastElementChild?.scrollIntoView({block:'end'}));
 await expect(root.getByRole('button',{name:'关闭资料界面',exact:true})).toBeInViewport();
 await capture('long-reading-bottom');
 await page.getByLabel('历史阅读内容').selectOption('人物档案');await root.locator('.history-world').scrollIntoViewIfNeeded();await capture('profile');await page.getByLabel('历史阅读内容').selectOption('经济与资产');await capture('economy');
 await page.getByLabel('历史阅读内容').selectOption('正文');await page.getByLabel('从此历史节点开始的行动').fill('先核对再决定');await page.getByRole('button',{name:'发送新行动（先确认覆盖）',exact:true}).click();await root.getByRole('heading',{name:'确认覆盖并继续？'}).scrollIntoViewIfNeeded();await capture('overwrite');
 await expect(root.getByRole('region',{name:'覆盖时间线确认'})).toContainText('不能通过撤回恢复');await expect(root).toContainText('玩家自行保存的历史节点不会被删除');await page.getByRole('button',{name:'取消，保留原进度',exact:true}).click();await page.getByRole('button',{name:'返回历史列表',exact:true}).click();
 expect(await read(page)).toEqual(before);expect(posts).toBe(0);
 await writeFile(info.outputPath('computed-contrast.json'),JSON.stringify({contrasts,metrics,buttonChecks},null,2));
 expect(buttonChecks.filter(c=>c.ratio<3)).toEqual([]);if(mobile)expect(buttonChecks.every(c=>c.minHeight>=44)).toBe(true);
 expect(contrasts.flatMap(c=>c.failures)).toEqual([]);expect(contrasts.flatMap(c=>c.controlFailures)).toEqual([]);
 await root.getByRole('button',{name:'关闭资料界面',exact:true}).click();
 await expect(root).not.toBeVisible();await expect(page.getByRole('button',{name:'历史存档',exact:true})).toBeFocused();
 expect(metrics.every(m=>{const v=m as {body:{width:number;clientWidth:number};pageWidth:number;viewport:number};return v.body.width<=v.body.clientWidth+1&&v.pageWidth<=v.viewport})).toBe(true);
});
