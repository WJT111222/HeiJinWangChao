import { openNpcRoster, closeNpcRoster, selectNpc, rosterGame } from './helpers/npcRoster';
import { expect, test } from './helpers/test';
import type { Page } from '@playwright/test';
import { seedSummary, summaryState } from './helpers/memorySummary';

const profile={detailedBackground:'在海边长大，学习设计后进入工作室，仍与家人保持联系。',activeGoals:['完成一项长期合作'],habits:['随身记录灵感'],offscreenTaskIds:[],relationshipNetwork:[{name:'顾林',relationship:'旧同学',description:'偶尔联系',affinity:null}]};
async function seedPlayable(page:Page){
 await seedSummary(page,{count:10,npcCount:3,automatic:false});
 await page.evaluate(async()=>{
  const r='/src/services/storage/saveRepository.ts',d='/src/domain/drafts.ts';
  const {SaveRepository}=await import(r),{createTurnDraft}=await import(d),repo=await SaveRepository.open();
  try{const {state,draft}=await repo.loadGame('save-a');if(!draft)await repo.saveDraft(createTurnDraft(state.saveId,state.revision,`turn-${crypto.randomUUID()}`,'regular',''),null);}finally{repo.close();}
 });
 await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
}
async function manage(page:Page,choice:'ordinary'|'special'){
 const before = await rosterGame(page), name = before.state.npc['npc-a'].name;
 await openNpcRoster(page); const detail = await selectNpc(page, name);
 await detail.getByRole('button', { name: `${choice === 'special' ? '设为特殊人物' : '取消特殊身份'}：${name}`, exact:true }).click();
 await expect.poll(async () => (await rosterGame(page)).state.npc['npc-a'].kind).toBe(choice);
 await closeNpcRoster(page);
 return rosterGame(page);
}
async function mock(page:Page){
 const calls:string[]=[],contexts:Record<string,unknown>[]=[];
 await page.route('https://summary.mock.invalid/**',async route=>{
  const body=route.request().postDataJSON(),stage=String(body.model);calls.push(stage);
  const text=body.messages.find((m:{content:string})=>m.content.startsWith('<GAME_CONTEXT>')).content;
  const context=JSON.parse(text.slice('<GAME_CONTEXT>\n'.length,-'\n</GAME_CONTEXT>'.length));contexts.push(context);
  expect(JSON.stringify(body)).not.toContain('mock-summary-secret');
  if(stage==='story'){
   const story='<thinking>承接已有关系。</thinking><正文>【旁白】对方谈起海边的成长经历、设计工作和家人，提出长期合作，留下可用电话并介绍工作地点。</正文><短期记忆>深入交谈并约定合作。</短期记忆><变量规划>[]</变量规划>';
   await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:story}}]})}\n\ndata: [DONE]\n\n`});return;
  }
  const owner=context.SAVE_STATE.npc['npc-a'];
  const commands=stage==='variables'&&owner.importancePreference!=='ordinary'?
    `set npc[npc-a].specialProfile = ${JSON.stringify(profile)}\nset npc[npc-a].phoneContact = {"status":"known","note":"本人提供可用联系方式"}\nset npc[npc-a].usualLocations = [{"locationId":"${context.SAVE_STATE.protagonist.locationId}","role":"work","knownToProtagonist":true}]`:'';
  const content=stage==='variables'?`<thinking>依据正文更新。</thinking><说明></说明><命令>\n${commands}\n</命令>`:JSON.stringify({worldCommands:[],taskCommands:[],eventCommands:[],visibleHooks:[],unresolved:[]});
  await route.fulfill({json:{choices:[{message:{content},finish_reason:'stop'}]}});
 });return {calls,contexts};
}

test('真实发送自动升级→玩家取消→下一回合不重新升级→恢复原档案，刷新不额外请求',async({page})=>{
 const {calls,contexts}=await mock(page);await seedPlayable(page);
 const before=await summaryState(page);await page.getByLabel('你的行动',{exact:true}).fill('继续了解对方并讨论合作');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await summaryState(page)).turnNumber,{timeout:15000}).toBe(before.turnNumber+1);
 const upgraded=await summaryState(page);expect(upgraded.npc['npc-a']).toMatchObject({kind:'special',detailedBackground:profile.detailedBackground,phoneContact:{status:'known'}});
 expect(upgraded.npc['npc-a'].identityKey).toBe(before.npc['npc-a'].identityKey);expect(upgraded.npc['npc-a'].memories).toEqual(before.npc['npc-a'].memories);expect(calls).toEqual(['story','variables','world']);
 await manage(page,'ordinary');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
 expect((await summaryState(page)).npc['npc-a'].kind).toBe('ordinary');expect(calls).toHaveLength(3);
 await page.getByLabel('你的行动',{exact:true}).fill('与对方继续普通交谈');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await summaryState(page)).turnNumber,{timeout:15000}).toBe(before.turnNumber+2);
 const ordinary=await summaryState(page);expect(ordinary.npc['npc-a'].importancePreference).toBe('ordinary');expect(ordinary.npc['npc-a'].kind).toBe('ordinary');
 const context=contexts.filter(c=>c.NPC_IMPORTANCE).at(-1)!;expect(context.NPC_IMPORTANCE).toEqual(expect.arrayContaining([expect.objectContaining({npcId:'npc-a',playerPreference:'ordinary',canRestoreProfile:true})]));
 expect(JSON.stringify(context)).not.toContain(profile.detailedBackground);
 const restored=await manage(page,'special');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
 expect(restored.state.npc['npc-a']).toEqual({...upgraded.npc['npc-a'],importancePreference:'special'});expect(restored.state.turnNumber).toBe(ordinary.turnNumber);expect(restored.state.worldClock).toBe(ordinary.worldClock);expect(calls).toEqual(['story','variables','world','story','variables','world']);
});

test('玩家首升立即持久化待完善，正常Variables补齐且没有独立资料AI请求',async({page})=>{
 const {calls,contexts}=await mock(page);await seedPlayable(page);const before=await summaryState(page);
 const pending=await manage(page,'special');expect(pending.state.npc['npc-a']).toMatchObject({kind:'special',profilePending:true,detailedBackground:'',importancePreference:'special'});expect(calls).toEqual([]);
 await page.reload();await expect(page.locator('.game-layout')).toBeVisible();expect((await summaryState(page)).npc['npc-a'].profilePending).toBe(true);
 await page.getByLabel('你的行动',{exact:true}).fill('听对方讲述经历并建立合作');await page.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(async()=>(await summaryState(page)).turnNumber,{timeout:15000}).toBe(before.turnNumber+1);
 const saved=await summaryState(page);expect(saved.npc['npc-a']).not.toHaveProperty('profilePending');expect(saved.npc['npc-a'].detailedBackground).toBe(profile.detailedBackground);
 expect(contexts.find(c=>c.NPC_IMPORTANCE)!.NPC_IMPORTANCE).toEqual(expect.arrayContaining([expect.objectContaining({npcId:'npc-a',profilePending:true,playerPreference:'special'})]));
 expect(calls).toEqual(['story','variables','world']);await page.reload();await expect(page.locator('.game-layout')).toBeVisible();expect(await summaryState(page)).toEqual(saved);expect(calls).toHaveLength(3);
});

test('双标签页管理CAS与待输入草稿持久化，操作不发请求也不推进时间',async({page,context})=>{
 const calls:string[]=[];await context.route('https://**/*',route=>{calls.push(route.request().url());return route.abort();});await seedPlayable(page);
 const before=await summaryState(page);const old=await page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{const {state,draft}=await repo.loadGame('save-a');return {saveId:state.saveId,expectedRevision:state.revision,expectedManagementRevision:state.npcManagementRevision??0,expectedDraftRevision:draft?.draftRevision,expectedTurnId:draft?.turnId,npcId:'npc-a',identityKey:state.npc['npc-a'].identityKey,choice:'special' as const,operationId:'stale-tab'};}finally{repo.close();}});
 const other=await context.newPage();await other.goto('/#game/save-a');await expect(other.locator('.game-layout')).toBeVisible();await manage(other,'special');
 const code=await page.evaluate(async request=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),repo=await SaveRepository.open();try{await repo.setNpcImportance(request);return 'unexpected-success';}catch(e){return (e as {code:string}).code;}finally{repo.close();}},old);expect(code).toBe('REVISION_CONFLICT');
 await page.reload();await expect(page.locator('.game-layout')).toBeVisible();const saved=await summaryState(page);expect(saved.npcManagementRevision).toBe(1);expect(saved.worldClock).toBe(before.worldClock);expect(saved.revision).toBe(before.revision);expect(saved.journal).toEqual(before.journal);expect(calls).toEqual([]);
});
