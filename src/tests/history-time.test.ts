import { expect, it } from 'vitest';
import { HistoryTimeSchema, historyBounds, historyTimeKey, historyTimeLabel } from '../domain/history/time';
import type { HistoryTime } from '../domain/history/time';
import { historyProjection } from '../domain/history/projection';
import { chronicle, historyEntry } from './fixtures/historyV2';
const entry = (id: string, time: HistoryTime) => historyEntry(id, chronicle(id, time));

it('所有类别先统一排序，后补2021年令2022年主角节点同步后移', () => {
  const a = entry('a', { precision: 'year', year: 2020 }), b = entry('b', { precision: 'year', year: 2022 });
  const c = entry('c', { precision: 'year', year: 2021 });
  c.chronicle = { ...c.chronicle!, category: 'world', scope: 'region', scopeText: '社区', basis: 'historical_event', endTime: { precision: 'year', year: 2021 } };
  expect(historyProjection([b, a]).slots.map(x => x.entries[0].id)).toEqual(['a', 'b']);
  expect(historyProjection([b, c, a]).slots.map(x => x.entries[0].id)).toEqual(['a', 'c', 'b']);
});
it('月、季、年各自排在对应精确记录之后；冬季不跨年', () => {
  const data: [string, HistoryTime][] = [
    ['jan', { precision: 'day', date: '2021-01-02' }],
    ['may-day', { precision: 'day', date: '2021-05-31' }], ['may', { precision: 'month', year: 2021, month: 5 }],
    ['spring', { precision: 'season', year: 2021, season: 'spring' }],
    ['aug', { precision: 'month', year: 2021, month: 8 }], ['summer', { precision: 'season', year: 2021, season: 'summer' }],
    ['nov', { precision: 'month', year: 2021, month: 11 }], ['autumn', { precision: 'season', year: 2021, season: 'autumn' }],
    ['dec-time', { precision: 'instant', at: '2021-12-31T23:59:59+08:00' }], ['dec-day', { precision: 'day', date: '2021-12-31' }],
    ['dec', { precision: 'month', year: 2021, month: 12 }], ['winter', { precision: 'season', year: 2021, season: 'winter', text: '那年冬天' }],
    ['year', { precision: 'year', year: 2021 }], ['next', { precision: 'day', date: '2022-01-01' }], ['unknown', { precision: 'unknown', text: '大学时期' }],
  ];
  const records = [...data].reverse().map(([id, time]) => entry(id, time)), before = structuredClone(records);
  const projected = historyProjection(records);
  expect(projected.slots.map(s => s.entries[0].id)).toEqual(data.map(([id]) => id));
  expect(projected.slots.find(s => s.entries[0].id === 'winter')).toMatchObject({ year: 2021 });
  expect(projected.slots.find(s => s.entries[0].id === 'winter')?.label).not.toContain('2022');
  expect(records).toEqual(before); expect(records.find(r => r.id === 'winter')?.occurredAt).toBeUndefined();
});
it('同一实际时刻跨时区表示共用槽位、保留独立人物与世界节点', () => {
  const a = entry('a', { precision: 'instant', at: '2021-06-02T08:00:00+08:00' });
  const b = entry('b', { precision: 'instant', at: '2021-06-02T00:00:00Z' });
  const c = entry('c', { precision: 'instant', at: '2021-06-02T09:00:00+08:00' });
  const slots = historyProjection([c,b,a]).slots;
  expect(slots).toHaveLength(2); expect(slots[0].entries.map(e => e.id)).toEqual(['a','b']);
});
it('未知日期不声称同时发生；旧史料不自动升级', () => {
  const a = entry('a', { precision: 'unknown', text: '青年时期' }), b = entry('b', { precision: 'unknown', text: '童年' });
  const old = { ...entry('legacy', { precision: 'year', year: 2021 }), chronicle: undefined };
  const result = historyProjection([a,b,old]); expect(result.slots).toHaveLength(2); expect(result.records).toEqual([old]);
});
it('时间范围以结束精度的尾部定位，保留完整起止精度且不制造日期', () => {
  const time: HistoryTime = { precision: 'range', from: { precision: 'year', year: 2020 }, to: { precision: 'month', year: 2021, month: 5 }, text: '建设期间' };
  const data = [entry('range', time), entry('may', { precision: 'month', year: 2021, month: 5 }), entry('june', { precision: 'day', date: '2021-06-01' })];
  expect(historyProjection(data).slots.map(s=>s.entries[0].id)).toEqual(['may','range','june']);
  expect(historyTimeLabel(time)).toContain('建设期间'); expect(time.from.precision).toBe('year');
});
it.each([
  { precision: 'day', date: '2021-02-29' }, { precision: 'month', year: 2021, month: 13 },
  { precision: 'year', year: 0 }, { precision: 'season', year: 2021, season: 'rainy' },
  { precision: 'unknown' }, { precision: 'instant', at: '2021-01-01' },
])('非法历法或结构拒绝：%j', raw => expect(HistoryTimeSchema.safeParse(raw).success).toBe(false));
it('冬季定位规则不改变事实时间范围、不隐含真实日期', () => {
  const time: HistoryTime = { precision: 'season', year: 2021, season: 'winter' };
  expect(historyTimeKey(time)).toBe('season:2021:winter');
  expect(historyBounds(time)?.earliest).toBe(Date.parse('2021-01-01T00:00:00+08:00'));
  expect(historyTimeLabel(time)).toBe('2021年冬季（日期未详）');
});
it('万条混合类别仅按同一排序、相同输入顺序变化不影响结果', () => {
  const rows = Array.from({length:10000},(_,i)=>entry(`h-${i}`,{precision:'day',date:`2021-${String(i%12+1).padStart(2,'0')}-${String(i%28+1).padStart(2,'0')}`}));
  const a=historyProjection(rows), b=historyProjection([...rows].reverse());
  expect(a.slots.map(s=>s.entries.map(e=>e.id))).toEqual(b.slots.map(s=>s.entries.map(e=>e.id)));
  expect(a.slots.flatMap(s=>s.entries)).toHaveLength(10000);
});
