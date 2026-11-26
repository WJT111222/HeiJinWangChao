// Phone messages are quoted game data. Escape literal opening braces on the wire so
// native prompt-template validation never mistakes a message for a template variable.
// JSON.parse recovers the exact text, including existing backslashes.
const quoteBraces = (json: string) => json.replaceAll('{{', '\\u007b\\u007b');

function wireJson(context: Record<string, unknown>) {
  const json = JSON.stringify(context);
  if (
    !json.includes('{{') ||
    !('PHONE_STORY' in context || 'PHONE_INBOX' in context || 'ENTITY_CANDIDATE' in context)
  )
    return json;

  const fields: string[] = [];
  for (const [key, value] of Object.entries(context)) {
    let field = JSON.stringify(value);
    if (field === undefined) continue;
    if (key === 'PHONE_STORY' || key === 'PHONE_INBOX') {
      field = quoteBraces(field);
    } else if (key === 'ENTITY_CANDIDATE' && Array.isArray(value)) {
      field =
        '[' +
        value
          .map((command) =>
            command?.type === 'RecordPhoneMessage'
              ? quoteBraces(JSON.stringify(command))
              : JSON.stringify(command),
          )
          .join(',') +
        ']';
    }
    fields.push(JSON.stringify(key) + ':' + field);
  }
  return '{' + fields.join(',') + '}';
}

export function contextMessage(context: Record<string, unknown>, tag = 'GAME_CONTEXT') {
  // 容器作为 user 数据，转义尖括号避免角色卡通过闭合标签伪造容器。
  const json = wireJson(context).replace(
    /[<>&]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `<${tag}>\n${json}\n</${tag}>`;
}
