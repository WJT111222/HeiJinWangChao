import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openGameTools } from './helpers/gameLayout';
import { worldResult, proof } from '../src/tests/fixtures/world';

async function prepare(page:Page,major=false) {
  await page.goto('/');
  const data=await page.evaluate(async(major)=>{
    const storage='/src/services/storage/saveRepository.ts',world='/src/tests/fixtures/world.ts',fixtures='/src/tests/fixtures/game.ts',turn='/src/tests/fixtures/turn.ts',
      configPath='/src/services/ai/configuration.ts',vaultPath='/src/services/ai/credentials.ts';
    const {SaveRepository}=await import(storage),{worldState}=await import(world),{event}=await import(fixtures),{completeDraft}=await import(turn),
      {defaultAiConfig,newChannel,saveAiConfig}=await import(configPath),{CredentialVault}=await import(vaultPath);
    const config=defaultAiConfig(),channel=newChannel();channel.baseUrl='https://events.mock.invalid/v1';channel.defaultModel='world';
    config.channels=[channel];config.routes.story={channelId:channel.id,modelId:'story'};config.routes.world={mode:'independent',channelId:channel.id,modelId:'world'};
    saveAiConfig(localStorage,config);new CredentialVault(sessionStorage,localStorage).set(channel.id,'mock-only-secret');
    const state=worldState();state.events.review={...event('review'),title:'内部清点',status:'active',backgroundText:'诊室值班清点',goalText:'清点完成',
      actorRefs:[{kind:'npc',id:'npc-a'}],estimatedEndAt:'2026-10-18T08:05:00+08:00',impact:major?'major':'minor',sourceTurnIds:[]};
    const repo=await SaveRepository.open();try{await repo.create(state);const draft=await completeDraft(repo);return {state,draft};}finally{repo.close();}
  },major);
  await page.goto('/#game/save-a');await openGameTools(page);return data;
}
async function stored(page:Page){return page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{return await repo.loadGame('save-a');}finally{repo.close();}});}
function endResult(data:Awaited<ReturnType<typeof prepare>>) {
  const text='同事完成内部清点并封存清单。';
  return {...worldResult(),eventCommands:[
    {type:'SaveEvent',commandId:'end-review',event:{...data.state.events.review,status:'resolved',resolvedAt:'2026-10-18T08:05:00+08:00',resolutionText:text,outcome:'success',sourceTurnIds:[data.draft.turnId]},
      evidence:proof({sources:['event:review','npc:npc-a'],fact:text,decision:{targetId:'review',status:'resolved',reason:'按工作安排完成清点',result:text,conditionsSatisfied:true,continues:false,resultKnowledge:{facts:[text],reported:[],suspected:[]}}})},
    {type:'DeleteEvent',commandId:'clean-review',eventId:'review',expectedStatus:'resolved',reason:'结束完整排程',evidence:proof({at:'2026-10-18T08:06:00+08:00',sources:['event:review'],fact:'事毕清理完整记录。',decision:{targetId:'review',status:'retired',reason:'事毕',result:'只保留必要引用',conditionsSatisfied:true,continues:false}})},
  ]};
}
for(const major of [false,true])test(`到期${major?'隐藏重大':'普通'}事件：候选、刷新、原子清理及幂等`,async({page},info)=>{
  const data=await prepare(page,major);let calls=0;
  await page.route('https://events.mock.invalid/**',async route=>{calls++;const body=route.request().postData()??'';expect(body).toContain('EVENT_SCHEDULE');expect(body).toContain('estimatedEndAt');
    await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(endResult(data))},finish_reason:'stop'}]})});});
  await page.getByRole('button',{name:/^(?:重新)?生成世界候选$/}).click();
  await expect(page.getByRole('region',{name:'三阶段工作流'})).toContainText('世界已完成 · 候选未正式结算');
  expect((await stored(page)).state).toEqual(data.state);await expect(page.locator('main')).not.toContainText('封存清单');
  await page.reload();await openGameTools(page);expect(calls).toBe(1);expect((await stored(page)).state).toEqual(data.state);
  const committed=await page.evaluate(async()=>{const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();try{
    const draft=await repo.loadDraft('save-a'),input={draft,nextAction:'稍作休息',useVariableStage:true,useWorldStage:true};return {first:await repo.commitTurn(input),replay:await repo.commitTurn(input)};
  }finally{repo.close();}});
  expect(committed.first.state.events.review).toBeUndefined();expect(committed.first.state.retiredEvents.review.status).toBe('resolved');
  expect(Boolean(committed.first.state.retiredEvents.review.detail)).toBe(major);expect(committed.first.state.timeline).toEqual([]);expect(committed.replay.replayed).toBe(true);
  await page.reload();expect((await stored(page)).state).toEqual(committed.first.state);expect(calls).toBe(1);
  await expect(page.locator('main')).not.toContainText('封存清单');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('event-lifecycle.png'),fullPage:true});
});
test('未处理到期事件不能伪装World成功，合法重试仍仅保存候选',async({page})=>{
  const data=await prepare(page);let calls=0;
  await page.route('https://events.mock.invalid/**',async route=>{calls++;await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?worldResult():endResult(data))},finish_reason:'stop'}]})});});
  await page.getByRole('button',{name:/^(?:重新)?生成世界候选$/}).click();await expect(page.getByRole('alert')).toBeVisible();expect(calls).toBe(1);expect((await stored(page)).state).toEqual(data.state);
  await page.getByRole('button',{name:/^(?:重新)?生成世界候选$/}).click();await expect(page.getByRole('region',{name:'三阶段工作流'})).toContainText('世界已完成 · 候选未正式结算');
  expect(calls).toBe(2);expect((await stored(page)).state).toEqual(data.state);
});
