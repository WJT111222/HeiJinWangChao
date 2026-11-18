import { z } from 'zod';
import { AiError } from './errors';

/** Output carrier only: never an executable function or a world command. */
export const STORY_OUTPUT_TOOL = 'heijin_story_output';
export const STORY_TOOL_DESCRIPTION = '将本次要求的完整 Story 回复原文放入 content，保留原有全部标签和格式。此工具仅承载回复，不执行任何动作。';
export const STORY_TOOL_PARAMETERS = {
  type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false,
} as const;
export const STORY_TOOL_ARGUMENT_LIMIT = 8_000_000;
const schema = z.strictObject({ content: z.string().min(1).max(8_000_000) });
export type ToolFailureRule = 'identity' | 'name' | 'multiple' | 'mixed_text' | 'ordering' | 'arguments' | 'incomplete' | 'unsupported_shape' | 'finish';
export function toolFailure(rule: ToolFailureRule): AiError {
  return new AiError('tool_response', undefined, { fieldPath: `storyTool.${rule}` });
}
export function parseStoryToolArguments(raw: string): string {
  if (raw.length > STORY_TOOL_ARGUMENT_LIMIT) throw toolFailure('arguments');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw toolFailure('arguments'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw toolFailure('arguments');
  // JSON.parse accepts duplicate object keys. A valid carrier has exactly one key
  // and one string value. Tokenize complete JSON strings, not words inside content.
  const strings = raw.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g);
  let keys = 0;
  for (const token of strings) if (/^\s*:/.test(raw.slice(token.index! + token[0].length))) keys++;
  if (keys !== 1) throw toolFailure('arguments');
  return parsed.data.content;
}
