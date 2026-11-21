import { householdFixture } from './fixtures/harem';
import { activeMembers } from '../domain/harem/schema';
import { householdContext } from '../domain/harem/projection';
import { describe, expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import { game, npc } from './fixtures/game';

const base = () => {
  const state = game();
  for (const id of ['a', 'b', 'c']) state.npc[id] = { ...npc(id), age: 28, gender: 'female', name: id };
  return state;
};
const join = (npcId: string, to: number) => ({
  op: 'join',
  npcId,
  identityKey: 'identity-' + npcId,
  to,
  reason: '已确认的共同生活安排',
});
const score = (npcId: string, from: number, to: number) => ({
  op: 'score',
  npcId,
  from,
  to,
  reason: '共同决定新的家庭安排',
});
function apply(state: ReturnType<typeof base>, changes: unknown[]) {
  const command = DomainCommandSchema.parse({
    type: 'ApplyHaremChanges',
    expectedRevision: state.revision,
    evidence: '当轮所选正文',
    commandId: 'family',
    changes,
  });
  return commitCommands(state, 'turn-' + state.revision, state.revision, [command], state.updatedAt);
}

describe('后宫正式事务', () => {
  it('旧 V10 不自动建档；成年女性首次加入必须形成唯一正宫', () => {
    const state = base();
    expect(state).not.toHaveProperty('harem');
    expect(() => apply(state, [join('a', 99)])).toThrow();
    expect(apply(state, [join('a', 100)])).toHaveProperty('harem');
  });
  it('更替正宫只看整批结果；错误前值或半笔无法改变基线', () => {
    const state = apply(base(), [join('a', 100), join('b', 92)]);
    expect(() => apply(state, [score('a', 100, 84)])).toThrow();
    expect(() => apply(state, [score('b', 92, 100)])).toThrow();
    expect(() => apply(state, [score('b', 91, 100), score('a', 100, 84)])).toThrow();
    expect(apply(state, [score('b', 92, 100), score('a', 100, 84)]).revision).toBe(2);
  });
});

const reason = '当轮已确认的家庭事实';
const familyChild = (id: string, parent = 'a', kinship = 'biological') => ({
  op: 'child',
  reason,
  value: {
    childNpcId: id,
    parentNpcId: parent,
    kinship,
    protagonistParentage: 'confirmed',
    visibility: 'player_known',
  },
});
describe('成员、家庭和权限边界', () => {
  it.each([
    { age: 17, gender: 'female' },
    { gender: 'female', age: undefined },
    { gender: 'unknown', age: 28 },
    { gender: 'male', age: 28 },
  ])('资格缺失就拒绝 $age/$gender', (fields) => {
    const state = base();
    Object.assign(state.npc.a, fields);
    expect(() => apply(state, [join('a', 100)])).toThrow();
    expect(state.harem).toBeUndefined();
  });
  it.each([-1, 101, 0.5])('拒绝地位 %s', (n) =>
    expect(() => apply(base(), [join('a', 100), join('b', n)])).toThrow(),
  );
  it('同名身份、重复加入、退出及再入保留连续历史；末人退出无需伪造正宫', () => {
    let state = base();
    state.npc.b.name = state.npc.a.name;
    expect(() => apply(state, [{ ...join('a', 100), identityKey: 'identity-b' }])).toThrow();
    state = apply(state, [join('a', 100), join('c', 50), join('b', 50)]);
    expect(activeMembers(state.harem!).map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(() => apply(state, [join('b', 20)])).toThrow();
    state = apply(state, [{ op: 'leave', npcId: 'a', from: 100, reason }, score('b', 50, 100)]);
    state = apply(state, [
      { op: 'leave', npcId: 'b', from: 100, reason },
      { op: 'leave', npcId: 'c', from: 50, reason },
    ]);
    expect(activeMembers(state.harem!)).toEqual([]);
    expect(apply(state, [join('a', 100)]).harem?.members.a.changes.map((c) => c.to)).toEqual([
      100,
      null,
      100,
    ]);
  });
  it('人物好感、联络、身份不受关系或规划影响，合作和冲突分别计算，逆序是同一对', () => {
    const state = base();
    const relation = {
      op: 'pair',
      reason,
      value: {
        leftNpcId: 'b',
        rightNpcId: 'a',
        relationship: '共同筹备搬家',
        cooperation: true,
        conflict: true,
        visibility: 'player_known',
      },
    };
    const joined = apply(state, [
      join('a', 100),
      join('b', 0),
      relation,
      { op: 'overview', value: { harmony: null, competition: '出现分歧', summary: '协商中' }, reason },
      {
        op: 'plan',
        npcId: 'b',
        reason,
        value: { action: '计划见面', status: 'planned', visibility: 'internal' },
      },
    ]);
    expect(joined.npc).toEqual(state.npc);
    expect(joined.harem?.overview?.harmony).toBeNull();
    expect(joined.harem?.pairs).toMatchObject([
      { leftNpcId: 'a', rightNpcId: 'b', cooperation: true, conflict: true },
    ]);
    expect(() =>
      apply(joined, [
        relation,
        { ...relation, value: { ...relation.value, leftNpcId: 'a', rightNpcId: 'b' } },
      ]),
    ).toThrow();
    for (const rightNpcId of ['b', 'ghost'])
      expect(() => apply(joined, [{ ...relation, value: { ...relation.value, rightNpcId } }])).toThrow();
    expect(JSON.stringify(householdContext(joined.harem!, joined.npc, false, ''))).not.toContain('计划见面');
    expect(JSON.stringify(householdContext(joined.harem!, joined.npc, true, ''))).toContain('计划见面');
    expect(
      apply(joined, [{ op: 'plan', npcId: 'b', value: null, reason }]).harem?.members.b.plan,
    ).toBeUndefined();
  });
  it('推测、确认及结束各自有来源；时间推进不产生孩子，亲子类型与重复引用严格验证', () => {
    const s = base();
    s.npc.twin1 = { ...npc('twin1'), age: 0 };
    s.npc.twin2 = { ...npc('twin2'), age: 0 };
    const preg = (status: string) => ({
      op: 'pregnancy',
      npcId: 'a',
      reason,
      value: { status, visibility: 'player_known' },
    });
    let state = apply(s, [join('a', 100), preg('suspected')]);
    expect(state.harem?.children).toHaveLength(0);
    state = apply(state, [preg('confirmed')]);
    const advanced = commitCommands(state, 'later', state.revision, [
      {
        type: 'SetWorldClock',
        commandId: 'clock',
        evidence: reason,
        worldClock: '2028-01-01T10:00:00+08:00',
      },
    ]);
    expect(advanced.harem).toEqual(state.harem);
    expect(() => apply(advanced, [familyChild('ghost')])).toThrow();
    const reg = familyChild('twin1');
    expect(() =>
      apply(advanced, [{ ...reg, value: { ...reg.value, protagonistParentage: 'suspected' } }]),
    ).toThrow();
    const ended = apply(advanced, [preg('ended'), reg, familyChild('twin2', 'a', 'step')]);
    expect(ended.harem?.children.map((c) => c.kinship)).toEqual(['biological', 'step']);
    expect(() => apply(ended, [reg])).toThrow();
    expect(ended.npc.twin1).not.toHaveProperty('privateProfile');
  });
  it('版本冲突、重复 ID、异内容重放拒绝，完全重复的回合幂等', () => {
    const state = base(),
      command = DomainCommandSchema.parse({
        type: 'ApplyHaremChanges',
        commandId: 'changes',
        expectedRevision: 0,
        evidence: reason,
        changes: [join('a', 100)],
      });
    const committed = commitCommands(state, 'turn', 0, [command]);
    expect(commitCommands(committed, 'turn', 0, [command])).toEqual(committed);
    expect(() => commitCommands(committed, 'another', 1, [command])).toThrow();
    expect(() => commitCommands(state, 'turn', 0, [command, command])).toThrow();
    expect(() => commitCommands(committed, 'turn', 0, [{ ...command, evidence: '不同版本' }])).toThrow();
  });
});

it('亲子事实可在之后被主角知悉，保留原登记来源且不重复统计', () => {
  const s = base();
  s.npc.baby = { ...npc('baby'), age: 0 };
  const r = familyChild('baby');
  const secret = apply(s, [join('a', 100), { ...r, value: { ...r.value, visibility: 'internal' } }]);
  expect(householdContext(secret.harem!, secret.npc, false, '').children).toHaveLength(0);
  const edit = { op: 'discloseChild', childNpcId: 'baby', reason: '正式知悉亲子关系' };
  const revealed = apply(secret, [edit]);
  expect(householdContext(revealed.harem!, revealed.npc, false, '').children).toHaveLength(1);
  expect(revealed.harem?.children[0]).toMatchObject({ turnId: 'turn-0', disclosure: { turnId: 'turn-1' } });
  expect(() => apply(revealed, [edit])).toThrow();
});

it('多成员档案按当前行动选取 Story 资料，旧地位依据不会进入任何请求', () => {
  const s = householdFixture(40);
  const named = s.npc['family-39'];
  named.name = '周岚';
  const projection = householdContext(s.harem!, s.npc, false, '联系' + named.name);
  expect(projection.members).toHaveLength(12);
  expect(projection.members[0].npcId).toBe(named.id);
  const variables = householdContext(s.harem!, s.npc, true, '');
  expect(variables.members).toHaveLength(40);
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
  const before = bytes(variables);
  const changes = s.harem!.members[named.id].changes;
  const initial = changes[0].to!;
  for (let i = 0; i < 200; i++) {
    changes.push({ ...changes[0], turnId: 'adjust-' + i, from: initial + (i % 2), to: initial + 1 - (i % 2), reason: '历史变更说明'.repeat(20) });
  }
  expect(bytes(householdContext(s.harem!, s.npc, true, '')) - before).toBeLessThan(2);
  expect(JSON.stringify(projection)).not.toContain('双方决定');
});
