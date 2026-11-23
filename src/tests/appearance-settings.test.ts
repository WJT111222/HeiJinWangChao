import { describe, expect, it } from 'vitest';
import { SettingsSchema, defaultSettings, mergeSettingsChanges } from '../ui/settings/model';
import { resolveAppearance } from '../app/useAppearance';

describe('外观设置', () => {
  it('旧设置缺少外观字段时为夜间，其余偏好原样保留', () => {
    const old = structuredClone(defaultSettings()) as Record<string, unknown>;
    delete old.display;
    (old.runtime as Record<string, unknown>).timeoutSeconds = 77;
    const parsed = SettingsSchema.parse(old);
    expect(parsed.display).toEqual({ appearance: 'night' });
    expect(parsed.runtime.timeoutSeconds).toBe(77);
    expect(defaultSettings().display.appearance).toBe('night');
  });
  it('只接受夜间、日间、跟随系统三种取值', () => {
    for (const appearance of ['night', 'day', 'system']) expect(SettingsSchema.safeParse({ ...defaultSettings(), display: { appearance } }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), display: { appearance: 'light' } }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), display: { appearance: 'day', extra: 1 } }).success).toBe(false);
  });
  it('跟随系统时按系统深浅色解析，其余取值直接生效', () => {
    expect(resolveAppearance('system', true)).toBe('day');
    expect(resolveAppearance('system', false)).toBe('night');
    expect(resolveAppearance('day', false)).toBe('day');
    expect(resolveAppearance('night', true)).toBe('night');
  });
});

it('外观或叙事视角的变更不会恢复另一标签已关闭的世界阶段', () => {
  const base = defaultSettings();
  const latest = structuredClone(base);
  latest.runtime.useWorldStage = false;
  const edited = structuredClone(base);
  edited.prompts.perspective = 'first';
  edited.display.appearance = 'day';
  expect(mergeSettingsChanges(base, edited, latest)).toEqual({
    ...latest, prompts: edited.prompts, display: edited.display,
  });
});
