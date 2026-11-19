import { extractCommandBlock, parseVariableResponse } from '../../parsers/variableText';

/** Non-executable text may be missing or unfinished. Never select among multiple command blocks. */
export function commandEnvelope(text: string) {
  let block = extractCommandBlock(text);
  if (!block.ok && block.error.code !== 'limit_exceeded') {
    // A broken prose prefix can be ignored only when it has no command markers of its own.
    const starts = [...text.matchAll(/^[\t ]*<命令>/gmu)];
    if (starts.length !== 1) return;
    const index = starts[0].index!;
    const prefix = text.slice(0, index);
    if (/<\/?命令>/u.test(prefix) || !/^\s*<(?:thinking|说明)>/iu.test(prefix)) return;
    text = text.slice(index);
    block = extractCommandBlock(text);
  }
  if (!block.ok || !/^<\/命令>\s*$/u.test(text.slice(block.value.source.end.offset))) return;
  const full = parseVariableResponse(text);
  return {
    text,
    commands: block.value.text,
    hasDescription: full.ok && Boolean(full.value.description.trim()),
    formatWarning: !full.ok || !full.value.analysis.trim() || !full.value.description.trim(),
  };
}
