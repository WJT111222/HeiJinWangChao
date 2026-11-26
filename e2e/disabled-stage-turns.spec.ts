import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openStageSwitches, closeWorkflowSheet } from './helpers/gameLayout';
import { variableTextEnvelope } from '../src/tests/fixtures/variableReply';
import { mkdir } from 'node:fs/promises';

const endpoint = 'https://disabled-stage.mock.invalid';
const guide = [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: '2015-06-01T08:00:00+08:00', endAt: '2015-06-01T08:03:00+08:00' }) }];
const narrative = '【旁白】林舟平静地站在门口，望着街边行人。';
function text(opening: boolean) { return `<正文>${narrative}</正文><短期记忆>林舟观察行人。</短期记忆><变量规划>${JSON.stringify(opening ? guide : [])}</变量规划>`; }
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const paths = ['/src/services/storage/saveRepository.ts','/src/ui/creation/model.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts'];
    const [{ SaveRepository },{ newCreation, buildCreationState },{ createTurnDraft },{ defaultSettings, settingsKey },{ defaultAiConfig, newChannel, saveAiConfig },{ CredentialVault }] = await Promise.all(paths.map(p => import(p)));
    const settings = defaultSettings(); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    for (const policy of Object.values(settings.memory.summaries) as { automatic: boolean }[]) policy.automatic = false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const channel = newChannel(), config = defaultAiConfig(); channel.baseUrl = 'https://disabled-stage.mock.invalid/v1'; config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    for (const stage of ['entities','variables','world']) config.routes[stage] = { mode: 'independent', channelId: channel.id, modelId: stage };
    saveAiConfig(localStorage,config); new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-disabled-key');
    const state = buildCreationState({ ...newCreation(), person: { name:'林舟',age:'30',gender:'女性',appearance:'',personality:'' },profession:'教师' },settings);
    state.saveId = 'pure-novel'; const repo = await SaveRepository.open();
    try { await repo.create(state); await repo.saveDraft(createTurnDraft(state.saveId,0,'opening','opening',''),null); } finally { repo.close(); }
  });
  await page.goto('/#game/pure-novel'); await page.reload(); await expect(page.getByTestId('story-reader')).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => { const p='/src/services/storage/saveRepository.ts', { SaveRepository }=await import(p),repo=await SaveRepository.open(); try { return await repo.loadGame('pure-novel'); } finally { repo.close(); } });
}
async function switches(page: Page, variables: boolean, world: boolean, entities = variables) {
  await openStageSwitches(page);
  await page.getByRole('checkbox',{name:'人物与实体',exact:true}).setChecked(entities);
  await page.getByRole('checkbox',{name:'主角与现场',exact:true}).setChecked(variables);
  await page.getByRole('checkbox',{name:'场外与网络',exact:true}).setChecked(world);
}
async function close(page: Page) {
  await closeWorkflowSheet(page);
  const closeButton = page.getByRole('button',{name:'收起四阶段详情',exact:true});
  if(await closeButton.isVisible())await closeButton.click();
  else if(await page.locator('.workflow-disclosure[open]').isVisible())await page.keyboard.press('Escape');
}
async function start(page: Page) { await page.getByRole('button',{name:'自动生成开局',exact:true}).click(); }
async function waitTurn(page: Page, turn: number) { await expect.poll(async ()=>(await stored(page)).state.turnNumber,{timeout:15000}).toBe(turn); }
async function shot(page: Page, name: string) {
  if(!process.env.DISABLED_STAGE_SHOTS)return;
  await mkdir(process.env.DISABLED_STAGE_SHOTS,{recursive:true});
  await page.screenshot({path:`${process.env.DISABLED_STAGE_SHOTS}/${(page.viewportSize()?.width??0)>900?'desktop':'mobile'}-${name}.png`});
}
async function wire(page: Page, truncated = false) {
  const calls: string[]=[]; let stories=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==endpoint){
      if(route.request().method()==='POST') throw Error(`Unexpected request: ${url.origin}`);
      if(url.hostname==='127.0.0.1'||url.hostname==='localhost')return route.continue();
      return route.abort();
    }
    const request=route.request().postDataJSON(), stage=String(request.model);calls.push(stage);
    let content:string,finish='stop';
    if(stage==='story'){
      stories++;
      if(truncated&&stories===1){content='<正文>林舟平静地站在门口';finish='length';}
      else if(truncated&&stories===2){expect(request.messages.at(-1).content).toContain('【续写】');content=`，望着街边行人。</正文><短期记忆>林舟观察行人。</短期记忆><变量规划>${JSON.stringify(guide)}</变量规划>`;}
      else content=text(stories===1);
    } else if(stage==='entities')content=variableTextEnvelope('<命令></命令>');
    else if(stage==='variables')content=variableTextEnvelope('<说明>林舟平静地观察行人。</说明><命令>set protagonist.emotionText = "平静"</命令>');
    else {expect(stage).toBe('world');content=JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content},finish_reason:finish}]})});
  });return calls;
}

