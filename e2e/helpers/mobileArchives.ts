import {expect} from '@playwright/test';
import type {Page} from '@playwright/test';
export async function seedMobileArchives(page:Page,extra=0,roster=false){
 await page.goto('/');const state=await page.evaluate(async ({extra,roster})=>{
  const paths=[roster?'/src/tests/fixtures/npcRoster.ts':'/src/tests/fixtures/mobileArchives.ts','/src/services/storage/saveRepository.ts','/src/domain/drafts.ts','/src/ui/settings/model.ts'];
  const [fixture,{SaveRepository},{createTurnDraft},{defaultSettings,settingsKey}]=await Promise.all(paths.map(p=>import(p))),state=roster?fixture.npcRosterState():fixture.mobileArchivesState(extra);
  const settings=defaultSettings();for(const option of Object.values(settings.memory.summaries) as {automatic:boolean}[])option.automatic=false;localStorage.setItem(settingsKey,JSON.stringify(settings));
  const repo=await SaveRepository.open();repo.close();await new Promise<void>((resolve,reject)=>{const q=indexedDB.open('heijinwangchao');q.onsuccess=()=>{const db=q.result,t=db.transaction(['saves','drafts'],'readwrite');t.objectStore('saves').put(state);t.objectStore('drafts').put(createTurnDraft(state.saveId,state.revision,'mobile-paper-draft','regular','保留原有草稿输入'));t.oncomplete=()=>{db.close();resolve();};t.onabort=()=>reject(t.error);};q.onerror=()=>reject(q.error);});return state;
 },{extra,roster});await enterArchiveGame(page);return state;
}
export async function enterArchiveGame(page:Page){await page.goto('/#game/save-a');await page.reload();await expect(page.getByTestId('story-reader')).toBeVisible();await page.evaluate(()=>document.fonts.ready);}
export async function storedArchives(page:Page){return page.evaluate(async()=>{const p='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(p),r=await SaveRepository.open();try{return await r.loadGame('save-a');}finally{r.close();}});}
export async function openArchive(page:Page,name:string){
 const old=page.locator('dialog.mobile-archive[open]');if(await old.count())await page.keyboard.press('Escape');
 if((page.viewportSize()?.width??0)<=900){await page.getByRole('navigation',{name:'底部导航'}).getByRole('button',{name:'世界资料',exact:true}).click();await page.getByRole('dialog',{name:'世界资料',exact:true}).getByRole('button',{name,exact:true}).click();}
 else await page.locator(`[data-archive-panel="${name}"]`).click();
 const dialog=page.getByRole('dialog',{name,exact:true});await expect(dialog).toBeVisible();return dialog;
}
export async function openEconomy(page:Page){
 if((page.viewportSize()?.width??0)<=900){await page.locator('.mobile-city-pill').click();await page.getByRole('dialog',{name:'此时此地',exact:true}).getByRole('button',{name:'经济与资产',exact:true}).click();}
 else await page.locator('[data-archive-panel="经济与资产"]').click();return page.getByRole('dialog',{name:'经济与资产',exact:true});
}
export async function openPaperSettings(page:Page){
 if((page.viewportSize()?.width??0)<=900)await page.getByRole('navigation',{name:'底部导航'}).getByRole('button',{name:'设置',exact:true}).click();else await page.locator('.dock-system [data-settings-open]').click();
 const settings=page.getByRole('dialog',{name:'设置',exact:true});await expect(settings).toBeVisible();return settings;
}
export async function archiveFits(page:Page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const dialog of await page.locator('dialog.mobile-archive[open]').all()){
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  const body=dialog.locator(':scope>.modal-body');expect(await body.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  const scrollOwners=await body.locator('.npc-directory,.npc-detail,.organization-directory,.organization-detail,.mp-main,.event-directory,.event-detail-pane,.history-panel,.memory-reader,.inventory-results,.settings-content').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>getComputedStyle(e).overflowY));expect(scrollOwners.every(v=>v==='visible'||v==='clip')).toBe(true);
 }
}
