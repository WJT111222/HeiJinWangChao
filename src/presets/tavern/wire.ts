import { insertPlayerWorldbook, type PlayerWorldbook } from '../../prompts/playerWorldbook';
import { z } from 'zod';
import { isOpenAiCompatible } from '../../services/ai/configuration';
import { AiError } from '../../services/ai/errors';
import { type AiMessage, wireRequest } from '../../services/ai/protocols';
import type { RequestSnapshot } from '../../services/ai/snapshot';
import { finalizeNativeDelivery } from '../nativeDelivery';
import { packageOverride } from '../package';

const name = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const declaration = z.strictObject({ type: z.literal('function'), function: z.strictObject({
  name, description: z.string().optional(), parameters: z.record(z.string(), z.json()), strict: z.boolean().optional(),
}) });
const request = z.object({
  messages: z.array(z.strictObject({ role: z.enum(['system','user','assistant']), content: z.string().min(1) })).min(1),
  tools: z.array(declaration).optional(),
  tool_choice: z.union([z.enum(['auto','none','required']), z.strictObject({ type: z.literal('function'), function: z.strictObject({ name }) })]).optional(),
  parallel_tool_calls: z.boolean().optional(), stream: z.boolean(), n: z.literal(1),
  enable_web_search: z.literal(false).optional(), request_images: z.literal(false).optional(),
  json_schema: z.never().optional(), response_format: z.never().optional(),
  chat_completion_source: z.literal('custom'), custom_prompt_post_processing: z.literal(''),
  ...packageOverride.shape.sampling.unwrap().shape,
});
function unsupported(fieldPath: string): never { throw new AiError('unsupported', undefined, { fieldPath: 'tavern.' + fieldPath }); }

export function tavernWire(snapshot: RequestSnapshot, raw: unknown, nativeReference?: readonly AiMessage[], playerWorldbook?: PlayerWorldbook) {
  const parsed = request.safeParse(raw);
  if (!parsed.success) unsupported('request');
  const { messages, tools = [], tool_choice: choice, parallel_tool_calls: parallel, stream, temperature, top_p, frequency_penalty, presence_penalty } = parsed.data;
  if (messages.at(-1)?.role === 'assistant') unsupported('assistant_prefill');
  const protocol = snapshot.channel.protocol;
  let conversation = false;
  const names = new Set(tools.map(t => t.function.name));
  if (nativeReference !== undefined && choice !== 'auto') unsupported('native_delivery.tools');
  const ordered = nativeReference === undefined ? messages : finalizeNativeDelivery(messages, tools, nativeReference);
  const adapted = ordered.map(message => {
    if (message.role !== 'system') conversation = true;
    if (!conversation || message.role !== 'system' || isOpenAiCompatible(protocol)) return message;
    return { role: 'user' as const, content: '[system]\n' + message.content };
  });
  const withWorldbook = playerWorldbook && snapshot.stage === 'story'
    ? insertPlayerWorldbook(adapted, playerWorldbook, ordered)
    : adapted;
  const wire = wireRequest(snapshot, withWorldbook, stream, nativeReference !== undefined ? undefined : { temperature, top_p, frequency_penalty, presence_penalty });
  const body = JSON.parse(wire.init.body) as Record<string, unknown>;
  const selected = typeof choice === 'object' ? choice.function.name : undefined;
  if (names.size !== tools.length || (selected && !names.has(selected)) || (!tools.length && (choice && choice !== 'none' || parallel !== undefined)))
    unsupported('tool_choice');
  if (isOpenAiCompatible(protocol)) {
    if (tools.length) body.tools = tools;
    if (choice !== undefined) body.tool_choice = choice;
    if (parallel !== undefined) {
      if (protocol === 'deepseek') unsupported('parallel_tool_calls');
      body.parallel_tool_calls = parallel;
    }
  } else if (tools.length) {
    if (tools.some(t => t.function.strict !== undefined)) unsupported('tools.strict');
    if (protocol === 'gemini') {
      if (parallel !== undefined) unsupported('parallel_tool_calls');
      body.tools = [{ functionDeclarations: tools.map(({ function: f }) => ({
        name: f.name, description: f.description, parametersJsonSchema: f.parameters,
      })) }];
      if (choice !== undefined) body.toolConfig = { functionCallingConfig: {
        mode: selected || choice === 'required' ? 'ANY' : choice === 'none' ? 'NONE' : 'AUTO',
        ...(selected ? { allowedFunctionNames: [selected] } : {}),
      } };
    } else {
      if (body.thinking && (selected || choice === 'required')) unsupported('thinking.tool_choice');
      body.tools = tools.map(({ function: f }) => ({ name: f.name, description: f.description, input_schema: f.parameters }));
      if (choice !== undefined || parallel !== undefined) body.tool_choice = {
        type: selected ? 'tool' : choice === 'required' ? 'any' : choice ?? 'auto',
        ...(selected ? { name: selected } : {}), ...(parallel !== undefined ? { disable_parallel_tool_use: !parallel } : {}),
      };
    }
  }
  wire.init.body = JSON.stringify(body);
  return { ...wire, stream, declaredTools: choice === 'none' ? new Set<string>() : names };
}
