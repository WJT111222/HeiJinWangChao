import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createProfileSave, newCreation } from '../ui/creation/model';
import { defaultSettings } from '../ui/settings/model';
import { SaveRepository } from '../services/storage/saveRepository';
import { rerollStory, TurnDraftSchema } from '../domain/drafts';
import { CommandDataError, DataError } from '../domain/common';
import * as domainCommands from '../domain/commands';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import type { ExecutionResult } from '../executors/variableText';
import { parseVariableText } from '../parsers/variableText';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { VariableStage } from '../workflows/variableStage';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { composePrompt } from '../prompts/composer';
import { selectVariableDomains } from '../prompts/variableDomains';
import { variableTextEnvelope } from './fixtures/variableReply';
import { submission } from './fixtures/turn';

const startAt = '2026-10-19T08:00:00+08:00';
const endAt = '2026-10-19T08:45:00+08:00';
const privateMarker = 'isolated-private-value-never-log';
const profile = { bodyDescription: privateMarker };
const initialize = 'set opening.initialState = {"cash":12000,"onlineBalance":34000,"weatherText":"晴","environmentText":"街边早餐店"}';
const gender = 'set npc[companion].gender = "female"';
const privateLine = `set npc[companion].privateProfile = ${JSON.stringify(profile)}`;
const interaction = `set npc[companion].lastInteractionAt = "${endAt}"`;
const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach(repo => repo.close()); vi.restoreAllMocks(); });
function unwrap<T>(result: ExecutionResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const response = (...lines: string[]) => variableTextEnvelope(`<命令>\n${lines.join('\n')}\n</命令>`);

async function fixture(age = '25', identity = '正式资料确认：女性，社区编辑') {
  const form = newCreation();
  form.saveId = 'save-a';
  form.person = { name: '测试主角', age: '30', gender: '男性', appearance: '', personality: '' };
  form.profession = 'custom'; form.customProfession = '档案员';
  form.hasCompanion = true;
  form.companion = { name: '测试同伴', age, identity, appearance: '普通外套', personality: '谨慎',
    skills: '编辑', background: '社区工作经历', relationship: '一起工作的朋友' };
  const settings = defaultSettings();
  const repo = await SaveRepository.open('opening-npc-eligibility', new IDBFactory());
  repositories.push(repo);
  // Use the exact creation -> Repository -> opening draft path; no handcrafted NPC or save patch.
  const state = await createProfileSave(repo, form, settings);
  const initial = (await repo.loadDraft(state.saveId))!;
  const draft = await repo.saveDraft(rerollStory(initial, {
    turnKind: 'opening', narrative: '主角与同伴在早餐店商议今天的工作。', summary: '两人确认今日安排。',
    variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt, endAt }) }],
  }), initial.draftRevision);
  return { state, draft, repo, settings, context: { draft, expectedRevision: state.revision } };
}
async function run(a: Awaited<ReturnType<typeof fixture>>, ...lines: string[]) {
  const ast = parseVariableText(response(...lines));
  if (!ast.ok) throw new Error('invalid authored test syntax');
  const plan = unwrap(await compileVariableCommands(ast.value, a.state, a.context));
  return simulateVariablePlan(plan, a.state, a.context);
}

async function readyDraft(a: Awaited<ReturnType<typeof fixture>>, result: Awaited<ReturnType<typeof parseTextVariables>>) {
  const variables = await a.repo.saveDraft(TurnDraftSchema.parse({
    ...a.draft, draftRevision: a.draft.draftRevision + 1,
    variables: { storyRevision: a.draft.storyRevision, candidateRevision: 1, requestRevision: 0,
      validation: 'validated', result }, stageStatus: { ...a.draft.stageStatus, variables: 'ready' },
  }), a.draft.draftRevision);
  const complete = await a.repo.saveDraft(TurnDraftSchema.parse({
    ...variables, draftRevision: variables.draftRevision + 1,
    world: { storyRevision: variables.storyRevision, candidateRevision: 1, requestRevision: 0,
      basedOnVariableRevision: 1, validation: 'validated',
      result: { worldCommands: [], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] } },
    stageStatus: { ...variables.stageStatus, world: 'ready' },
  }), variables.draftRevision);
  return complete;
}
async function settleOpening(a: Awaited<ReturnType<typeof fixture>>) {
  const result = await parseTextVariables(response(initialize, gender, privateLine, interaction), a.state, a.draft);
  const complete = await readyDraft(a, result);
  return { committed: await a.repo.commitTurn(submission(complete, '')), complete };
}

