import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsSchema, defaultSettings, mergeSettingsChanges } from '../ui/settings/model';
import { playChime, primeChime, shouldChime } from '../ui/game/completionChime';

const page = (hidden: boolean, focused: boolean) => ({ hidden, hasFocus: () => focused });

describe('生成完成提示音', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('旧设置缺字段时默认「切到别处时」，其余设置不变', () => {
    const old = structuredClone(defaultSettings()) as Record<string, unknown>;
    delete old.notifications;
    const parsed = SettingsSchema.parse(old);
    expect(parsed.notifications).toEqual({ completionChime: 'background' });
    expect(parsed.display).toEqual({ appearance: 'night' });
    expect(SettingsSchema.safeParse({ ...defaultSettings(), notifications: { completionChime: 'loud' } }).success).toBe(false);
  });

  it('默认只在页面不在前台时提醒；关闭时从不提醒；总是时都提醒', () => {
    expect(shouldChime('background', page(false, true))).toBe(false);
    expect(shouldChime('background', page(true, false))).toBe(true);
    expect(shouldChime('background', page(false, false))).toBe(true);
    expect(shouldChime('off', page(true, false))).toBe(false);
    expect(shouldChime('always', page(false, true))).toBe(true);
  });

  it('提示音与其他分类的修改互不覆盖', () => {
    const base = defaultSettings(), latest = structuredClone(base), edited = structuredClone(base);
    latest.notifications.completionChime = 'off';
    edited.prompts.perspective = 'first';
    expect(mergeSettingsChanges(base, edited, latest).notifications.completionChime).toBe('off');
  });

  it('不支持 Web Audio 的环境静默跳过，不抛错', () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    expect(() => { primeChime(); playChime('done'); playChime('attention'); }).not.toThrow();
  });
});
