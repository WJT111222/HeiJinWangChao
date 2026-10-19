import type { DomainCommand } from './commands';
import type { NPC } from './npc/schema';
import type { GameState } from './state';
import { requireData } from './common';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = (names: string[]) => `(?:${names.map(escape).join('|')})`;
const movement = '(?:走进|走入|进入|来到|到达|抵达|走到|前往|去往)';
const counterEvidence =
  /准备|打算|计划|将要|明天|如果|假如|假设|可能|或许|尚未|并未|没有|取消|未能|不曾|声称|自称|听说|据说|传闻|猜测|不跟|不同行|未跟|未同行/;

function npcReference(state: GameState, npc: NPC) {
  // 同名/别名有歧义时必须改用稳定 ID，不能凭同名证据决定谁同行。
  const others = Object.values(state.npc).filter((person) => person.id !== npc.id);
  return alternatives([
    npc.id,
    ...[npc.name, ...npc.aliases].filter(
      (name) => !others.some((person) => person.name === name || person.aliases.includes(name)),
    ),
  ]);
}

// 只接受可解释的明确行动句式，不把关键词共现宣称为完整语义证明。
// 复杂叙述无法可靠关联参与者/地点时应 unresolved，不替 NPC 决定行动。
function supportsMove(evidence: string, npc: string, destination: string, hero?: string) {
  return evidence.split(/[。！？\n]/).some((sentence) => {
    if (
      counterEvidence.test(sentence) ||
      (hero && /独自|独行|一个人/.test(sentence)) ||
      /[“”「」]/.test(sentence) ||
      [...sentence.matchAll(/【([^】]+)】/g)].some((match) => match[1] !== '旁白')
    )
      return false;
    const arrive = `${movement}(?:了)?${destination}`;
    const patterns = hero
      ? [
          `${npc}(?:已经|已)?(?:跟随|跟着|陪同|陪着)${hero}(?:一起|一同|一道)?${arrive}`,
          `(?:${npc}(?:和|与|同)${hero}|${hero}(?:和|与|同)${npc})(?:已经|已)?(?:一起|一同|一道|共同|结伴)${arrive}`,
          `${npc}(?:随后|之后)?(?:也)?${arrive}[，,]?(?:并)?与${hero}会合`,
        ]
      : [`${npc}(?:已经|已|随后|独自)?${arrive}`];
    return patterns.some((pattern) => new RegExp(pattern).test(sentence));
  });
}

export function validateSceneTransition(
  before: GameState,
  after: GameState,
  commands: readonly DomainCommand[],
) {
  if (after.protagonist.locationId === before.protagonist.locationId) return;
  const hero = alternatives(['主角', before.protagonist.id, before.protagonist.name]);
  for (const npc of Object.values(before.npc).filter((person) => person.onScene)) {
    const updates = commands
      .filter((command) => command.type === 'UpdateNpc')
      .filter((command) => command.npcId === npc.id);
    requireData(
      updates.some((command) => command.changes.onScene !== undefined),
      'SCENE_TRANSITION',
      '主角移动时必须依据正文明确处理每个原在场 NPC，不自动跟随',
    );
    const spatial = updates
      .filter(
        (command) =>
          command.changes.onScene !== undefined || command.changes.locationId !== undefined,
      )
      .at(-1);
    requireData(spatial, 'SCENE_TRANSITION', '缺少 NPC 场景处理依据');
    const next = after.npc[npc.id];
    const person = npcReference(before, npc);
    if (next.onScene || (next.locationId !== undefined && next.locationId !== npc.locationId)) {
      const place = next.locationId && after.locations[next.locationId];
      requireData(
        place &&
          supportsMove(
            spatial.evidence,
            person,
            alternatives([place.id, place.name]),
            next.onScene ? hero : undefined,
          ),
        'SCENE_EVIDENCE',
        'NPC 同行或改换地点缺少明确人物、行动和目的地依据',
      );
    } else if (next.locationId !== undefined) {
      const place = before.locations[next.locationId];
      requireData(
        place &&
          new RegExp(
            `${person}(?:仍然|仍|继续)?(?:留在|停留在|留守)${alternatives([place.id, place.name])}`,
          ).test(spatial.evidence),
        'SCENE_EVIDENCE',
        '不能推定 NPC 留守；去向不明时显式清除地点引用',
      );
    }
    // onScene=false 且 locationId 缺失只表达已不同场、去向未知，不推定移动目标。
  }
}
