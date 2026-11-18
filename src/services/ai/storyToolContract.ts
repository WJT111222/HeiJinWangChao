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
const toolRules = ['identity', 'name', 'multiple', 'mixed_text', 'ordering', 'arguments', 'incomplete', 'unsupported_shape', 'finish'] as const;
export type ToolFailureRule = typeof toolRules[number];
export type ToolOrderingSite =
  | 'reasoning_after_finish' | 'duplicate_provider_finish' | 'tool_event_after_finish' | 'tool_event_after_message_stop'
  | 'duplicate_message_stop' | 'message_stop_before_required_boundaries' | 'missing_or_closed_slot'
  | 'snapshot_delta_conflict' | 'projector_reopened_slot' | 'projector_arguments_without_open_slot'
  | 'projector_end_without_open_slot' | 'duplicate_content_block_stop';
const orderingSites = new WeakMap<AiError, ToolOrderingSite>();

export function toolOrderingFailure(site: ToolOrderingSite) {
  const error = toolFailure('ordering');
  orderingSites.set(error, site);
  return error;
}

export function toolFailureMetadata(error: AiError) {
  const toolRule = toolRules.find(rule => error.details?.fieldPath === `storyTool.${rule}`);
  const orderingSite = orderingSites.get(error);
  return { ...(toolRule && { toolRule }), ...(orderingSite && { orderingSite }) };
}

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
  let keys = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '"') continue;
    for (i++; i < raw.length; i++) {
      if (raw[i] === '\\') i++; // Already validated by JSON.parse; skip escaped quotes.
      else if (raw[i] === '"') break;
    }
    let next = i + 1;
    while (/\s/.test(raw[next] ?? '') && next < raw.length) next++;
    if (raw[next] === ':') keys++;
  }
  if (keys !== 1) throw toolFailure('arguments');
  return parsed.data.content;
}
