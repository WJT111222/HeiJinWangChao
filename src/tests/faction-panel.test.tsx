import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { commitCommands } from '../domain/commands';
import { GameStateSchema } from '../domain/state';
import type { GameState } from '../domain/state';
import { playerView } from '../ui/panels/playerView';
import { factionPublicRows, factionView } from '../ui/panels/factionView';
import { FactionPanel } from '../ui/panels/FactionPanel';
import { panelNames } from '../ui/panels/Panels';
import { organizationArchiveState, organizationUpdate } from './fixtures/organizations';

function boundState() {
  const state = organizationArchiveState();
  const withRoster = commitCommands(state, 'roster', state.revision, [organizationUpdate('org-business', {
    departments: [{ id: 'dept-ops', name: '运营部', duty: '日常经营', headPosition: '经理', headPublicName: '林澄', headNpcId: 'person' },
      { id: 'dept-fin', name: '财务部', duty: '账目' }],
    members: [{ npcId: 'person', position: '运营经理', departmentId: 'dept-ops' }],
    reputationText: '口碑稳定', operatingAreaText: '沿江三区',
  })]);
  const bound = commitCommands(withRoster, 'bind', withRoster.revision, [{ type: 'RecordOrgRelation', commandId: 'bind', evidence: '剧情', organizationId: 'org-business',
    relation: '合伙人', reason: '正式入股', faction: { action: 'bind', position: '合伙人', bondText: '入股成为合伙人，负责财务', departmentId: 'dept-fin' } }]);
  const known = commitCommands(bound, 'know', bound.revision, [{ type: 'RecordOrgKnowledge', commandId: 'know', evidence: '剧情', organizationId: 'org-business',
    entry: { id: 'k1', category: 'intel', text: '董事长有意出售维修业务', source: '林澄私下透露', learnedAt: bound.worldClock, knowledgeKind: 'reported' } }]);
  // 夹具事件默认对外隐藏；进行中的业务整合设为公开，已结束的保持隐藏。
  const raw = structuredClone(known);
  raw.events['org-active'] = { ...raw.events['org-active'], visibility: 'known' };
  return GameStateSchema.parse(raw);
}
const markup = (state: GameState, links = false) => renderToStaticMarkup(<FactionPanel view={playerView(state)} desktop
  links={links ? { npc: () => undefined, organization: () => undefined, event: () => undefined } : undefined}/>);

