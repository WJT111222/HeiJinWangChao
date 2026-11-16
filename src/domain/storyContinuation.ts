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

export function canContinueStory(draft: TurnDraft | undefined): boolean {
  return Boolean(draft && !draft.story && draft.stageStatus.story === 'failed' && draft.storyPartial
    && draft.storyPartial.storyRevision === draft.storyRevision
    && draft.storyPartial.continuations < STORY_CONTINUATION_LIMIT);
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
  const base = trimIncompleteTag(partial);
  let next = addition.replace(/^\s+/u, '');
  if (/<\/thinking>/u.test(base) || /<正文>/u.test(base)) next = next.replace(/^<thinking>[\s\S]*?<\/thinking>\s*/u, '');
  // 已写部分的正文还没闭合、续写却重新打开 <正文>：只去掉重复的开头标签，保留后续文字。
  if (/<正文>/u.test(base) && !/<\/正文>/u.test(base)) next = next.replace(/^<正文>\s*/u, '');
  return base + next.slice(overlapLength(base, next));
}

/** 已写结尾与续写开头的最长重叠（至少 4 个字符才认定为重复，避免误删正常衔接；中文 4 字已足够特定）。 */
export function overlapLength(base: string, next: string, max = 2000): number {
  const limit = Math.min(base.length, next.length, max);
  for (let k = limit; k >= 4; k--) if (base.endsWith(next.slice(0, k))) return k;
  return 0;
}

/** 续写请求末尾追加的指令（user 消息）；紧跟在作为 assistant 消息的已写部分之后。 */
export function continuationInstruction(actionOptions: boolean): string {
  const tags = actionOptions ? '<短期记忆>、<变量规划>、<行动选项>' : '<短期记忆>、<变量规划>';
  return [
    '【续写】你的上一条回复在中途被截断，上面那条助手消息就是你已经输出的全部内容。请直接从中断处接着写：',
    '1. 不要重复已经写过的任何文字，不要重新输出 <thinking>，也不要从头开始；',
    '2. 如果 <正文> 还没有结束，先把正文自然地写完并输出 </正文>；',
    `3. 然后按本阶段的格式要求，依次补齐还没输出的结构标签（${tags}），每个都要完整闭合；`,
    '4. 只输出续写部分，第一个字符就是接在断点后面的内容，不加任何说明。',
  ].join('\n');
}

/**
 * 正文失败后草稿里应保存的截断原文：
 * - 失败属于「没写完」且收到了有效内容：保存新的（续写时为拼接后的）原文；
 * - 续写本身失败但没有新内容：保留原来的截断原文，消耗一次续写次数；
 * - 其余情况不保留。
 */
export function nextStoryPartial(draft: TurnDraft, failure: { code: string; storyRule?: string }, received: string | undefined,
  continuation: boolean): TurnDraft['storyPartial'] {
  const previous = continuation && draft.storyPartial?.storyRevision === draft.storyRevision ? draft.storyPartial : undefined;
  const continuations = previous ? Math.min(STORY_CONTINUATION_LIMIT, previous.continuations + 1) : 0;
  if (received && continuableStoryFailure(failure.code, failure.storyRule) && partialWorthKeeping(received))
    return { text: received, storyRevision: draft.storyRevision, continuations };
  return previous ? { ...previous, continuations } : undefined;
}
