import { expect, it } from 'vitest';
import { CITY, ORDER, saveCity, skyline } from '../ui/home/skyline';
it('四城固定种子可重复，不把玩家文本拼入装饰SVG',()=>{
 for(const c of ORDER){expect(skyline(c)).toBe(skyline(c));expect(skyline(c)).toContain('viewBox="0 0 1200 160"');}
 expect(new Set(ORDER.map(c=>skyline(c))).size).toBe(4);
});
it('四城只从明确标题末尾识别人生起点，不猜测当前位置',()=>{
 for(const c of ORDER){expect(saveCity(`人物 · ${CITY[c][0]}`)).toBe(c);expect(saveCity(`人物·${CITY[c][0]} `)).toBe(c);}
 expect(saveCity('重庆人的旅程 · 北京')).toBeUndefined();expect(saveCity('未命名')).toBeUndefined();
});
it('城市特效与元信息沿用设计稿',()=>{
 expect(skyline('cq')).toContain('home-train');expect(skyline('hrb')).toContain('home-snow');
 expect(skyline('sh')).not.toContain('home-train');expect(CITY.gz).toEqual(['广州','GUANGZHOU · 23°07′N','早茶 · 榕荫 · 珠江']);
});
