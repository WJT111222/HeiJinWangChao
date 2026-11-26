// SPDX-License-Identifier: GPL-3.0-only
// SoliUmbra / starowo; Dynasty adaptation, 2026-11-27. See SOURCES.json.
import { processFinalRequest, normalizeSPresetOutputProcessorResult, preprocessOutput } from './pipeline.mjs';

const reply = {
  type: 'function', function: { name: 'soliumbra_reply',
    description: '小猫之神交付完整的本回合游戏回复。',
    parameters: { type: 'object', properties: {
      think_nya: { type: 'string', description: '可省略的猫神文学附注。' },
      game_content: { type: 'string', description: '按本回合输出协议给出完整正文及必需标签。' },
    }, required: ['game_content'], additionalProperties: false },
  },
};

// Original ToolBindings actionBody. Invoke it only after terminal validation and formatting.
function acceptReply() {
  return JSON.stringify({ ok: true });
}

export function createOracleSession() {
  let next = 'prepare';
  let authorComment = false;
  return (operation, input) => {
    if (operation !== next) throw new TypeError('处理顺序错误');
    next = operation === 'prepare' ? 'finish' : null;
    if (operation === 'prepare') {
      const { enableAuthorComment, ...request } = input;
      authorComment = enableAuthorComment === true;
      return processFinalRequest(request, draft => {
        const tool = globalThis.structuredClone(reply);
        if (authorComment) tool.function.parameters.properties.comment = { type: 'string', description: '猫猫悄悄话，可选的场外留言。' };
        draft.tools = [tool];
        draft.tool_choice = 'auto';
        return draft;
      });
    }
    let content = input.text;
    let receipt = null;
    if (input.call !== undefined) {
      const { id, name, args } = input.call;
      if (content !== '' || typeof id !== 'string' || !id.trim() || name !== reply.function.name
        || !args || Object.keys(args).some(key => key !== 'game_content' && key !== 'think_nya' && !(key === 'comment' && authorComment))
        || (Object.hasOwn(args, 'comment') && typeof args.comment !== 'string')
        || (Object.hasOwn(args, 'think_nya') && typeof args.think_nya !== 'string') || typeof args.game_content !== 'string') throw new TypeError();
      content = args.game_content;
    }
    if (typeof content !== 'string' || !content.trim()) throw new TypeError();
    const { output } = normalizeSPresetOutputProcessorResult(preprocessOutput(content));
    if (input.call) receipt = { id: input.call.id, bytes: new globalThis.TextEncoder().encode(output).length, result: acceptReply() };
    return { output, receipt };
  };
}
const run = createOracleSession();
globalThis.onmessage = ({ data }) => {
  try { globalThis.postMessage({ result: run(data.operation, data.input) }); }
  catch { globalThis.postMessage({ error: true }); }
};
