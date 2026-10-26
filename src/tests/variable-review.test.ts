// M8-P0A：保留旧文学反例作为词法无关性回归；是否成立由变量AI判断，程序只验证数据。
import { describe, expect, it } from 'vitest';
import { commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { parseVariables } from '../services/validation/aiOutputs';
import { selectVariableDomains } from '../prompts/variableDomains';
import { game, npc } from './fixtures/game';

const paid = '主角已经用现金支付30元吃饭。';
const spend: DomainCommand = {
  type: 'SpendFunds',
  commandId: 'meal',
  evidence: paid,
  account: 'cash',
  amount: 3000,
  purpose: '午餐',
};
function parse(commands: DomainCommand[], text: string, state = game()) {
  return parseVariables(
    JSON.stringify({ commands, rejectedSuggestions: [], unresolved: [] }),
    state,
    rerollStory(createTurnDraft(state.saveId, state.revision, 'turn-a', 'regular', ''), {
      turnKind: 'regular',
      narrative: text,
      summary: '',
      variableGuide: [],
    }),
  );
}
function scene() {
  return GameStateSchema.parse({
    ...game(),
    npc: { 'npc-a': npc() },
    locations: {
      ...game().locations,
      clinic: { id: 'clinic', name: '社区诊所', parentId: 'chongqing' },
      shop: { id: 'shop', name: '便利店', parentId: 'chongqing' },
    },
  });
}
function movement(
  text: string,
  changes: Extract<DomainCommand, { type: 'UpdateNpc' }>['changes'],
): DomainCommand[] {
  return [
    {
      type: 'UpdateProtagonist',
      commandId: 'hero-move',
      expectedRevision: 0,
      protagonistId: 'hero',
      evidence: text,
      changes: { locationId: 'clinic' },
    },
    {
      type: 'UpdateNpc',
      commandId: 'npc-move',
      expectedRevision: 0,
      npcId: 'npc-a',
      evidence: text,
      changes,
    },
  ];
}

describe('M8-P0A：对白格式不再决定变量验收', () => {
  it.each([
    `【店员】欢迎光临。\n${paid}`,
    `【店员】欢迎光临。\r\n${paid}`,
    `【店员】欢迎光临。\n\n${paid}`,
    `【店员】\n\n${paid}`,
    `【店员】欢迎光临。\n【旁白】${paid}`,
    `【店员】欢迎光临。【旁白】${paid}`,
    `【店员】\n【旁白】${paid}`,
    `【店员】“欢迎光临。”\n${paid}`,
    `【店员】\n欢迎光临。\n${paid}`,
    `【旁白】${paid}【店员】下次再来。`,
  ])('正常旁白不继承先前角色身份：%s', (text) => {
    expect(parse([spend], text).commands).toEqual([spend]);
  });
  it.each([
    `【店员】${paid}`,
    `【店员】\n${paid}`,
    `【旁白】欢迎光临。【店员】${paid}`,
    `【店员】“他昨天说\n${paid}”`,
    `【旁白】店员声称${paid}`,
    '【旁白】主角原本准备现金支付30元吃饭，但最终取消了。',
    '【旁白】主角没有用现金支付30元吃饭。',
    '【旁白】主角准备明天用现金支付30元吃饭。',
  ])('不以对白、自述、否定或计划词拒绝结构合法候选：%s', (text) => {
    expect(() => parse([{ ...spend, evidence: '现金支付30元吃饭' }], text)).not.toThrow();
  });
  it.each(['【同事】我已经把现金转入线上账户50元。', '【同事】\n我已经把现金转入线上账户50元。'])(
    '转账事实由模型判断，程序只检查账户与余额：%s',
    (text) => {
      expect(() =>
        parse(
          [
            {
              type: 'TransferFunds',
              commandId: 'transfer',
              from: 'cash',
              to: 'onlineBalance',
              amount: 5000,
              evidence: '已经把现金转入线上账户50元',
            },
          ],
          text,
        ),
      ).not.toThrow();
    },
  );
});

describe('M8-P0A：场景数据约束与文学判断分离', () => {
  it.each([
    '主角独自走进诊所。',
    '主角独自走进社区诊所，同事没有跟随。',
    '同事准备和主角一起走进社区诊所。',
    '同事声称和主角一起走进社区诊所。',
    '主角走进社区诊所，同事在附近散步。',
    '同事和陌生人一起走进社区诊所，主角留在门外。',
    '同事和主角一起走进便利店，主角随后走进社区诊所。',
    '同事和主角一起离开社区诊所。',
  ])('移动语义由模型判断，程序不匹配固定同行句式：%s', (text) => {
    const state = scene(),
      before = structuredClone(state);
    const commands = movement(text, { onScene: true, locationId: 'clinic' });
    expect(() => parse(commands, text, state)).not.toThrow();
    expect(() => commitCommands(state, 'turn-a', 0, [spend, ...commands])).not.toThrow();
    expect(state).toEqual(before);
  });
  it.each([
    '同事和主角一起走进社区诊所。',
    '主角与同事一同走进社区诊所。',
    '同事跟随主角进入社区诊所。',
    '同事陪同林舟来到社区诊所。',
    '同事随后也走进社区诊所，与主角会合。',
  ])('明确同行或随后实际会合可形成候选：%s', (text) => {
    const state = scene(),
      commands = movement(text, { onScene: true, locationId: 'clinic' });
    expect(parse(commands, text, state).commands).toHaveLength(2);
    const projected = commitCommands(state, 'turn-a', 0, commands);
    expect(projected.npc['npc-a']).toMatchObject({ onScene: true, locationId: 'clinic' });
    expect(state.npc['npc-a'].locationId).toBe('chongqing');
  });
  it('留在原地、离场至其它地点、去向未知分别记录，不推定行动', () => {
    const state = scene();
    for (const [text, changes, expected] of [
      [
        '主角走进社区诊所，同事留在重庆。',
        { onScene: false },
        { onScene: false, locationId: 'chongqing' },
      ],
      [
        '主角走进社区诊所，同事独自走到便利店。',
        { onScene: false, locationId: 'shop' },
        { onScene: false, locationId: 'shop' },
      ],
      [
        '主角独自走进社区诊所，同事去向不明。',
        { onScene: false, locationId: null },
        { onScene: false },
      ],
    ] as const) {
      const commands = movement(text, changes);
      expect(parse(commands, text, state).commands).toHaveLength(2);
      const person = commitCommands(state, 'turn-a', 0, commands).npc['npc-a'];
      expect(person).toMatchObject(expected);
      if (changes.locationId === null) expect(person).not.toHaveProperty('locationId');
    }
    expect(() =>
      parse(
        movement('主角独自走进社区诊所。', { onScene: false }),
        '主角独自走进社区诊所。',
        state,
      ),
    ).not.toThrow();
    expect(() =>
      parse(
        movement('主角独自走进社区诊所。', { onScene: true, locationId: null }),
        '主角独自走进社区诊所。',
        state,
      ),
    ).toThrow();
  });
  it('只有主角独自离开的事实时，可以记录 NPC 不同场但去向未知，不能推定原地等待', () => {
    const state = scene(),
      text = '主角独自走进社区诊所。';
    const commands = movement(text, { onScene: false, locationId: null });
    expect(parse(commands, text, state).commands).toHaveLength(2);
    const person = commitCommands(state, 'turn-a', 0, commands).npc['npc-a'];
    expect(person.onScene).toBe(false);
    expect(person).not.toHaveProperty('locationId');
  });
  it('旧档 NPC 缺少地点时，非空间更新保持原有兼容性', () => {
    const state = scene();
    delete state.npc['npc-a'].locationId;
    const command: DomainCommand = {
      type: 'UpdateNpc',
      commandId: 'health',
      expectedRevision: 0,
      npcId: 'npc-a',
      evidence: '同事手臂受伤。',
      changes: { healthText: '手臂受伤' },
    };
    expect(() => parse([command], command.evidence, state)).not.not.toThrow();
    expect(commitCommands(state, 'turn-a', 0, [command]).npc['npc-a'].healthText).toBe('手臂受伤');
  });
  it('分步更新由最终场景一致性验证，不匹配最后一句证据', () => {
    const text = '同事和主角一起走进便利店。主角独自走进社区诊所。';
    const commands = movement(text, { onScene: true, locationId: 'shop' });
    commands.push({
      type: 'UpdateNpc',
      commandId: 'overwrite',
      expectedRevision: 0,
      npcId: 'npc-a',
      evidence: '主角独自走进社区诊所。',
      changes: { locationId: 'clinic' },
    });
    expect(() => parse(commands, text, scene())).not.toThrow();
  });
  it('实体由命令稳定ID确定，不凭证据中的同名判断', () => {
    const state = scene();
    state.npc['npc-b'] = { ...npc('npc-b'), onScene: false };
    const text = '同事和主角一起走进社区诊所。';
    expect(() =>
      parse(movement(text, { onScene: true, locationId: 'clinic' }), text, state),
    ).not.toThrow();
    const explicit = 'npc-a和主角一起走进社区诊所。';
    expect(() =>
      parse(movement(explicit, { onScene: true, locationId: 'clinic' }), explicit, state),
    ).not.not.toThrow();
  });
  it('没有组织线索不等于可以证明没有组织领域：保留九域安全兜底', () => {
    const state = game();
    const draft = rerollStory(createTurnDraft(state.saveId, 0, 'turn-a', 'regular', ''), {
      turnKind: 'regular',
      narrative: paid,
      summary: '',
      variableGuide: [],
    });
    expect(selectVariableDomains(state, draft).domains).toHaveLength(9);
  });
});

describe('M8-P0A：否定与计划的语义判断交由模型', () => {
  it.each([
    '主角没用现金支付30元吃饭。',
    '不是主角已经用现金支付30元吃饭。',
    '并非主角已经用现金支付30元吃饭。',
    '主角没用现金支付30元吃饭，但同事已经吃完。',
    '主角已经用现金支付30元吃饭，这并非事实。',
    '主角已经用现金支付30元吃饭，但这不是事实。',
    '主角已经用现金支付30元吃饭，但没有成功。',
    '不是主角，已经用现金支付30元吃饭。',
    '主角没有付款，也已经用现金支付30元吃饭。',
  ])('否定语义由模型判断，程序不扫描上下文：%s', (text) => {
    const before = game();
    expect(() => parse([{ ...spend, evidence: '现金支付30元吃饭' }], text, before)).not.toThrow();
    expect(before.economy.cash).toBe(10000);
  });
  it.each(['主角没用现金支付30元吃饭。', '不是主角已经用现金支付30元吃饭。'])(
    '完整来源文本不触发否定词黑名单：%s',
    (text) => {
      expect(() => parse([{ ...spend, evidence: text }], text)).not.toThrow();
    },
  );
  it.each([
    '同事没付款，但主角已经用现金支付30元吃饭。',
    '同事不是付款人，主角已经用现金支付30元吃饭。',
    '同事并非付款人；主角已经用现金支付30元吃饭。',
    '同事没有付款，主角已经用现金支付30元吃饭。',
    '主角没有赊账，而是已经用现金支付30元吃饭。',
    '主角没去便利店，却已经用现金支付30元吃饭。',
    '主角已经用现金支付30元吃饭，但同事没有付款。',
    '主角已经用现金支付30元吃饭，同事并非付款人。',
    '主角不慌不忙，已经用现金支付30元吃饭。',
    '主角已经用现金支付30元吃饭，同事没有完成工作。',
    '同事没有付款，主角已经用现金支付30元吃饭，但同事没有完成工作。',
  ])('同一句中独立的已完成事实仍可生成消费候选：%s', (text) => {
    expect(parse([{ ...spend, evidence: '现金支付30元吃饭' }], text).commands).toHaveLength(1);
  });
  it.each([
    '不是同事和主角一起走进社区诊所。',
    '并非同事和主角一起走进社区诊所。',
    '同事没和主角一起走进社区诊所。',
    '同事和主角一起走进社区诊所，这不是事实。',
    '并非同事和主角一起走进社区诊所，但店员已经开门。',
  ])('领域模拟和变量解析不对文学否定作语义推断：%s', (text) => {
    const state = scene(),
      before = structuredClone(state);
    const commands = movement(text, { onScene: true, locationId: 'clinic' });
    expect(() => commitCommands(state, 'turn-a', 0, commands)).not.toThrow();
    expect(() => parse(commands, text, state)).not.toThrow();
    expect(state).toEqual(before);
  });
  it.each(['不是', '并非'])('不再逐字或按 %s 对小说作语义审判', (prefix) => {
    const fact = '同事和主角一起走进社区诊所';
    const text = `${prefix}${fact}。`;
    expect(() =>
      parse(movement(fact, { onScene: true, locationId: 'clinic' }), text, scene()),
    ).not.toThrow();
  });
  it.each([
    '同事没去便利店，但同事和主角一起走进社区诊所。',
    '同事不是病人，同事和主角一起走进社区诊所。',
    '不是店员，而是同事和主角一起走进社区诊所。',
    '同事和主角一起走进社区诊所，但店员没有进来。',
  ])('无关的否定不污染明确同行的事实：%s', (text) => {
    const fact = '同事和主角一起走进社区诊所';
    const state = scene(),
      commands = movement(fact, { onScene: true, locationId: 'clinic' });
    expect(parse(commands, text, state).commands).toHaveLength(2);
    // 领域校验也应能在较长证据中定位实际匹配句式，而非封禁整句。
    expect(
      commitCommands(state, 'turn-a', 0, movement(text, { onScene: true, locationId: 'clinic' }))
        .npc['npc-a'].onScene,
    ).toBe(true);
  });
  it.each(['不是同事留在重庆。', '并非同事留在重庆。'])(
    '场景状态由模型提供，程序不推断否定留守：%s',
    (text) => {
      const state = scene(),
        commands = movement(text, { onScene: false });
      expect(() => commitCommands(state, 'turn-a', 0, commands)).not.toThrow();
    },
  );
});
