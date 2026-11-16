/**
 * 正文续写：正文被截断（输出长度用完、连接中断、标签未写完）时，保留已收到的原始输出，
 * 由玩家手动点「续写正文」，用同一份上下文让模型从断点接着写，拼接后仍走原有严格解析。
 * 不改变正文输出格式，也不放宽任何校验。
 */
import type { TurnDraft } from './drafts';

/** 一次截断最多续写的次数；用完后只能重新生成。 */
export const STORY_CONTINUATION_LIMIT = 3;
/** 保存在草稿里的截断原文上限（字符）。 */
export const STORY_PARTIAL_MAX_CHARS = 400_000;

/** 这些失败说明「还没写完」，续写有意义；权限、限流、拒答、逻辑校验等失败续写解决不了。 */
const continuableCodes = new Set(['output_limit', 'stream_interrupted', 'network', 'timeout']);
const continuableRules = new Set(['tag_missing', 'tag_unclosed']);
export function continuableStoryFailure(code: string, storyRule?: string): boolean {
  return continuableCodes.has(code) || (code === 'invalid_output' && Boolean(storyRule && continuableRules.has(storyRule)));
}

/** 截断原文必须已经写到 <thinking> 或 <正文> 才值得续写；纯空白或无法识别的开头不保留。 */
export function partialWorthKeeping(text: string): boolean {
  const trimmed = text.trim();
  const content = trimmed.replace(/<\/?(?:thinking|正文)>/gu, '').trim();
  return /^(?:<thinking>|<正文>)/u.test(trimmed) && content.length >= 4 && trimmed.length <= STORY_PARTIAL_MAX_CHARS;
}

/**
 * 截断原文里已写出的正文：只统计 <正文> 之内的文字（不含规划、标签、摘要、变量规划、行动选项），
 * 计数规则与正式解析一致：去掉空白后按 Unicode 字符计数。正文尚未开始时为 0。
 */
export interface PartialNarrative { started: boolean; closed: boolean; chars: number }
export function partialNarrative(partial: string): PartialNarrative {
  const base = trimIncompleteTag(partial), open = base.indexOf('<正文>');
  if (open < 0) return { started: false, closed: false, chars: 0 };
  const rest = base.slice(open + '<正文>'.length), close = rest.indexOf('</正文>');
  // 模型漏写 </正文> 就开始写后续结构标签时，正文到第一个结构标签为止。
  const body = (close < 0 ? rest : rest.slice(0, close)).split(/<\/?(?:thinking|短期记忆|变量规划|行动选项)>/u)[0]!;
  return { started: true, closed: close >= 0, chars: Array.from(body.trim().replace(/\s/gu, '')).length };
}

/**
 * 为什么这段截断正文不能续写：
 * - used_up：续写次数已用完；
 * - closed_short：<正文> 已经闭合但字数低于本次设置的最低要求——续写只能在 </正文> 之后补标签，无法补足字数。
 * 可以续写时返回 undefined。
 */
export type ContinuationBlock = 'used_up' | 'closed_short';
export function continuationBlock(draft: TurnDraft | undefined, minNarrativeChars: number): ContinuationBlock | undefined {
  if (!storyPartialVisible(draft)) return undefined;
  const partial = draft!.storyPartial!;
  if (partial.continuations >= STORY_CONTINUATION_LIMIT) return 'used_up';
  const narrative = partialNarrative(partial.text);
  return narrative.closed && narrative.chars < minNarrativeChars ? 'closed_short' : undefined;
}

export function canContinueStory(draft: TurnDraft | undefined, minNarrativeChars: number): boolean {
  return storyPartialVisible(draft) && !continuationBlock(draft, minNarrativeChars);
}

/** 截断点可能落在半个标签上（如「<短期记」）：去掉末尾不完整的标签片段，由续写补出完整标签。 */
export function trimIncompleteTag(partial: string): string {
  return partial.replace(/<\/?[^<>\s]{0,12}$/u, '');
}

/**
 * 把续写内容接到已写部分后面：
 * - 去掉续写开头重复输出的 <thinking>…</thinking>（已写部分已越过规划时）；
 * - 去掉续写开头与已写结尾重叠的文字（模型常把最后一句再写一遍）。
 */
export function mergeContinuation(partial: string, addition: string): string {
  const base = trimIncompleteTag(partial), next = continuationOpening(base, addition);
  return base + next.slice(overlapLength(base, next));
}

/** 续写开头去掉重复的规划块与重复的 <正文> 后的文字（尚未去掉与已写结尾重叠的部分）。base 须已去掉末尾残缺标签。 */
function continuationOpening(base: string, addition: string): string {
  let next = addition.replace(/^\s+/u, '');
  if (/<\/thinking>/u.test(base) || /<正文>/u.test(base)) next = next.replace(/^<thinking>[\s\S]*?<\/thinking>\s*/u, '');
  // 已写部分的正文还没闭合、续写却重新打开 <正文>：只去掉重复的开头标签，保留后续文字。
  if (/<正文>/u.test(base) && !/<\/正文>/u.test(base)) next = next.replace(/^<正文>\s*/u, '');
  return next;
}

/** 认定为重复的最长重叠（字符）。 */
const OVERLAP_MAX = 2000;

/**
 * 流式显示时，续写开头是否已经能确定怎么拼接：
 * - 重新输出的规划块还没闭合、或开头可能是 <thinking>/<正文> 的前半截：继续等；
 * - 开头仍完整出现在已写结尾附近（可能正在重复旧文字，重叠还会变长）：继续等；
 * - 开头已经和已写内容对不上，或超过可去重的最大长度：可以确定。
 */
