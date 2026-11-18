import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiError } from '../services/ai/errors';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';
import { organizationState, organizationUpdate, organizationWorld } from './fixtures/organizations';
import { worldState, worldDraft, npcUpdate, worldResult } from './fixtures/world';
import { organizations } from './fixtures/game';
import { completeDraft, submission } from './fixtures/turn';

const envelope = (commands: string) => `<thinking>仅处理已发生事实。</thinking><说明></说明><命令>${commands}</命令>`;
async function organizationCase() {
  const state = organizationState();
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'scene-write-turn', 'regular', '查看发展'), {
    turnKind: 'regular', narrative: '【旁白】商行确认照常营业。', summary: '确认营业安排。', variableGuide: [],
  });
  const result = await parseTextVariables(envelope('set organizations[org-business].state = {"operatingStatus":"正文确认照常营业"}'), state, draft);
  draft.variables = { result, storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' };
  draft.stageStatus.variables = 'ready';
  const repeated = { ...organizationUpdate('org-business', { operatingStatus: 'World不同的营业安排' }), commandId: 'world-repeat' };
  return { state, draft, repeated };
}
function failure(run: () => unknown) {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(AiError); return error as AiError; }
  throw new Error('非法原始候选必须拒绝，不能因过滤而通过');
}
function npcCase(leave = true) {
  const state = worldState(), draft = worldDraft();
  draft.variables!.result.commands.push({ ...npcUpdate({ healthText: '离开前身体良好', ...(leave ? { onScene: false } : {}) }),
    commandId: 'scene-fact', npcId: 'scene' });
  draft.story!.narrative += '现场人物离开前身体良好，随后离开现场。';
  return { state, draft, repeated: { ...npcUpdate({ healthText: 'World另写状态' }), npcId: 'scene' } };
}