test('开局通过真实开关关闭两阶段，连续三章保存、刷新不收费；重启两阶段后恢复完整流程',async({page})=>{
  await seed(page);const calls=await wire(page);const initial=(await stored(page)).state;
  await switches(page,false,false);await start(page);await waitTurn(page,1);await close(page);
  for(let turn=1;turn<=3;turn++){
    if(turn>1){await page.locator('#player-input').fill(`继续观察第${turn}次`);await page.getByRole('button',{name:'发送',exact:true}).click();await waitTurn(page,turn);}
    const current=await stored(page);
    expect(current.state.revision).toBe(turn);expect(current.state.journal).toHaveLength(turn);expect(current.state.memories.short).toHaveLength(turn);
    expect(current.state.worldClock).toBe('2015-06-01T08:03:00+08:00');expect(current.draft.userInput).toBe('');
    expect(current.draft.variables).toBeUndefined();expect(current.draft.world).toBeUndefined();
    for(const key of ['protagonist','economy','npc','items','organizations','tasks','events'])expect(current.state[key]).toEqual(initial[key]);
    expect(calls).toEqual(Array(turn).fill('story'));
  }
  await shot(page,'three-chapters');await page.reload();await expect(page.locator('#player-input')).toBeEditable();
  expect(calls).toHaveLength(3);await switches(page,true,true);await close(page);
  await page.locator('#player-input').fill('继续看街景');await page.getByRole('button',{name:'发送',exact:true}).click();await waitTurn(page,4);
  expect(calls).toEqual(['story','story','story','story','entities','variables','world']);
  expect((await stored(page)).state.protagonist.emotionText).toBe('平静');
});

test('只关闭World：变量仍严格执行并正式结算，关闭状态可见',async({page})=>{
  await seed(page);const calls=await wire(page);await switches(page,true,false);await start(page);await waitTurn(page,1);
  expect(calls).toEqual(['story','entities','variables']);expect((await stored(page)).state.protagonist.emotionText).toBe('平静');
  await openStageSwitches(page);await expect(page.locator('.workflow-stages>li').nth(3)).toContainText('已跳过');await shot(page,'variables-only');
});

test('只启用场外阶段时直接读取已选正文的合法开局时钟并完成本章',async({page})=>{
  await seed(page);const calls=await wire(page);await switches(page,false,true);await start(page);
  await waitTurn(page,1);
  expect(calls).toEqual(['story','world']);
  expect((await stored(page)).state.protagonist.emotionText).not.toBe('平静');
});

test('纯小说截断不提交，刷新保留，续写完整后一次正式保存',async({page})=>{
  await seed(page);const calls=await wire(page,true);await switches(page,false,false);await start(page);
  await expect.poll(async()=>(await stored(page)).draft?.storyPartial?.continuations).toBe(0);
  expect((await stored(page)).state.turnNumber).toBe(0);await page.reload();
  const diagnostics=page.locator('dialog.mobile-diagnostics-sheet[open]');if(await diagnostics.isVisible())await page.keyboard.press('Escape');
  await expect(page.getByTestId('story-reader')).toContainText('林舟平静地站在门口');expect(calls).toEqual(['story']);await shot(page,'partial');
  await page.getByRole('button',{name:'续写正文',exact:true}).click();await waitTurn(page,1);
  expect(calls).toEqual(['story','story']);expect((await stored(page)).state.journal).toHaveLength(1);await shot(page,'continued');
});

