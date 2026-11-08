import { GameStateSchema } from '../../domain/state';
import { TurnDraftSchema } from '../../domain/drafts';
import { defaultSettings } from '../../ui/settings/model';
import { game, npc, gameTime, event, task } from './game';
import { worldDraft } from './world';

export const companionMilestones = [8, 60, 120, 160, 220, 280];
/** A companion participates in 293/300 turns, including ordinary shared activities and broad summaries. */
export function longCompanionRecallFixture() {
  const state = game('long-companion-recall');
  state.createdAt = state.updatedAt = gameTime;
  const history: Record<number, string> = {
    8: '那是我们第一次见面的那天。小晚在旧书铺替主角找回遗失的信笺，两人因此相识。',
    60: '林晚决定成为长期同行的伙伴，双方重新商量彼此的边界，关系发生转折。',
    120: '林晚和主角因为搬家决定发生争吵。双方误解了对方的打算，当天各自离开。',
    160: '搬家的争吵终于说清，两人交换解释并和解，重新确认今后重大决定要共同商量。',
    220: '林晚与主角作出长期承诺，约定一起修复山间旧屋，待秋季到来便开始施工。',
    280: '修复旧屋的长期承诺有了新变化：材料运送受阻，双方约定推迟施工，先查明路况。',
  };
  const routine = ['林晚和主角一起吃早餐，随后收拾餐桌。', '林晚和主角一起散步，沿着河堤缓缓走回住处。',
    '林晚和主角闲坐聊天，聊过当天的琐事。', '林晚和主角各自工作，结束后整理桌面。'];
  state.journal = Array.from({ length: 300 }, (_, index) => ({
    turnId: `companion-${index + 1}`, revision: index + 1,
    relatedActorRefs: index >= 7 ? [{ kind: 'npc' as const, id: 'partner' }] : [],
    story: { turnKind: 'regular' as const, narrative: history[index + 1] ?? `第${index + 1}日，${index < 7 ? '主角独自整理住处。' : routine[index % routine.length]}`,
      summary: history[index + 1] ?? (index < 7 ? '主角独自整理住处。' : routine[index % routine.length]), variableGuide: [] },
  }));
  const memory = (number: number) => ({ id: `raw-${number}`, text: state.journal[number - 1].story.narrative,
    sourceTurnIds: [`companion-${number}`], affectedEntityRefs: [{ kind: 'npc' as const, id: 'partner' }],
    visibility: 'npc_private' as const, createdAtGameTime: gameTime, knowledgeSource: '自己的共同经历' });
  state.npc.partner = { ...npc('partner'), name: '林晚', aliases: ['小晚'], kind: 'special', onScene: true,
    relationshipText: '长期同行，最近已调整承诺的履行计划。', background: '曾经历初识、关系转折、争吵与和解。',
    detailedBackground: '完整私人经历与最新档案，不能因召回降噪而裁剪。', activeGoals: [], habits: ['早餐后整理桌面'],
    memories: Array.from({ length: 293 }, (_, index) => memory(index + 8)),
    longTermMemories: companionMilestones.map(number => ({ ...memory(number), id: `long-${number}` })), offscreenTaskIds: [],
    privateProfile: { firstExperienceText: '正式私人资料标记，三个阶段都可完整读取。' } };
  state.memories.npcSummaries.partner = [0, 100, 200].map((start, index) => ({
    id: `broad-${index}`, text: '共同生活包含初识、争吵、和解、旧屋承诺及其变化，也包含早餐、散步、聊天和工作。',
    sourceTurnIds: state.journal.slice(start, start + 100).map(entry => entry.turnId),
    affectedEntityRefs: [{ kind: 'npc', id: 'partner' }], visibility: 'npc_private', createdAtGameTime: gameTime,
  }));
  state.revision = state.turnNumber = 300;
  const base = worldDraft();
  const draft = TurnDraftSchema.parse({ ...base, saveId: state.saveId, baseSaveRevision: 300,
    userInput: '和她去吃早餐。', story: { ...base.story!, narrative: '林晚和主角在住处吃早餐，随后收拾餐桌。', variableGuide: [] },
    variables: { ...base.variables!, result: { commands: [], rejectedSuggestions: [], unresolved: [] } } });
  const settings = defaultSettings(); settings.memory.immediateWindowSize = 3;
  return { state: GameStateSchema.parse(state), draft, settings };
}

export function addCompanionBackgroundEvent(a: ReturnType<typeof longCompanionRecallFixture>) {
  a.state.npc.worker = { ...npc('worker'), name: '运送人', onScene: false };
  a.state.events.materials = { ...event('materials'), title: '旧屋材料运送', status: 'blocked',
    actorRefs: [{ kind: 'npc', id: 'worker' }], linkedTaskIds: ['materials-task'],
    sourceTurnIds: ['companion-220', 'companion-280'], blockers: ['路况尚未确认'] };
  a.state.tasks['materials-task'] = { ...task('materials-task'), actorRef: { kind: 'npc', id: 'worker' },
    linkedEventId: 'materials', goal: '查明运送材料的道路情况', status: 'active' };
  return a;
}
