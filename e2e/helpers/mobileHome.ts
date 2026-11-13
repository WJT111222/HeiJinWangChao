import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
export async function seedTickets(page:Page, count=5, draft=true, long=false){
 await page.goto('/');
 await page.evaluate(async({count,draft,long})=>{
  const rp='/src/services/storage/saveRepository.ts',fp='/src/tests/fixtures/game.ts',cp='/src/ui/creation/model.ts';
  const {SaveRepository}=await import(rp),{game}=await import(fp),{newCreation,creationKey}=await import(cp),repo=await SaveRepository.open();
  for(let i=0;i<count;i++)await repo.create({...game(`ticket-${i}`),title:`${long?'长姓名与存档资料'.repeat(15):['沈砚','周远','林舟','陆遥','阿宁'][i%5]} · ${['重庆','上海','哈尔滨','广州','未知城市'][i%5]}`,createdAt:'2026-10-01T00:00:00Z',updatedAt:`2026-11-${String(10-i%9).padStart(2,'0')}T15:41:00Z`});
  repo.close();
  localStorage.setItem('heijin.selected.v1',JSON.stringify(count?'ticket-1':''));
  if(draft){const creation=newCreation();creation.person.name='待发车的旅人';localStorage.setItem(creationKey,JSON.stringify(creation));}
 },{count,draft,long});
 await page.reload();await expect(page.locator('.mobile-home')).toBeVisible();await expect(page.locator('.mh-ticket')).toHaveCount(count+1);
}
export async function ticketAt(page:Page,index:number){
 await page.getByRole('button',{name:new RegExp(`^第 ${index+1} 张`)}).click();
 await expect(page.locator('.mh-ticket-wrap').nth(index)).toHaveAttribute('aria-current','true');
}
export async function rawSnapshot(page:Page){
 return page.evaluate(async()=>{
  const rp='/src/services/storage/saveRepository.ts',{SaveRepository}=await import(rp),repo=await SaveRepository.open(),list=await repo.list();
  try{return await Promise.all(list.map((s:{storageKey:IDBValidKey})=>repo.exportRaw(s.storageKey)));}finally{repo.close();}
 });
}
