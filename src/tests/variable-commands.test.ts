import { describe, expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { parseVariables } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { playerView } from '../ui/panels/playerView';
import { selectVariableDomains } from '../prompts/variableDomains';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { game, npc, gameTime } from './fixtures/game';

const paid = '主角已经用现金支付30元吃饭。';
const spend: DomainCommand = {
  type: 'SpendFunds',
  commandId: 'meal',
  evidence: paid,
  account: 'cash',
  amount: 3000,
  purpose: '午餐',
};
function draft(text = paid, mode: 'opening' | 'regular' = 'regular') {
  return rerollStory(createTurnDraft('save-a', 0, 'turn-a', mode, '固定行动'), {
    turnKind: mode,
    narrative: text,
    summary: '',
    variableGuide: [],
  });
}
function parsed(
  commands: DomainCommand[],
  text = commands.map((command) => command.evidence).join('。'),
  state = game(),
) {
  return parseVariables(
    JSON.stringify({ commands, rejectedSuggestions: [], unresolved: [] }),
    state,
    draft(text),
  );
}
function apply(commands: DomainCommand[], state = game()) {
  return commitCommands(state, 'turn-a', state.revision, commands, state.updatedAt);
}
function scene() {
  return GameStateSchema.parse({ ...game(), npc: { 'npc-a': npc() } });
}
function update(
  changes: Extract<DomainCommand, { type: 'UpdateNpc' }>['changes'],
): Extract<DomainCommand, { type: 'UpdateNpc' }> {
  return {
    type: 'UpdateNpc',
    commandId: 'npc-change',
    expectedRevision: 0,
    npcId: 'npc-a',
    evidence: '同事承担了重大风险救下主角，关系变得信任。',
    changes,
  };
}
const item = {
  id: 'badge',
  name: '证件',
  category: 'document' as const,
  quantity: 2,
  ownerRef: { kind: 'protagonist' as const, id: 'hero' },
  conditionText: '完好',
};
function withItem() {
  return GameStateSchema.parse({ ...game(), items: { badge: item } });
}

describe('M4-P2 八类严格领域命令', () => {
  it('真实目录包含旧十四类和八类新命令，所有类型均可导出严格 JSON Schema', () => {
    expect(DomainCommandSchema.options).toHaveLength(24);
    expect(commandCatalog('variables').schema.oneOf).toHaveLength(23);
    for (const type of [
      'UpdateProtagonist',
      'UpdateNpc',
      'RecordNpcMemory',
      'CreateLocation',
      'SpendFunds',
      'AcquireItem',
      'UpdateItem',
      'LoseItem',
    ]) {
      expect(commandCatalog('variables').commandTypes).toContain(type);
      expect(commandCatalog('world').commandTypes.some((candidate) => candidate === type)).toBe(
        ['UpdateNpc', 'RecordNpcMemory', 'CreateLocation'].includes(type),
      );
    }
    expect(DomainCommandSchema.safeParse({ ...spend, arbitraryPath: 'economy.cash' }).success).toBe(
      false,
    );
    expect(
      DomainCommandSchema.safeParse({
        ...update({}),
        changes: { identityKey: 'rewrite', affinityConfirmed: true },
      }).success,
    ).toBe(false);
  });
  it('消费扣款但不创建永久物品、收入或其它资产，原始状态不变', () => {
    const state = game(),
      before = structuredClone(state);
    expect(parsed([spend], paid, state).commands).toHaveLength(1);
    const after = apply([spend], state);
    expect(after.economy.cash).toBe(7000);
    expect(after.economy.incomes).toEqual({});
    expect(after.items).toEqual({});
    expect(state).toEqual(before);
  });
  it.each([null, 2000])('余额 %s 时不允许猜零或透支，整批回滚', (cash) => {
    const state = GameStateSchema.parse({ ...game(), economy: { ...game().economy, cash } });
    expect(() => apply([spend], state)).toThrow();
    expect(state.economy.cash).toBe(cash);
  });
  it('命令重放幂等，复用 ID 却改内容拒绝冲突', () => {
    const once = apply([spend]);
    expect(commitCommands(once, 'turn-a', 0, [spend])).toEqual(once);
    expect(() => commitCommands(once, 'turn-a', 1, [{ ...spend, purpose: '不同消费' }])).toThrow(
      '内容发生变化',
    );
  });
  it('主角白名单更新允许现实状态变化，不能改 ID、属性或过期版本', () => {
    const command: DomainCommand = {
      type: 'UpdateProtagonist',
      commandId: 'hero',
      expectedRevision: 0,
      protagonistId: 'hero',
      evidence: '受伤后到诊所就诊，情绪紧张。',
      changes: {
        healthText: '手臂受伤',
        emotionText: '紧张',
        profession: '教师',
        legalStatus: '合法公民',
        publicStatus: '请假',
      },
    };
    expect(apply([command]).protagonist.healthText).toBe('手臂受伤');
    expect(() => apply([{ ...command, expectedRevision: 1 }])).toThrow('过期');
    expect(DomainCommandSchema.safeParse({ ...command, changes: { strength: 20 } }).success).toBe(
      false,
    );
  });
  it('新地点与主角位置支持增量层级，原 NPC 必须有明确离场或跟随事实', () => {
    const state = scene();
    const location: DomainCommand = {
      type: 'CreateLocation',
      commandId: 'place',
      evidence: '到了诊所',
      location: { id: 'clinic', name: '社区诊所', parentId: 'chongqing' },
    };
    const move: DomainCommand = {
      type: 'UpdateProtagonist',
      commandId: 'move',
      expectedRevision: 0,
      protagonistId: 'hero',
      evidence: '主角到了诊所',
      changes: { locationId: 'clinic' },
    };
    expect(() => apply([location, move], state)).toThrow();
    const after = apply(
      [location, move, { ...update({ onScene: false }), evidence: '同事留在重庆。' }],
      state,
    );
    expect(after.protagonist.locationId).toBe('clinic');
    expect(after.npc['npc-a'].locationId).toBe('chongqing');
    expect(after.npc['npc-a'].onScene).toBe(false);
    expect(
      apply(
        [
          location,
          move,
          {
            ...update({ onScene: true, locationId: 'clinic' }),
            evidence: '同事和主角一起走进社区诊所。',
          },
        ],
        state,
      ).npc['npc-a'].locationId,
    ).toBe('clinic');
    expect(() => apply([update({ onScene: true, locationId: 'missing' })], state)).toThrow();
  });
  it.each([
    { id: 'x', name: '地点', parentId: 'missing' },
    { id: 'x', name: '地点', parentId: 'x' },
  ])('非法父级/循环地点拒绝：%s', (location) => {
    expect(() =>
      apply([{ type: 'CreateLocation', commandId: 'location', evidence: '到达地点', location }]),
    ).toThrow();
  });
  it('关系候选保留前值、原因和范围；是否因寒暄变化由模型判断', () => {
    const state = scene(),
      command = {
        ...update({ relationshipText: '共同承担风险后信任' }),
        affinityChange: { from: 30, to: 35, reason: '同事承担了重大风险救下主角' },
      };
    parsed([command], command.evidence, state);
    expect(apply([command], state).npc['npc-a'].affinity).toBe(35);
    expect(() =>
      apply([{ ...command, affinityChange: { ...command.affinityChange, from: 0 } }], state),
    ).toThrow('前值');
    expect(
      DomainCommandSchema.safeParse({
        ...command,
        affinityChange: { ...command.affinityChange, to: 101 },
      }).success,
    ).toBe(false);
    expect(() =>
      parsed(
        [
          {
            ...command,
            evidence: '同事问好寒暄。',
            affinityChange: { from: 30, to: 35, reason: '问好寒暄' },
          },
        ],
        '同事问好寒暄。',
        state,
      ),
    ).not.toThrow();
  });
  it('初始同伴占位0保持未知，只有明确从 null 提出的候选确认；旧档不被猜测迁移', () => {
    const person = {
      ...npc(),
      kind: 'special' as const,
      detailedBackground: '',
      activeGoals: [],
      habits: [],
      longTermMemories: [],
      offscreenTaskIds: [],
      affinity: 0,
    };
    const state = GameStateSchema.parse({
      ...game(),
      npc: { 'npc-a': person },
      initialCompanionId: 'npc-a',
    });
    expect(playerView(state).npc[0].affinity).toBeNull();
    const command = {
      ...update({ relationshipText: '共同承担风险后信任' }),
      affinityChange: { from: null, to: 20, reason: '同事承担了重大风险救下主角' },
    };
    const next = apply([command], state);
    expect(next.npc['npc-a'].affinityConfirmed).toBe(true);
    expect(playerView(next).npc[0].affinity).toBe(20);
    expect(playerView(state).npc[0].affinity).toBeNull();
    expect(() =>
      apply([{ ...command, affinityChange: { ...command.affinityChange, from: 0 } }], state),
    ).toThrow('前值');
    expect(
      DomainCommandSchema.safeParse({ ...update({}), changes: { affinityConfirmed: true } })
        .success,
    ).toBe(false);
  });
  it('稳定 ID / 别名 / 初始同伴不能重复建档，原有同名不同人规则不变', () => {
    const state = scene();
    state.npc['npc-a'].aliases = ['老林'];
    expect(() =>
      apply(
        [
          {
            type: 'CreateNpc',
            commandId: 'duplicate',
            evidence: '老林到场',
            npc: { ...npc('npc-b'), name: '老林' },
          },
        ],
        state,
      ),
    ).toThrow();
    state.initialCompanionId = 'npc-a';
    state.npc['npc-a'] = {
      ...state.npc['npc-a'],
      kind: 'special',
      detailedBackground: '',
      activeGoals: [],
      habits: [],
      longTermMemories: [],
      offscreenTaskIds: [],
    };
    expect(() =>
      apply(
        [{ type: 'CreateNpc', commandId: 'duplicate', evidence: '同事到场', npc: npc('npc-b') }],
        state,
      ),
    ).toThrow();
  });
  it('NPC 记忆和知晓信息保持来源/时间/可见性；转述不是世界客观事实', () => {
    const state = scene();
    const command: DomainCommand = {
      type: 'RecordNpcMemory',
      commandId: 'memory',
      expectedRevision: 0,
      npcId: 'npc-a',
      knowledgeKind: 'reported',
      layer: 'personal',
      addToKnownInformation: true,
      evidence: '同事亲耳听到电话传闻，声称有人收到一百万。',
      memory: {
        id: 'memory-a',
        text: '[转述]听到有人自称收款，尚未证实',
        sourceTurnIds: ['turn-a'],
        affectedEntityRefs: [{ kind: 'npc', id: 'npc-a' }],
        visibility: 'npc_private',
        createdAtGameTime: gameTime,
        knowledgeSource: '亲耳听到电话传闻',
      },
    };
    parsed([command], command.evidence, state);
    const next = apply([command], state);
    expect(next.npc['npc-a'].memories[0].visibility).toBe('npc_private');
    expect(next.npc['npc-a'].knownInformation[0].text).toMatch(/^\[转述\]/);
    expect(next.economy).toEqual(state.economy);
    expect(playerView(next).memories).toEqual([]);
    expect(() =>
      apply([{ ...command, memory: { ...command.memory, text: '已客观到账一百万' } }], state),
    ).toThrow();
    expect(() => apply([{ ...command, knowledgeKind: 'observed' }], state)).toThrow();
    expect(() =>
      apply(
        [{ ...command, memory: { ...command.memory, createdAtGameTime: '2027-01-01T00:00:00Z' } }],
        state,
      ),
    ).toThrow();
    expect(() =>
      apply([{ ...command, memory: { ...command.memory, sourceTurnIds: ['other-turn'] } }], state),
    ).toThrow();
  });
  it('特殊 NPC 可记录长期事实和独立目标；普通 NPC 不得写特殊字段', () => {
    expect(() => apply([{ ...update({}), activeGoals: ['联系律师'] }], scene())).toThrow(
      '普通 NPC',
    );
    const state = scene();
    state.npc['npc-a'] = {
      ...npc(),
      kind: 'special',
      detailedBackground: '',
      activeGoals: [],
      habits: [],
      longTermMemories: [],
      offscreenTaskIds: [],
    };
    expect(apply([{ ...update({}), activeGoals: ['联系律师'] }], state).npc['npc-a']).toMatchObject(
      { activeGoals: ['联系律师'] },
    );
  });
  it('无偿获得、数量消耗、遗失和转移共享实体与装备真值', () => {
    const acquired = apply([
      { type: 'AcquireItem', commandId: 'acquire', evidence: '获赠证件', item },
    ]);
    const updated = commitCommands(acquired, 'next', 1, [
      {
        type: 'UpdateItem',
        commandId: 'consume',
        evidence: '使用一份证件',
        expectedRevision: 1,
        itemId: item.id,
        expectedQuantity: 2,
        quantityReason: 'consumption',
        changes: { quantity: 1, conditionText: '使用过' },
      },
    ]);
    expect(updated.items.badge.quantity).toBe(1);
    expect(Object.keys(updated.items)).toEqual(['badge']);
    const lost = apply(
      [
        {
          type: 'LoseItem',
          commandId: 'lose',
          evidence: '证件遗失',
          expectedRevision: 0,
          itemId: 'badge',
          expectedOwner: item.ownerRef,
          conditionText: '遗失，位置未确认',
        },
      ],
      withItem(),
    );
    expect(lost.items.badge.ownerRef).toBeUndefined();
    expect(lost.items.badge.locationId).toBeUndefined();
    expect(Object.keys(lost.items)).toEqual(['badge']);
    const recovered = commitCommands(lost, 'recover-turn', 1, [
      {
        type: 'TransferItem',
        commandId: 'recover',
        evidence: '主角拾回遗失证件',
        itemId: 'badge',
        from: null,
        to: item.ownerRef,
      },
    ]);
    expect(recovered.items.badge.ownerRef).toEqual(item.ownerRef);
    expect(Object.keys(recovered.items)).toEqual(['badge']);
    const state = GameStateSchema.parse({
      ...game(),
      items: { badge: { ...item, category: 'accessory' } },
      protagonist: { ...game().protagonist, currentWear: { accessoryItemIds: ['badge'] } },
    });
    expect(
      apply(
        [
          {
            type: 'UpdateItem',
            commandId: 'remove',
            evidence: '全部消耗',
            expectedRevision: 0,
            itemId: 'badge',
            expectedQuantity: 2,
            quantityReason: 'consumption',
            changes: { quantity: 0 },
          },
        ],
        state,
      ).protagonist.currentWear.accessoryItemIds,
    ).toEqual([]);
    expect(() =>
      apply(
        [
          {
            type: 'UpdateItem',
            commandId: 'bad',
            evidence: '错误数量',
            expectedRevision: 0,
            itemId: 'badge',
            expectedQuantity: 1,
            quantityReason: 'consumption',
            changes: { quantity: 0 },
          },
        ],
        state,
      ),
    ).toThrow();
  });
  it('多对象批次任一失败整体回滚，不保留扣款或新物品', () => {
    const state = game(),
      before = structuredClone(state);
    expect(() =>
      apply(
        [
          spend,
          {
            type: 'AcquireItem',
            commandId: 'car',
            evidence: '汽车',
            item: { ...item, name: '跑车', category: 'other' },
          },
        ],
        state,
      ),
    ).toThrow();
    expect(state).toEqual(before);
  });
});
describe('证据防护与领域提示词绑定', () => {
  it.each([
    '主角原本准备现金支付30元吃饭，但最终取消了。',
    '如果主角用现金支付30元吃饭，就能离开。',
    '主角没有用现金支付30元吃饭。',
    'NPC声称主角已经用现金支付30元吃饭。',
    '主角准备明天用现金支付30元吃饭。',
    '【同事】主角已经用现金支付30元吃饭。',
    '【同事】\n主角已经用现金支付30元吃饭。',
  ])('模型处理计划/否定/传闻，程序不以小说词语拒绝安全数据：%s', (text) => {
    expect(() => parsed([{ ...spend, evidence: '现金支付30元吃饭' }], text)).not.toThrow();
  });
  it('来源说明可概括，金额只按整数分校验；未知命令仍拒绝', () => {
    expect(() => parsed([spend], '毫不相关的正文')).not.toThrow();
    expect(() => parsed([{ ...spend, amount: 30 }])).not.toThrow();
    expect(() => parsed([{ ...spend, evidence: '已经支付30元' }])).not.toThrow();
    expect(() => parsed([{ ...spend, evidence: '现金支付30元和20元' }])).not.toThrow();
    expect(() =>
      parseVariables(
        JSON.stringify({
          commands: [{ type: 'SetArbitraryValue', commandId: 'x', evidence: paid }],
          rejectedSuggestions: [],
          unresolved: [],
        }),
        game(),
        draft(),
      ),
    ).toThrow();
  });
  it('证据不足可诚实列出拒绝和未解决项，空候选仍合法', () => {
    const result = {
      commands: [],
      rejectedSuggestions: [{ reason: '只是付款计划', reference: 'variableGuide' }],
      unresolved: ['账户及余额未知'],
    };
    expect(parseVariables(JSON.stringify(result), game(), draft())).toEqual(result);
  });
  it('不同命令ID的同额消费不靠内容相同判定为同一次交易', () => {
    expect(parsed([spend, { ...spend, commandId: 'same-meal-again' }]).commands).toHaveLength(2);
  });
  it('新 NPC 的合法初始知识不需要额外事实审批', () => {
    const person = npc();
    person.knownInformation = [{ text: '未经证实的后台秘密', source: '未知', learnedAt: gameTime }];
    expect(() =>
      parsed([{ type: 'CreateNpc', commandId: 'npc', evidence: '同事来到现场', npc: person }]),
    ).not.toThrow();
  });
  it('离场 NPC 状态与互动更新不需要额外现场授权', () => {
    const state = scene();
    state.npc['npc-a'].onScene = false;
    expect(() =>
      parsed(
        [{ ...update({ healthText: '受伤' }), evidence: '主角想起同事' }],
        '主角想起同事',
        state,
      ),
    ).not.toThrow();
    const command = {
      ...update({ lastInteractionAt: gameTime }),
      evidence: '主角与同事完成电话通话',
    };
    expect(() => parsed([command], command.evidence, state)).not.toThrow();
  });
  it('正文确立的合理耗时可以推进投影时钟；倒退仍失败', () => {
    const command: DomainCommand = {
      type: 'SetWorldClock',
      commandId: 'clock',
      evidence: '经过十分钟，主角完成用餐',
      worldClock: '2026-10-18T08:10:00+08:00',
    };
    expect(() => parsed([command])).not.toThrow();
    expect(apply([command]).worldClock).toBe(command.worldClock);
    expect(() => apply([{ ...command, worldClock: '2026-10-18T07:00:00+08:00' }])).toThrow();
  });
  it('技能与行动耗时语义由模型判断，不对来源说明做关键词限制', () => {
    expect(() =>
      parsed([
        {
          type: 'UpdateProtagonist',
          commandId: 'skill',
          expectedRevision: 0,
          protagonistId: 'hero',
          changes: { skills: ['专业驾驶'] },
          evidence: '主角开了一次车',
        },
      ]),
    ).not.toThrow();
    expect(() =>
      parsed([
        {
          type: 'SetWorldClock',
          commandId: 'clock',
          evidence: '准备明天出发',
          worldClock: '2026-10-19T08:00:00+08:00',
        },
      ]),
    ).not.toThrow();
    expect(() =>
      parsed([
        {
          type: 'SetWorldClock',
          commandId: 'clock',
          evidence: '现金支付30元吃饭',
          worldClock: '2026-10-18T08:02:00+08:00',
        },
      ]),
    ).not.toThrow();
  });
  it.each(['opening', 'regular'] as const)(
    '%s 即使指导遗漏，也加载现场五组和不确定组织规则，且只装配对应主模板',
    async (mode) => {
      const state = game(),
        current = draft('新人物拿来一份证件，组织类别尚未确认。', mode);
      current.story!.variableGuide = [];
      const selection = selectVariableDomains(state, current);
      expect(selection.domains).toHaveLength(9);
      const prompt = await composePrompt({
        state,
        draft: current,
        mode,
        stage: 'variables',
        settings: defaultSettings(),
        userInput: current.userInput,
        domains: selection.domains,
      });
      expect(prompt.modules.some((module) => module.id === `stages.${mode}.variables.text`)).toBe(true);
      for (const domain of selection.domains)
        expect(
          prompt.modules.filter(
            (module) =>
              module.id === `variableGroups.${domain}.${mode === 'opening' ? 'init' : 'update'}.text`,
          ),
        ).toHaveLength(1);
      expect(
        prompt.modules.some(
          (module) => module.id.includes('.offscreen') || module.id === 'shared.06_story_output',
        ),
      ).toBe(false);
    },
  );
  it('组织模块仍按现有提示词选择逻辑加载，不作候选完整性审批', () => {
    const state = game(),
      current = draft('主角走进公司。');
    expect(selectVariableDomains(state, current).domains).toContain('org_business');
    expect(selectVariableDomains(state, current).domains).not.toContain('org_gang');

  });
});
