import { test, expect } from './helpers/test';
import type { Page } from '@playwright/test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fullPrivateProfile } from '../src/tests/fixtures/npcUnified';

async function read(page:Page) {
  return page.evaluate(async()=>{
    const path='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(path),repo=await SaveRepository.open();
    try{return await repo.loadGame('save-a');}finally{repo.close();}
  });
}
async function seed(page:Page,version:6|7) {
  return page.evaluate(async version=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/tests/fixtures/npcUnified.ts','/src/domain/drafts.ts'];
    const [{SaveRepository},{legacyNpcMemories},{createTurnDraft}]=await Promise.all(paths.map(path=>import(path)));
    const raw=legacyNpcMemories(version),repo=await SaveRepository.open();
    try {
      await new Promise<void>((resolve,reject)=>{
        const open=indexedDB.open('heijinwangchao');open.onerror=()=>reject(open.error);
        open.onsuccess=()=>{const db=open.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(raw);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
      });
      await repo.saveDraft(createTurnDraft(raw.saveId,raw.revision,'unified-next','regular',''),null);
      return {memories:[...raw.npc['npc-a'].memories,...raw.npc['npc-a'].longTermMemories],summary:raw.memories.npcSummaries['npc-a'],clock:raw.worldClock,journal:raw.journal};
    } finally {repo.close();}
  },version);
}
// Fixture-only persistence of internal pure transitions. No player switch or new
// domain command is introduced by this batch.
async function switchFixture(page:Page,mode:'sleep'|'restore') {
  return page.evaluate(async mode=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/domain/npc/profiles.ts'];
    const [{SaveRepository},{hibernateNpcProfile,restoreNpcProfile}]=await Promise.all(paths.map(path=>import(path))),repo=await SaveRepository.open();
    const state=await repo.load('save-a');repo.close();
    const next=(mode==='sleep'?hibernateNpcProfile:restoreNpcProfile)(state,'npc-a',state.npc['npc-a'].identityKey);
    await new Promise<void>((resolve,reject)=>{
      const open=indexedDB.open('heijinwangchao');open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('saves','readwrite');tx.objectStore('saves').put(next);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
    });return next;
  },mode);
}

for(const version of [6,7] as const) test(`V${version}实际浏览器迁移与身份往返：记忆和总结可读，香闺七字段完整，零模型请求`,async({page})=>{
  const calls:string[]=[];await page.route('https://**/*',route=>{calls.push(route.request().url());return route.abort();});
  await page.goto('/');const old=await seed(page,version);await page.goto('/#game/save-a');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
  const baseline=(await read(page)).state;expect(baseline.schemaVersion).toBe(9);
  expect(baseline.npc['npc-a'].memories).toEqual(old.memories);expect(baseline.memories.npcSummaries['npc-a']).toEqual(old.summary);
  const sleeping=await switchFixture(page,'sleep');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
  expect((await read(page)).state).toEqual(sleeping);
  expect(sleeping.npc['npc-a'].kind).toBe('ordinary');expect(sleeping.npc['npc-a'].memories).toEqual(old.memories);
  expect(sleeping.dormantNpcProfiles['npc-a'].profile.privateProfile).toEqual(fullPrivateProfile);
  const input=await page.evaluate(async()=>{
    const paths=['/src/services/storage/saveRepository.ts','/src/prompts/composer.ts','/src/ui/settings/model.ts','/src/domain/drafts.ts'];
    const [{SaveRepository},{composePrompt},{defaultSettings},{rerollStory}]=await Promise.all(paths.map(path=>import(path))),repo=await SaveRepository.open();
    try {
      const {state,draft}=await repo.loadGame('save-a'),selected=rerollStory(draft,{turnKind:'regular',narrative:'【旁白】继续日常。',summary:'继续日常',variableGuide:[]});
      const outputs=[];
      for(const stage of ['story','variables','world'])outputs.push((await composePrompt({stage,mode:'regular',state,draft:selected,settings:defaultSettings(),userInput:'继续'})).messages);
      return JSON.stringify(outputs);
    } finally {repo.close();}
  });
  for(const value of Object.values(fullPrivateProfile))if(typeof value==='string')expect(input).not.toContain(value.trim());
  expect(input).toContain('原始文本');
  const restored=await switchFixture(page,'restore');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();
  expect((await read(page)).state).toEqual(restored);expect(restored.npc['npc-a']).toEqual(baseline.npc['npc-a']);
  expect(restored.memories).toEqual(baseline.memories);expect(restored.worldClock).toBe(old.clock);expect(restored.journal).toEqual(old.journal);expect(calls).toEqual([]);
});

test('关闭Chromium进程后重开：统一原文、旧总结来源与休眠七字段保持持久化',async({baseURL},info)=>{
  test.setTimeout(60000);const directory=await mkdtemp(join(tmpdir(),'npc-memory-v2-')),calls:string[]=[];
  const launch=async()=>{
    const context=await chromium.launchPersistentContext(directory,{executablePath:process.env.CHROMIUM_PATH,viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
    await context.route('https://**/*',route=>{calls.push(route.request().url());return route.abort();});
    await context.addInitScript(()=>{try{const d=new Date();localStorage.setItem('heijin.notices.hidden-on.v1',[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'));}catch{/* about:blank */}});
    return context;
  };
  let context:Awaited<ReturnType<typeof launch>>|undefined;
  try {
    context=await launch();let page=context.pages()[0];await page.goto(baseURL!);await seed(page,7);await page.goto(baseURL+'#game/save-a');await expect(page.locator('.game-layout')).toBeVisible();
    await switchFixture(page,'sleep');await page.reload();await expect(page.locator('.game-layout')).toBeVisible();const before=await read(page);
    await context.close();context=undefined;context=await launch();page=context.pages()[0];await page.goto(baseURL+'#game/save-a');await expect(page.locator('.game-layout')).toBeVisible();
    expect(await read(page)).toEqual(before);expect(before.state.dormantNpcProfiles['npc-a'].profile.privateProfile).toEqual(fullPrivateProfile);expect(calls).toEqual([]);
  }finally{await context?.close();await rm(directory,{recursive:true,force:true});}
});
