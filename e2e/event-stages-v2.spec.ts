import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';
async function seed(page:Page) {
  await page.goto('/');
  const response=await page.evaluate(async()=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/eventStages.ts','/src/domain/drafts.ts','/src/services/ai/configuration.ts','/src/services/ai/credentials.ts','/src/ui/settings/model.ts'];
    const [{SaveRepository},{stageContext,endStage,stageCommand},{createTurnDraft,rerollStory},{defaultAiConfig,newChannel,saveAiConfig},{CredentialVault},{defaultSettings,settingsKey}]=await Promise.all(paths.map(path=>import(path)));
    const settings=defaultSettings();settings.prompts.minNarrativeChars=1;
    for(const value of Object.values(settings.memory.summaries) as {automatic:boolean}[])value.automatic=false;
    localStorage.setItem(settingsKey,JSON.stringify(settings));
    const config=defaultAiConfig(),channel=newChannel();channel.baseUrl='https://event-stages.mock.invalid/v1';channel.defaultModel='world-stage-mock';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'world-stage-mock'};saveAiConfig(localStorage,config);
    new CredentialVault(sessionStorage,localStorage).set(channel.id,'stage-browser-test-only');
    const a=stageContext(),repo=await SaveRepository.open();
    try {await repo.create(a.state);const initial=createTurnDraft('save-a',0,a.draft.turnId,'opening','');await repo.saveDraft(initial,null);await repo.saveDraft(rerollStory(initial,a.draft.story),0);await repo.saveDraft({...a.draft,draftRevision:2},1);}finally{repo.close();}
    return {...a.response,eventCommands:[stageCommand(endStage(a.state.events['stage-one'])),{type:'DeleteEvent',commandId:'cleanup-stage',eventId:'stage-one',expectedStatus:'resolved',reason:'阶段成果保留后清理',evidence:'合成测试'}]};
  });
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
