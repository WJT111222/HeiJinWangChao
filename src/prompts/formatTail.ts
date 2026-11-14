import type { AiStage } from '../services/ai/configuration';

/**
 * 各阶段的「最终格式提醒」：拼在请求末尾、紧贴生成点的简短骨架。
 *
 * 掉格式的主要原因是输出协议写在系统消息里，与生成点之间隔着数千 token 的
 * 存档上下文，距离越远越容易被模型遗忘。这里只重复"输出长什么样"这一件事，
 * 不新增任何规则；内容必须与 shared/06~08 输出协议和解析器保持一致，改任何
 * 一方都要同步核对另一方（parseStoryEnvelope / VARIABLE_TEXT_V1 / World JSON）。
 */
export function formatTailMessage(
  stage: AiStage | 'memory',
  options: { actionOptions: boolean; minNarrativeChars: number },
): string | undefined {
  if (stage === 'story') {
    const actions = options.actionOptions
      ? '<行动选项>3～5条，每行一条短行动</行动选项>'
      : '（行动选项未启用：不要输出<行动选项>块。）';
    return [
      '【最终格式提醒】从输出的第一个字符起就是协议内容，顶层骨架如下，顺序固定、各至多一次、打开必须闭合：',
      '<thinking>（可选）本回合创作要点；不输出则直接从<正文>开始</thinking>',
      `<正文>连续小说正文，纯文本不少于 ${options.minNarrativeChars} 字</正文>`,
      '<短期记忆>本回合已发生事实的简洁摘要</短期记忆>',
      '<变量规划>严格JSON数组；无更新写 []</变量规划>',
      actions,
      '顶层标签之外不得有任何文字、Step规划、解释或Markdown代码围栏；写完最后一个闭合标签立即结束输出。',
    ].join('\n');
  }
  if (stage === 'variables') {
    return [
      '【最终格式提醒】从输出的第一个字符起依次给出三个顶层区块，顺序固定、各一次、打开必须闭合，区块之外不得有任何文字或Markdown代码围栏：',
      '<thinking>变量变化分析结论</thinking>',
      '<说明>',
      '- 本回合确认的变化与不能处理的事项（每行以"- "开头）',
      '</说明>',
      '<命令>',
      'set/add/push/delete 指令每行一条；没有任何变化时保持此块为空',
      '</命令>',
      '输出</命令>后立即结束，不追加自检报告或解释。',
    ].join('\n');
  }
  if (stage === 'world') {
    return [
      '【最终格式提醒】只输出一个严格JSON对象：第一个字符是 {，最后一个字符是 }，之外不得有任何文字、解释或Markdown代码围栏。五个顶层数组必须全部出现：',
      '{"worldCommands":[],"taskCommands":[],"eventCommands":[],"visibleHooks":[],"unresolved":[]}',
      '先确认 EVENT_SCHEDULE 的到期事项都已处理；确无变化时就输出上面的空形状。',
    ].join('\n');
  }
  return undefined;
}
