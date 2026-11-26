import { game, gameTime, npc, organizations } from './game';

export function phoneGame() {
  const state = game('phone-fixture');
  state.title = '江边的周末';
  state.revision = state.turnNumber = 1;
  state.journal = [
    {
      turnId: 'evening',
      revision: 1,
      relatedActorRefs: [],
      story: {
        turnKind: 'opening',
        narrative: '林舟从沿江步道回来，在窗边坐下。',
        summary: '沿江散步后回家。',
        variableGuide: [],
      },
      scene: { worldClock: gameTime, locationId: 'chongqing' },
    },
  ];
  state.worldClock = '2026-10-18T21:40:00+08:00';
  state.economy.onlineBalance = 8642035;
  const ownerRef = { kind: 'protagonist' as const, id: state.protagonist.id };
  state.economy.properties.flat = {
    kind: 'property',
    id: 'flat',
    name: '临江公寓',
    ownerRef,
    estimatedValue: 68000000,
    source: '购入住房',
    statusText: '自住',
    locationId: 'chongqing',
    ownershipText: '本人产权',
    mortgageDebtId: 'mortgage',
  };
  state.economy.debts.mortgage = {
    id: 'mortgage',
    creditor: '城市银行',
    principal: 50000000,
    outstanding: 41200000,
    status: 'active',
    dueAt: '2026-10-21T08:00:00+08:00',
    source: '住房贷款',
    collateralAssetIds: ['flat'],
    autoPaymentAuthorized: true,
    repaymentTerms: '按月还款',
  };
  state.economy.vehicles.car = {
    kind: 'vehicle',
    id: 'car',
    name: '银色轿车',
    ownerRef,
    estimatedValue: 6500000,
    source: '购入',
    statusText: '停放中',
    model: '旅行车',
    plate: '渝A·20367',
    locationId: 'chongqing',
  };
  state.economy.otherAssets.studio = {
    kind: 'other',
    id: 'studio',
    name: '工作室份额',
    ownerRef,
    estimatedValue: null,
    source: '出资',
    statusText: '持有',
    category: '股权',
    details: '持有两成份额',
  };
  state.economy.incomes.royalty = {
    id: 'royalty',
    source: '九月稿酬',
    status: 'expected',
    account: 'onlineBalance',
    amount: 150000,
    expectedAt: '2026-10-25T09:00:00+08:00',
  };
  const people = [
    ['daughter', '林安'],
    ['partner', '方宁'],
    ['colleague', '许舟'],
    ['old', '顾远'],
    ['hidden', '程望'],
  ];
  for (const [id, name] of people)
    state.npc[id] = { ...npc(id), name, phoneContact: { status: id === 'old' ? 'invalid' : 'known' } };
  Object.assign(state.npc.partner, { gender: 'female', age: 30 });
  state.contactNpcIds = people.map(([id]) => id);
  state.harem = {
    members: {
      partner: {
        id: 'partner',
        identityKey: 'identity-partner',
        changes: [{ from: null, to: 100, at: gameTime, turnId: 'evening', reason: '共同生活' }],
      },
    },
    pairs: [],
    children: [
      {
        childNpcId: 'daughter',
        parentNpcId: 'partner',
        protagonistParentage: 'confirmed',
        kinship: 'adoptive',
        visibility: 'player_known',
        turnId: 'evening',
        at: gameTime,
        reason: '家人相认',
      },
    ],
  };
  const org = {
    ...organizations[3],
    id: 'org',
    members: [
      { npcId: 'colleague', position: '同事' },
      { npcId: 'hidden', position: '职员', covert: true },
    ],
  };
  state.organizations.org = org;
  state.protagonistFaction = {
    organizationId: org.id,
    position: '经理',
    joinedAt: gameTime,
    bondText: '加入公司',
  };
  return state;
}
