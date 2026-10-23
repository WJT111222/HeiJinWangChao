import type { DomainCommand } from '../../domain/commands';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { AiError } from '../ai/errors';
import { isNegatedFact } from '../../domain/factPolarity';

// 只识别明确的反证/高风险语境，不声称能判定所有中文因果、反讽或真假陈述。
const uncertain =
  /准备|打算|计划|将要|明天|后天|如果|假如|假设|可能|或许|预计|取消|声称|自称|谎称|听说|据说|传闻|据传|猜测/;

// 行内标签只作用于本行；独占一行的标签只延续到紧接的下一行。
// 未标记的新行可以是旁白，不能从整篇正文继承最近一个角色身份。
function evidenceContext(narrative: string, index: number, length: number) {
  const lineStart = narrative.lastIndexOf('\n', index - 1) + 1;
  const before = narrative.slice(lineStart, index);
  const lastTag = [...before.matchAll(/【([^】]+)】/g)].at(-1);
  const openingTag = /^【([^】]+)】/.exec(narrative.slice(index, index + length));
  const previousLine =
    narrative
      .slice(0, Math.max(0, lineStart - 1))
      .split('\n')
      .at(-1) ?? '';
  const standaloneTag = /^\s*【([^】]+)】\s*$/.exec(previousLine);
  const speaker = openingTag?.[1] ?? lastTag?.[1] ?? standaloneTag?.[1];
  const scopeStart = openingTag
    ? index
    : lastTag
      ? lineStart + lastTag.index + lastTag[0].length
      : lineStart;
  const left = narrative.slice(scopeStart, index).search(/[^。！？\n]*$/) + scopeStart;
  const tail = narrative.slice(index + length);
  // 后续另一标签的对白不应倒灌进当前旁白证据，但句内的否定/取消仍须检查。
  const right = tail.search(/[。！？\n]|【[^】]+】/);
  const sentence = narrative.slice(left, index + length + (right < 0 ? tail.length : right));
  const evidence = narrative.slice(index, index + length);
  const dialogue =
    (speaker !== undefined && speaker !== '旁白') ||
    [...evidence.matchAll(/【([^】]+)】/g)].some((match) => match[1] !== '旁白');
  // 跨行引号仍属于直接引语，不因换行变成客观旁白。
  const quotes: string[] = [];
  for (const char of narrative.slice(0, index)) {
    if (char === '“' || char === '「') quotes.push(char);
    else if ((char === '”' && quotes.at(-1) === '“') || (char === '」' && quotes.at(-1) === '「'))
      quotes.pop();
  }
  return { sentence, sentenceStart: left, dialogue: dialogue || quotes.length > 0 };
}
export function factEvidence(command: DomainCommand, narrative: string) {
  let index = narrative.indexOf(command.evidence);
  let safe = false;
  while (index >= 0) {
    const { sentence, sentenceStart, dialogue } = evidenceContext(
      narrative,
      index,
      command.evidence.length,
    );
    const reportedMemory =
      command.type === 'RecordNpcMemory' && command.knowledgeKind !== 'observed';
    if (
      reportedMemory ||
      // 真实对话本身也耗时；对白内容的未来计划不是时钟的目标时间。
      (command.type === 'SetWorldClock' && (dialogue || /[“”「」]/.test(sentence))) ||
      (!uncertain.test(sentence) &&
        !isNegatedFact(
          sentence,
          index - sentenceStart,
          index - sentenceStart + command.evidence.length,
        ) &&
        !/[“”「」]/.test(sentence) &&
        !dialogue)
    )
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
    if (
      command.knowledgeKind === 'observed' &&
      (uncertain.test(command.evidence) || isNegatedFact(command.evidence))
    )
      throw new AiError('invalid_output');
    if (!command.evidence.includes(command.memory.knowledgeSource))
      throw new AiError('invalid_output');
  }
  if (command.type === 'SaveTask' && (command.task.resolution !== undefined || command.task.handoff !== undefined))
    throw new AiError('permission'); // 场外成果/交接只能经世界协议验证，现场旧任务仍走原流程。
  if (command.type === 'RetireNpc') throw new AiError('permission');
  if (command.type === 'RegisterContact' && (!scene(command.npcId) ||
    ![command.npcId, state.npc[command.npcId]?.name].some((name) => name && command.evidence.includes(name))))
    throw new AiError('permission');
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
