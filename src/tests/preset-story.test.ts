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
import { tavernEvents } from '../presets/tavern/events';
import { previewTavernStory, runStageRequest } from '../services/ai/runtime';
import { recoveryNarrative, recoverySummary, recoveryGuide } from './fixtures/storyRecovery';
import { requestSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { clearAdjustedParameters, knownSamplingLimit, skipsPresetSampling } from '../services/ai/compat';
import { requestInspections } from '../services/ai/inspection';

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
  it('干跑组装真实预设，发出预览事件，不调用 fetch', async () => {
    const input = talentPromptInput('story', 'regular');
    savePresetSettings(selection());
    const order: string[] = [];
    const hooks = [
      tavernEvents.on('generation_started', (type, _options, dry) => order.push(type + dry)),
      tavernEvents.on('GENERATION_AFTER_COMMANDS', () => order.push('commands')),
      tavernEvents.on('chat_completion_prompt_ready', e => { order.push('prompt'); expect(e.dryRun).toBe(true); }),
      tavernEvents.on('generate_after_data', (d, dry) => { order.push('data' + dry); d.prompt.push({ role: 'user', content: '预览标记' }); }),
      tavernEvents.on('chat_completion_settings_ready', () => order.push('send')),
    ];
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      const preview = await previewTavernStory({ ...input, stage: 'story' });
      expect(preview.at(-1)?.content).toBe('预览标记');
      expect(preview.some(m => m.content.includes(input.userInput))).toBe(true);
      expect(order).toEqual(['normaltrue','commands','prompt','datatrue']);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { hooks.forEach(h => h.stop()); fetcher.mockRestore(); }
  });
  it('Anthropic 预设将中途 system 留在原位置，以标记的 user 文本发送；原生路径仍拒绝', async () => {
    const { config, vault } = channelSetup();
    config.channels[0].protocol = 'anthropic';
    savePresetSettings(selection());
    const input = talentPromptInput('story', 'regular');
    const snap = requestSnapshot(config, 'story', vault);
    const { messages } = await composePrompt({ ...input, cotAllowed: snap.useCot });
    expect(() => wireRequest(snap, messages, false)).toThrow();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ type: 'error', error: {} }));
    await expect(runStageRequest(input, config, vault, { stream: false }, new AiClient(fetcher))).rejects.toMatchObject({ code: 'rejected' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const history = messages.slice(messages.findIndex(m => m.role !== 'system'));
    expect(body.messages).toEqual(history.map(m => m.role === 'system' ? { role: 'user', content: '[system]\n' + m.content } : m));
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

describe('预设正文采样兼容', () => {
  const sampling = { temperature: 0, top_p: 0, frequency_penalty: -0.25, presence_penalty: 0 };
  const messages = [{ role: 'user' as const, content: '合成行动' }];
  const ok = () => Response.json({ choices: [{ message: { content: '合成正文' }, finish_reason: 'stop' }] });
  const rejected = (field: string) =>
    ({ code: 'unsupported_parameter', param: field, message: `Unsupported parameter: '${field}' is not supported with this model.` });
  function transport(error?: Record<string, unknown>, status = 400) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ok());
    if (error) fetcher.mockImplementationOnce(async () => Response.json({ error }, { status }));
    const ai = new AiClient(fetcher);
    const body = (i: number) => JSON.parse(String(fetcher.mock.calls[i][1]?.body));
    return { ai, fetcher, body };
  }
  beforeEach(() => { clearAdjustedParameters(); requestInspections.clear(); });
  afterEach(() => { clearAdjustedParameters(); requestInspections.clear(); });

  it.each(['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-2025-08-07', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07'])(
    '官方 %s 第一次出站即省略 temperature 和 top_p，惩罚参数保留',
    async (model) => {
      const { config, vault } = channelSetup();
      config.routes.story.modelId = model;
      const { ai, fetcher, body } = transport();
      await ai.generate(requestSnapshot(config, 'story', vault), messages, { presetSampling: sampling });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(body(0)).toMatchObject({ model, max_completion_tokens: 4096, frequency_penalty: -0.25, presence_penalty: 0 });
      expect(body(0)).not.toHaveProperty('temperature');
      expect(body(0)).not.toHaveProperty('top_p');
      expect(requestInspections.getSnapshot()[0]).toMatchObject({
        presetSampling: expect.arrayContaining([
          { field: 'top_p', desired: 0, omission: 'known_capability' },
          { field: 'presence_penalty', desired: 0, sent: 0 },
        ]),
      });
    },
  );

  it.each([
    ['gpt-5.2', 'https://api.openai.com/v1'],
    ['gpt-5.1', 'https://api.openai.com/v1'],
    ['gpt-5-custom', 'https://api.openai.com/v1'],
    ['gpt-5', 'https://api.openai.com/proxy/v1'],
    ['gpt-5-mini', 'https://relay.example/v1'],
  ])('保留 %s 在 %s 的值，包括 0', async (model, url) => {
    const { config, vault } = channelSetup();
    config.routes.story.modelId = model;
    config.channels[0].baseUrl = url;
    const { ai, fetcher, body } = transport();
    await ai.generate(requestSnapshot(config, 'story', vault), messages, { presetSampling: sampling });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${url}/chat/completions`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-credential' }),
    }));
    expect(body(0)).toMatchObject({ ...sampling, model });
    expect(body(0).max_tokens ?? body(0).max_completion_tokens).toBe(4096);
    expect(body(0)).not.toHaveProperty('reasoning_effort');
  });

  it('关闭渠道温度时，官方旧模型仍会独立检查 top_p', async () => {
    const { config, vault } = channelSetup();
    const channel = config.channels[0];
    channel.compatibility.temperature = false;
    config.routes.story.modelId = 'gpt-5';
    const { ai, body } = transport();
    await ai.generate(requestSnapshot(config, 'story', vault), messages, { presetSampling: sampling });
    expect(body(0)).not.toHaveProperty('temperature');
    expect(body(0)).not.toHaveProperty('top_p');
    expect(requestInspections.getSnapshot()[0].presetSampling).toEqual(expect.arrayContaining([
      { field: 'temperature', desired: 0, omission: 'channel_setting' },
      { field: 'top_p', desired: 0, omission: 'known_capability' },
    ]));
  });

  it('官方 GPT-5.2 默认 none 的实际发送和条件拒绝与其他推理设置隔离', async () => {
    const { config, vault } = channelSetup();
    const channel = config.channels[0], model = 'gpt-5.2';
    const url = `${channel.baseUrl}/chat/completions`;
    config.routes.story.modelId = model;
    const snapshot = requestSnapshot(config, 'story', vault);
    const { ai, body, fetcher } = transport({
      code: 'unsupported_parameter', param: 'frequency_penalty',
      message: "frequency_penalty is not supported when reasoning_effort is 'none'.",
    });
    const run = () => ai.generate(snapshot, messages, { presetSampling: sampling });
    await expect(run()).rejects.toMatchObject({ code: 'parameter_adjusted' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = body(0);
    expect(sent).toMatchObject(sampling);
    expect(sent).not.toHaveProperty('reasoning_effort');
    await run();
    expect(body(1)).not.toHaveProperty('frequency_penalty');
    expect(body(1).top_p).toBe(0);
    // 当前游戏不写 reasoning_effort。验证以后传入真实配置时，规则只按对应值匹配。
    const low = { ...sent, reasoning_effort: 'low' };
    expect(knownSamplingLimit(channel, url, model, 'top_p', low)).toBe(true);
    expect(knownSamplingLimit(channel, url, model, 'top_p', { ...sent, reasoning_effort: 'none' })).toBe(false);
    expect(knownSamplingLimit(channel, url, model, 'top_p', { ...sent, reasoning_effort: 'unrecognized' })).toBe(false);
    expect(skipsPresetSampling(channel, url, model, 'frequency_penalty', sampling.frequency_penalty, low)).toBe(false);
    expect(skipsPresetSampling(channel, url, model, 'frequency_penalty', sampling.frequency_penalty, sent)).toBe(true);
  });

  it('同路由的原生四阶段完整实际请求不受预设学习影响', async () => {
    const { config, vault } = channelSetup();
    config.channels[0].baseUrl = 'https://relay.example/v1';
    const { ai, body, fetcher } = transport();
    const stages = ['story', 'variables', 'world', 'memory'] as const;
    const native = () => Promise.all(stages.map((stage) => ai.generate(requestSnapshot(config, stage, vault), messages)));
    await native();
    fetcher.mockImplementationOnce(async () => Response.json({ error: rejected('temperature') }, { status: 400 }));
    const preset = () => ai.generate(requestSnapshot(config, 'story', vault), messages, { presetSampling: sampling });
    await expect(preset()).rejects.toMatchObject({ code: 'parameter_adjusted' });
    await preset();
    expect(body(5)).not.toHaveProperty('temperature');
    await native();
    expect(fetcher).toHaveBeenCalledTimes(10);
    for (let i = 0; i < stages.length; i++) expect(body(6 + i)).toEqual(body(i));
  });

  it.each(['top_p', 'frequency_penalty', 'presence_penalty', 'temperature'] as const)(
    '明确拒绝 %s 后，本次单次失败，下次主动生成才省略',
    async (field) => {
      const { config, vault } = channelSetup();
      config.channels[0].baseUrl = 'https://relay.example/v1';
      const snapshot = requestSnapshot(config, 'story', vault);
      const { ai, fetcher, body } = transport(rejected(field));
      const run = () => ai.generate(snapshot, messages, { presetSampling: sampling });
      await expect(run()).rejects.toMatchObject({ code: 'parameter_adjusted' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(body(0)).toMatchObject(sampling);
      expect(requestInspections.getSnapshot()[0]).toMatchObject({ status: 'failed', body: sampling });
      await run();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(body(1)).not.toHaveProperty(field);
      for (const key of Object.keys(sampling).filter((key) => key !== field))
        expect(body(1)[key]).toBe(body(0)[key]);
      expect(requestInspections.getSnapshot()[0]).toMatchObject({
        presetSampling: expect.arrayContaining([{ field, desired: sampling[field], omission: 'remembered_rejection' }]),
      });
    },
  );

  it.each([
    ['数值越界', { ...rejected('top_p'), message: 'top_p must be between 0 and 1' }, 400],
    ['一般 invalid_value', { ...rejected('top_p'), code: 'invalid_value' }, 422],
    ['错误字段与文字冲突', { ...rejected('top_p'), param: 'temperature' }, 400],
    ['缺字段的默认值说明', { code: 'unsupported_value', message: 'Only the default (1) value is supported.' }, 422],
    ['本次已发送所称默认值', { code: 'unsupported_value', param: 'top_p', message: 'Only the default (0) value is supported.' }, 422],
    ['未识别的结构化条件', { ...rejected('top_p'), message: { condition: 'unknown' } }, 400],
    ['含糊提示', { message: 'Could not handle a sampling option' }, 400],
    ['普通 unsupported_value', { ...rejected('top_p'), code: 'unsupported_value', message: 'Invalid value supplied for top_p.' }, 400],
    ['未发送的字段', rejected('presence_penalty'), 400],
    ['401', rejected('top_p'), 401],
    ['403', rejected('top_p'), 403],
    ['429', rejected('top_p'), 429],
    ['500', rejected('top_p'), 500],
    ['未知实际推理配置', { ...rejected('top_p'), message: "Unsupported parameter: 'top_p' is only supported when reasoning_effort is 'none'." }, 400],
    ['其他未识别条件', { ...rejected('top_p'), message: 'top_p is not supported when tools are enabled.' }, 400],
  ] as const)('%s 不记忆', async (name, error, status) => {
    const { config, vault } = channelSetup();
    config.channels[0].baseUrl = 'https://relay.example/v1';
    const snapshot = requestSnapshot(config, 'story', vault);
    const { ai, fetcher, body } = transport(error, status);
    const sent = name === '未发送的字段' ? { ...sampling, presence_penalty: undefined } : sampling;
    const run = () => ai.generate(snapshot, messages, { presetSampling: sent });
    await expect(run()).rejects.not.toMatchObject({ code: 'parameter_adjusted' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await run();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(body(1)).toEqual(body(0));
  });

  it.each([
    "Unsupported value: 'frequency_penalty' does not support -0.25 with this model. Only the default (0) value is supported.",
    'Only the default (0) value is supported.',
  ])('只接受默认值时区分已拒绝值和可发送的 0：%s', async (message) => {
    const { config, vault } = channelSetup();
    config.channels[0].baseUrl = 'https://relay.example/v1';
    const snapshot = requestSnapshot(config, 'story', vault);
    const { ai, body, fetcher } = transport({
      code: 'unsupported_value', param: 'frequency_penalty',
      message,
    }, 422);
    const run = (frequency_penalty: number) =>
      ai.generate(snapshot, messages, { presetSampling: { ...sampling, frequency_penalty } });
    await expect(run(-0.25)).rejects.toMatchObject({ code: 'parameter_adjusted' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await run(-0.25);
    await run(0);
    expect(body(1)).not.toHaveProperty('frequency_penalty');
    expect(body(2).frequency_penalty).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('兼容记忆按渠道、模型、地址和协议隔离，并沿用清理入口', async () => {
    const { config, vault } = channelSetup();
    const channel = config.channels[0];
    channel.baseUrl = 'https://relay.example/v1';
    const { ai, body } = transport(rejected('top_p'));
    const run = () => ai.generate(requestSnapshot(config, 'story', vault), messages, { presetSampling: sampling });
    await expect(run()).rejects.toMatchObject({ code: 'parameter_adjusted' });
    config.channels[0] = { ...channel, id: crypto.randomUUID() };
    vault.set(config.channels[0].id, 'fixture-credential');
    config.routes.story.channelId = config.channels[0].id;
    await run();
    config.channels[0] = { ...channel, protocol: 'deepseek' };
    config.routes.story.channelId = channel.id;
    await run();
    config.channels[0] = { ...channel, baseUrl: 'https://other-relay.example/v1' };
    await run();
    config.channels[0] = channel;
    config.routes.story.modelId = 'another-model';
    await run();
    config.routes.story.modelId = '';
    await run();
    clearAdjustedParameters();
    await run();
    expect([1, 2, 3, 4, 6].map((i) => body(i).top_p)).toEqual([0, 0, 0, 0, 0]);
    expect(body(5)).not.toHaveProperty('top_p');
  });
});
