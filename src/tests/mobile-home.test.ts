import { describe, expect, it } from 'vitest';
import { departure, guilloche, ticketKey, ticketName, ticketOrder, ticketTime } from '../ui/home/ticketView';
import type { SaveSummary } from '../services/storage/saveManagement';
import { game } from './fixtures/game';
const a:SaveSummary={...game('a'),status:'readable',storageKey:'a',title:'甲 · 重庆'};
const b:SaveSummary={...game('b'),status:'readable',storageKey:'b',title:'乙 · 上海'};
const bad:SaveSummary={status:'unreadable',storageKey:'broken',title:'旧存档',saveId:'a'};
describe('phone ticket projection, without storage writes',()=>{
 it('selected readable record first, every other record retains order; input unchanged',()=>{
  const input=[a,b,bad],before=structuredClone(input);expect(ticketOrder(input,'b')).toEqual([b,a,bad]);expect(input).toEqual(before);
  expect(ticketOrder([bad,b,a],'a')).toEqual([a,bad,b]);expect(ticketOrder(input,'missing')).toEqual(input);
 });
 it('empty input and unreadable contents cannot claim a selection',()=>{expect(ticketOrder([],'a')).toEqual([]);expect(ticketOrder([b,bad],'a')).toEqual([b,bad]);});
 it.each([['沈砚 · 重庆','沈砚'],['名字 · 其他 · 上海','名字'],['无后缀','无后缀'],['姓·名','姓·名'],[' · 重庆',' · 重庆']])('real title %s → %s', (text,name)=>expect(ticketName(text)).toBe(name));
 it('record identity uses original storage key, not possibly misleading content saveId',()=>{
  expect(ticketKey(bad)).not.toBe(ticketKey(a));expect(ticketKey({...bad,storageKey:7})).not.toBe(ticketKey({...bad,storageKey:'7'}));
 });
 it('timestamps use the existing China-time formatter, never the device time',()=>{
  expect(ticketTime('2026-11-10T15:41:00Z')).toEqual({date:'2026/11/10',time:'23:41',full:'保存于 2026/11/10 23:41'});
  expect(ticketTime('2026-11-10T23:59:00Z').date).toBe('2026/11/11');
  expect(ticketTime(undefined).time).toBe('--:--');expect(ticketTime('invalid').full).toBe('保存时间无法读取');
 });
 it.each([['重庆','重庆'],['上海','上海'],['哈尔滨','哈尔滨'],['广州','广州'],['北京','未知']])('departure uses existing suffix rule: %s', (suffix,dest)=>{
  expect(departure({...a,title:`甲 · ${suffix}`},'a',false,'')).toMatchObject({dest,status:'已选择'});
 });
 it('departure status precedence includes no invented save time',()=>{
  expect(departure(a,'a',true,'oops')).toMatchObject({dest:'···',time:'--:--',status:'读取中'});
  expect(departure(a,'a',false,'oops')).toMatchObject({dest:'———',status:'暂停检票'});
  expect(departure(undefined,'a',false,'')).toMatchObject({dest:'新人生',time:'--:--',status:'可购票'});
  expect(departure(bad,'a',false,'')).toMatchObject({dest:'未知',time:'--:--',status:'无法读取'});
  expect(departure(b,'a',false,'').status).toBe('本地存档');
 });
 it('guilloche is stable, seeded, fifteen paths, with neutral support',()=>{
  expect(guilloche('cq')).toEqual(guilloche('cq'));expect(guilloche('cq')).not.toEqual(guilloche('sh'));
  for(const city of ['cq','sh','hrb','gz',undefined] as const){const paths=guilloche(city);expect(paths).toHaveLength(15);for(const path of paths){expect(path.match(/L/g)).toHaveLength(80);expect(path).not.toMatch(/NaN|Infinity/);}}
 });
});
