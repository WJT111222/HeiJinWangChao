export function contextMessage(context: Record<string, unknown>) {
  // 容器作为 user 数据，转义尖括号避免角色卡通过闭合标签伪造容器。
  const json = JSON.stringify(context).replace(
    /[<>&]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `<GAME_CONTEXT>\n${json}\n</GAME_CONTEXT>`;
}
