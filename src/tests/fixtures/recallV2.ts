import { GameStateSchema } from '../../domain/state';
import { TurnDraftSchema } from '../../domain/drafts';
import { defaultSettings } from '../../ui/settings/model';
import { game, npc, event, task, gameTime } from './game';
import { worldDraft } from './world';

/** Synthetic committed history: no production save, paid request, schema change or compression. */
export function recallV2Fixture(count = 200) {
  const state = game('recall-v2');
  state.createdAt = state.updatedAt = gameTime;
  state.npc.zhang = { ...npc('zhang'), name: '张三', aliases: ['阿山', '旧称三郎'], onScene: false,
    relationshipText: '旧款已经结清，现在是合作伙伴。' };
  state.npc.worker = { ...npc('worker'), name: '墨客', onScene: false };
  const milestones: Record<number, string> = {
    8: '阿山初识主角，在废弃码头一同救下受伤船夫。',
    10: '旧称三郎借走主角五百元，用于修复渔船。',
    25: '他在无人知晓的阁楼坦白私人往事：曾替兄长保管证据。',
    30: '墨客受托为组织运送账册，起因是前任信使失联。',
    60: '阿山作出约定，待商路恢复便共同寻找失踪船夫。',
    70: '旧称三郎承诺分两次偿还借款，双方重新约定期限。',
    90: '墨客因山道封锁受阻，与摆渡人约定改走水路。',
    130: '旧称三郎告知船夫已经远行，原来的寻找计划需要改变。',
    140: '旧称三郎偿还两百元，仍欠三百元，双方记下余额。',
    150: '阿山与主角建立新的航运合作，旧债不再与新账混算。',
    160: '墨客收到摆渡人的回信，可以继续护送账册。',
    190: '路边传闻旧称三郎仍欠全部款项，未经证实。',
    199: '旧称三郎终于结清余款，主角出具收据。',
    200: '主角今天准备再次拜访老朋友，尚未开始谈话。',
  };
  state.journal = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const narrative = milestones[number] ?? `日常记录${number}：清扫屋舍，给盆栽浇水。`;
    return { turnId: `history-${number}`, revision: number,
      relatedActorRefs: [8, 10, 60, 70, 140, 150, 199].includes(number) ? [{ kind: 'npc' as const, id: 'zhang' }] : [],
      story: { turnKind: 'regular' as const, narrative, summary: narrative, variableGuide: [] } };
  });
  state.revision = state.turnNumber = count;
  const memory = { id: 'sailing-history', text: '救助船夫、旧日约定以及后来的计划改变。',
    sourceTurnIds: ['history-8', 'history-60', 'history-130', 'history-199'], affectedEntityRefs: [{ kind: 'npc' as const, id: 'zhang' }],
    visibility: 'internal' as const, createdAtGameTime: gameTime };
  state.memories.long = [memory];
  state.memories.medium = [{ ...memory, id: 'sailing-medium' }];
  state.memories.short = [{ ...memory, id: 'sailing-short' }];
  state.npc.zhang.memories = [{ ...memory, id: 'private-history', text: '私人阁楼经历关联保存，不能仅因离场排除。',
    sourceTurnIds: ['history-25'], visibility: 'npc_private', knowledgeSource: '亲历' }];
  state.memories.npcSummaries.zhang = [{ ...memory, id: 'private-summary', sourceTurnIds: ['history-25'], visibility: 'npc_private' }];
  state.events.escort = { ...event('escort'), title: '账册护送', status: 'active', estimatedEndAt: '2026-10-18T08:06:00+08:00',
    actorRefs: [{ kind: 'npc', id: 'worker' }], linkedTaskIds: ['escort-task'], sourceTurnIds: ['history-30', 'history-90', 'history-160'] };
  state.tasks['escort-task'] = { ...task('escort-task'), goal: '送达账册', status: 'blocked',
    actorRef: { kind: 'npc', id: 'worker' }, linkedEventId: 'escort', dueAt: '2026-10-18T08:06:00+08:00', blockers: ['等待摆渡人'] };
  state.timeline = [{ id: 'plan-change', title: '航运计划修正', summary: '船夫远行，旧约需要重新商量。',
    knowledgeKind: 'established', sourceTurnId: 'history-130', recordedAt: gameTime,
    actorRefs: [{ kind: 'npc', id: 'zhang' }], relatedEntryIds: [] }];
  state.economy.debts.oldLoan = { id: 'oldLoan', creditor: '主角', principal: 50000, outstanding: 0, status: 'repaid',
    repaymentTerms: '已全额结清', collateralAssetIds: [], autoPaymentAuthorized: false, source: 'history-199收据' };
  const base = worldDraft();
  const draft = TurnDraftSchema.parse({ ...base, saveId: state.saveId, baseSaveRevision: state.revision, userInput: '去找张三聊聊。',
    story: { ...base.story!, narrative: `${base.story!.narrative}随后主角与张三谈起船夫的去向和旧约。`,
      variableGuide: [{ group: 'npc', subjectHint: 'zhang', observedFact: '张三谈起过去的约定，尚未新增付款。' }] } });
  const settings = defaultSettings(); settings.memory.immediateWindowSize = 3;
  settings.prompts.minNarrativeChars = 1; settings.prompts.actionOptions = false;
  return { state: GameStateSchema.parse(state), draft, settings };
}
