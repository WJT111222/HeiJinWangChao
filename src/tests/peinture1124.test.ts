import { expect, it } from 'vitest';
import manifest from '../presets/resources/peinture-1124-manifest.json';
import { controlsFor, emptyOverride, checkSelection, enabled, lockedByWritingStyle, toggleEntry } from '../presets/peintureSettings';
import { builtInPresets, canResumeWriting, captureStoryWriting, resolveStoryPreset } from '../presets/library';
import { applyScheme, parseScheme, snapshotScheme } from '../presets/peintureScheme';
import { historyForSending } from '../presets/history';
import { assemblePreset } from '../presets/messages';
import { scriptOrder } from '../presets/scriptOrder';
import { talentPromptInput } from './fixtures/talentPrompt';

it('1118 与 1124 分别注册，控制台文风和互斥菜单按版本解析', () => {
  const modern = controlsFor(manifest.id), old = controlsFor('peinture-1118');
  expect(builtInPresets.map(item => item.id)).toEqual(expect.arrayContaining(['peinture-1118', manifest.id]));
  expect(modern.groups.find(g=>g.name==='文风')?.ids).toContain('wave-style-stream-of-consciousness');
  expect(old.groups.find(g=>g.name==='文风')?.ids).not.toContain('wave-style-stream-of-consciousness');
  for (const section of modern.sections) for (const id of section.ids) expect(manifest.lockedOff).not.toContain(id);
});

it('内置 1124 的宏、四条历史正则、完整菜单及断点来源', async () => {
  const selection = { definition:manifest }, preset = await resolveStoryPreset(selection);
  expect(preset.entries).toHaveLength(168);
  expect(scriptOrder(preset.scripts).filter(s=>s.enabled)).toHaveLength(3);
  expect(preset.data.extensions?.regex_scripts).toHaveLength(4);
  expect(/LogUpload|waveShieldPrepare|防路由护盾/.test(preset.raw)).toBe(false);
  const defaults = emptyOverride(preset);
  checkSelection(preset,defaults);
  const edited = toggleEntry(preset,defaults,'wave-style-stream-of-consciousness',true);
  const revised = await resolveStoryPreset({...selection,overrides:edited});
  const materials = { markers:{worldInfoAfter:'灯塔长期记忆'}, char:'守塔人', user:'林舟', history:[{role:'user' as const,content:'出港'}] };
  const assembled = assemblePreset(revised,materials,()=>0.5);
  expect(assembled.unknownMacros).toEqual([]);
  expect(JSON.stringify(assembled.messages)).toContain('当前文风：意识流');
  for (const id of controlsFor(manifest.id).sections.flatMap(s=>s.ids)) {
    expect(preset.entries.find(row=>row.identifier===id)?.content.trim(),id).toBeTruthy();
  }
  const history = [{role:'assistant' as const,content:'<wave_plan>旧规划</wave_plan><content>既有事实</content><turing_weather>晴</turing_weather>'}];
  expect(historyForSending(history,preset)[0].content).toBe('既有事实<wave_weather>晴</wave_weather>');
  expect(history[0].content).toContain('旧规划');
  const prompts = talentPromptInput('story','regular').settings.prompts;
  const now = await captureStoryWriting(selection,prompts), changed = await captureStoryWriting({...selection,overrides:edited},prompts);
  const old = await captureStoryWriting({ definition:builtInPresets.find(p=>p.id==='peinture-1118')! },prompts);
  expect(await canResumeWriting(now,now,selection)).toBe(true);
  expect(await canResumeWriting(old,now,selection)).toBe(false);
  expect(await canResumeWriting(now,changed,{...selection,overrides:edited})).toBe(false);
});

it('1124 意识流联动视角与心声，方案只恢复可编辑的文学条目', async () => {
  const preset = await resolveStoryPreset({definition: manifest});
  const defaults = emptyOverride(preset);
  const draft = toggleEntry(preset, defaults, 'wave-dialogue-only', true);
  const edited = toggleEntry(preset, draft, 'wave-style-stream-of-consciousness', true);
  for (const id of ['wave-person-first', 'wave-mind-blackbox']) expect(enabled(preset, edited, id)).toBe(true);
  expect(enabled(preset, edited, 'wave-dialogue-only')).toBe(false);
  expect(lockedByWritingStyle(preset, edited, 'wave-person-third')).toBe(true);
  expect(() => toggleEntry(preset, edited, 'wave-person-third', true)).toThrow('意识流');
  const scheme = snapshotScheme(preset, edited, '码头');
  scheme.prompts.push({ id: 'main', enabled: true, content: '合成样例' });
  const loaded = applyScheme(preset, defaults, parseScheme(scheme));
  expect(loaded.skipped).toBe(1);
  expect(loaded.edits.entries.main).toBeUndefined();
  expect(() => checkSelection(preset, loaded.edits)).not.toThrow();
  expect(enabled(preset, loaded.edits, 'wave-mind-blackbox')).toBe(true);
  expect(() => parseScheme({...scheme, prompts:[scheme.prompts[0], scheme.prompts[0]]})).toThrow();
});

it('局部旧方案按最终文风联动，导入顺序无关，冲突不改变现有编辑', async () => {
  const preset = await resolveStoryPreset({definition:manifest});
  const defaults = emptyOverride(preset);
  const stream = 'wave-style-stream-of-consciousness', essay = 'wave-style-essay';
  const edits = toggleEntry(preset,defaults,stream,true), saved = structuredClone(edits);
  const row = (id: string, on = true) => ({id,enabled:on,content:'旧方案测试'});
  const apply = (...prompts: ReturnType<typeof row>[]) => applyScheme(preset,edits,
    parseScheme({name:'旧方案',version:1,format:'wave-console-scheme',family:'wave-1103-dame',prompts})).edits;
  expect(enabled(preset,apply(row('wave-pace-fast')),stream)).toBe(true);
  const rows = [row(essay),row('wave-person-third'),row('wave-style-adaptive',false)];
  const next = apply(...rows);
  expect(apply(...[...rows].reverse())).toEqual(next);
  expect(enabled(preset,next,stream)).toBe(false);
  expect(enabled(preset,next,essay)).toBe(true);
  expect(enabled(preset,next,'wave-person-third')).toBe(true);
  expect(() => apply(row(essay),row('wave-style-wuxia'))).toThrow('互斥');
  expect(() => apply(row(stream),row('wave-person-third'))).toThrow('意识流');
  expect(() => apply(row('wave-mind-blackbox',false))).toThrow('意识流');
  expect(apply(row('main')).entries.main).toBeUndefined();
  expect(edits).toEqual(saved);
});
