import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MobileCityBar,MobileStatus} from '../ui/game/MobileCity';
import {CityChapter} from '../ui/game/CityNight';
import {worldState} from './fixtures/world';
import {newCreation,buildCreationState} from '../ui/creation/model';
import {defaultSettings} from '../ui/settings/model';
import {money} from '../ui/panels/playerView';

const noop=()=>undefined;
test('手机时间来自正式世界时钟的中国标准时间，当前所在地不改开局印章',()=>{
 const state=worldState();state.openingCityId='chongqing';state.worldClock='2026-11-11T23:50:00Z';state.locations.other={id:'other',name:'上海的门店'};state.protagonist.locationId='other';const before=structuredClone(state);
 const html=renderToStaticMarkup(<MobileCityBar state={state} mini={false} onStatus={noop}/>);
 expect(html).toContain('07:50');expect(html).toContain('2026/11/12 星期四');expect(html).toContain('上海的门店');expect(html).toContain('>渝<');expect(state).toEqual(before);
});
test('开局未确认时不显示设备日期、虚构时段或晴天',()=>{
 const form=newCreation();form.person={name:'林遥',age:'30',gender:'男性',appearance:'',personality:''};form.customProfession='记者';const state=buildCreationState(form,defaultSettings());
 const html=renderToStaticMarkup(<><MobileCityBar state={state} mini={false} onStatus={noop}/><MobileStatus state={state} equipment={[]} onProfile={noop} onEconomy={noop}/></>);
 expect(html).toContain('--:--');expect(html).toContain('开局时间待确认');expect(html).toContain('天气待确认');expect(html).not.toContain('0001/');expect(html).not.toContain('深夜');expect(html).not.toContain('>晴<');
});
test.each([null,123456,Number.MAX_SAFE_INTEGER])('状态抽屉完整保留长文本、装备与金额 %s',amount=>{
 const state=worldState();state.economy.cash=amount;state.economy.onlineBalance=amount;state.protagonist.healthText='长身体说明。'.repeat(200);state.protagonist.emotionText='完整情绪说明。'.repeat(200);const before=structuredClone(state);
 const equipment:[string,string][]=[['上衣','长装备名称'.repeat(80)],['下装','无'],['鞋子','无'],['饰品','无'],['主武器','无'],['副武器','无'],['载具','无']];
 const html=renderToStaticMarkup(<MobileStatus state={state} equipment={equipment} onProfile={noop} onEconomy={noop}/>);
 expect(html).toContain(state.protagonist.healthText);expect(html).toContain(state.protagonist.emotionText);expect(html).toContain(equipment[0][1]);expect(html.split(money(amount))).toHaveLength(3);for(const [label]of equipment)expect(html).toContain(`<dt>${label}</dt>`);expect(state).toEqual(before);
});
test('手机回目使用历史 scene，缺失时保留降级文案和可访问标题',()=>{
 const state=worldState();state.worldClock='2026-11-20T23:00:00+08:00';state.locations.past={id:'past',name:'过去的会面地点'};
 const html=renderToStaticMarkup(<CityChapter number={7} state={state} scene={{worldClock:'2026-11-11T00:05:00+08:00',locationId:'past'}} desktop={false}/>);
 expect(html).toContain('第 7 回合');expect(html).toContain('2026/11/11 · 星期三 · 00:05');expect(html).toContain('过去的会面地点');expect(html).not.toContain('2026/11/20');
 expect(renderToStaticMarkup(<CityChapter number={1} state={state} desktop={false}/>)).toContain('时间地点未记录');
});
