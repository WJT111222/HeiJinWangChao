import { z } from 'zod';
import { DataError } from '../../domain/common';
import { StoryValidationError, storyFieldPath, storyTags } from '../../domain/storyDiagnostics';
import type { StoryDiagnostic, StoryTag, StoryRule } from '../../domain/storyDiagnostics';
import { AiError } from '../ai/errors';

/** Diagnose only missing REQUIRED tags; an absent project <thinking> is valid. */
export function storyEnvelopeDiagnostic(text: string, actions: boolean): StoryDiagnostic {
  const required: StoryTag[] = ['正文', '短期记忆', '变量规划', ...(actions ? ['行动选项' as const] : [])];
  for (const tag of required) {
    const open = text.indexOf(`<${tag}>`), close = text.indexOf(`</${tag}>`);
    if (open < 0) return { storyRule: 'tag_missing', storyTag: tag };
    if (close < 0) return { storyRule: 'tag_unclosed', storyTag: tag };
    if (close < open) return { storyRule: 'tag_order', storyTag: tag };
  }
  if (!actions && /<\/?行动选项>/u.test(text)) return { storyRule: 'tag_unexpected', storyTag: '行动选项' };

  const hasThinking = /<\/?thinking>/u.test(text);
  let after = 0;
  if (hasThinking) {
    const open = text.indexOf('<thinking>'), close = text.indexOf('</thinking>');
    if (open < 0 || close < open) return { storyRule: 'tag_order', storyTag: 'thinking' };
    if (close < 0) return { storyRule: 'tag_unclosed', storyTag: 'thinking' };
    if (open > text.indexOf('<正文>')) return { storyRule: 'tag_order', storyTag: 'thinking' };
    if (text.indexOf('<thinking>', open + 1) >= 0 || text.indexOf('</thinking>', close + 1) >= 0)
      return { storyRule: 'tag_nested', storyTag: 'thinking' };
    after = close + '</thinking>'.length;
  }
  for (const tag of required) {
    const open = text.indexOf(`<${tag}>`), close = text.indexOf(`</${tag}>`);
    if (open < after) return { storyRule: 'tag_order', storyTag: tag };
    after = close + tag.length + 3;
  }
  return { storyRule: 'structure_unrecognized' };
}
export function nestedStoryTag(part: string): StoryTag | undefined {
  const match = /<\s*\/?\s*(thinking|think|judge|正文|短期记忆|变量规划|行动选项)(?=[\s/>])[^>]*>/i.exec(part);
  const tag = match?.[1].toLowerCase();
  return storyTags.find(known => known === tag);
}
export function storySchemaError(error: z.ZodError) {
  const issue = error.issues[0], path = issue?.path ?? [];
  const guideIndex = path[0] === 'variableGuide' && typeof path[1] === 'number' ? path[1] : undefined;
  const status = path.includes('eventInteraction') && path.at(-1) === 'action';
  const rule = issue && ['invalid_type', 'invalid_value', 'too_small', 'unrecognized_keys', 'invalid_format'].includes(issue.code) ? issue.code : 'constraint';
  return new AiError('invalid_output', undefined, {
    storyRule: status ? 'receipt_status' : 'story_schema', fieldPath: storyFieldPath(path), guideIndex,
    storyIssue: rule as StoryDiagnostic['storyIssue'],
  });
}
// Exact, program-owned DataError messages only; never classify model prose or echo arbitrary error text.
const timeFailureRules: Record<string, StoryRule> = {
  '历史视角声明无效': 'retrospective_duplicate',
  '历史视角声明不是合法JSON': 'retrospective_json',
  '历史视角必须是玩家明确要求的纯过去回顾': 'retrospective_schema',
  '历史视角缺少人物或玩家原请求的独立依据': 'retrospective_source',
  '过去回顾不能混合当前时间推进': 'retrospective_mixed',
  '时间结果不唯一': 'time_duplicate',
  '时间结果非法或倒退': 'time_invalid_or_reversed',
  '中断事件已失效或不具备触达条件': 'time_interrupt',
  '未知时间结果类型': 'time_kind',
};
/** Presentation adapter only; callers may retain the original DataError for existing control flow. */
export function storyFailure(error: unknown, knownStoryResponse = false): unknown {
  if (error instanceof AiError) {
    if (knownStoryResponse && error.code === 'invalid_output' && !error.details?.storyRule)
      return new AiError(error.code, error.status, { storyRule: 'structure_unrecognized' });
    return error;
  }
  if (error instanceof StoryValidationError) return new AiError(error.code === 'EVENT_ENTRY' ? 'event_entry' : 'time_data', undefined, error.diagnostic);
  if (error instanceof DataError && ['DRAFT_CONFLICT', 'REVISION_CONFLICT'].includes(error.code))
    return new AiError('candidate_conflict', undefined, { storyRule: 'draft_conflict' });
  if (error instanceof DataError && error.code === 'TIME_PREFLIGHT')
    return new AiError('time_data', undefined, { storyRule: Object.hasOwn(timeFailureRules, error.message) ? timeFailureRules[error.message] : 'time_preflight', fieldPath: 'variableGuide' });
  return error;
}
