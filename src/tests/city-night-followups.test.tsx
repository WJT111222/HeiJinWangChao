import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { timeOfDayLabel, deriveAtmosphere } from '../ui/game/atmosphere';
import { CityBar } from '../ui/game/CityNight';
import { PlayerStatus } from '../ui/game/PlayerStatus';
import { SceneDetails } from '../ui/game/SceneDetails';
import { game } from './fixtures/game';
import { pendingOpeningClock } from '../domain/openingTime';

afterEach(() => vi.useRealTimers());
describe('正式游戏时间的中文时段独立于五档天空', () => {
  it.each([
    ['00:00:00','深夜'],['04:59:59','深夜'],['05:00:00','黎明'],['06:59:59','黎明'],
    ['07:00:00','早晨'],['07:50:00','早晨'],['08:59:59','早晨'],['09:00:00','上午'],
    ['11:59:59','上午'],['12:00:00','中午'],['12:59:59','中午'],['13:00:00','下午'],
    ['16:59:59','下午'],['17:00:00','黄昏'],['18:59:59','黄昏'],['19:00:00','夜晚'],
    ['22:59:59','夜晚'],['23:00:00','深夜'],['23:59:59','深夜'],
  ])('%s → %s（GMT+8）', (clock,label) => {
    expect(timeOfDayLabel({ worldClock:`2026-11-12T${clock}+08:00` })).toBe(label);
  });
  it('UTC 跨日仍按中国标准时间取时段、日期和星期', () => {
    const state=game(); state.worldClock='2026-11-11T23:50:00Z';
    expect(timeOfDayLabel(state)).toBe('早晨');
    const html=renderToStaticMarkup(<CityBar state={state}/>);
    expect(html).toContain('07:50'); expect(html).toContain('2026/11/12 星期四');expect(html).toContain('早晨');
  });
  it('天气与设备日期不影响显示，07–16点仍共用 day 天空', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('1999-01-01T23:30:00Z'));
    for(const [hour,label] of [[7,'早晨'],[9,'上午'],[12,'中午'],[13,'下午'],[16,'下午']] as const){
      for(const weatherText of ['晴','暴雨','雪','雾霾']){
        const state={...game(),worldClock:`2026-11-12T${String(hour).padStart(2,'0')}:50:00+08:00`,weatherText};
        expect(timeOfDayLabel(state)).toBe(label);expect(deriveAtmosphere(state).time).toBe('day');
      }
    }
  });
  it('开局待定不显示占位日期或任何虚构时段，天空仍沿用 night', () => {
    const state={...game(),openingTimePending:true as const,worldClock:pendingOpeningClock};
    expect(timeOfDayLabel(state)).toBeUndefined();expect(deriveAtmosphere(state).time).toBe('night');
    const html=renderToStaticMarkup(<CityBar state={state}/>);
    expect(html).toContain('开局时间待确认');expect(html).toContain('--:--');expect(html).not.toContain('class="tod"');expect(html).not.toContain('0001');
  });
});

describe('状态、资金和详情使用原始 GameState 全文', () => {
  it('两项状态全文、金额小数与单位均在可见正文，完整装备及入口保留且不改存档', () => {
    const state=game(),before=structuredClone(state);
    state.protagonist.healthText='第一段身体描述。\n第二段'+ '长中文内容。'.repeat(80);
    state.protagonist.emotionText='异常长文本'+ 'A'.repeat(1000);
    state.economy.cash=123456789;state.economy.onlineBalance=12345678901;
    const snapshot=structuredClone(state),equipment:[string,string][]=[['上衣','外套'],['下装','长裤'],['鞋子','布鞋'],['饰品','无'],['主武器','无'],['副武器','无'],['载具','无']];
    const html=renderToStaticMarkup(<PlayerStatus state={state} equipment={equipment} onProfile={()=>{}} onEconomy={()=>{}}/>);
    expect(html).toContain('</small>'+state.protagonist.healthText+'</span>');expect(html).toContain('</small>'+state.protagonist.emotionText+'</span>');
    expect(html).toContain('<strong>1,234,567.89 元</strong>');expect(html).toContain('<strong>123,456,789.01 元</strong>');
    for(const [label] of equipment)expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('人物档案');expect(html).toContain('经济与资产');expect(state).toEqual(snapshot);expect(state.saveId).toBe(before.saveId);
  });
  it('详情同时包含两个真实字段、正确转义、空值待确认与键盘入口', () => {
    const weatherText='雨和雪。\n'+ '天气详情'.repeat(100),environmentText='<script>不是可执行标签</script>'+ '环境全文'.repeat(100);
    const html=renderToStaticMarkup(<SceneDetails weatherText={weatherText} environmentText={environmentText}/>);
    expect(html).toContain('<dt>天气</dt>');expect(html).toContain('<dt>环境</dt>');expect(html).toContain(weatherText);
    expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('环境全文'.repeat(100));
    expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('aria-expanded="false"');
    const empty=renderToStaticMarkup(<SceneDetails weatherText="" environmentText="" compactLabel="07:50 · 街口"/>);
    expect(empty).toContain('天气待确认');expect(empty).toContain('环境待确认');expect(empty).toContain('查看天气与环境详情');
  });
});