export function continuationSettled(partial: string, addition: string): boolean {
  const base = trimIncompleteTag(partial), head = addition.replace(/^\s+/u, '');
  if (!head) return false;
  if ((/<\/thinking>/u.test(base) || /<正文>/u.test(base))
    && (head.startsWith('<thinking>') ? !head.includes('</thinking>') : '<thinking>'.startsWith(head))) return false;
  const next = continuationOpening(base, addition);
  if (next.length > OVERLAP_MAX) return true;
  if (next.length < 4) return false;
  return !base.slice(-OVERLAP_MAX).includes(next);
}

/** 续写的流式显示：开头先缓冲到能确定拼接方式，再按最终拼接同一套规则去重后显示，之后的增量原样显示。 */
export class ContinuationPreview {
  private opening = '';
  private settled = false;
  constructor(private readonly partial: string) {}
  /** 返回本次可以追加到显示里的文字（缓冲期间为空）。 */
  push(delta: string): string {
    if (this.settled) return delta;
    this.opening += delta;
    if (!continuationSettled(this.partial, this.opening)) return '';
    this.settled = true;
    return mergeContinuation(this.partial, this.opening).slice(trimIncompleteTag(this.partial).length);
  }
}

/** 已写结尾与续写开头的最长重叠（至少 4 个字符才认定为重复，避免误删正常衔接；中文 4 字已足够特定）。 */
export function overlapLength(base: string, next: string, max = OVERLAP_MAX): number {
  const limit = Math.min(base.length, next.length, max);
  for (let k = limit; k >= 4; k--) if (base.endsWith(next.slice(0, k))) return k;
  return 0;
}

/**
 * 续写请求末尾追加的指令（user 消息）；紧跟在作为 assistant 消息的已写部分之后。
 * 每次请求都按当前已写部分与本次设置重新计算字数，告诉模型已写多少、至少还需多少；不要求凑到某个精确字数。
 */
export function continuationInstruction(options: { actionOptions: boolean; minNarrativeChars: number; partial: string }): string {
  const tags = options.actionOptions ? '<短期记忆>、<变量规划>、<行动选项>' : '<短期记忆>、<变量规划>';
  const min = options.minNarrativeChars, narrative = partialNarrative(options.partial), need = Math.max(0, min - narrative.chars);
  const progress = !narrative.started
    ? `正文字数：<正文> 还没有开始（已写 0 字）；本回合 <正文> 至少需要 ${min} 字（只计正文里的非空白字符）。`
    : narrative.closed
      ? `正文字数：<正文> 已经完整结束，共 ${narrative.chars} 字，已达到最低 ${min} 字。不要再写正文，也不要重新打开 <正文>，只补齐缺少的结构标签。`
      : need > 0
        ? `正文字数：<正文> 目前已写 ${narrative.chars} 字（只计非空白字符），本回合至少需要 ${min} 字，还需至少约 ${need} 字。请自然推进场景直到合适的收束点，不必恰好停在某个字数，也不要为凑字数重复或灌水。`
        : `正文字数：<正文> 目前已写 ${narrative.chars} 字，已达到最低 ${min} 字；把当前场景自然收尾即可，不必扩写。`;
  return [
    '【续写】你的上一条回复在中途被截断，上面那条助手消息就是你已经输出的全部内容。请直接从中断处接着写：',
    '1. 不要重复已经写过的任何文字，不要重新输出 <thinking>，也不要从头开始；',
    narrative.closed ? '2. <正文> 已经结束，不要在 </正文> 之后再写任何正文；' : '2. 如果 <正文> 还没有结束，先把正文自然地写完并输出 </正文>；',
    `3. 然后按本阶段的格式要求，依次补齐还没输出的结构标签（${tags}），每个都要完整闭合；`,
    '4. 只输出续写部分，第一个字符就是接在断点后面的内容，不加任何说明。',
    progress,
  ].join('\n');
}

/** 正文请求失败时收到的内容：text 为可保存的原文（已去掉前导 <think>，续写时为拼接后的全文）；produced 表示模型这次是否返回了任何文字。 */
export interface StoryFailureText { text: string; produced: boolean }

/** 截断正文是否应在阅读区显示（不论还能否续写；次数用完后仍可阅读、复制）。 */
export function storyPartialVisible(draft: TurnDraft | undefined): boolean {
  return Boolean(draft && !draft.story && draft.stageStatus.story === 'failed' && draft.storyPartial
    && draft.storyPartial.storyRevision === draft.storyRevision);
}

/**
 * 正文失败后草稿里应保存的截断原文：
 * - 失败属于「没写完」且收到了有效内容：保存新的（续写时为拼接后的）原文；
 * - 续写失败但不能用新内容替换：保留原来的截断原文；模型返回过文字才消耗一次续写次数，什么都没返回（如网络断开、服务器 500）不扣；
 * - 其余情况不保留。
 */
export function nextStoryPartial(draft: TurnDraft, failure: { code: string; storyRule?: string }, received: StoryFailureText | undefined,
  continuation: boolean): TurnDraft['storyPartial'] {
  const previous = continuation && draft.storyPartial?.storyRevision === draft.storyRevision ? draft.storyPartial : undefined;
  const produced = Boolean(received?.produced);
  const continuations = previous ? Math.min(STORY_CONTINUATION_LIMIT, previous.continuations + (produced ? 1 : 0)) : 0;
  if (received && produced && continuableStoryFailure(failure.code, failure.storyRule) && partialWorthKeeping(received.text))
    return { text: received.text, storyRevision: draft.storyRevision, continuations };
  return previous ? { ...previous, continuations } : undefined;
}

/** 玩家点「放弃这段」：只清掉没写完的正文，不调用 AI，失败记录与上一回合都不受影响。 */
export function discardStoryPartial(draft: TurnDraft): TurnDraft {
  return { ...draft, draftRevision: draft.draftRevision + 1, storyPartial: undefined };
}
