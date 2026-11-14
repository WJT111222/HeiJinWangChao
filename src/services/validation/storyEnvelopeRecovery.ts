const stepHeadings = (value: string) => [...value.matchAll(/(?:^|\r?\n)[ \t]*(?:(?:#{1,6}|[-*+])[ \t]+)?(?:\*\*|__)?Step[ \t]+\d+/giu)];
function completeStepPrefix(value: string) {
  const steps = [...value.matchAll(/(?:^|\r?\n)[ \t]*(?:(?:#{1,6}|[-*+])[ \t]+)?(?:\*\*|__)?Step[ \t]+(\d{1,2})[ \t]*[｜|:：]/giu)];
  return steps.length === 16 && stepHeadings(value).length === 16 && steps[0].index === 0
    && steps.every((step, i) => Number(step[1]) === i);
}

/** undefined: no inline body; false: an inline hint exists but is ambiguous.
 * Only the reviewed instruction clauses and a full stop are admitted here.
 * A label quoted by the instruction is not a candidate body boundary. */
function inlineBodyStart(value: string): number | false | undefined {
  const transitions = [...value.matchAll(/(?:^|\r?\n)([ \t]*现在按照这些规划写正文[^\r\n]*)/gu)];
  const reference = '段落以【旁白】和【角色名】标签呈现';
  if (!transitions.some(match => match[1].replaceAll(reference, '').includes('【旁白】'))) return undefined;
  if (transitions.length !== 1) return false;
  const transition = transitions[0], line = transition[1];
  const boundaries = [...line.matchAll(/[。.][ \t]*(?=【旁白】)/gu)];
  if (boundaries.length !== 1) return false;
  const lineStart = transition.index + transition[0].length - line.length;
  if (!completeStepPrefix(value.slice(0, lineStart).trim())) return false;
  const boundary = boundaries[0], end = boundary.index + boundary[0].length;
  const instruction = line.slice(0, end).trim();
  if (!/^现在按照这些规划写正文(?:[，,]保证层次完整)?(?:[，,]段落以【旁白】和【角色名】标签呈现)?(?:[，,]并控制字数不低于[1-9]\d{0,5})?[。.]$/u.test(instruction)) return false;
  return lineStart + end;
}

/**
 * Narrow, display-independent recovery for a Story response that contains all
 * post-story blocks but omits BOTH <正文> delimiters.
 *
 * No prose, planning, memory, guide or action option is generated here.
 * An unlabeled planning preface is discarded only when the exact numbered
 * Step 0–15 sequence and explicit transition sentence make the boundary
 * unambiguous. The untouched response remains available as model raw text.
 *
 * This does NOT relax StorySchema, time, event, or atomic draft validation.
 */
export function recoverStoryEnvelope(text: string, actions: boolean): string | undefined {
  const source = text.trim();
  if (!source || /<\s*\/?\s*正文/u.test(source)) return undefined;

  const tailPattern = actions
    ? /<短期记忆>[\s\S]*?<\/短期记忆>\s*<变量规划>[\s\S]*?<\/变量规划>\s*<行动选项>[\s\S]*?<\/行动选项>\s*$/u
    : /<短期记忆>[\s\S]*?<\/短期记忆>\s*<变量规划>[\s\S]*?<\/变量规划>\s*$/u;
  const tail = tailPattern.exec(source);
  if (!tail) return undefined;

  const prefix = source.slice(0, tail.index).trim();
  let beforeBody = prefix;
  let wrappedPlanning = '';
  const plan = /^<thinking>[\s\S]*?<\/thinking>\s*/u.exec(beforeBody);
  if (plan) {
    wrappedPlanning = plan[0].trim();
    beforeBody = beforeBody.slice(plan[0].length).trim();
  } else if (/<\s*\/?\s*thinking\s*>/u.test(beforeBody)) {
    return undefined; // Broken planning is never silently repaired or discarded.
  }

  // A reserved-name prefix is enough to make recovery ambiguous. Requiring a
  // valid tag delimiter would miss damaged suffixes such as <正文?bad> and let
  // them disappear along with an otherwise valid Step preface.
  if (/<\s*\/?\s*(?:thinking|think|正文|短期记忆|变量规划|行动选项|judge)/iu.test(beforeBody))
    return undefined;

  // Preserve the standalone-line route. An inline hint must not fall back to a
  // later paragraph if it fails: doing that could silently discard real prose.
  const inline = inlineBodyStart(beforeBody);
  if (inline === false || (inline !== undefined && wrappedPlanning)) return undefined;
  const marker = inline === undefined ? /(?:^|\r?\n)[ \t]*【旁白】/u.exec(beforeBody) : undefined;
  const start = inline ?? marker?.index;
  if (start === undefined) return undefined;
  const preface = beforeBody.slice(0, start).trim();
  const narrative = beforeBody.slice(start).trim();
  // Recognizable planning headings cannot become prose or disappear merely
  // because their casing, Markdown decoration or delimiter differs.
  if (!narrative.startsWith('【旁白】') || stepHeadings(narrative).length)
    return undefined;
  if (inline !== undefined && (!narrative.slice('【旁白】'.length).trim()
    || narrative.includes('现在按照这些规划写正文') || narrative.includes('段落以【旁白】和【角色名】标签呈现')))
    return undefined;

  if (preface) {
    // A numbered preface plus an already wrapped planning block would be
    // ambiguous; do not guess which text belongs to which section.
    if (wrappedPlanning) return undefined;
    if (!completeStepPrefix(preface)) return undefined;
    const finalLine = preface.split(/\r?\n/u).filter(Boolean).at(-1)?.trim() ?? '';
    if (!/^现在按照这些规划写正文(?:[，,:：。.\s]|$)/u.test(finalLine))
      return undefined;
  }

  return `${wrappedPlanning ? wrappedPlanning + '\n' : ''}<正文>${narrative}</正文>\n${tail[0].trim()}`;
}

// —— 漏写闭合标签的确定性补全（与上面的双标签缺失恢复互斥：这里要求开标签已存在） ——

const reservedNameSource = '(?:thinking|think|judge|正文|短期记忆|变量规划|行动选项)';
/** 精确的保留标签：区分大小写、无空格、无多余字符。 */
const canonicalReservedTag = new RegExp(`^</?${reservedNameSource}>`, 'u');
/** 任何「像保留标签但不精确」的片段：<正文?bad>、</正文?broken>、<正文：>、< 正文 >、<THINKING>、残缺的 <正文……。 */
const reservedTagProbe = new RegExp(`<\\s*/?\\s*${reservedNameSource}`, 'giu');

function hasMalformedReservedTag(text: string): boolean {
  for (const match of text.matchAll(reservedTagProbe)) {
    if (!canonicalReservedTag.test(text.slice(match.index))) return true;
  }
  return false;
}

/**
 * 模型偶尔漏写某段的闭合标签就直接开下一段。只补一种情况：该段完全没有对应的
 * 闭合标签，且下一段的开标签已经出现——此时这段在哪里结束没有歧义，在下一段
 * 开标签前补上闭合，再交回原有严格正则与全部校验。连续多段漏写同样适用。
 *
 * 一律不补的情况：
 * - 文本任何位置存在畸形或疑似保留标签（见 hasMalformedReservedTag）：损坏的
 *   闭合标签不能靠补一个正常闭合被伪装成合法响应，边界有歧义就拒绝；
 * - 最后一段缺闭合：通常意味着输出被截断，内容可能不完整，仍按原规则拒绝；
 * - 闭合标签存在但位置不对（乱序、重复、嵌套）：由原有诊断处理。
 *
 * 只作用于内部解析副本；不生成任何正文、摘要、变量或行动选项，原始响应不变。
 */
export function repairUnclosedTags(text: string, actions: boolean): string | undefined {
  const order = ['thinking', '正文', '短期记忆', '变量规划', ...(actions ? ['行动选项'] : [])];
  if (hasMalformedReservedTag(text)) return undefined;
  let repaired = text, inserted = false;
  for (const [index, tag] of order.entries()) {
    const next = order[index + 1];
    if (!next) break; // 最后一段不补。
    const open = repaired.indexOf(`<${tag}>`);
    if (open < 0 || repaired.includes(`</${tag}>`)) continue;
    const nextOpen = repaired.indexOf(`<${next}>`, open + tag.length + 2);
    if (nextOpen < 0) continue;
    repaired = `${repaired.slice(0, nextOpen)}</${tag}>\n${repaired.slice(nextOpen)}`;
    inserted = true;
  }
  return inserted ? repaired : undefined;
}
