import { describe, expect, it, onTestFinished, vi } from 'vitest';
import raw from '../presets/resources/peinture-1118.json?raw';
import manifest from '../presets/resources/peinture-manifest.json';
import { loadPreset, packageOverride } from '../presets/package';
import {
  customSlot,
  checkSelection,
  controls,
  editOutput,
  emptyOverride,
  enabled,
  outputPreferences,
  samplingFields,
  toggleEntry,
} from '../presets/peintureSettings';

const preset = loadPreset(raw, manifest);
const defaults = emptyOverride(preset);
it('面板仅列出已排序、可用的内容条目，互斥组成员均有入口', () => {
  const ids = controls.sections.flatMap((section) => section.ids);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    const row = preset.entries.find((r) => r.identifier === id);
    expect(row?.content.trim()).toBeTruthy();
    expect(row?.marker).toBe(false);
    expect(manifest.lockedOff).not.toContain(id);
  }
  for (const g of controls.groups) expect(ids).toEqual(expect.arrayContaining(g.ids));
  expect(() => toggleEntry(preset, defaults, 'wave-extra-summary', true)).toThrow();
});
describe.each(controls.groups)('$name', (group) => {
  it('适配默认、替换、保存重载、取消选择和清除覆盖均遵循原组规则', () => {
    expect(group.rule).toBe('atMostOne');
    checkSelection(preset, defaults);
    let edits = defaults;
    for (const id of group.ids) {
      edits = toggleEntry(preset, edits, id, true);
      checkSelection(preset, edits);
      const saved = loadPreset(raw, manifest, JSON.parse(JSON.stringify(edits)));
      expect(
        saved.entries
          .filter((row) => group.ids.includes(row.identifier) && row.enabled)
          .map((row) => row.identifier),
      ).toEqual([id]);
    }
    const last = group.ids.at(-1)!;
    expect(group.ids.some((id) => enabled(preset, toggleEntry(preset, edits, last, false), id))).toBe(false);
    expect(loadPreset(raw, manifest).entries).toEqual(preset.entries);
    const conflicting = structuredClone(edits);
    for (const id of group.ids) conflicting.entries[id] = { enabled: true };
    expect(() => checkSelection(preset, conflicting)).toThrow(group.name);
  });
});
it('采样上下界、零值及脚本偏好独立于内置资源', () => {
  for (const { key, min, max } of samplingFields) {
    for (const value of [min, 0, max])
      expect(loadPreset(raw, manifest, { ...defaults, sampling: { [key]: value } }).sampling[key]).toBe(
        value,
      );
    for (const value of [min - 1, max + 1])
      expect(packageOverride.safeParse({ ...defaults, sampling: { [key]: value } }).success).toBe(false);
  }
  expect(outputPreferences(editOutput(defaults, { mode: 'text', unescape: true }))).toEqual({
    mode: 'text',
    unescape: true,
  });
  expect(outputPreferences(defaults)).toEqual({ mode: 'auto', unescape: false });
});

it('自定义输入保留已适配模板，字面宏和双冒号按文字读取', () => {
  for (const id of controls.sections.find((s) => s.name === '自定义')!.ids) {
    const original = preset.entries.find((r) => r.identifier === id)!.content;
    const slot = customSlot(id, original, original)!;
    expect(slot.value).toBe('');
    const text = '合成文字 {{user}}::保留';
    expect(customSlot(id, original, slot.replace(text))?.value).toBe(text);
    expect(customSlot(id, original, '旧模板')).toBeUndefined();
  }
});

it('可编辑条目在适配版消息中有实际效果，资料及输出边界仍在', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  onTestFinished(() => { random.mockRestore(); });
  const { composePrompt } = await import('../prompts/composer');
  const { talentPromptInput } = await import('./fixtures/talentPrompt');
  const input = talentPromptInput('story', 'regular');
  const base = await composePrompt(input, {definition:manifest});
  const unchanged:string[]=[];
  for(const id of controls.sections.flatMap(section=>section.ids)) {
    const edits=toggleEntry(preset,defaults,id,!enabled(preset,defaults,id));
    const changed=await composePrompt(input,{definition:manifest,overrides:edits});
    if(JSON.stringify(changed.messages)===JSON.stringify(base.messages)) unchanged.push(id);
    expect(changed.messages.at(-1)).toEqual(base.messages.at(-1));
  }
  expect(unchanged).toEqual([]);
});
