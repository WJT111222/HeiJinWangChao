import { hasKnownPlayerConnection } from './contactReview';
import type { ContactReview } from './contactReview';
import { npcKnowledgeKind } from '../memories/schema';
import { requireData } from '../common';
import type { GameState } from '../state';
import type { WorldTask } from '../events/schema';

export const terminalTask = (task: WorldTask) => ['completed', 'cancelled'].includes(task.status);
const sameActor = (a: WorldTask, b: WorldTask) => a.actorRef.kind === b.actorRef.kind && a.actorRef.id === b.actorRef.id;

// 校验真实时间区间，而不是强迫接班等待下一回合。旧终态缺实际结束记录不猜补时间。
export function validateTaskTransitions(before: GameState, after: GameState, changed: readonly WorldTask[]) {
  for (const task of changed) {
    const old = before.tasks[task.id];
    requireData(!old || (sameActor(old, task) && old.goal === task.goal && old.startAt === task.startAt
      && old.completionCondition === task.completionCondition), 'TASK_ACTOR', '历史任务身份与职责不能改派');
    if (task.handoff) {
      requireData(!old || JSON.stringify(old.handoff) === JSON.stringify(task.handoff), 'HANDOFF_IMMUTABLE', '不能事后补造或改写交接');
      const repeated = Object.values(after.tasks).filter((other) => other.handoff?.fromTaskId === task.handoff?.fromTaskId
        && sameActor(other, task) && other.goal === task.goal);
      requireData(repeated.length === 1, 'DUPLICATE_HANDOFF', '不能重复交接同一成果与职责');
    }
    if (task.actorRef.kind !== 'npc' || old) continue;
    for (const other of Object.values(after.tasks)) {
      if (other.id === task.id || !sameActor(other, task)) continue;
      const end = task.resolution?.at, otherEnd = other.resolution?.at;
      // 两项未终结任务即便计划开始时间不同也争用同一个名额。
      const disjoint = (terminalTask(other) && (otherEnd
        ? Date.parse(otherEnd) <= Date.parse(task.startAt)
        : Boolean(before.tasks[other.id] && terminalTask(before.tasks[other.id]))))
        || (terminalTask(task) && end && Date.parse(end) <= Date.parse(other.startAt));
      requireData(disjoint, 'NPC_TASK_CONFLICT', 'NPC 后台职责重叠，须先有真实终结及合法开始时间');
      // 本批新终结的旧任务必须有确切结束时间；不能用 legacy 终态逃逸。
      if (before.tasks[other.id] && !terminalTask(before.tasks[other.id]) && terminalTask(other))
        requireData(otherEnd && Date.parse(otherEnd) <= Date.parse(task.startAt), 'NPC_TASK_CONFLICT', '同批释放缺少实际终结时间');
    }
  }
  const touched = new Set(changed.filter((t) => t.actorRef.kind === 'npc').map((t) => t.actorRef.id));
  for (const id of touched) requireData(Object.values(after.tasks).filter((t) => t.actorRef.kind === 'npc'
    && t.actorRef.id === id && !terminalTask(t)).length <= 1, 'NPC_TASK_CONFLICT', 'NPC 最多一项未终结后台任务');
}

export function retireNpc(state: GameState, npcId: string, expectedIdentityKey: string,
  retainMemoryIds: readonly string[], turnId: string, contactReview?: ContactReview) {
  const npc = state.npc[npcId];
  requireData(npc && npc.identityKey === expectedIdentityKey, 'NPC_IDENTITY', '退场人物身份已经变化');
  requireData(!state.contactNpcIds.includes(npcId) && state.initialCompanionId !== npcId && !npc.onScene,
    'NPC_PROTECTED', '联系人、初始同伴和现场人物保留完整档案');
  if (state.contactReviewNpcIds.includes(npcId)) requireData(contactReview?.conclusion === 'non_contact'
    && (contactReview.basis === 'player_confirmed' ? contactReview.playerConfirmation : !hasKnownPlayerConnection(state, npcId)),
    'CONTACT_UNREVIEWED', '旧档联系人身份尚未可靠复核，暂缓清理');
  requireData(npc.kind !== 'special' || npc.activeGoals.length === 0, 'NPC_DUTIES', '人物仍有明确长期职责');
  const duties = Object.values(state.tasks).filter((task) => task.actorRef.kind === 'npc' && task.actorRef.id === npcId);
  requireData(duties.every(terminalTask), 'NPC_DUTIES', '未终结任务不能随人物删除');
  requireData(duties.every((task) => task.resolution || (task.linkedEventId && ['resolved', 'cancelled'].includes(state.events[task.linkedEventId]?.status))),
    'NPC_OUTCOMES', '历史任务的必要成果尚未独立留存');
  requireData(!Object.values(state.organizations).some((org) => org.keyNpcIds.includes(npcId)), 'NPC_REFERENCED', '人物仍承担组织职务');
  const owned = [...Object.values(state.items), ...Object.values(state.economy.properties),
    ...Object.values(state.economy.vehicles), ...Object.values(state.economy.otherAssets)];
  requireData(!owned.some((item) => item.ownerRef?.kind === 'npc' && item.ownerRef.id === npcId), 'NPC_REFERENCED', '不能删除当前财产持有人');
  for (const event of Object.values(state.events)) {
    if (['resolved', 'cancelled'].includes(event.status) || !event.actorRefs.some((ref) => ref.kind === 'npc' && ref.id === npcId)) continue;
    requireData(event.linkedTaskIds.some((id) => {
      const task = state.tasks[id];
      return task && !terminalTask(task) && task.actorRef.id !== npcId && task.handoff
        && duties.some((prior) => prior.id === task.handoff?.fromTaskId);
    }), 'NPC_REFERENCED', '仍有未处理的事件职责，不能凭空退出');
  }
  const raw = [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])];
  requireData(retainMemoryIds.every((id) => raw.filter((memory) => memory.id === id).length === 1), 'NPC_MEMORY', '保留记忆来源不存在或有歧义');
  // 公开原文必须保留；AI选择的必要私人材料仅转为内部历史，绝不变成其他人的知识来源。
  for (const memory of raw.filter((m) => m.visibility === 'player_known' || retainMemoryIds.includes(m.id))) {
    const id = `retired:${npcId}:${memory.id}`;
    requireData(id.length <= 128 && !state.memories.long.some((m) => m.id === id), 'NPC_MEMORY', '历史记忆ID冲突');
    state.memories.long.push({ id, text: memory.visibility === 'player_known' ? memory.text
      : `[${npcKnowledgeKind(memory)}；来源：${memory.knowledgeSource}]${memory.text}`,
    sourceTurnIds: memory.sourceTurnIds, affectedEntityRefs: memory.affectedEntityRefs,
    retiredNpcSource: { npcId, sourceMemoryId: memory.id, knowledgeKind: npcKnowledgeKind(memory), knowledgeSource: memory.knowledgeSource },
    visibility: memory.visibility === 'player_known' ? 'player_known' : 'internal', createdAtGameTime: memory.createdAtGameTime });
  }
  state.retiredNpcs[npcId] = { id: npc.id, identityKey: npc.identityKey, name: npc.name, aliases: npc.aliases,
    retiredAt: state.worldClock, sourceTurnIds: [turnId] };
  delete state.memories.npcSummaries[npcId];
  state.contactReviewNpcIds = state.contactReviewNpcIds.filter((id) => id !== npcId);
  delete state.npc[npcId];
}