describe('我的势力面板', () => {
  it('入口位于势力组织之后', () => {
    expect(panelNames.indexOf('我的势力')).toBe(panelNames.indexOf('势力组织') + 1);
  });

  it('未绑定只显示目前孤身一人', () => {
    const html = markup(organizationArchiveState());
    expect(html).toContain('目前孤身一人');
    expect(html).not.toContain('你');
  });

  it('公开信息统一七项，缺失项不显示', () => {
    const state = boundState(), org = state.organizations['org-business'];
    const rows = factionPublicRows(org).map(row => row.label);
    expect(rows).toEqual(['管理层', '简介', '范围', '实力', '主要业务', '名声']);
    const gang = factionPublicRows(state.organizations['org-gang']).map(row => row.label);
    expect(gang).not.toContain('名声');
  });

  it('部门列出联系人成员与主角自身，主事件按阶段显示', () => {
    const state = boundState(), data = factionView(playerView(state))!;
    expect(data.department).toBe('财务部');
    const ops = data.departments.find(row => row.id === 'dept-ops')!;
    expect(ops.people.map(person => person.name)).toEqual([state.npc.person.name]);
    expect(data.departments.find(row => row.id === 'dept-fin')!.mine).toBe(true);
    expect(data.intel.map(row => row.text)).toEqual(['董事长有意出售维修业务']);
    expect(data.ongoing.map(event => event.id)).toEqual(['org-active']);
    const html = markup(state, true);
    for (const text of ['合伙人', '入股成为合伙人，负责财务', '运营部', '我在这里', '董事长有意出售维修业务', '业务整合与新车间交接', '口碑稳定'])
      expect(html).toContain(text);
    expect(html).toContain(`查看人物：${state.npc.person.name}`);
  });

  it('非联系人不出现在部门成员里；隐藏且主角不知情的主事件不进近期动态', () => {
    const state = boundState();
    const raw = structuredClone(state);
    raw.contactNpcIds = [];
    const data = factionView(playerView(GameStateSchema.parse(raw)))!;
    expect(data.departments.flatMap(row => row.people)).toEqual([]);
    expect(data.recent).toEqual([]);
  });

  it('管理层列出全部公开职位，不把第一位当首脑；未公开的不显示', () => {
    const raw = structuredClone(boundState());
    raw.organizations['org-business'].leadership = [{ position: '项目顾问', publicName: '甲' }, { position: '董事长', publicName: '乙' }, { position: '幕后股东', publicName: null }];
    const row = factionPublicRows(GameStateSchema.parse(raw).organizations['org-business']).find(r => r.label === '管理层')!;
    expect(row.value).toBe('项目顾问 · 甲；董事长 · 乙');
  });

  it('部门负责人只显示公开姓名；暗中身份成员和关键人物名单不推定主角知情', () => {
    const raw = structuredClone(boundState());
    const org = raw.organizations['org-business'];
    org.departments![0] = { ...org.departments![0], headPublicName: '林经理' };
    raw.npc.other = { ...raw.npc.other, name: '暗桩' };
    raw.contactNpcIds = [...new Set([...raw.contactNpcIds, 'other'])];
    org.members = [...org.members!, { npcId: 'other', position: '司机', departmentId: 'dept-ops', covert: true }];
    org.keyNpcIds = [...new Set([...org.keyNpcIds, 'other'])];
    const data = factionView(playerView(GameStateSchema.parse(raw)))!;
    const ops = data.departments.find(row => row.id === 'dept-ops')!;
    expect(ops.headName).toBe('林经理');
    expect(data.departments.flatMap(row => row.people).map(p => p.id)).not.toContain('other');
    expect(data.otherPeople.map(p => p.id)).not.toContain('other');
  });

  it('主角只是参与者、没有知情记录的隐藏事件不显示；部分公开的事件不显示；主角不知道的阶段不显示', () => {
    const raw = structuredClone(boundState());
    const active = raw.events['org-active'];
    raw.events['org-active'] = { ...active, visibility: 'hidden', actorRefs: [...active.actorRefs, { kind: 'protagonist', id: raw.protagonist.id }] };
    expect(factionView(playerView(GameStateSchema.parse(raw)))!.ongoing).toEqual([]);
    raw.events['org-active'] = { ...active, visibility: 'partially_known' };
    expect(factionView(playerView(GameStateSchema.parse(raw)))!.ongoing).toEqual([]);
    raw.events['org-active'] = { ...active, visibility: 'known' };
    const { estimatedEndAt: _end, ...base } = raw.events['org-active']; void _end;
    const stage = (id: string, title: string, visibility: 'known' | 'hidden') => ({ ...base, id, title, eventKind: 'sub' as const, parentEventId: 'org-active',
      status: 'active' as const, visibility, startAt: raw.worldClock, fixedEndAt: new Date(Date.parse(raw.worldClock) + 86400000).toISOString(),
      linkedTaskIds: [], predecessorEventIds: [] });
    raw.events['stage-open'] = stage('stage-open', '公开阶段：对接新车间', 'known');
    raw.events['stage-secret'] = stage('stage-secret', '秘密阶段：暗中压价收购', 'hidden');
    const data = factionView(playerView(GameStateSchema.parse(raw)))!;
    expect(data.ongoing.map(e => e.id)).toEqual(['org-active']);
    expect(data.ongoing[0].stages.map(s => s.title)).toEqual(['公开阶段：对接新车间']);
  });
});