describe('#190 原始分组、ID和权限必须先于冲突剔除', () => {
  it('合法 worldCommands 中的完全重复字段忽略，原输入与正式状态不变', async () => {
    const { state, draft, repeated } = await organizationCase(), raw = organizationWorld([repeated]);
    const before = structuredClone({ state, draft, raw }), text = JSON.stringify(raw);
    const result = parseWorld(text, state, draft);
    expect(result.worldCommands).toEqual([]);
    expect(worldNormalizationNotes.get(result)).toHaveLength(1);
    expect({ state, draft, raw }).toEqual(before); expect(JSON.stringify(raw)).toBe(text);
  });
  it.each(['taskCommands', 'eventCommands'] as const)('UpdateOrganization 误入 %s，即使会整条剔除也拒绝', async group => {
    const { state, draft, repeated } = await organizationCase(), raw = organizationWorld(); raw[group] = [repeated];
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('UpdateNpc 误入 eventCommands 不能被完全重复字段隐藏', () => {
    const { state, draft, repeated } = npcCase(), raw = { ...worldResult(), eventCommands: [repeated] };
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('RecordOrgRelation 误入 eventCommands 不能被重复关系隐藏', async () => {
    const { state, draft } = await organizationCase();
    draft.variables!.result.commands.push({ type: 'RecordOrgRelation', commandId: 'variable-relation', evidence: '正文确认合作', organizationId: 'org-business', relation: '合作', reason: '协助营业' });
    const raw = { ...organizationWorld(), eventCommands: [{ type: 'RecordOrgRelation' as const, commandId: 'world-relation', evidence: '后台', organizationId: 'org-business', relation: '敌对', reason: '不同推演' }] };
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('合法重复、独立合法字段和非法分组混合时整批拒绝，不接受其中任何部分', async () => {
    const { state, draft, repeated } = await organizationCase();
    const raw = organizationWorld([repeated, { ...organizationUpdate('org-business', { ownershipText: '独立合法字段' }), commandId: 'independent' }]);
    raw.taskCommands = [{ ...repeated, commandId: 'wrong-group' }];
    const before = structuredClone({ state, draft, raw });
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
    expect({ state, draft, raw }).toEqual(before);
  });
  it('原始 World commandId 重复不能因两条命令都被剔除而消失', async () => {
    const { state, draft, repeated } = await organizationCase();
    const raw = organizationWorld([repeated, { ...repeated, changes: { operatingStatus: '另一重复值' } }]);
    failure(() => parseWorld(JSON.stringify(raw), state, draft));
  });
  it('与 Variables 的 commandId 冲突，完全重复的 World 命令也必须拒绝', async () => {
    const { state, draft, repeated } = await organizationCase();
    repeated.commandId = draft.variables!.result.commands[0].commandId;
    failure(() => parseWorld(JSON.stringify(organizationWorld([repeated])), state, draft));
  });
  it('原始相同效果的重复命令即使 ID 不同也保持原有拒绝规则', async () => {
    const { state, draft, repeated } = await organizationCase();
    failure(() => parseWorld(JSON.stringify(organizationWorld([repeated, { ...repeated, commandId: 'other-id' }])), state, draft));
  });
  it.each([
    { name: '被重复的身份' },
    { relationshipText: '已承诺效忠' },
    { lastInteractionAt: '2026-10-18T08:10:00+08:00' },
    { onScene: true },
  ])('NPC 禁写字段与重复字段同批仍拒绝：%j', changes => {
    const { state, draft, repeated } = npcCase();
    const raw = worldResult([{ ...repeated, changes: { ...repeated.changes, ...changes } }]);
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('NPC affinityChange 不因重复 changes 被忽略', () => {
    const { state, draft, repeated } = npcCase();
    const raw = worldResult([{ ...repeated, affinityChange: { from: state.npc.scene.affinity, to: 50, reason: 'World无权修改' } }]);
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('仍在场的 NPC 不因所有字段会被剔除而绕过 World 授权', () => {
    const { state, draft, repeated } = npcCase(false);
    expect(failure(() => parseWorld(JSON.stringify(worldResult([repeated])), state, draft))).toMatchObject({ code: 'permission' });
  });
  it('旧 expectedRevision 不因完全重复而获豁免', async () => {
    const { state, draft, repeated } = await organizationCase();
    failure(() => parseWorld(JSON.stringify(organizationWorld([{ ...repeated, expectedRevision: state.revision + 1 }])), state, draft));
  });
  it('重复字段中的非法 NPC 引用仍由正式领域投影拒绝', async () => {
    const { state, draft } = await organizationCase();
    draft.variables!.result.commands.push({ ...organizationUpdate('org-business', { keyNpcIds: ['person'] }), commandId: 'variable-npc-reference' });
    const raw = organizationWorld([{ ...organizationUpdate('org-business', { keyNpcIds: ['PRIVATE_MISSING_NPC'] }), commandId: 'world-npc-reference' }]);
    const error = failure(() => parseWorld(JSON.stringify(raw), state, draft));
    expect(JSON.stringify(error.details)).not.toContain('PRIVATE_MISSING_NPC');
  });
  it('缺失目标实体、主角命令、错误组织字段继续拒绝', async () => {
    const { state, draft } = await organizationCase();
    const commands: DomainCommand[] = [organizationUpdate('missing', { ownershipText: '未知组织' }),
      { type: 'UpdateProtagonist', protagonistId: state.protagonist.id, expectedRevision: state.revision, commandId: 'protagonist', evidence: 'World越权', changes: { emotionText: '不能写入' } },
      organizationUpdate('org-government', { liquidityEstimate: 100 })];
    for (const command of commands) failure(() => parseWorld(JSON.stringify(organizationWorld([command])), state, draft));
  });
  it('过滤会移除首条时，后续权限错误仍定位模型原始第 2 条', () => {
    const { state, draft, repeated } = npcCase();
    const error = failure(() => parseWorld(JSON.stringify(worldResult([repeated, { ...npcUpdate({ relationshipText: 'PRIVATE_RELATION' }), commandId: 'forbidden' }])), state, draft));
    expect(error.details).toMatchObject({ commandIndex: 1, commandType: 'UpdateNpc', fieldPath: 'worldCommands.1' });
    expect(JSON.stringify(error.details)).not.toContain('PRIVATE_RELATION');
  });
  it('过滤会移除首条时，后续领域错误仍定位模型原始第 2 条', async () => {
    const { state, draft, repeated } = await organizationCase();
    const invalid: DomainCommand = { type: 'CreateLocation', commandId: 'bad-parent', evidence: '新增地点', location: { id: 'new-location', name: '测试地点', parentId: 'PRIVATE_MISSING_PARENT' } };
    const error = failure(() => parseWorld(JSON.stringify(organizationWorld([repeated, invalid])), state, draft));
    expect(error.details).toMatchObject({ commandIndex: 1, commandType: 'CreateLocation', fieldPath: 'worldCommands.1.location.parentId' });
    expect(JSON.stringify(error.details)).not.toContain('PRIVATE_MISSING_PARENT');
  });
  it('剔除后领域重验失败仍映射模型原始索引，不接受依赖临时覆盖的独立字段', async () => {
    const { state, draft } = await organizationCase();
    state.organizations.second = { ...structuredClone(state.organizations['org-business']), id: 'second', name: '第二家商行' };
    draft.variables!.result.commands.push({ ...organizationUpdate('org-business', { name: 'Variables确认名称' }), commandId: 'variable-name' });
    // The unfiltered projection temporarily frees the first name. Once the
    // authoritative Variables name wins, the second rename must be rejected.
    const raw = organizationWorld([
      { ...organizationUpdate('org-business', { name: 'World临时名称' }), commandId: 'dropped-name' },
      { ...organizationUpdate('second', { name: 'Variables确认名称' }), commandId: 'invalid-retained-name' },
    ]);
    const before = structuredClone({ state, draft, raw });
    const error = failure(() => parseWorld(JSON.stringify(raw), state, draft));
    expect(error.details).toMatchObject({ commandIndex: 1, commandType: 'UpdateOrganization', fieldPath: 'worldCommands.1' });
    expect({ state, draft, raw }).toEqual(before);
  });
  it('跨数组权限错误保留原始扁平索引和分组位置', async () => {
    const { state, draft, repeated } = await organizationCase(), raw = organizationWorld([repeated]);
    raw.taskCommands = [{ ...repeated, commandId: 'misgrouped' }];
    expect(failure(() => parseWorld(JSON.stringify(raw), state, draft)).details).toMatchObject({ commandIndex: 1, commandType: 'UpdateOrganization', fieldPath: 'taskCommands.0' });
  });
});

it('#186 正式 Repository 保存剔除候选，Commit 重验、幂等、刷新与原文隔离', async () => {
  const repo = await SaveRepository.open('scene-write-commit', new IDBFactory());
  try {
    const state = worldState(); state.organizations.shop = { ...organizations[3], id: 'shop' };
    await repo.create(state);
    const variables = { ...worldDraft().variables!.result, commands: [...worldDraft().variables!.result.commands,
      { ...organizationUpdate('shop', { operatingStatus: 'Variables权威值' }, 0), commandId: 'scene-shop' }] };
    let selected = await completeDraft(repo, { variables });
    const raw = organizationWorld([{ ...organizationUpdate('shop', { operatingStatus: 'World重复值', ownershipText: 'World独立字段' }, 0), commandId: 'background-shop' }]);
    const text = JSON.stringify(raw), normalized = parseWorld(text, state, selected);
    expect(normalized.worldCommands).toEqual([{ ...organizationUpdate('shop', { ownershipText: 'World独立字段' }, 0), commandId: 'background-shop' }]);
    expect(worldNormalizationNotes.get(normalized)).toHaveLength(1);
    expect(parseWorld(JSON.stringify(normalized), state, selected)).toEqual(normalized);
    const candidate = { ...selected, draftRevision: selected.draftRevision + 1, world: { ...selected.world!, candidateRevision: selected.world!.candidateRevision + 1, result: normalized } };
    selected = await repo.saveDraft(candidate, selected.draftRevision);
    expect((await repo.loadDraft(state.saveId))!.world!.result).toEqual(normalized);
    const projected = projectTurn(state, selected, normalized.worldCommands);
    const committed = await repo.commitTurn(submission(selected));
    expect(committed.state.organizations).toEqual(projected.organizations);
    expect(committed.state.organizations.shop).toMatchObject({ operatingStatus: 'Variables权威值', ownershipText: 'World独立字段' });
    expect(committed.state.revision).toBe(1); expect(committed.state.journal).toHaveLength(1);
    expect(JSON.stringify(committed.state)).not.toContain('程序处理说明');
    expect(JSON.stringify(raw)).toBe(text);
    expect((await repo.commitTurn(submission(selected))).replayed).toBe(true);
    expect((await repo.loadGame(state.saveId)).state).toEqual(committed.state);
  } finally { repo.close(); }
});
