import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPreset, exportWithOverrides } from '../presets/package';
import { readPresetSettings, resetPackage, savePresetSettings } from '../presets/settings';
import { builtInPresets, captureStoryPreset } from '../presets/library';
import { presetMacros } from '../presets/macros';
import { assemblePreset } from '../presets/messages';
import { composePrompt } from '../prompts/composer';
import { talentMemoryInput, talentPromptInput } from './fixtures/talentPrompt';
import { newCreation, buildCreationState } from '../ui/creation/model';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { runStageRequest } from '../services/ai/runtime';
import { recoveryNarrative, recoverySummary, recoveryGuide } from './fixtures/storyRecovery';
import { requestSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';

const def = { id: 'synthetic', version: 'v1', lockedOff: ['retired'] };
const rows = [
  { identifier: 'setup', enabled: false, content: '{{setvar::name::{{user}}}}' },
  { identifier: 'intro', content: '{{getvar::name}} / {{char}}' },
  { identifier: 'empty', content: '   ' },
  { identifier: 'chatHistory', marker: true },
  {
    identifier: 'depth',
    role: 'user',
    content: 'first',
    injection_position: 1,
    injection_depth: 1,
    injection_order: 10,
  },
  {
    identifier: 'depth2',
    role: 'system',
    content: 'second',
    injection_position: 1,
    injection_depth: 1,
    injection_order: 20,
  },
  { identifier: 'retired', content: 'never' },
  { identifier: 'unordered', content: 'never' },
];
function fixture() {
  const order = rows.slice(0, -1).map((x) => ({ identifier: x.identifier, enabled: true }));
  const rule = {
    id: 'r',
    findRegex: '/a(\\d)/g',
    replaceString: '$1!',
    placement: [2],
    promptOnly: true,
    minDepth: 1,
    maxDepth: 1,
  };
  return {
    prompts: structuredClone(rows),
    prompt_order: [{ character_id: 100001, order }],
    extensions: {
      regex_scripts: [rule, { ...rule, findRegex: '/!/g', replaceString: '!!', disabled: true }],
      SPreset: { regex_scripts: [rule] },
      extraVendor: { keep: true },
      tavern_helper: {
        scripts: [
          {
            type: 'folder',
            scripts: [
              {
                type: 'script',
                id: 'child',
                enabled: true,
                button: { buttons: [] },
                data: { old: 1 },
                content: 'inert',
              },
            ],
          },
        ],
      },
    },
  };
}
const raw = JSON.stringify(fixture());
const edit = {
  version: 'v1',
  entries: { intro: { content: 'replacement' } },
  scripts: { child: { enabled: false, data: { new: 2 } } },
};
const materials = {
  user: '主人公',
  char: '邻居',
  markers: {},
  history: [
    { role: 'assistant' as const, content: 'older a1' },
    { role: 'assistant' as const, content: 'a2' },
    { role: 'user' as const, content: 'act a3' },
  ],
};
let store: Storage;
beforeEach(() => {
  const map = new Map<string, string>();
  store = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal('localStorage', store);
});
afterEach(() => vi.unstubAllGlobals());
describe('包、顺序及全局覆盖', () => {
  it('分开保留原件、执行视图与可合并导出，含目录内脚本数据', () => {
    const view = loadPreset(raw, def, edit);
    expect(view.raw).toBe(raw);
    expect(view.entries.map((p) => p.identifier)).not.toContain('unordered');
    expect(view.entries.find((p) => p.identifier === 'setup')?.enabled).toBe(true);
    expect(view.entries.find((p) => p.identifier === 'retired')?.enabled).toBe(false);
    const exported = JSON.parse(exportWithOverrides(raw, def, edit));
    expect(exported.extensions.extraVendor).toEqual({ keep: true });
    expect(exported.extensions.tavern_helper.scripts[0].scripts[0]).toMatchObject({
      enabled: false,
      data: { old: 1, new: 2 },
      content: 'inert',
      button: { buttons: [] },
    });
    expect(loadPreset(JSON.stringify(exported), def).entries).toEqual(view.entries);
  });
  it('拒绝无标识、顺序悬空、重复条目和顺序表歧义', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.prompts[0].identifier = '';
      },
      (f: ReturnType<typeof fixture>) => {
        f.prompts.push(f.prompts[0]);
      },
      (f: ReturnType<typeof fixture>) => {
        f.prompt_order[0].order[0].identifier = 'absent';
      },
      (f: ReturnType<typeof fixture>) => {
        f.prompt_order[0].order.push(f.prompt_order[0].order[0]);
      },
      (f: ReturnType<typeof fixture>) => {
        f.prompt_order.push(f.prompt_order[0]);
      },
      (f: ReturnType<typeof fixture>) => {
        f.prompt_order[0].character_id = 0;
      },
    ]) {
      const f = fixture();
      mutate(f);
      expect(() => loadPreset(JSON.stringify(f), def)).toThrow();
    }
    expect(() => loadPreset(raw, def, { ...edit, version: 'old' })).toThrow();
  });
  it('配置全局重读、分包恢复、写入失败如实返回', () => {
    expect(readPresetSettings().enabled).toBe(false);
    savePresetSettings({ enabled: true, selected: 'synthetic', packages: { synthetic: edit, second: edit } });
    resetPackage('synthetic');
    expect(readPresetSettings()).toEqual({
      enabled: true,
      selected: 'synthetic',
      packages: { second: edit },
    });
    expect(() =>
      savePresetSettings(readPresetSettings(), {
        setItem() {
          throw Error('quota');
        },
      }),
    ).toThrow('quota');
  });
});
describe('单请求宏与历史发送', () => {
  it('支持先写后读、两类随机、空值、转义与未知嵌套保留', () => {
    const m = presetMacros('甲', '乙', () => 0.75);
    expect(
      m.expand(
        '{{setvar::x::{{random::a::b}}}}{{getvar::x}} {{random a,b}} {{random::a,b}} {{user}} {{char}}',
      ),
    ).toBe('b b b 甲 乙');
    expect(m.expand('{{setvar::x::}}{{getvar::x}}')).toBe('');
    expect(m.expand(String.raw`\{\{user\}\} {{unknown::{{user}}}}`)).toBe('{{user}} {{unknown::{{user}}}}');
    expect([...m.unknown]).toEqual(['unknown']);
    expect(presetMacros('丙', '丁').expand('{{getvar::x}}')).toBe('');
  });
  it('合并角色、深度与顺序，在副本上只执行权威来源的发送类正则', () => {
    const assembled = assemblePreset(loadPreset(raw, def), materials);
    expect(assembled.messages.map((m) => [m.role, m.content])).toEqual([
      ['system', '主人公 / 邻居'],
      ['assistant', 'older a1'],
      ['assistant', '2!'],
      ['user', 'first'],
      ['system', 'second'],
      ['user', 'act a3'],
    ]);
    expect(materials.history[1].content).toBe('a2');
  });
});
const selection = () => ({ enabled: true, selected: builtInPresets[0].id, packages: {} });
function channelSetup() {
  const config = defaultAiConfig(),
    channel = newChannel('openai');
  channel.defaultModel = 'synthetic-model';
  channel.parameters = { temperature: 0.25, maxOutputTokens: 4096 };
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '' };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'fixture-credential');
  return { config, vault };
}
describe('正式组装入口', () => {
  it('拍下开始时的配置，切换后新存档使用自己的主角、行动、历史与游戏格式', async () => {
    const a = talentPromptInput('story', 'regular'),
      b = talentPromptInput('story', 'regular');
    b.state.protagonist.name = '独立档案乙';
    const native = await composePrompt(a);
    savePresetSettings(selection());
    const snap = captureStoryPreset();
    savePresetSettings({ ...selection(), enabled: false });
    a.historyActions = { 'talent-history-0': '合成前回合行动' };
    const adapted = await composePrompt(a, snap),
      second = await composePrompt(b, snap);
    expect(adapted.preset?.unknownMacros).toEqual(['//']);
    const sent = adapted.messages.map((m) => m.content).join('\n');
    expect(sent.split(a.userInput)).toHaveLength(2);
    expect(sent.indexOf('[[WAVE_CONTEXT_BEGIN_07_8d2c91]]')).toBeLessThan(sent.indexOf(a.userInput));
    expect(sent.indexOf(a.userInput)).toBeLessThan(sent.indexOf('[[WAVE_CONTEXT_END_07_8d2c91]]'));
    expect(sent.indexOf('[[WAVE_CONTEXT_END_07_8d2c91]]')).toBeLessThan(sent.indexOf('【最终格式提醒】'));
    expect(sent).not.toMatch(/<wave_(?:summary|plan|comments?|parallel)\b|<content>/u);
    expect(adapted.messages.filter((m) => m.content === a.userInput)).toHaveLength(1);
    expect(adapted.messages.filter((m) => m.content === '合成前回合行动')).toEqual([
      { role: 'user', content: '合成前回合行动' },
    ]);
    expect(adapted.messages.at(-1)).toEqual(native.messages.at(-1));
    expect(adapted.modules.some((m) => m.id.startsWith('writing.style'))).toBe(false);
    expect(second.messages.map((m) => m.content).join('')).toContain('独立档案乙');
    expect(adapted.messages.map((m) => m.content).join('')).not.toContain('独立档案乙');
    expect((await composePrompt(a)).messages).toEqual(native.messages);
  });
  it('开局材料沿用本存档的主角与行动，保留必要游戏规则；设置关闭恢复原生偏好', async () => {
    const input = talentPromptInput('story', 'opening');
    input.state = buildCreationState(
      {
        ...newCreation(),
        person: { name: '开局合成人物', age: '30', gender: '女性', appearance: '', personality: '' },
        profession: '教师',
      },
      input.settings,
    );
    input.draft = undefined;
    const original = structuredClone(input);
    savePresetSettings(selection());
    const assembled = await composePrompt(input);
    const body = assembled.messages.map((m) => m.content).join('\n');
    expect(body.split(input.userInput)).toHaveLength(2);
    expect(body).toContain('OPENING_TIME');
    expect(body).toContain(input.state.protagonist.name);
    expect(body).toContain('<变量规划>');
    expect(assembled.modules.map((m) => m.id)).toContain('worldbooks.heijin.worldview');
    expect(input).toEqual(original);
  });
  it('需要中途 system 的预设在不支持的协议发送前明确拒绝', async () => {
    const { config, vault } = channelSetup();
    config.channels[0].protocol = 'anthropic';
    savePresetSettings(selection());
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      runStageRequest(
        talentPromptInput('story', 'regular'),
        config,
        vault,
        { stream: false },
        new AiClient(fetcher),
      ),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['variables', 'world', 'memory'] as const)('%s 完整出站载荷不受选择影响', async (stage) => {
    const input = stage === 'memory' ? talentMemoryInput() : talentPromptInput(stage, 'regular');
    const { config, vault } = channelSetup();
    const snap = requestSnapshot(config, stage, vault);
    const a = await composePrompt(input);
    savePresetSettings(selection());
    const b = await composePrompt(input);
    expect(b).toEqual(a);
    expect(wireRequest(snap, b.messages, false)).toEqual(wireRequest(snap, a.messages, false));
  });
  it('真实 Runtime 单次 Mock，保留渠道预算、严格解析和行动选项规则', async () => {
    savePresetSettings(selection());
    const { config, vault } = channelSetup();
    const input = talentPromptInput('story', 'regular');
    let output =
      '<正文>' +
      recoveryNarrative +
      '</正文><短期记忆>' +
      recoverySummary +
      '</短期记忆><变量规划>' +
      JSON.stringify(recoveryGuide) +
      '</变量规划>';
    const fetcher = vi.fn<typeof fetch>(async () => {
      return Response.json({ choices: [{ message: { content: output }, finish_reason: 'stop' }] });
    });
    const run = () => runStageRequest(input, config, vault, { stream: false }, new AiClient(fetcher));
    expect((await run()).result).toMatchObject({ narrative: recoveryNarrative });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      model: 'synthetic-model',
      max_completion_tokens: 4096,
      temperature: 1,
      top_p: 1,
    });
    expect(body.tools).toBeUndefined();
    expect(body.messages.at(-1).role).toBe('user');
    expect(fetcher).toHaveBeenCalledTimes(1);
    input.settings.prompts.actionOptions = true;
    await expect(run()).rejects.toThrow();
    output = '<正文>孤立正文</正文>';
    await expect(run()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
