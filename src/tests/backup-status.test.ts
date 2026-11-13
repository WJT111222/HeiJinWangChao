import { describe, expect, it } from 'vitest';
import { backupReminderCount, backupReminderTurns, backupStatus, backupStatusKey, forgetBackup, recordBackup } from '../ui/home/backupStatus';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>([['unrelated', 'preserve']]);
  if (initial !== undefined) values.set(backupStatusKey, initial);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  return { values, access: () => storage };
}
const save = (saveId: string, revision: number, turnNumber: number) => ({ saveId, revision, turnNumber });

describe('存档备份状态：只记在本机，不写进存档', () => {
  it('从未备份 → 导出当天显示已备份，并且不碰其他配置', () => {
    const { values, access } = memoryStorage();
    const now = new Date(2026, 10, 13, 20, 0);
    expect(backupStatus(save('a', 8, 8), now, access)).toEqual({ tone: 'none', text: '从未备份' });
    recordBackup([save('a', 8, 8)], new Date(2026, 10, 13, 9, 30), access);
    expect(backupStatus(save('a', 8, 8), now, access)).toEqual({ tone: 'ok', text: '已备份 · 今天' });
    expect(values.get('unrelated')).toBe('preserve');
  });

  it('昨天与更早的日期按本地日历显示', () => {
    const { access } = memoryStorage();
    recordBackup([save('a', 3, 3)], new Date(2026, 10, 12, 23, 59), access);
    recordBackup([save('b', 3, 3)], new Date(2026, 9, 2, 8, 0), access);
    const now = new Date(2026, 10, 13, 0, 1);
    expect(backupStatus(save('a', 3, 3), now, access).text).toBe('已备份 · 昨天');
    expect(backupStatus(save('b', 3, 3), now, access).text).toBe('已备份 · 10/02');
  });

  it('备份后继续游玩：按回合数报出差值', () => {
    const { access } = memoryStorage();
    recordBackup([save('a', 10, 10)], new Date(), access);
    expect(backupStatus(save('a', 13, 13), new Date(), access)).toEqual({ tone: 'warn', text: '备份后又玩了 3 回合' });
  });

  it('撤回会抬高版本号但让回合数回退：只说有变动，不报错误的回合数', () => {
    const { access } = memoryStorage();
    recordBackup([save('a', 10, 10)], new Date(), access);
    // 撤回一次：revision 11，回合 9
    expect(backupStatus(save('a', 11, 9), new Date(), access)).toEqual({ tone: 'warn', text: '备份后存档有变动' });
    // 撤回后重玩同一回合：revision 12，回合 10
    expect(backupStatus(save('a', 12, 10), new Date(), access)).toEqual({ tone: 'warn', text: '备份后存档有变动' });
    // 用更旧的备份覆盖：revision 变小
    expect(backupStatus(save('a', 6, 6), new Date(), access)).toEqual({ tone: 'warn', text: '备份后存档有变动' });
  });

  it('一次导出多份存档都会记下；删除存档后忘掉它的记录', () => {
    const { access } = memoryStorage();
    recordBackup([save('a', 2, 2), save('b', 5, 4)], new Date(), access);
    expect(backupStatus(save('b', 5, 4), new Date(), access).tone).toBe('ok');
    forgetBackup('a', access);
    expect(backupStatus(save('a', 2, 2), new Date(), access).tone).toBe('none');
    expect(backupStatus(save('b', 5, 4), new Date(), access).tone).toBe('ok');
  });

  it.each(['not json', '[]', 'null', '{"a":{"revision":-1,"turnNumber":1,"at":"2026-11-13T00:00:00.000Z"}}',
    '{"a":{"revision":1,"at":"2026-11-13T00:00:00.000Z"}}', '{"a":{"revision":1,"turnNumber":1,"at":"bad"}}'])(
    '损坏或旧格式的记录当作从未备份：%s', raw => {
      const { access } = memoryStorage(raw);
      expect(backupStatus(save('a', 1, 1), new Date(), access).tone).toBe('none');
    });

  it('存储不可用时不抛错，备份文件照常生成', () => {
    const broken = () => ({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(() => recordBackup([save('a', 1, 1)], new Date(), broken)).not.toThrow();
    expect(backupStatus(save('a', 1, 1), new Date(), broken).tone).toBe('none');
  });

  it(`提醒只算从未备份且玩到 ${backupReminderTurns} 回合以上的存档`, () => {
    const { access } = memoryStorage();
    recordBackup([save('done', 9, 9)], new Date(), access);
    const saves = [save('new', 4, 4), save('long', 5, 5), save('done', 12, 12), save('undo-heavy', 9, 3)];
    expect(backupReminderCount(saves, access)).toBe(1);
  });
});
