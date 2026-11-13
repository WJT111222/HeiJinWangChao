import { describe, expect, it, vi } from 'vitest';
import { localNoticeDate, noticeDateKey, noticeMuteToday, noticesMutedFor, noticesMutedToday, noticeVersionKey, saveNoticePreference } from '../ui/notices/preferences';

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

describe('公告免打扰：绑定当时看到的公告版本', () => {
  const today = new Date(2026, 10, 13, 9), tomorrow = new Date(2026, 10, 14, 9);
  it('只对勾选时的版本免打扰；同一天新版本照常弹出，次日全部恢复', () => {
    const storage = memoryStorage();
    saveNoticePreference(true, today, () => storage, '1.0 Beta · 2026.11.13');
    expect(storage.values.get(noticeDateKey)).toBe('2026-11-13');
    expect(storage.values.get(noticeVersionKey)).toBe('1.0 Beta · 2026.11.13');
    expect(noticeMuteToday(today, () => storage)).toEqual({ version: '1.0 Beta · 2026.11.13' });
    expect(noticesMutedFor('1.0 Beta · 2026.11.13', today, () => storage)).toBe(true);
    expect(noticesMutedFor('1.0 Beta · 2026.11.13-2', today, () => storage)).toBe(false);
    expect(noticesMutedFor('1.0 Beta · 2026.11.13', tomorrow, () => storage)).toBe(false);
    expect(noticeMuteToday(tomorrow, () => storage)).toBeUndefined();
  });
  it('只有日期的旧记录当天对所有版本免打扰；不带版本保存会清掉旧版本记录', () => {
    const storage = memoryStorage();
    storage.setItem(noticeDateKey, '2026-11-13');
    expect(noticeMuteToday(today, () => storage)).toEqual({});
    expect(noticesMutedFor('任何版本', today, () => storage)).toBe(true);
    storage.setItem(noticeVersionKey, '旧版本');
    saveNoticePreference(true, today, () => storage);
    expect(storage.values.has(noticeVersionKey)).toBe(false);
  });
  it('取消勾选同时清除日期与版本，保留其他本地配置', () => {
    const storage = memoryStorage();
    saveNoticePreference(true, today, () => storage, 'v');
    saveNoticePreference(false, today, () => storage);
    expect(storage.values.has(noticeDateKey)).toBe(false);
    expect(storage.values.has(noticeVersionKey)).toBe(false);
    expect(storage.values.get('unrelated')).toBe('preserve');
    expect(noticesMutedToday(today, () => storage)).toBe(false);
  });
  it('存储不可用时视为未免打扰', () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(noticeMuteToday(today, () => storage)).toBeUndefined();
    expect(noticesMutedFor('v', today, () => storage)).toBe(false);
  });
});
