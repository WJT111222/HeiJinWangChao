import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { SaveRepository } from '../services/storage/saveRepository';
import { completeDraft, submission } from './fixtures/turn';
import { worldState, worldDraft, worldResult, proof, actionTime } from './fixtures/world';
import { event } from './fixtures/game';

const repositories: SaveRepository[] = [];
afterEach(() => repositories.splice(0).forEach(repo => repo.close()));
function failure(run: () => unknown) { try { run(); } catch (error) { return error; } throw Error('Expected rejection'); }
const parse = (raw: unknown) => parseWorld(typeof raw === 'string' ? raw : JSON.stringify(raw), worldState(), worldDraft(true, 'opening'));
function plannedEvent() {
  return { type: 'SaveEvent', commandId: 'new-event', evidence: proof({ kind: 'planned', sources: ['npc:npc-a'], fact: '计划整理诊室' }),
    event: { ...event('future'), actorRefs: [{ kind: 'npc', id: 'npc-a' }], startAt: '2026-10-19T08:00:00+08:00', estimatedEndAt: '2026-10-19T09:00:00+08:00' } };
}
describe('World诊断先复现', () => {
  it('非法JSON定位为world/json', () => expect(failure(() => parse('{bad'))).toMatchObject({ code: 'invalid_json', details: { worldRule: 'json' } }));
  it('顶层缺字段定位字段', () => expect(failure(() => parse({}))).toMatchObject({ code: 'schema_fields', details: { worldRule: 'schema', fieldPath: 'worldCommands' } }));
  it('事件缺预计结束时间能定位命令、字段，而不是invalid_output', () => {
    const c = plannedEvent(); const { estimatedEndAt: omitted, ...missing } = c.event; void omitted;
    expect(failure(() => parse({ ...worldResult(), eventCommands: [{ ...c, event: missing }] }))).toMatchObject({ code: 'schema_fields', details: { commandType: 'SaveEvent', commandIndex: 0, fieldPath: 'eventCommands.0.event.estimatedEndAt' } });
  });
  it('来源引用不存在与时间越界分别定位', () => {
    const c = plannedEvent();
    for (const [evidence, worldRule] of [[proof({ sources: ['not-a-source'] }), 'source_missing'], [proof({ at: '2026-10-20T08:00:00+08:00' }), 'source_time']] as const)
      expect(failure(() => parse({ ...worldResult(), eventCommands: [{ ...c, evidence }] }))).toMatchObject({ details: { worldRule, commandType: 'SaveEvent', commandIndex: 0 } });
  });
  it('现场NPC越权定位到命令和actor规则', () => {
    expect(failure(() => parse(worldResult([{ type: 'UpdateNpc', commandId: 'illegal', npcId: 'scene', expectedRevision: 0, changes: { healthText: '疲惫' }, evidence: proof() }])))).toMatchObject({ code: 'permission', details: { commandType: 'UpdateNpc', commandIndex: 0, worldRule: 'actor_permission' } });
  });
  it('真实结构的合法世界输出仍可通过', () => expect(parse({ ...worldResult(), eventCommands: [plannedEvent()] })).toHaveProperty('eventCommands.0.type', 'SaveEvent'));
  it('预计时间早于开始时定位时间规则', () => {
    const c = plannedEvent(); c.event.estimatedEndAt = actionTime;
    expect(failure(() => parse({ ...worldResult(), eventCommands: [c] }))).toMatchObject({ code: 'time_data', details: { commandType: 'SaveEvent' } });
  });
});
describe('自动提交的等待输入边界先复现', () => {
  it('完整三阶段不依赖下一条玩家行动即可原子结算，创建空待输入草稿；精确重放不二次扣款', async () => {
    const repo = await SaveRepository.open('automatic-settlement', new IDBFactory()); repositories.push(repo); await repo.create(worldState());
    const draft = await completeDraft(repo), input = { ...submission(draft), nextAction: '' };
    const committed = await repo.commitTurn(input);
    expect(committed.state.turnNumber).toBe(1); expect(committed.draft.userInput).toBe(''); expect(committed.draft.story).toBeUndefined();
    expect((await repo.commitTurn(input)).replayed).toBe(true);
    expect((await repo.load('save-a')).economy.cash).toBe(committed.state.economy.cash);
  });
});
