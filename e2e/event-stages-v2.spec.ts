import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';
async function seed(page:Page,clock?:string,unseen=false) {
  await page.goto('/');
  const response=await page.evaluate(async({clock,unseen})=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/eventStages.ts','/src/domain/drafts.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/ui/settings/model.ts'];
    const [{SaveRepository},{stageContext,endStage,stageCommand},{createTurnDraft,rerollStory},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault},{defaultSettings,settingsKey}]=await Promise.all(paths.map(path=>import(path)));
    const settings=defaultSettings();settings.prompts.minNarrativeChars=1;settings.prompts.actionOptions=false;
    for(const value of Object.values(settings.memory.summaries) as {automatic:boolean}[])value.automatic=false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const config=defaultAiConfig(),channel=newChannel();channel.baseUrl='https://event-stages.mock.invalid/v1';channel.defaultModel='world-stage-mock';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'story'};config.routes.variables={mode:'independent',channelId:channel.id,modelId:'variables'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};saveAiConfig(localStorage,config);
    new CredentialVault(sessionStorage,localStorage).set(channel.id,'stage-browser-test-only');
    const a=stageContext(clock),repo=await SaveRepository.open();
    if(unseen){const stage=a.state.events['stage-one'];stage.sourceTurnIds=[a.draft.turnId];stage.protagonistEntry={id:'unseen-stage-entry',sourceTurnId:a.draft.turnId,queuedAt:a.state.worldClock,channel:'电话',cue:'尚未呈现的旧安排',status:'pending'};}
    try {await repo.create(a.state);const initial=createTurnDraft('save-a',0,a.draft.turnId,'opening','');await repo.saveDraft(initial,null);await repo.saveDraft(rerollStory(initial,a.draft.story),0);await repo.saveDraft({...a.draft,draftRevision:2},1);}finally{repo.close();}
    return {...a.response,eventCommands:[stageCommand(endStage(a.state.events['stage-one'])),{type:'DeleteEvent',commandId:'cleanup-stage',eventId:'stage-one',expectedStatus:'resolved',reason:'阶段成果保留后清理',evidence:'合成测试'}]};
  },{clock,unseen});
  await page.goto('/#game/save-a');await page.reload();await openGameTools(page);return response;
}
const stored=(page:Page)=>page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});
for(const firstFailure of [false,true])test(`固定阶段积压结算保留原时刻并退役，${firstFailure?'失败仅重试World':'直接自动提交'}后刷新不重复请求`,async({page})=>{
  const response=await seed(page),initial=await stored(page);let invalid=firstFailure,calls=0;
  await page.route('https://event-stages.mock.invalid/**',async route=>{
    calls++;const reply=structuredClone(response);
    if(invalid)delete reply.eventCommands[0].event.outcome;
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(reply)},finish_reason:'stop'}]})});
  });
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  if(firstFailure){
    await expect(page.getByTestId('runtime-log')).toContainText('stage_result');
    const failed=await stored(page);expect(failed.state).toEqual(initial.state);expect(failed.draft.story).toEqual(initial.draft.story);expect(failed.draft.variables).toEqual(initial.draft.variables);
    expect(calls).toBe(1);await page.reload();await openGameTools(page);expect(calls).toBe(1);invalid=false;
    await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  }
  await expect(page.getByRole('region',{name:'三阶段工作流'}).getByRole('status')).toContainText('本回合已结算');
  const saved=await stored(page);expect(saved.state.events['stage-one']).toBeUndefined();
  expect(saved.state.retiredEvents['stage-one'].detail).toMatchObject({resolvedAt:'2027-01-03T00:00:00+08:00',outcome:'success',resolutionText:expect.any(String),resultKnowledge:{reported:['值班人员提出另一种说法']}});
  expect(saved.state.events['main-stage']).toEqual(initial.state.events['main-stage']);expect(saved.state.worldClock).toBe('2027-04-01T00:00:00+08:00');
  expect(calls).toBe(firstFailure?2:1);await page.reload();await openGameTools(page);
  expect((await stored(page)).state).toEqual(saved.state);expect(calls).toBe(firstFailure?2:1);await expect(page.getByLabel('你的行动',{exact:true})).toHaveValue('');
});

