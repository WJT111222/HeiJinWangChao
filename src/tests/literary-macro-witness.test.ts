import { expect, it, vi } from 'vitest';
import { parsePresetTemplate, presetMacros } from '../presets/macros';
import { canResumeWriting, captureStoryWriting, resolveStoryPreset } from '../presets/library';
import manifest from '../presets/resources/peinture-1124-manifest.json';
import { emptyOverride } from '../presets/peintureSettings';
import { talentPromptInput } from './fixtures/talentPrompt';

it('只删除能被原解析器识别的注释，保留词法边界、转义、未知语法和有副作用的宏', () => {
  const parse = parsePresetTemplate;
  expect(parse('前{{// {{random::甲::乙}} }}后')).toEqual(parse('前后'));
  expect(parse('{{setvar::x::甲{{//注}}乙}}{{getvar::x}}')).toEqual(parse('{{setvar::x::甲乙}}{{getvar::x}}'));
  expect(parse('\\{{//注}}')).not.toEqual(parse(''));
  expect(parse('{{unknown::{{// 内文 }} }}')).not.toEqual(parse('{{unknown:: }}'));
  expect(parse('{x{{//注}}{user}}')).not.toEqual(parse('{{user}}'));
  expect(parse('{{random::甲::乙}}')).not.toEqual(parse('{{random::乙::甲}}'));
  expect(parse('{{setvar::x::甲}}{{getvar::x}}')).not.toEqual(parse('甲'));
  for (const bad of ['{{// 未闭合','{{user::多余}}','{{setvar::x}}']) {
    expect(() => parse(bad)).toThrow();
    expect(() => presetMacros('我','他').expand(bad)).toThrow();
  }
  const random = vi.fn(() => 0);
  const runtime = presetMacros('{{char}}','他',random);
  const templ = '{{setvar::x::{{random::山::海}}}}{{//{{random::甲::乙}}}}{{getvar::x}}{{user}}';
  parse(templ);
  expect(random).not.toHaveBeenCalled();
  expect(runtime.expand(templ)).toBe('山{{char}}');
  expect(random).toHaveBeenCalledTimes(1);
});

it('v4 注释增删改可续写，v3 原始断点只能用当前原文或发行默认配置举证', async () => {
  const loaded = await resolveStoryPreset({definition:manifest});
  const id = 'wave-length-800-1000';
  const source = loaded.entries.find(row => row.identifier === id)!.content;
  const prompts = talentPromptInput('story','regular').settings.prompts;
  const selection = (suffix: string) => ({definition:manifest,overrides:{
    ...emptyOverride(loaded),entries:{[id]:{content:source+suffix}},
  }});
  const configs = ['', '{{// 本地校对备注 }}', '{{// {{char}} 换条备注 }}'].map(selection);
  const writings = await Promise.all(configs.map(s => captureStoryWriting(s,prompts)));
  const base = writings[0];
  if (base.source !== 'preset') throw Error('preset expected');
  expect(base.configurationVersion).toBe(4);
  for (let i=0;i<writings.length;i++) for (const old of writings)
    expect(await canResumeWriting(old,writings[i],configs[i])).toBe(true);
  const real = selection('请写出码头上路灯的颜色。'), changed = await captureStoryWriting(real,prompts);
  expect(await canResumeWriting(base,changed,real)).toBe(false);
  const legacy = { ...base, configurationVersion:3 as const,
    configuration:'539d3723a0c8c5fcdaa4b101f9dd3e7fc1bd890533e34583ff0c0839ab4625a9' };
  expect(await canResumeWriting(legacy,writings[1],configs[1])).toBe(true);
  expect(await canResumeWriting(legacy,changed,real)).toBe(false);
  const custom = {...legacy,configuration:'8b0b149bcec9b7b6f5d85d3b14c56c6bb9b0d935adf4a6b573a9c4f5858a11ee'};
  expect(await canResumeWriting(custom,changed,real)).toBe(true);
  expect(await canResumeWriting(custom,base,configs[0])).toBe(false);
});
