// Shared checks for free text. The app also removes its known credentials and
// matching private request inputs before any text is included in the preview.
const privateContext = /<\/?(?:GAME_CONTEXT|TURN_CONTEXT|SAVE_STATE|MEMORY_CONTEXT)\b|["'](?:SAVE_STATE|TURN_CONTEXT|GAME_CONTEXT|MEMORY_CONTEXT)["']\s*:/i;
const requestDump = /["'](?:messages|systemInstruction)["']\s*:\s*\[\s*\{\s*["'](?:role|parts)["']\s*:/i;
const saveDump = /["'](?:schemaVersion|formatVersion|saveId)["']\s*:/;
const missingText = '[请求或存档内容已隐藏]';
const hidden = '[凭证已隐藏]';

export function containsPrivateDump(text: string) {
  return privateContext.test(text) || requestDump.test(text)
    || (saveDump.test(text) && /["'](?:protagonist|journal|records|saves|gameState)["']\s*:/.test(text));
}
export function cleanFeedbackText(text: string) {
  if (containsPrivateDump(text)) return missingText;
  return text
    .replace(/^[\t ]*(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-goog-api-key)\s*:[^\r\n]*/gim, hidden)
    .replace(/\b(?:Bearer|Basic)\s+(?!\[)[^\s"<>,;]+/gi, hidden)
    .replace(/((?:["']?(?:authorization|proxy-authorization|cookie|x-api-key|x-goog-api-key|api[-_ ]?key|access[-_]?token|refresh[-_]?token)["']?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;<>]+)/gi,
      (match, prefix: string, value: string) => /^["']?\[(?:凭证|密钥|敏感字段)/.test(value) ? match : prefix + hidden)
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,})\b/g, hidden);
}
