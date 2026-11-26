// SPDX-License-Identifier: GPL-3.0-only
// SoliUmbra / starowo. Adapted 2026-11-27, fixed local processor callback.
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// processSPresetFinalRequest. The processor is statically registered. No script compiler.
export function processFinalRequest(request, configure) {
  if (!object(request) || !Array.isArray(request.messages)) throw new TypeError();
  const draft = globalThis.structuredClone(request);
  const processed = configure(draft);
  if (!object(processed) || processed.stream !== request.stream || processed.chat_completion_source !== request.chat_completion_source)
    throw new TypeError();
  const normalized = JSON.parse(JSON.stringify(processed));
  if (!object(normalized) || normalized.stream !== request.stream || normalized.chat_completion_source !== request.chat_completion_source)
    throw new TypeError();
  return normalized;
}

export function normalizeSPresetOutputProcessorResult(result) {
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
export function preprocessOutput(buffer) {
  const start = /^\s*<think(?:\s[^>]*)?>/iu.exec(buffer);
  let output = buffer;
  if (start) {
    const end = /<\/think>\s*/igu;
    end.lastIndex = start[0].length;
    if (end.exec(buffer) && /^<(?:正文|thinking)>/u.test(buffer.slice(end.lastIndex))) output = buffer.slice(end.lastIndex);
  }
  return { output, hold: '', state: { accepted: true } };
}
