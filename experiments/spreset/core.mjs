// SPDX-License-Identifier: GPL-3.0-only
// SPreset by SoliUmbra / starowo. Adapted for the C2 experiment, 2026-11-26.
// See SOURCES.json for the exact upstream revisions, line ranges and hashes.
const tool = {
  type: 'function',
  function: {
    name: 'submit_scene',
    description: '交付本次写完的游戏正文与必需的协议标签。',
    parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false },
  },
};

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// processSPresetFinalRequest. The processor is statically registered. No script compiler.
function processFinalRequest(request) {
  if (!object(request) || !Array.isArray(request.messages)) throw new TypeError();
  const draft = globalThis.structuredClone(request);
  const processed = declareSceneTool(draft);
  if (!object(processed) || processed.stream !== request.stream || processed.chat_completion_source !== request.chat_completion_source)
    throw new TypeError();
  const normalized = JSON.parse(JSON.stringify(processed));
  if (!object(normalized) || normalized.stream !== request.stream || normalized.chat_completion_source !== request.chat_completion_source)
    throw new TypeError();
  return normalized;
}

function declareSceneTool(draft) {
  draft.tools = [tool];
  draft.tool_choice = 'auto';
  return draft;
}

function normalizeSPresetOutputProcessorResult(result) {
  if (typeof result === 'string') {
    return { output: result, hold: '', state: undefined };
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('输出预处理脚本必须返回字符串或 { output, hold }');
  }

  const hasOutput = Object.prototype.hasOwnProperty.call(result, 'output')
    || Object.prototype.hasOwnProperty.call(result, 'emit')
    || Object.prototype.hasOwnProperty.call(result, 'text')
    || Object.prototype.hasOwnProperty.call(result, 'content');
  if (!hasOutput) {
    throw new TypeError('输出预处理结果缺少 output');
  }
  const output = Object.prototype.hasOwnProperty.call(result, 'output')
    ? result.output
    : Object.prototype.hasOwnProperty.call(result, 'emit')
      ? result.emit
      : Object.prototype.hasOwnProperty.call(result, 'text')
        ? result.text
        : result.content;
  return {
    output: output == null ? '' : String(output),
    hold: result.hold == null ? '' : String(result.hold),
    state: result.state,
  };
}

// The original output processor returns { output, hold, state }. Only a closed leading
// compatibility think block immediately before the game envelope is eligible for removal.
// Never manufacture an envelope, complete an argument or strip text inside the narrative.
function preprocessOutput(buffer) {
  const start = /^\s*<think(?:\s[^>]*)?>/iu.exec(buffer);
  let output = buffer;
  if (start) {
    const end = /<\/think>\s*/igu;
    end.lastIndex = start[0].length;
    if (end.exec(buffer) && /^<(?:正文|thinking)>/u.test(buffer.slice(end.lastIndex))) output = buffer.slice(end.lastIndex);
  }
  return { output, hold: '', state: { accepted: true } };
}

// One instance per request. Only the real, complete model tool invocation can reach this action.
export function createSession() {
  let phase = 'ready';
  return (operation, input) => {
    if (operation === 'prepare' && phase === 'ready') {
      phase = 'prepared';
      return processFinalRequest(input);
    }
    if (operation === 'finish' && phase === 'prepared') {
      phase = 'closed';
      if (!object(input)) throw new TypeError();
      let content = input.text;
      if (input.call !== undefined) {
        const { id, name, args } = input.call;
        if (content || typeof id !== 'string' || !id.trim() || name !== tool.function.name || !object(args)
          || Object.keys(args).length !== 1 || !Object.hasOwn(args, 'content') || typeof args.content !== 'string') throw new TypeError();
        content = args.content;
      }
      if (typeof content !== 'string' || !content.trim()) throw new TypeError();
      const { output } = normalizeSPresetOutputProcessorResult(preprocessOutput(content));
      // The receipt is derived locally, never inserted as model or conversation history.
      return { output, receipt: input.call ? { id: input.call.id, bytes: new globalThis.TextEncoder().encode(output).length } : null };
    }
    throw new TypeError();
  };
}
