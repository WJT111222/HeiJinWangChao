import type { DomainCommand } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { AiError } from '../ai/errors';

// 只识别明确的反证/高风险语境，不声称能判定所有中文因果、反讽或真假陈述。
const uncertain =
  /准备|打算|计划|将要|明天|后天|如果|假如|假设|可能|或许|预计|尚未|并未|没有|取消|未能|不曾|没(?:有)?(?:付|买|转|到|收|借)|声称|自称|谎称|听说|据说|传闻|据传|猜测/;
export function factEvidence(command: DomainCommand, narrative: string) {
  let index = narrative.indexOf(command.evidence);
  let safe = false;
  while (index >= 0) {
    const left = narrative.slice(0, index).search(/[^。！？\n]*$/);
    const tail = narrative.slice(index + command.evidence.length);
    const right = tail.search(/[。！？\n]/);
    const sentence = narrative.slice(
      Math.max(0, left),
      index + command.evidence.length + (right < 0 ? tail.length : right),
    );
    const reportedMemory =
      command.type === 'RecordNpcMemory' && command.knowledgeKind !== 'observed';
    const openingSpeaker = /^【([^】]+)】/.exec(command.evidence)?.[1];
    const priorSpeaker = [...narrative.slice(0, index).matchAll(/【([^】]+)】/g)].at(-1)?.[1];
    const speaker = openingSpeaker ?? priorSpeaker;
    const dialogue =
      (speaker !== undefined && speaker !== '旁白') ||
      [...sentence.matchAll(/【([^】]+)】/g)].some((match) => match[1] !== '旁白');
    if (reportedMemory || (!uncertain.test(sentence) && !/[“”「」]/.test(sentence) && !dialogue))
      safe = true;
    index = narrative.indexOf(command.evidence, index + 1);
  }
  if (!safe) throw new AiError('invalid_output');
  if (command.type === 'UpdateNpc' && command.affinityChange) {
    if (
      !narrative.includes(command.affinityChange.reason) ||
      /寒暄|打招呼|问好|你好|客套/.test(command.evidence)
    )
      throw new AiError('invalid_output');
  }
  if (
    command.type === 'UpdateProtagonist' &&
    command.changes.skills &&
    !/长期|多年|训练|培训|考核|资格|认证|毕业|学习.*(?:完成|掌握)/.test(command.evidence)
  )
    throw new AiError('invalid_output');
}
export function variablePermission(command: DomainCommand, state: GameState, draft: TurnDraft) {
  if (!draft.story) throw new AiError('configuration');
  if (
    command.type === 'SetWorldClock' &&
    Date.parse(command.worldClock) > Date.parse(state.worldClock) &&
    !/(?:\d{1,2}[:：]\d{2}|\d+月\d+日|(?:经过|过了|耗时|等待|行驶|分钟后|小时后)|[一二三四五六七八九十\d]+(?:分钟|小时)后)/.test(
      command.evidence,
    )
  )
    throw new AiError('invalid_output');
  const scene = (id: string) => {
    const person = state.npc[id];
    return (
      person &&
      (person.onScene ||
        (/电话|通话|视频|短信|来信/.test(command.evidence) &&
          [person.id, person.name, ...person.aliases].some((name) =>
            command.evidence.includes(name),
          )))
    );
  };
  if (
    command.type === 'CreateNpc' &&
    (!command.npc.onScene ||
      ![command.npc.name, command.npc.id, ...command.npc.aliases].some((name) =>
        command.evidence.includes(name),
      ))
  )
    throw new AiError('permission');
  if (
    command.type === 'CreateNpc' &&
    (command.npc.memories.length > 0 ||
      command.npc.knownInformation.length > 0 ||
      (command.npc.kind === 'special' && command.npc.longTermMemories.length > 0))
  )
    throw new AiError('permission');
  if ((command.type === 'UpdateNpc' || command.type === 'RecordNpcMemory') && !scene(command.npcId))
    throw new AiError('permission');
  if (command.type === 'RecordNpcMemory') {
    if (command.knowledgeKind === 'observed' && uncertain.test(command.evidence))
      throw new AiError('invalid_output');
    if (!command.evidence.includes(command.memory.knowledgeSource))
      throw new AiError('invalid_output');
  }
  const ownerAllowed = (ref: { kind: string; id: string } | undefined | null) =>
    !ref ||
    (ref.kind === 'protagonist' && ref.id === state.protagonist.id) ||
    (ref.kind === 'npc' && scene(ref.id)) ||
    (ref.kind === 'organization' &&
      command.evidence.includes(state.organizations[ref.id]?.name ?? '\0'));
  if (
    (command.type === 'UpdateItem' || command.type === 'LoseItem') &&
    !ownerAllowed(state.items[command.itemId]?.ownerRef)
  )
    throw new AiError('permission');
  if (command.type === 'AcquireItem' && !ownerAllowed(command.item.ownerRef))
    throw new AiError('permission');
  if (command.type === 'TransferItem' && (!ownerAllowed(command.from) || !ownerAllowed(command.to)))
    throw new AiError('permission');
}
export function economicAmount(command: DomainCommand): number | undefined {
  switch (command.type) {
    case 'PurchaseItem':
    case 'PurchaseVehicle':
      return command.price;
    case 'TransferFunds':
    case 'RepayDebt':
    case 'SpendFunds':
      return command.amount;
    case 'ReceiveIncome':
      return command.income.amount;
    case 'Borrow':
      return command.debt.principal;
    default:
      return undefined;
  }
}
export function completedPayment(command: DomainCommand) {
  if (economicAmount(command) === undefined) return;
  if (
    !/已|完成|付清|支付|付了|花了|花费|扣除|到账|收到|转入|转出|归还|偿还|借到/.test(
      command.evidence,
    ) ||
    [...command.evidence.matchAll(/(\d+(?:\.\d{1,2})?)\s*(元|分)/g)].length !== 1
  )
    throw new AiError('invalid_output');
  const account =
    command.type === 'TransferFunds'
      ? undefined
      : command.type === 'ReceiveIncome'
        ? command.income.account
        : 'account' in command
          ? command.account
          : undefined;
  const cash = /现金|零钱|纸币/.test(command.evidence),
    online = /线上|电子|微信|支付宝|银行卡|银行账户/.test(command.evidence);
  if (command.type === 'TransferFunds' ? !cash || !online : account === 'cash' ? !cash : !online)
    throw new AiError('invalid_output');
}
