import { describe, expect, it } from 'vitest';
import { commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { prepareVariableProjection } from '../domain/turnProjection';
import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { sharedContext } from '../prompts/sharedContext';
import { organizationState, organizationUpdate, organizationWorld } from './fixtures/organizations';
import { organizations } from './fixtures/game';

type Relation = Extract<DomainCommand, { type: 'RecordOrgRelation' }>;
type Knowledge = Extract<DomainCommand, { type: 'RecordOrgKnowledge' }>;
const relation = (organizationId: string, faction?: Relation['faction'], commandId = 'relation'): Relation =>
  ({ type: 'RecordOrgRelation', commandId, evidence: '本幕剧情', organizationId, relation: '正式成员', reason: '本幕正式入伙', ...(faction ? { faction } : {}) });
const bind = (position = '看场', departmentId?: string): Relation['faction'] =>
  ({ action: 'bind', position, bondText: '由引荐人带入会，在夜场看场', ...(departmentId ? { departmentId } : {}) });
const knowledge = (state: GameState, id = 'know-1', organizationId = 'org-gang'): Knowledge =>
  ({ type: 'RecordOrgKnowledge', commandId: id, evidence: '本幕剧情', organizationId,
    entry: { id, category: 'intel', text: '账由二把手的人亲自来收', source: '夜班时亲眼看到', learnedAt: state.worldClock, knowledgeKind: 'observed' } });
const departments = [{ id: 'dept-door', name: '看场组', duty: '夜场看场', headPosition: '红棍', headPublicName: '阿虎', headNpcId: 'person' },
  { id: 'dept-books', name: '账房', duty: '收账分钱' }];
function regularDraft(state: GameState) {
  return rerollStory(createTurnDraft(state.saveId, state.revision, 'faction-turn', 'regular', '拜码头入会'), {
    turnKind: 'regular', narrative: '【旁白】主角在堂口正式拜了码头。', summary: '正式入会', variableGuide: [] });
}
const body = (...lines: string[]) => `<thinking>只处理实际变化。</thinking><说明></说明><命令>\n${lines.join('\n')}\n</命令>`;

describe('主势力与组织扩展字段：旧档兼容', () => {
  it('旧存档与旧组织不带新字段照常读取，默认孤身一人', () => {
    const state = organizationState();
    expect(state.protagonistFaction).toBeUndefined();
    for (const org of Object.values(state.organizations)) {
      expect(org.departments).toBeUndefined(); expect(org.members).toBeUndefined(); expect(org.protagonistKnown).toBeUndefined();
    }
    const rawOld = JSON.parse(JSON.stringify(state));
    expect(GameStateSchema.safeParse(rawOld).success).toBe(true);
  });

  it('不带faction的关系记录行为不变', () => {
    const state = organizationState();
    const next = commitCommands(state, 'plain', state.revision, [relation('org-gang')]);
    expect(next.organizations['org-gang']).toMatchObject({ protagonistRelation: '正式成员', relationHistory: ['本幕正式入伙'] });
    expect(next.protagonistFaction).toBeUndefined();
  });
});

describe('主势力绑定：只有一个', () => {
  it('绑定、更新职位与部门、解除', () => {
    const state = organizationState();
    const withDepts = commitCommands(state, 'depts', state.revision, [organizationUpdate('org-gang', { departments })]);
    const bound = commitCommands(withDepts, 'bind', withDepts.revision, [relation('org-gang', bind('看场', 'dept-door'))]);
    expect(bound.protagonistFaction).toEqual({ organizationId: 'org-gang', position: '看场', departmentId: 'dept-door',
      bondText: '由引荐人带入会，在夜场看场', joinedAt: bound.worldClock });
    const promoted = commitCommands(bound, 'promote', bound.revision, [relation('org-gang', { action: 'update', position: '账房先生', departmentId: 'dept-books' }, 'promote')]);
    expect(promoted.protagonistFaction).toMatchObject({ position: '账房先生', departmentId: 'dept-books', joinedAt: bound.protagonistFaction!.joinedAt });
    const cleared = commitCommands(promoted, 'clear-dept', promoted.revision, [relation('org-gang', { action: 'update', departmentId: null }, 'clear-dept')]);
    expect(cleared.protagonistFaction).not.toHaveProperty('departmentId');
    const left = commitCommands(cleared, 'leave', cleared.revision, [relation('org-gang', { action: 'unbind' }, 'leave')]);
    expect(left.protagonistFaction).toBeUndefined();
    expect(left.organizations['org-gang'].relationHistory.length).toBeGreaterThan(0);
  });

  it('改投新势力自动解除旧绑定，并在旧组织关系历史留下记录', () => {
    const state = organizationState();
    const first = commitCommands(state, 'first', state.revision, [relation('org-gang', bind())]);
    const second = commitCommands(first, 'second', first.revision, [relation('org-business', bind('合伙人'), 'second')]);
    expect(second.protagonistFaction).toMatchObject({ organizationId: 'org-business', position: '合伙人' });
    expect(second.organizations['org-gang'].relationHistory.at(-1)).toContain(second.organizations['org-business'].name);
  });

  it.each([
    ['未绑定时更新', [relation('org-gang', { action: 'update', position: '红棍' })]],
    ['未绑定时解除', [relation('org-gang', { action: 'unbind' })]],
    ['部门不存在', [relation('org-gang', bind('看场', 'no-dept'))]],
    ['组织不存在', [relation('no-org', bind())]],
  ] as const)('%s被拒绝，源状态不变', (_name, commands) => {
    const state = organizationState(), before = structuredClone(state);
    expect(() => commitCommands(state, 'bad', state.revision, [...commands])).toThrow();
    expect(state).toEqual(before);
  });

  it('不能对另一个组织更新或解除当前绑定', () => {
    const state = organizationState();
    const bound = commitCommands(state, 'bind', state.revision, [relation('org-gang', bind())]);
    expect(() => commitCommands(bound, 'other', bound.revision, [relation('org-business', { action: 'unbind' }, 'other')])).toThrow();
  });
});

describe('部门、成员与补齐的公开字段', () => {
  it('部门与成员经白名单更新，引用须存在', () => {
    const state = organizationState();
    const next = commitCommands(state, 'roster', state.revision, [organizationUpdate('org-gang', {
      departments, members: [{ npcId: 'person', position: '红棍', departmentId: 'dept-door' }] })]);
    expect(next.organizations['org-gang'].members).toEqual([{ npcId: 'person', position: '红棍', departmentId: 'dept-door' }]);
    for (const changes of [
      { members: [{ npcId: 'missing', position: '看场' }] },
      { departments, members: [{ npcId: 'person', position: '看场', departmentId: 'no-dept' }] },
      { departments: [{ ...departments[0], headNpcId: 'missing' }] },
      { departments: [departments[0], departments[0]] },
      { departments: [{ id: 'secret', name: '暗线', duty: '不公开', headPublicName: null, headNpcId: 'person' }] },
    ]) expect(() => commitCommands(state, 'bad', state.revision, [organizationUpdate('org-gang', changes)])).toThrow();
  });

  it('五个公开字段只属于对应类型', () => {
    const state = organizationState();
    const cases = [['org-gang', { reputationText: '道上都知道' }], ['org-government', { fundingText: '财政拨款' }],
      ['org-civil', { fundingText: '会员捐助' }], ['org-business', { reputationText: '口碑稳定', operatingAreaText: '沿江三区' }]] as const;
    for (const [id, changes] of cases) {
      const next = commitCommands(state, `field-${id}`, state.revision, [organizationUpdate(id, changes)]);
      expect(next.organizations[id]).toMatchObject(changes);
    }
    expect(() => commitCommands(state, 'wrong', state.revision, [organizationUpdate('org-government', { reputationText: '不属于政府' })])).toThrow();
    expect(() => commitCommands(state, 'wrong', state.revision, [organizationUpdate('org-gang', { fundingText: '不属于帮派' })])).toThrow();
  });
});

describe('主角已知列表', () => {
  it('逐条追加；重复ID、未来时间与创建时内联均拒绝', () => {
    const state = organizationState();
    const once = commitCommands(state, 'know', state.revision, [knowledge(state)]);
    expect(once.organizations['org-gang'].protagonistKnown).toHaveLength(1);
    const twice = commitCommands(once, 'know-2', once.revision, [knowledge(once, 'know-2')]);
    expect(twice.organizations['org-gang'].protagonistKnown!.map(row => row.id)).toEqual(['know-1', 'know-2']);
    expect(() => commitCommands(once, 'dup', once.revision, [{ ...knowledge(once), commandId: 'dup' }])).toThrow();
    const future = knowledge(state, 'future');
    expect(() => commitCommands(state, 'future', state.revision, [{ ...future, entry: { ...future.entry, learnedAt: '2099-01-01T00:00:00+08:00' } }])).toThrow();
    const create = { type: 'CreateOrganization' as const, commandId: 'inline', evidence: '正文', organization: { ...organizations[0], id: 'new-gang', name: '新堂口',
      protagonistRelation: '闻所未闻', relationHistory: [], protagonistKnown: [knowledge(state).entry] } };
    expect(() => commitCommands(state, 'inline', state.revision, [create])).toThrow();
  });
});

describe('文本变量协议', () => {
  it('普通回合可绑定主势力并追加已知条目，id与时间由程序填写', async () => {
    const state = organizationState(), selected = regularDraft(state);
    const result = await parseTextVariables(body(
      `set organizations[org-gang].protagonistRelation = ${JSON.stringify({ relation: '正式成员', reason: '本幕拜码头', faction: bind() })}`,
      `push organizations[org-gang].protagonistKnown = ${JSON.stringify({ category: 'holding', text: '金樽KTV是帮里的场子', source: '亲自在那里看场', knowledgeKind: 'observed', statusText: '营业中' })}`,
    ), state, selected);
    expect(result.commands[0]).toMatchObject({ type: 'RecordOrgRelation', faction: { action: 'bind', position: '看场' } });
    expect(result.commands[1]).toMatchObject({ type: 'RecordOrgKnowledge', organizationId: 'org-gang',
      entry: { category: 'holding', text: '金樽KTV是帮里的场子', learnedAt: state.worldClock } });
    expect((result.commands[1] as Knowledge).entry.id).toMatch(/^text-orgknow:/);
  });

  it('已知条目只接受push，且不接受模型自填id', async () => {
    const state = organizationState(), selected = regularDraft(state);
    const value = { category: 'intel', text: '内情', source: '听说', knowledgeKind: 'reported' };
    await expect(parseTextVariables(body(`set organizations[org-gang].protagonistKnown = ${JSON.stringify(value)}`), state, selected)).rejects.toThrow();
    await expect(parseTextVariables(body(`push organizations[org-gang].protagonistKnown = ${JSON.stringify({ ...value, id: 'model-id' })}`), state, selected)).rejects.toThrow();
  });

  it('文本目录列出绑定与已知入口', () => {
    const catalog = textVariableCatalog();
    expect(catalog.entries).toContainEqual(expect.objectContaining({ operation: 'push', path: 'organizations[id].protagonistKnown', commandType: 'RecordOrgKnowledge' }));
    expect(JSON.stringify(catalog.entries.find(e => e.path === 'organizations[id].protagonistRelation')?.valueSchema)).toContain('faction');
  });
});

describe('World权限', () => {
  function worldDraft(state: GameState) {
    const draft = regularDraft(state);
    draft.variables = { result: { commands: [], rejectedSuggestions: [], unresolved: [] }, storyRevision: draft.storyRevision, candidateRevision: 1, requestRevision: 0, validation: 'validated' };
    draft.stageStatus.variables = 'ready';
    return draft;
  }
  it('World不能写主势力绑定，也不能记录主角已知', () => {
    const state = organizationState(), draft = worldDraft(state);
    expect(() => parseWorld(JSON.stringify(organizationWorld([relation('org-gang', bind())])), state, draft)).toThrow();
    expect(() => parseWorld(JSON.stringify(organizationWorld([knowledge(state)])), state, draft)).toThrow();
    expect(() => parseWorld(JSON.stringify(organizationWorld([relation('org-gang')])), state, draft)).not.toThrow();
  });
  it('World可更新部门与成员；目录不展示faction', () => {
    const state = organizationState(), draft = worldDraft(state);
    const update = organizationUpdate('org-gang', { departments, members: [{ npcId: 'person', position: '红棍', departmentId: 'dept-door' }] });
    expect(parseWorld(JSON.stringify(organizationWorld([update])), state, draft).worldCommands).toEqual([update]);
    const world = JSON.stringify(commandCatalog('world').schema);
    expect(world).not.toContain('"faction"');
    expect(world).not.toContain('RecordOrgKnowledge');
  });
});

describe('按需加载的势力上下文', () => {
  it('未绑定时不注入；绑定后三个阶段各带本阶段边界', () => {
    const state = organizationState();
    for (const stage of ['story', 'variables', 'world'] as const)
      expect(sharedContext(state, 3, '', false, { stage, playerInput: '' })).not.toHaveProperty('PROTAGONIST_FACTION');
    const bound = commitCommands(state, 'bind', state.revision, [relation('org-gang', bind())]);
    const policies = new Set<string>();
    for (const stage of ['story', 'variables', 'world'] as const) {
      const context = sharedContext(bound, 3, '', false, { stage, playerInput: '' }) as { PROTAGONIST_FACTION?: { name: string; position: string; policy: string } };
      expect(context.PROTAGONIST_FACTION).toMatchObject({ name: bound.organizations['org-gang'].name, position: '看场' });
      policies.add(context.PROTAGONIST_FACTION!.policy);
    }
    expect(policies.size).toBe(3);
  });
});

describe('审查修订：部门撤销与开局保护', () => {
  it('撤销主角所在部门时，成员与主角的部门归属同步清空，职位保留，更新不被拒绝', () => {
    const state = organizationState();
    const roster = commitCommands(state, 'roster', state.revision, [organizationUpdate('org-gang', {
      departments, members: [{ npcId: 'person', position: '红棍', departmentId: 'dept-door' }] })]);
    const bound = commitCommands(roster, 'bind', roster.revision, [relation('org-gang', bind('看场', 'dept-door'))]);
    const next = commitCommands(bound, 'reorg', bound.revision, [{ ...organizationUpdate('org-gang', { departments: [departments[1]] }, bound.revision), commandId: 'reorg' }]);
    expect(next.organizations['org-gang'].members).toEqual([{ npcId: 'person', position: '红棍' }]);
    expect(next.protagonistFaction).toMatchObject({ organizationId: 'org-gang', position: '看场' });
    expect(next.protagonistFaction).not.toHaveProperty('departmentId');
  });

  it('只改成员却引用不存在的部门仍然拒绝', () => {
    const state = organizationState();
    expect(() => commitCommands(state, 'bad', state.revision, [organizationUpdate('org-gang', { members: [{ npcId: 'person', position: '红棍', departmentId: 'ghost' }] })])).toThrow();
  });

  it('正式候选入口拒绝开局回合绑定主势力，不只依赖文本编译', () => {
    const state = organizationState();
    const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'opening-turn', 'opening', ''), {
      turnKind: 'opening', narrative: '【旁白】开局。', summary: '开局', variableGuide: [] });
    expect(() => prepareVariableProjection(state, draft, [relation('org-gang', bind())])).toThrow(/开局回合不能绑定主势力/);
  });
});