describe('真实创角同伴的开局资格与命令定位', () => {
  it('缺失结构化性别：正式编译成功，模拟精确返回第三条 NPC_KIND，整批无写入', async () => {
    const a = await fixture(), before = await a.repo.loadGame(a.state.saveId);
    expect(a.state.npc.companion).toMatchObject({ kind: 'special', age: 25 });
    expect(a.state.npc.companion).not.toHaveProperty('gender');
    const result = await run(a, initialize, 'set protagonist.emotionText = "准备出发"', privateLine, interaction);
    expect(result).toMatchObject({ ok: false, error: { code: 'domain_validation_failed', commandIndex: 3,
      relatedCommands: [], diagnostic: { domainRule: 'npc_kind', commandType: 'UpdateNpc', validationRule: 'domain_schema' } } });
    expect(result).not.toHaveProperty('value');
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
    expect(a.state).toEqual(before.state);
  });

  it('阶段与玩家日志保留精确命令类型和位置，不带 NPC 身份、私密值或原始命令', async () => {
    const a = await fixture();
    const failure = await parseTextVariables(response(initialize, privateLine, interaction), a.state, a.draft)
      .then(() => { throw new Error('expected failure'); }, error => error);
    expect(failure).toMatchObject({ code: 'data_integrity', details: { variableStep: 'simulation',
      fieldPath: 'text.domain_validation_failed', commandIndex: 1, commandType: 'UpdateNpc', domainRule: 'npc_kind' } });
    expect(failure.details).not.toHaveProperty('relatedCommandIndices');
    const log = runtimeLogEvent(1, 'variables', 'failed', failure);
    expect(log).toMatchObject({ commandIndex: 2, commandType: 'UpdateNpc', domainRule: 'npc_kind', variableStep: 'simulation' });
    for (const secret of ['companion', privateMarker, '测试同伴', 'bodyDescription', 'stack'])
      expect(JSON.stringify(log)).not.toContain(secret);
  });

  it.each(['18', '25', ''])('已有明确女性依据，先登记性别后初始化：年龄 %s 沿用现有资格', async age => {
    const a = await fixture(age), before = await a.repo.loadGame(a.state.saveId);
    const result = unwrap(await run(a, initialize, gender, privateLine, interaction));
    expect(result.npc.companion).toMatchObject({ kind: 'special', gender: 'female', privateProfile: profile, lastInteractionAt: endAt });
    expect(result.worldClock).toBe(endAt);
    expect(result.npc.companion.kind === 'special' && result.npc.companion.privateProfile).not.toHaveProperty('firstExperienceTarget');
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
  });

  it('合法初始化经过既有候选与原子提交后可重载，时钟与互动时间一致', async () => {
    const a = await fixture();
    const { committed, complete } = await settleOpening(a);
    expect(committed.state).toMatchObject({ turnNumber: 1, revision: 1, worldClock: endAt });
    expect(committed.state.npc.companion).toMatchObject({ gender: 'female', privateProfile: profile, lastInteractionAt: endAt });
    expect(await a.repo.load(a.state.saveId)).toEqual(committed.state);
    expect((await a.repo.commitTurn(submission(complete, ''))).replayed).toBe(true);
  });

  it('真实 VariablesStage 的失败响应不保存候选、不会重发，只记安全失败元数据', async () => {
    const a = await fixture(), before = await a.repo.load(a.state.saveId);
    const channel = { ...newChannel(), defaultModel: 'mock-model' }, config = defaultAiConfig();
    config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: channel.defaultModel };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: channel.defaultModel };
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); } };
    const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-only-credential');
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop',
      message: { content: response(initialize, privateLine, interaction) } }] }));
    const stage = new VariableStage(a.repo, new AiClient(fetcher));
    try {
      await expect(stage.generate({ draft: a.draft, settings: a.settings, config, vault }))
        .rejects.toMatchObject({ code: 'data_integrity', details: { commandIndex: 1,
          commandType: 'UpdateNpc', domainRule: 'npc_kind', variableStep: 'simulation' } });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const failed = (await a.repo.loadDraft(a.state.saveId))!;
      expect(failed.stageStatus.variables).toBe('failed'); expect(failed.variables).toBeUndefined();
      expect(failed.story).toEqual(a.draft.story);
      expect(failed.failures.at(-1)).toMatchObject({ stage: 'variables', errorCode: 'data_integrity' });
      expect(JSON.stringify(failed)).not.toContain(privateMarker);
      expect(await a.repo.load(a.state.saveId)).toEqual(before);
    } finally { stage.dispose(); }
  });

  it('即使测试故意绕过客户端模拟，Repository 最终提交也整批拒绝，无部分资金/人物/journal', async () => {
    const a = await fixture();
    const ast = parseVariableText(response(initialize, privateLine, interaction));
    if (!ast.ok) throw new Error('invalid authored syntax');
    const plan = unwrap(await compileVariableCommands(ast.value, a.state, a.context));
    const complete = await readyDraft(a, { commands: [...plan.commands], rejectedSuggestions: [], unresolved: [] });
    const before = await a.repo.loadGame(a.state.saveId);
    const applied = vi.spyOn(domainCommands, 'commitCommands');
    await expect(a.repo.commitTurn(submission(complete, ''))).rejects.toMatchObject({ code: 'data_integrity' });
    expect(applied.mock.results.some(result => result.type === 'throw'
      && result.value instanceof CommandDataError && result.value.code === 'NPC_KIND')).toBe(true);
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
    expect(await a.repo.load(a.state.saveId)).toEqual(a.state);
  });

  it('没有可靠性别依据：仅正常开局，不自动猜性别或产生专属档案', async () => {
    const a = await fixture('25', '同行的社区编辑');
    const result = unwrap(await run(a, initialize, interaction));
    expect(result.npc.companion).not.toHaveProperty('gender');
    expect(result.npc.companion).not.toHaveProperty('privateProfile');
  });

  it.each([
    ['未知', 'set npc[companion].gender = "unknown"', '25'],
    ['男性', 'set npc[companion].gender = "male"', '25'],
    ['未成年', gender, '17'],
  ])('%s仍不能写专属档案，不会留下前序资金或身份的部分写入', async (_label, identityLine, age) => {
    const a = await fixture(age), before = await a.repo.loadGame(a.state.saveId);
    const result = await run(a, initialize, identityLine, privateLine, interaction);
    expect(result).toMatchObject({ ok: false, error: { commandIndex: 3, relatedCommands: [],
      diagnostic: { domainRule: 'npc_kind', commandType: 'UpdateNpc' } } });
    expect(result).not.toHaveProperty('value');
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
  });

  it('普通成年女性 NPC 仍不能写专属档案，整批建档也不落盘', async () => {
    const a = await fixture(), before = await a.repo.loadGame(a.state.saveId);
    const ordinary = { kind: 'ordinary', identityKey: 'isolated-person', name: '普通人物', age: 25, gender: 'female',
      aliases: [], skills: [], onScene: false, affinity: 0, relationshipText: '初次见面', memories: [], knownInformation: [] };
    const result = await run(a, initialize, `set npc[ordinary] = ${JSON.stringify(ordinary)}`,
      `set npc[ordinary].privateProfile = ${JSON.stringify(profile)}`);
    expect(result).toMatchObject({ ok: false, error: { commandIndex: 3,
      diagnostic: { domainRule: 'npc_kind', commandType: 'UpdateNpc' } } });
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
  });

  it('不能把后写性别当作前一条专属更新的资格，不偷偷重排命令', async () => {
    const a = await fixture();
    expect(await run(a, initialize, privateLine, gender)).toMatchObject({ ok: false,
      error: { commandIndex: 2, diagnostic: { domainRule: 'npc_kind' } } });
  });

  it.each(['firstExperienceTarget', 'firstExperienceTime', 'firstExperienceText'])(
    '未发生字段 %s 的 null 仍严格拒绝，不做静默清洗', async key => {
      const a = await fixture();
      await expect(parseTextVariables(response(initialize, gender,
        `set npc[companion].privateProfile = ${JSON.stringify({ ...profile, [key]: null })}`), a.state, a.draft))
        .rejects.toMatchObject({ code: 'schema_fields', details: { variableStep: 'mapping', commandIndex: 2 } });
    });

  it('原七字段均保留，合法值仍由原 Schema 接收', async () => {
    const a = await fixture();
    const allFields = { bodyDescription: privateMarker, chestDescription: 'schema-test', pussyDescription: 'schema-test',
      isVirgin: false, firstExperienceTarget: '记录对象', firstExperienceTime: '既有记录时间', firstExperienceText: '既有记录内容' };
    const result = unwrap(await run(a, initialize, gender, `set npc[companion].privateProfile = ${JSON.stringify(allFields)}`));
    expect(result.npc.companion.kind === 'special' && result.npc.companion.privateProfile).toEqual(allFields);
  });

  it('修复性别后，晚于 Story 开局结束的互动仍精准拒绝，不改写时间', async () => {
    const a = await fixture(), before = await a.repo.loadGame(a.state.saveId);
    const future = 'set npc[companion].lastInteractionAt = "2026-10-19T08:46:00+08:00"';
    await expect(parseTextVariables(response(initialize, gender, privateLine, future), a.state, a.draft))
      .rejects.toMatchObject({ code: 'time_data', details: { variableStep: 'simulation', commandIndex: 3,
        commandType: 'UpdateNpc', domainRule: 'npc_interaction_time' } });
    expect(await a.repo.loadGame(a.state.saveId)).toEqual(before);
  });

  it('最终整体 Schema 问题仍报告多条来源，不伪装成单条 apply 错误', async () => {
    const a = await fixture();
    const result = await run(a, 'set locations[remote] = {"name":"远处","parentId":"chongqing"}',
      'set npc[companion].locationId = "remote"', 'set npc[companion].onScene = true');
    expect(result).toMatchObject({ ok: false, error: { commandIndex: null,
      diagnostic: { domainRule: 'npc_scene_location' } } });
    if (result.ok) throw new Error('expected failure');
    expect(result.error.relatedCommands.map(origin => origin.commandIndex)).toEqual([1, 2, 3]);
    expect(result.error.diagnostic).not.toHaveProperty('commandType');
  });
});