test('自动提交故障后有完成结算入口，重试只提交，不再次生成正文',async({page})=>{
  await seed(page);const calls=await wire(page);
  await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),original=SaveRepository.prototype.commitTurn;
    SaveRepository.prototype.commitTurn=async function(...args:unknown[]){SaveRepository.prototype.commitTurn=original;throw Error(`mock commit failure (${args.length})`);};});
  await switches(page,false,false);await start(page);await expect.poll(async()=>(await stored(page)).draft?.stageStatus.story).toBe('ready');
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    const diagnostics = page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'重试与变更详情'})});
    await expect(diagnostics).toBeVisible();
    await diagnostics.getByRole('button',{name:'关闭资料界面',exact:true}).click();
    await expect(diagnostics).not.toBeVisible();
  }
  await expect(page.getByRole('button',{name:'完成本回合结算',exact:true}).first()).toBeEnabled();
  expect((await stored(page)).state.turnNumber).toBe(0);await page.getByRole('button',{name:'完成本回合结算',exact:true}).first().click();
  await waitTurn(page,1);expect(calls).toEqual(['story']);
});


test('旧完整候选切为纯小说须先CAS应用开关，不能通过发送绕过；不应用关闭阶段旧结果',async({page})=>{
  await seed(page);const initial=(await stored(page)).state,calls=await wire(page);
  await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),original=SaveRepository.prototype.commitTurn;
    SaveRepository.prototype.commitTurn=async function(){SaveRepository.prototype.commitTurn=original;throw Error('mock commit failure');};});
  await switches(page,true,true);await start(page);
  await expect.poll(async()=>(await stored(page)).draft?.stageStatus.world).toBe('ready');
  await expect(page.locator('.workflow-summary')).toContainText('结算失败');
  if((page.viewportSize()?.width??0)<=900){
    const diagnostics=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'重试与变更详情'})});
    await expect(diagnostics).toBeVisible();await diagnostics.getByRole('button',{name:'关闭资料界面',exact:true}).click();
  }
  expect(calls).toEqual(['story','entities','variables','world']);await switches(page,false,false);await close(page);
  await page.locator('#player-input').fill('下一回合的行动');
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'应用阶段设置并继续',exact:true}).click();await waitTurn(page,1);
  const current=await stored(page);expect(current.state.protagonist).toEqual(initial.protagonist);
  expect(current.state.economy).toEqual(initial.economy);expect(current.draft.variables).toBeUndefined();expect(current.draft.world).toBeUndefined();
  expect(calls).toEqual(['story','entities','variables','world']);await expect(page.locator('#player-input')).toBeEditable();
});

test('纯小说双标签由Web Locks阻止第二次请求；取消后迟到响应不提交',async({page,context})=>{
  await seed(page);await switches(page,false,false);
  const second=await context.newPage();const secondCalls=await wire(second);
  await second.goto('/#game/pure-novel');await expect(second.getByTestId('story-reader')).toBeVisible();
  await second.evaluate(async()=>{const c='/src/services/ai/configuration.ts',v='/src/services/ai/credentials.ts';
    const {readAiConfig}=await import(c),{CredentialVault}=await import(v);
    new CredentialVault(sessionStorage,localStorage).set(readAiConfig(localStorage).channels[0].id,'mock-disabled-key');});
  await openStageSwitches(second);
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  await page.route(`${endpoint}/**`,async route=>{calls++;await hold;await route.fulfill({json:{choices:[{message:{content:text(true)},finish_reason:'stop'}]}}).catch(()=>undefined);});
  const before=(await stored(page)).state;await start(page);await expect.poll(()=>calls).toBe(1);
  await start(second);await expect(second.locator('.workflow-summary')).toContainText('失败');
  expect(secondCalls).toEqual([]);expect((await stored(page)).state).toEqual(before);
  await page.getByRole('button',{name:'取消自动执行',exact:true}).click();release();
  await expect(page.getByRole('button',{name:'取消自动执行',exact:true})).toBeHidden();
  expect((await stored(page)).draft?.stageStatus.story).toBe('pending');
  await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();
  expect((await stored(page)).state).toEqual(before);expect((await stored(page)).draft?.story).toBeUndefined();
  expect(calls).toBe(1);expect(secondCalls).toEqual([]);await second.close();
});

test('纯小说缺少Web Locks零请求，保留原草稿和输入并显示明确提示',async({page})=>{
  await seed(page);const calls=await wire(page);await switches(page,false,false);const before=await stored(page);
  await page.evaluate(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
  await page.locator('#player-input').fill('不应丢失的行动');await start(page);
  await expect(page.getByText(/当前浏览器无法使用 Web Locks/).first()).toBeVisible();
  expect(calls).toEqual([]);expect(await stored(page)).toEqual(before);
  await expect(page.locator('#player-input')).toHaveValue('不应丢失的行动');
});
