import { test,expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedRoster,rosterGame } from './helpers/npcRoster';
import { openGameTools } from './helpers/gameLayout';
import { worldNpcCreationBatch } from '../src/tests/fixtures/worldNpcCreation';
import { fullPrivateProfile } from '../src/tests/fixtures/npcUnified';

async function seed(page:Page){
 await seedRoster(page);
 await page.evaluate(async()=>{
  const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();const state=await repo.load('save-a');repo.close();
  state.locations.china={id:'china',name:'中国'};state.locations.chongqing.parentId='china';state.locations['overseas-country']={id:'overseas-country',name:'瑞士'};
  await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('heijinwangchao');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(state);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
 });
 await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function mock(page:Page,bad=false){
 const control={bad},calls:string[]=[];
 await page.route('https://summary.mock.invalid/**',async route=>{
  const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
  const raw=body.messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>')).content,ctx=JSON.parse(raw.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));
  if(stage==='story'){
   const text='<thinking>承接当前背景。</thinking><正文>【旁白】主角继续日常工作，远方的亲属处理自己的事务，等待下一封消息。</正文><短期记忆>继续日常。</短期记忆><变量规划>[]</变量规划>';
   await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`});return;
  }
  let content:string;
  if(stage==='variables')content=`<thinking>只推进实际时间。</thinking><说明></说明><命令>set worldClock = "${new Date(Date.parse(ctx.SAVE_STATE.worldClock)+600000).toISOString()}"</命令>`;
  else{
   const prompt=body.messages.map((m:{content:string})=>m.content).join('\n');expect(prompt).toContain('affinityConfirmed必须省略');expect(prompt).toContain('男性特殊NPC不得携带privateProfile');
   const createSchema=ctx.COMMAND_CATALOG.schema.oneOf.find((s:{properties:{type:{const:string}}})=>s.properties.type.const==='CreateNpc');
   for(const variant of createSchema.properties.npc.oneOf??createSchema.properties.npc.anyOf){expect(variant.properties.affinityConfirmed).toBeUndefined();expect(variant.properties.affinity.const).toBe(0);}
   const response=worldNpcCreationBatch().result;
   for(const c of response.worldCommands){if(c.type==='CreateNpc'&&c.npc.id==='remote-relative'&&control.bad)c.npc.affinityConfirmed=true;if(c.type==='RecordNpcMemory'){c.expectedRevision=ctx.BASE_SAVE_REVISION;c.memory.sourceTurnIds=[ctx.TURN_CONTEXT.turnId];}}
   for(const c of response.eventCommands)if(c.type==='SaveEvent')c.event.sourceTurnIds=[ctx.TURN_CONTEXT.turnId];
   content=JSON.stringify(response);
  }
  await route.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}});
 });
 return {control,calls};
}

test('真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样',async({page})=>{
 await seed(page);const before=await rosterGame(page),server=await mock(page);
 await page.getByLabel('你的行动',{exact:true}).fill('继续处理日常消息');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await rosterGame(page)).state.turnNumber,{timeout:20000}).toBe(before.state.turnNumber+1);
 const saved=await rosterGame(page);
 expect(saved.state.npc['new-ordinary']).toMatchObject({kind:'ordinary',onScene:false,affinity:0});expect(saved.state.npc['remote-relative']).toMatchObject({kind:'special',gender:'male',affinity:0});
 expect(saved.state.npc['remote-relative']).not.toHaveProperty('privateProfile');expect(saved.state.npc['new-woman']).toMatchObject({kind:'special',gender:'female',privateProfile:fullPrivateProfile});
 for(const id of ['new-ordinary','remote-relative','new-woman'])expect(saved.state.npc[id].affinityConfirmed).toBeUndefined();
 for(const [id,npc] of Object.entries(before.state.npc))expect(saved.state.npc[id]).toEqual(npc);
 expect(saved.state.memories.npcSummaries).toEqual(before.state.memories.npcSummaries);expect(saved.state.protagonist).toEqual(before.state.protagonist);expect(saved.state.economy).toEqual(before.state.economy);
 expect(saved.state.tasks['remote-duty']).toMatchObject({actorRef:{id:'remote-relative'},linkedEventId:'remote-main'});
 expect(saved.state.organizations['remote-company'].keyNpcIds).toEqual(['remote-relative','new-ordinary','new-woman']);
 expect(saved.state.locations['overseas-city'].parentId).toBe('overseas-country');expect(saved.state.events['remote-sub']).toMatchObject({parentEventId:'remote-main',protagonistEntry:{status:'pending'}});
 expect(server.calls).toEqual(['story','variables','world']);await page.reload();await expect(page.locator('.game-layout')).toBeVisible();expect((await rosterGame(page)).state).toEqual(saved.state);expect(server.calls).toHaveLength(3);
});

test('非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算',async({page})=>{
 await seed(page);const before=await rosterGame(page),server=await mock(page,true);
 await page.getByLabel('你的行动',{exact:true}).fill('等待新的消息');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await rosterGame(page)).draft?.stageStatus.world,{timeout:20000}).toBe('failed');
 const failed=await rosterGame(page);expect(failed.state).toEqual(before.state);expect(failed.draft.story).toBeDefined();expect(failed.draft.variables.validation).toBe('validated');expect(failed.draft.world).toBeUndefined();expect(server.calls).toEqual(['story','variables','world']);
 await openGameTools(page);await expect(page.getByTestId('runtime-log')).toContainText('actor_permission');await expect(page.getByTestId('runtime-log')).toContainText('CreateNpc');
 server.control.bad=false;await page.getByRole('button',{name:'继续未完成阶段',exact:true}).click();
 await expect.poll(async()=>(await rosterGame(page)).state.turnNumber,{timeout:20000}).toBe(before.state.turnNumber+1);
 const saved=await rosterGame(page);expect(saved.state.journal.at(-1).story).toEqual(failed.draft.story);expect(server.calls).toEqual(['story','variables','world','world']);expect(Date.parse(saved.state.worldClock)-Date.parse(before.state.worldClock)).toBe(600000);
});
