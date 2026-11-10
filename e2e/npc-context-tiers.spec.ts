import { test,expect } from './helpers/test';
import { seedSummary,summaryState } from './helpers/memorySummary';

function profiles(value:unknown,id:string):number{
 if(!value||typeof value!=='object')return 0;
 const self=!Array.isArray(value)&&'id'in value&&value.id===id&&'onScene'in value?1:0;
 return self+Object.values(value).reduce<number>((sum,v)=>sum+profiles(v,id),0);
}

test('真实三阶段四级唯一注入、合法离返场与后台任务、Commit及刷新不改完整档案',async({page})=>{
 const calls:string[]=[],received:Record<string,unknown>[]=[];
 await page.route('https://summary.mock.invalid/**',async route=>{
  const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
  const raw=body.messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>')).content;
  const c=JSON.parse(raw.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));received.push(c);
  const data=c.SAVE_STATE;
  expect(Object.keys(data.npc)).toHaveLength(10);expect(c).not.toHaveProperty('NPC_KNOWLEDGE');expect(c).not.toHaveProperty('SCENE_NPCS');
  expect(profiles(c,'scene-ordinary')).toBe(1);expect(profiles(c,'off-special')).toBe(1);
  expect(data.npc['tier-npc-6'].memories).toHaveLength(20);expect(data.npc['tier-npc-6']).not.toHaveProperty('background');
  expect(data.npc['tier-npc-6'].usualLocations[0].knownToProtagonist).toBe(false);
  if(stage==='story'){
   expect(c.NPC_CONTEXT.groups.sceneOrdinary).toContain('scene-ordinary');expect(c.NPC_CONTEXT.groups.offsceneSpecial).toContain('off-special');
   const text=`<thinking>承接人物与工作。</thinking><正文>【旁白】${data.npc['scene-ordinary'].name}离开现场去处理合作事务，${data.npc['off-special'].name}回到现场交流工作。</正文><短期记忆>人员离返场并继续工作。</短期记忆><变量规划>[]</变量规划>`;
   await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`});return;
  }
  let content:string;
  if(stage==='variables'){
   expect(c.NPC_CONTEXT.groups.sceneOrdinary).toContain('scene-ordinary');expect(c.NPC_IMPORTANCE).toEqual(expect.arrayContaining([expect.objectContaining({npcId:'scene-ordinary'})]));
   content='<thinking>记录实际离返场。</thinking><说明></说明><命令>\nset npc[scene-ordinary].onScene = false\nset npc[off-special].locationId = "chongqing"\nset npc[off-special].onScene = true\n</命令>';
  }else{
   expect(stage).toBe('world');expect(c.NPC_CONTEXT.groups.offsceneOrdinary).toContain('scene-ordinary');expect(c.NPC_CONTEXT.groups.sceneSpecial).toContain('off-special');
   expect(c.PROTECTED_SCENE.sceneNpcIds).toContain('off-special');expect(c.OFFSCREEN_STATE.npcIds).toContain('scene-ordinary');expect(c.OFFSCREEN_STATE).not.toHaveProperty('npc');
   expect(data.revision).toBe(c.BASE_SAVE_REVISION);expect(data.revision).toBe(c.TURN_CONTEXT.baseSaveRevision);
   content=JSON.stringify({worldCommands:[],taskCommands:[{type:'SaveTask',commandId:'new-independent-task',evidence:'离场后处理合作事务',task:{id:'new-independent-task',actorRef:{kind:'npc',id:'scene-ordinary'},goal:'继续处理合作事务',startAt:data.worldClock,dueAt:new Date(Date.parse(data.worldClock)+3600000).toISOString(),status:'active',locationId:'chongqing',prerequisites:[],blockers:[]}}],eventCommands:[],visibleHooks:[],unresolved:[]});
  }
  await route.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}});
 });
 await seedSummary(page,{count:10,automatic:false});
 const before=await page.evaluate(async()=>{
  const paths=['/src/tests/fixtures/npcContextTiers.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts'];
  const [{npcContextFixture},{SaveRepository},{createTurnDraft}]=await Promise.all(paths.map(p=>import(p))),a=npcContextFixture(),repo=await SaveRepository.open();
  try{
   await new Promise<void>((resolve,reject)=>{const open=indexedDB.open('heijinwangchao');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(a.state);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};});
   await repo.saveDraft(createTurnDraft(a.state.saveId,a.state.revision,'tier-browser-turn','regular',''),null);return a.state;
  }finally{repo.close();}
 });
 await page.goto('/#game/'+before.saveId);await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
 await page.getByLabel('你的行动',{exact:true}).fill('继续普通交流');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await summaryState(page,before.saveId)).turnNumber,{timeout:20000}).toBe(before.turnNumber+1);
 const saved=await summaryState(page,before.saveId);expect(saved.npc['scene-ordinary'].onScene).toBe(false);expect(saved.npc['off-special'].onScene).toBe(true);
 expect(saved.tasks['new-independent-task'].actorRef).toEqual({kind:'npc',id:'scene-ordinary'});
 expect(saved.npc['tier-npc-6']).toEqual(before.npc['tier-npc-6']);expect(saved.npc['tier-npc-6'].memories).toHaveLength(40);expect(saved.memories.npcSummaries).toEqual(before.memories.npcSummaries);
 expect(calls).toEqual(['story','variables','world']);expect(received).toHaveLength(3);
 await page.reload();await expect(page.locator('.game-layout')).toBeVisible();expect(await summaryState(page,before.saveId)).toEqual(saved);expect(calls).toHaveLength(3);
});
