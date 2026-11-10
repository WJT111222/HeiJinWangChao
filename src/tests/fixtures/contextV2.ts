import { GameStateSchema } from '../../domain/state';
import { TurnDraftSchema } from '../../domain/drafts';
import { defaultSettings } from '../../ui/settings/model';
import { game, npc, gameTime, event, task, organizations } from './game';
import { worldDraft } from './world';

// 可重复的合成富状态，不来自真实玩家存档；供最终 messages、Runtime 和体积比较共用。
export function contextV2Fixture() {
  const state = game('context-v2');
  state.createdAt = state.updatedAt = gameTime;
  state.weatherText = '天气标记：薄雾转晴';
  state.environmentText = '环境标记：街道传来电车声';
  state.protagonist.background = '主角完整背景标记';
  state.locations.remote = { id: 'remote', name: '远处资料室', parentId: 'chongqing' };
  for (const [id, onScene, special] of [
    ['scene-ordinary', true, false], ['off-ordinary', false, false],
    ['scene-special', true, true], ['off-special', false, true],
    ['companion', false, true],
  ] as const) {
    const base = { ...npc(id), name: `${id}姓名`, onScene, locationId: onScene ? 'chongqing' : 'remote',
      age: 32, gender: 'female' as const, aliases: [`${id}别名`], identity: `${id}身份`,
      appearance: `${id}外貌`, temperament: `${id}性格`, background: `${id}背景`,
      skills: [`${id}技能`], relationshipText: `${id}关系`, healthText: `${id}健康`, lastInteractionAt: gameTime,
      memories: Array.from({ length: 24 }, (_, index) => ({
        id: `${id}-raw-${index}`, text: `${id}原始私有记忆${index}：保管资料与自己的未了约定。`,
        visibility: index === 23 ? 'internal' as const : 'npc_private' as const,
        sourceTurnIds: ['past-1'], affectedEntityRefs: [{ kind: 'npc' as const, id }],
        createdAtGameTime: gameTime, knowledgeKind: 'observed' as const, knowledgeSource: '亲历标记',
      })),
      knownInformation: [{ text: `${id}已知情报`, source: '独立来源', learnedAt: gameTime }],
    };
    state.npc[id] = special ? { ...base, kind: 'special', detailedBackground: `${id}完整详细背景`,
      activeGoals: [`${id}长期目标`], habits: [`${id}习惯`], offscreenTaskIds: [],
      memories: [...base.memories, { ...base.memories[0], id: `${id}-long`, text: `${id}长期私有记忆` }], longTermMemories: [],
      privateProfile: { bodyDescription: `${id}私人档案标记`, isVirgin: false, firstExperienceText: '私人经历标记' },
    } : base;
    state.memories.npcSummaries[id] = [{ ...base.memories[0],
      id: `${id}-summary`, text: `${id}私人总结完整标记`,
      // 总结与原始材料同在，不能因为已有总结就裁掉原始记忆。
    }].map(({ id: memoryId, text, visibility, sourceTurnIds, affectedEntityRefs, createdAtGameTime }) =>
      ({ id: memoryId, text, visibility, sourceTurnIds, affectedEntityRefs, createdAtGameTime }));
  }
  state.initialCompanionId = 'companion';
  state.contactNpcIds = ['scene-ordinary'];
  state.contactReviewNpcIds = ['off-ordinary'];
  state.retiredNpcs.retired = { id: 'retired', identityKey: 'retired-identity', name: '已退场人物', aliases: [], retiredAt: gameTime, sourceTurnIds: ['past-1'] };
  const ownerRef = { kind: 'protagonist' as const, id: 'hero' };
  state.items.bag = { id: 'bag', name: '背包标记', category: 'other', quantity: 1, ownerRef, conditionText: '完整' };
  state.items.offscreenItem = { id: 'offscreenItem', name: '场外人物物品标记', category: 'other', quantity: 1, ownerRef: { kind: 'npc', id: 'off-ordinary' }, conditionText: '完整' };
  state.economy.incomes.salary = { id: 'salary', source: '工资标记', amount: 800000, status: 'expected', account: 'onlineBalance', scheduleText: '每月月底' };
  state.economy.debts.loan = { id: 'loan', creditor: '债权标记', principal: 500000, outstanding: 250000, status: 'active', repaymentTerms: '分期', collateralAssetIds: ['house'], autoPaymentAuthorized: false, source: '既有借款' };
  const asset = { ownerRef, estimatedValue: 1000000, source: '既有财产标记', statusText: '可用' };
  state.economy.properties.house = { ...asset, id: 'house', name: '房产标记', kind: 'property', locationId: 'chongqing', ownershipText: '独有', mortgageDebtId: 'loan' };
  state.economy.vehicles.car = { ...asset, id: 'car', name: '车辆标记', kind: 'vehicle', model: '轿车', locationId: 'chongqing' };
  state.economy.otherAssets.shares = { ...asset, id: 'shares', name: '其他资产标记', kind: 'other', category: '份额', details: '已有份额' };
  state.economy.otherAssets.remoteAsset = { ...asset, id: 'remoteAsset', name: '场外资产标记', ownerRef: { kind: 'npc', id: 'off-ordinary' }, kind: 'other', category: '资料', details: '独有资料' };
  state.protagonist.currentWear.currentVehicleAssetId = 'car';
  organizations.forEach((org, index) => { const id = `organization-${index}`; state.organizations[id] = { ...org, id, name: `组织${index}完整标记` }; });
  for (const [id, actorRef] of [
    ['hero-task', ownerRef], ['scene-task', { kind: 'npc' as const, id: 'scene-special' }],
    ['off-task', { kind: 'npc' as const, id: 'off-special' }], ['org-task', { kind: 'organization' as const, id: 'organization-3' }],
  ] as const) state.tasks[id] = { ...task(id), actorRef, goal: `${id}完整任务标记` };
  state.events.secret = { ...event('secret'), title: '隐藏事件完整标记', estimatedEndAt: '2026-10-20T08:00:00+08:00', actorRefs: [{ kind: 'npc', id: 'off-special' }] };
  state.retiredEvents.light = { id: 'light', status: 'cancelled', retiredAt: gameTime, sourceTurnIds: ['past-1'], linkedTaskIds: [], predecessorEventIds: [] };
  state.retiredEvents.detailed = { ...state.retiredEvents.light, id: 'detailed', detail: {
    title: '退役事件成果标记', startAt: gameTime, resolvedAt: gameTime, actorRefs: [ownerRef], visibility: 'hidden', impact: 'major', resolutionText: '完整历史成果',
  } };
  state.timeline = [{ id: 'timeline-one', title: '历史陈述标记', summary: '旧日合作秘密并非人人知晓', knowledgeKind: 'reported',
    sourceRef: { kind: 'npc', id: 'off-special' }, actorRefs: [ownerRef], relatedEntryIds: [], recordedAt: gameTime, sourceTurnId: 'past-1' }];
  for (const layer of ['short', 'medium', 'long'] as const) state.memories[layer] = Array.from({ length: 15 }, (_, index) => ({
    id: `${layer}-${index}`, text: `${layer}完整层级记忆${index}：${'历史因果与独立角色立场。'.repeat(45)}`,
    sourceTurnIds: ['past-1'], affectedEntityRefs: [], visibility: index % 2 ? 'internal' : 'player_known', createdAtGameTime: gameTime,
  }));
  state.journal = Array.from({ length: 8 }, (_, index) => ({
    turnId: `past-${index + 1}`, revision: index + 1, relatedActorRefs: [ownerRef],
    story: { turnKind: 'regular' as const, narrative: `已提交正文${index + 1}：${'散步与交流，保留完整经过。'.repeat(30)}`,
      summary: `已提交摘要${index + 1}`, variableGuide: [{ group: 'protagonist' as const, observedFact: `已提交指导${index + 1}` }],
      actionOptions: [`已提交选项${index + 1}`] },
  }));
  state.revision = state.turnNumber = state.journal.length;
  state.appliedCommands = [{ turnId: 'past-1', commandId: 'old-command', fingerprint: '不可注入的幂等指纹' }];
  const draft = TurnDraftSchema.parse({ ...worldDraft(), saveId: state.saveId, baseSaveRevision: state.revision,
    userInput: '本次独立玩家行动：付现金吃饭，然后听现场人物讲述。',
    story: { ...worldDraft().story!, narrative: '本回合候选正文标记：经过十分钟，主角用现金支付30元吃饭，听现场人物讲述。',
      variableGuide: [{ group: 'economy', observedFact: '本回合完整变量指导' }], actionOptions: ['本回合候选选项'] },
  });
  const settings = defaultSettings(); settings.memory.immediateWindowSize = 3;
  return { state: GameStateSchema.parse(state), draft, settings };
}
