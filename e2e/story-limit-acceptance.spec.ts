import {test,expect} from './helpers/test';
import {openStageSwitches,closeWorkflowSheet} from './helpers/gameLayout';
import {variableTextEnvelope} from '../src/tests/fixtures/variableReply';
import type {Page} from '@playwright/test';

const base='https://readonly.mock.invalid',body='【旁白】雨丝斜着落进货场，老周看着行人，终于决定回家。';
const full=`<正文>${body}</正文><短期记忆>老周观察行人后回家。</短期记忆><变量规划>[]</变量规划><行动选项>继续走走\n回家休息\n询问路人</行动选项>`;
const cut='<正文>【旁白】雨丝斜着落进货场，老周';const tail='看着行人，终于决定回家。</正文><短期记忆>老周观察行人后回家。</短期记忆><变量规划>[]</变量规划><行动选项>继续走走\n回家休息\n询问路人</行动选项>';
async function seed(page:Page,stream:boolean){await page.goto('/');await page.evaluate(async(stream)=>{
 const rp='/src/services/storage/saveRepository.ts',fp='/src/tests/fixtures/turn.ts',wp='/src/tests/fixtures/world.ts',cp='/src/services/ai/configuration.ts',vp='/src/services/ai/credentials.ts',sp='/src/ui/settings/model.ts';
 const [{SaveRepository},{completeDraft},{worldState},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault},{defaultSettings,settingsKey}]=await Promise.all([rp,fp,wp,cp,vp,sp].map(p=>import(p)));
 const settings=defaultSettings();settings.prompts.minNarrativeChars=5;settings.prompts.actionOptions=true;settings.runtime.streamStory=stream;
 for(const p of Object.values(settings.memory.summaries) as {automatic:boolean}[])p.automatic=false;localStorage.setItem(settingsKey,JSON.stringify(settings));
 const c=newChannel(),config=defaultAiConfig();c.baseUrl='https://readonly.mock.invalid/v1';config.channels=[c];config.routes.story={channelId:c.id,modelId:'story'};
 for(const stage of ['variables','world'])config.routes[stage]={mode:'independent',channelId:c.id,modelId:stage};saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(c.id,'mock-only-key');
 const repo=await SaveRepository.open();try{await repo.create(worldState());const d=await completeDraft(repo);const settled=await repo.commitTurn({draft:d,nextAction:'去街边观察',useVariableStage:true,useWorldStage:true});if(settled.state.turnNumber!==1)throw Error('bad fixture');}finally{repo.close();}
 },stream);await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();}
async function load(page:Page){return page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open();try{return await r.loadGame('save-a')}finally{r.close()}})}
async function closeDiagnostics(page:Page){const d=page.locator('dialog.mobile-diagnostics-sheet[open]');if(await d.isVisible()){await page.keyboard.press('Escape');await expect(d).toBeHidden()}}
async function shot(page:Page,name:string){await page.screenshot({path:test.info().outputPath(`${name}.png`)})}
for(const stream of [true,false]){

 test(`完整limit原请求直接保存并完成后续阶段 stream=${stream}`,async({page},info)=>{
  await seed(page,stream);const calls:string[]=[];
  await page.route(`${base}/**`,async route=>{const b=route.request().postDataJSON();calls.push(b.model);
   const text=b.model==='story'?full:b.model==='variables'?variableTextEnvelope('<说明>无变化</说明><命令>\n</命令>'):JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
   await route.fulfill(stream&&b.model==='story'?{contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'length'}]})}\n\ndata: [DONE]\n\n`}:{json:{choices:[{message:{content:text},finish_reason:b.model==='story'?'length':'stop'}]}});
  });
  await openStageSwitches(page);await page.getByRole('button',{name:'自动生成本回合',exact:true}).click();
  await expect.poll(async()=>(await load(page)).state.turnNumber,{timeout:15000}).toBe(2);
  const current=await load(page);expect(current.state.journal.at(-1).story.narrative).toBe(body);expect(current.state.revision).toBe(2);
  expect(current.draft.storyPartial).toBeUndefined();expect(calls).toEqual(['story','variables','world']);
  await expect(page.locator('.workflow-summary')).toContainText('本回合已结算');await expect(page.getByRole('button',{name:'续写正文',exact:true})).toHaveCount(0);
  await shot(page,`${info.project.name}-${stream}-limit-settled`);await page.reload();expect((await load(page)).state.turnNumber).toBe(2);expect(calls).toHaveLength(3);
 });
 test(`手动失败→自动续写成功Commit后旧错误不再显示 stream=${stream}`,async({page},info)=>{
  await seed(page,stream);let stories=0;const calls:string[]=[];
  await page.route(`${base}/**`,async route=>{const b=route.request().postDataJSON();calls.push(b.model);let text:string,finish='stop';
   if(b.model==='story'){stories++;if(stories===1){text=cut;finish='length'}else if(stories===2)text=tail;else return route.fulfill({status:403,json:{error:{message:'Mock forbidden'}}});}
   else if(b.model==='variables')text=variableTextEnvelope('<说明>无变化</说明><命令>\n</命令>');else text=JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
   await route.fulfill(stream&&b.model==='story'?{contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`}:{json:{choices:[{message:{content:text},finish_reason:finish}]}});
  });
  await page.getByRole('button',{name:'生成本回合正文',exact:true}).click();await expect.poll(async()=>(await load(page)).draft?.storyPartial?.text).toBe(cut);await closeDiagnostics(page);
  await page.getByRole('button',{name:'续写正文',exact:true}).click();await expect.poll(async()=>(await load(page)).state.turnNumber,{timeout:15000}).toBe(2);
  await expect(page.getByRole('button',{name:'续写正文',exact:true})).toHaveCount(0);
  await expect(page.locator('.workflow-summary')).toContainText('本回合已结算');
  await openStageSwitches(page);await expect(page.locator('.workflow-stages>li').first()).toContainText('已结算');
  await shot(page,`${info.project.name}-${stream}-committed-stale-error`);
  expect(calls).toEqual(['story','story','variables','world']);await closeWorkflowSheet(page);
  const x=page.getByRole('button',{name:'关闭三阶段详情',exact:true});if(await x.isVisible())await x.click();
  await page.locator('#player-input').fill('再次观察');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await load(page)).draft?.failures.at(-1)?.errorCode).toBe('authorization');await closeDiagnostics(page);
  await expect(page.locator('.workflow-summary')).toContainText('正文生成失败');
 });
}