it.each([
  [-1, 'UpdateNpc'], [999, 'UpdateNpc'], [NaN, 'UpdateNpc'], [1, 'unsafe-type-marker'], [0, 'SetWorldClock'],
])('无法可靠映射的 CommandDataError 不冒认单条：%s / %s', async (index, type) => {
  const a = await fixture();
  vi.spyOn(domainCommands, 'commitCommands').mockImplementationOnce(() => {
    throw new CommandDataError(new DataError('NPC_KIND', privateMarker), index as number, type as string);
  });
  const result = await run(a, gender);
  expect(result).toMatchObject({ ok: false, error: { commandIndex: null } });
  if (result.ok) throw new Error('expected failure');
  expect(result.error.relatedCommands.map(origin => origin.commandIndex)).toEqual([1]);
  expect(result.error.diagnostic).not.toHaveProperty('commandType');
  expect(JSON.stringify(result)).not.toContain('unsafe-type-marker');
  expect(JSON.stringify(result)).not.toContain(privateMarker);
});

it.each(['opening', 'regular'] as const)('%s正式 Variables 提示词包含有据登记性别、顺序与未知边界', async mode => {
  const a = await fixture();
  const completed = mode === 'regular' ? (await settleOpening(a)).committed : undefined;
  const state = completed?.state ?? a.state;
  const draft = completed ? rerollStory(completed.draft, {
    turnKind: 'regular', narrative: '两人继续讨论工作。', summary: '讨论工作。', variableGuide: [],
  }) : a.draft;
  const composed = await composePrompt({ stage: 'variables', mode, state, draft,
    settings: a.settings, userInput: '', domains: selectVariableDomains(state, draft).domains });
  const sent = composed.messages.map(message => message.content).join('\n');
  expect(sent.includes('先登记结构化性别，再更新专属资料'), '先登记结构化性别，再更新专属资料').toBe(true);
  expect(sent.includes('不能根据姓名或外貌猜测性别'), '不能根据姓名或外貌猜测性别').toBe(true);
  expect(sent.includes('没有可靠依据时保持未知并省略 privateProfile'), '没有可靠依据时保持未知并省略 privateProfile').toBe(true);
  expect(sent.includes('未发生的 firstExperienceTarget/firstExperienceTime/firstExperienceText 必须省略，不填 null'), '未发生的 firstExperienceTarget/firstExperienceTime/firstExperienceText 必须省略，不填 null').toBe(true);
  if (mode === 'opening') {
    expect(sent.includes('lastInteractionAt 不得晚于 Story 的 endAt'), 'lastInteractionAt 不得晚于 Story 的 endAt').toBe(true);
    expect(sent).toContain(startAt); expect(sent).toContain(endAt);
  }
});
