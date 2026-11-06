import { describe, expect, it, vi } from 'vitest';
import { localNoticeDate, noticeDateKey, noticesMutedToday, saveNoticePreference } from '../ui/notices/preferences';

function memoryStorage() {
  const values = new Map<string, string>([['unrelated', 'preserve']]);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

describe('公告免打扰：只存设备本地日期', () => {
  it.each([[2026, 0, 2, '2026-01-02'], [2026, 11, 31, '2026-12-31'], [2027, 0, 1, '2027-01-01']])(
    '日历日期 %s/%s/%s', (year, month, day, expected) => {
      expect(localNoticeDate(new Date(Number(year), Number(month), Number(day)))).toBe(expected);
    },
  );
  it('读取本地年月日，不依赖 UTC 序列化', () => {
    const date = new Date();
    vi.spyOn(date, 'getFullYear').mockReturnValue(2027);
    vi.spyOn(date, 'getMonth').mockReturnValue(0);
    vi.spyOn(date, 'getDate').mockReturnValue(1);
    vi.spyOn(date, 'toISOString').mockImplementation(() => { throw new Error('UTC must not be used'); });
    expect(localNoticeDate(date)).toBe('2027-01-01');
  });
  it('当日跳过，跨日/跨年恢复；不会碰其他配置', () => {
    const storage = memoryStorage();
    const today = new Date(2026, 11, 31, 23, 59);
    expect(noticesMutedToday(today, () => storage)).toBe(false);
    saveNoticePreference(true, today, () => storage);
    expect(storage.values.get(noticeDateKey)).toBe('2026-12-31');
    expect(noticesMutedToday(today, () => storage)).toBe(true);
    expect(noticesMutedToday(new Date(2027, 0, 1), () => storage)).toBe(false);
    saveNoticePreference(false, today, () => storage);
    expect(noticesMutedToday(today, () => storage)).toBe(false);
    expect([...storage.values]).toEqual([['unrelated', 'preserve']]);
  });
  it.each(['bad date', '', '2026-11-08', '2026-11-06'])('不接受无效或非当日值 %s', value => {
    const storage = memoryStorage(); storage.setItem(noticeDateKey, value);
    expect(noticesMutedToday(new Date(2026, 10, 7), () => storage)).toBe(false);
  });
  it('localStorage 属性本身不可访问也不抛异常', () => {
    const unavailable = () => { throw new Error('denied'); };
    expect(noticesMutedToday(new Date(), unavailable)).toBe(false);
    expect(() => saveNoticePreference(true, new Date(), unavailable)).not.toThrow();
    expect(() => saveNoticePreference(false, new Date(), unavailable)).not.toThrow();
  });
  it.each(['getItem', 'setItem', 'removeItem'] as const)('%s 失败不阻塞游戏', method => {
    const storage = memoryStorage();
    vi.spyOn(storage, method).mockImplementation(() => { throw new Error('denied'); });
    expect(noticesMutedToday(new Date(), () => storage)).toBe(false);
    expect(() => saveNoticePreference(true, new Date(), () => storage)).not.toThrow();
    expect(() => saveNoticePreference(false, new Date(), () => storage)).not.toThrow();
  });
});
