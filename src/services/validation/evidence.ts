import type { DomainCommand } from '../../domain/commands';
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
// 仅世界来源验证使用；变量候选不走文学词法判断。
export function worldFactEvidence(command: DomainCommand, narrative: string) {
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
}
