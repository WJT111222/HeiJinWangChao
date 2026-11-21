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
  // 夹具事件默认对外隐藏；进行中的业务整合设为部分公开，已结束的保持隐藏。
  const raw = structuredClone(known);
  raw.events['org-active'] = { ...raw.events['org-active'], visibility: 'partially_known' };
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
    expect(rows).toEqual(['首脑', '简介', '范围', '实力', '主要业务', '名声']);
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
});
