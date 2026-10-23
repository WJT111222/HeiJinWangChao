import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import type { DomainCommand } from '../../domain/commands';
import type { WorldTask } from '../../domain/events/schema';
import { worldState, worldResult, proof, actionTime } from './world';
import { npc, task, organizations } from './game';

export const resultText = '清单记录了三份齐全的材料，登记编号为318。';
export function handoffState() {
  const state = worldState();
  state.npc['npc-a'] = { ...npc(), onScene: false };
  state.npc['npc-b'] = { ...npc('npc-b'), name: '接收人', onScene: false };
  state.organizations['org-a'] = organizations[1];
  state.tasks.work = { ...task('work'), goal: '核对材料', actorRef: { kind: 'npc', id: 'npc-a' }, status: 'active', dueAt: '2026-10-18T09:00:00+08:00' };
  return GameStateSchema.parse(state);
}
export function finishTask(state: GameState, id = 'work', at = actionTime, status: 'completed' | 'cancelled' = 'completed'): Extract<DomainCommand, { type: 'SaveTask' }> {
  return { type: 'SaveTask', commandId: `finish-${id}`, task: { ...state.tasks[id], status },
    evidence: proof({ at, sources: [`task:${id}`, state.tasks[id].actorRef.kind === 'npc' ? `npc:${state.tasks[id].actorRef.id}` : `org:${state.tasks[id].actorRef.id}`],
      fact: status === 'completed' ? '清单与三份材料逐一吻合。' : '材料封存，核对人员离开工作岗位。',
      decision: { targetId: id, status, result: resultText, reason: status === 'completed' ? '逐份比对登记记录，无缺失。' : '场地被封，原排程不再执行，留下登记清单。',
        conditionsSatisfied: status === 'completed', continues: false, failure: status === 'cancelled',
        resultKnowledge: { facts: [resultText], reported: [], suspected: [] } } }) };
}
export function receiveTask(actor: WorldTask['actorRef'] = { kind: 'npc', id: 'npc-b' }, id = 'next'): Extract<DomainCommand, { type: 'SaveTask' }> {
  return { type: 'SaveTask', commandId: `receive-${id}`, task: { ...task(id), actorRef: actor, goal: '根据清单核验登记手续', status: 'active', startAt: '2026-10-18T08:06:00+08:00', dueAt: '2026-10-18T09:00:00+08:00',
    handoff: { fromTaskId: 'work', at: '2026-10-18T08:06:00+08:00', channel: '内部工作电话报告编号和清单', content: resultText, necessity: '后续登记核验属于接收方职责', knowledgeKind: 'reported' } },
    evidence: proof({ at: '2026-10-18T08:06:00+08:00', sources: ['task:work', actor.kind === 'organization' ? `org:${actor.id}` : `npc:${actor.id}`], fact: resultText }) };
}
export function retireCommand(state: GameState, id = 'npc-a'): Extract<DomainCommand, { type: 'RetireNpc' }> {
  const reason = '临时核对工作告一段落，成果已登记，没有其他职责。';
  return { type: 'RetireNpc', commandId: `retire-${id}`, npcId: id, expectedIdentityKey: state.npc[id].identityKey, reason, retainMemoryIds: [],
    evidence: proof({ sources: [`npc:${id}`], fact: '临时人员办妥离任安排。', decision: { targetId: id, status: 'retired', reason, result: '必要成果留存于任务登记清单。', conditionsSatisfied: true, continues: false } }) };
}
export function handoffResult(state: GameState, recipient: WorldTask['actorRef'] = { kind: 'npc', id: 'npc-b' }) {
  return { ...worldResult(), visibleHooks: [], taskCommands: [receiveTask(recipient), finishTask(state)] };
}