test('真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用',async({page})=>{
  const response=await seed(page,'2027-01-02T00:00:00+08:00'),calls:string[]=[];let worlds=0;
  const invited={...response.eventCommands[0].event,id:'early-invited',title:'提前入场的阶段',status:'active',continuation:{direction:'protagonist',reason:'现在需要电话核对',entry:{channel:'电话',cue:'请核对本阶段材料'}}};
  for(const key of ['resolvedAt','outcome','resolutionText','resultKnowledge'])delete invited[key];
  await page.route('https://event-stages.mock.invalid/**',async route=>{
    const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
    const joined=body.messages.map((m:{content:string})=>m.content).join('\n'),matched=joined.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/);if(!matched)throw Error('missing final context');
    const context=JSON.parse(matched[1]);let text:string;
    if(stage==='story') {
      const entry=context.EVENT_ENTRIES.find((e:{eventId:string})=>e.eventId==='early-invited');expect(entry).toBeTruthy();
      text=`<thinking>按玩家行动处理当前来电。</thinking><正文>【旁白】主角在通话中实际核对并结束了本阶段。</正文><短期记忆>主角已经完成本次核对。</短期记忆><变量规划>${JSON.stringify([{group:'event',observedFact:'阶段实际结束',textEvidence:'通话中核对完成',eventInteraction:{eventId:'early-invited',entryId:entry.entryId,action:'left'}}])}</变量规划>`;
    } else if(stage==='variables') {
      text='<thinking>只落实本幕现场变化。</thinking><说明>实际提前结束本阶段。</说明><命令>set worldClock = "2027-01-02T01:00:00+08:00"\nset events[early-invited].sceneState = {"status":"resolved","resolvedAt":"2027-01-02T01:00:00+08:00","outcome":"changed","resolutionText":"主角实际核对并结束了阶段。"}</命令>';
    } else {
      worlds++;if(worlds===2)expect(context.SAVE_STATE.events['early-invited'].status).toBe('resolved');
      text=JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:worlds===1?[{type:'SaveEvent',commandId:'invite-stage',event:invited,evidence:'真实开始的合成阶段'}]:[],visibleHooks:[],unresolved:[]});
    }
    await route.fulfill({contentType:stage==='story'?'text/event-stream':'application/json',body:stage==='story'?`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`:JSON.stringify({choices:[{message:{content:text},finish_reason:'stop'}]})});
  });
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  expect((await stored(page)).state.events['early-invited'].protagonistEntry.status).toBe('pending');
  await page.getByLabel('你的行动',{exact:true}).fill('接听并结束本阶段');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(2);
  const data=await stored(page);expect(data.state.events['early-invited']).toMatchObject({resolvedAt:'2027-01-02T01:00:00+08:00',fixedEndAt:'2027-01-03T00:00:00+08:00',outcome:'changed',protagonistEntry:{status:'left'}});
  expect(calls).toEqual(['world','story','variables','world']);await page.reload();expect(calls).toHaveLength(4);
});

test('阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应',async({page})=>{
  const response=await seed(page,undefined,true),before=await stored(page);let calls=0;
  await page.route('https://event-stages.mock.invalid/**',async route=>{calls++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(response)},finish_reason:'stop'}]})});});
  await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
  await expect.poll(async()=>(await stored(page)).state.turnNumber).toBe(1);
  const saved=await stored(page);expect(saved.state.events['stage-one']).toBeUndefined();expect(saved.state.retiredEvents['stage-one'].detail.outcome).toBe('success');
  expect(Object.values(saved.state.events).some((e:unknown)=>Boolean((e as {protagonistEntry?:unknown}).protagonistEntry))).toBe(false);
  expect(saved.state.protagonist).toEqual(before.state.protagonist);expect(calls).toBe(1);await page.reload();expect((await stored(page)).state).toEqual(saved.state);expect(calls).toBe(1);
});
