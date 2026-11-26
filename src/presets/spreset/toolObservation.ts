// Parse only a prefix of the flat string-valued argument object. Never finish an
// incomplete escape, descend into another field or return a callable tool object.
export function observedToolString(raw: string, field: string): string {
  const source = raw.slice(0, 120_000);
  const open = /^\s*\{\s*/u.exec(source);
  if (!open) return '';
  // JSON string literals exclude unescaped U+0000–U+001F (RFC 8259).
  /* eslint-disable no-control-regex */
  const member = /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*")\s*:\s*"/uy;
  const value = /(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*/uy;
  /* eslint-enable no-control-regex */
  const next = /"\s*,/uy;
  let offset = open[0].length;
  while (offset < source.length) {
    member.lastIndex = offset;
    const key = member.exec(source);
    if (!key) break;
    value.lastIndex = member.lastIndex;
    const prefix = value.exec(source)![0];
    if (JSON.parse(key[1]) === field)
      return (JSON.parse('"' + prefix + '"') as string).replace(/[\uD800-\uDBFF]$/u, '');
    next.lastIndex = value.lastIndex;
    if (!next.exec(source)) break;
    offset = next.lastIndex;
  }
  return '';
}
