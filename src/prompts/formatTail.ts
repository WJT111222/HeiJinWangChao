import type { AiStage } from '../services/ai/configuration';

/**
 * 各阶段的「最终格式提醒」：拼在请求末尾、紧贴生成点的简短骨架。
 *
 * 掉格式的主要原因是输出协议写在系统消息里，与生成点之间隔着数千 token 的
 * 存档上下文，距离越远越容易被模型遗忘。这里只重复"输出长什么样"这一件事，
 * 不新增任何规则；内容必须与 shared/06~08 输出协议和解析器保持一致，改任何
 * 一方都要同步核对另一方（parseStoryEnvelope / VARIABLE_TEXT_V1 / World JSON）。
 *
 * 骨架会被模型照抄，所以骨架自身必须是严格解析器可接受的形状：
 * - 各占位文字里不得出现任何保留标签字面量（否则照抄即 tag_nested）；
 * - <变量规划>/<命令> 等结构化块给出真正合法的最小内容（[] 或空块），
 *   规则说明一律放在骨架外的说明行里。
 * src/tests/format-tail.test.ts 用正式解析器逐条锁定这些性质。
 */
export function formatTailMessage(
  stage: AiStage | 'memory',
  options: { actionOptions: boolean; minNarrativeChars: number },
): string | undefined {
  if (stage === 'story') {
    const actionsSkeleton = options.actionOptions ? '\n<行动选项>每行一条短行动</行动选项>' : '';
    const actionsRule = options.actionOptions
      ? '<行动选项>共3～5条、每行一条；'
      : '行动选项未启用，不要输出<行动选项>块；';
    return [
      '【最终格式提醒】从输出的第一个字符起就是协议内容，不加前言、解释或Markdown代码围栏。创作提纲（thinking 块）可选：不输出它时，第一个标签直接是正文块。顶层骨架如下（占位文字不可照抄，各块写入真实内容；骨架之前不得输出任何文字）：',
      '<thinking>创作要点提纲</thinking>',
      '<正文>完整连续的小说正文</正文>',
      '<短期记忆>本回合事实摘要</短期记忆>',
      `<变量规划>[]</变量规划>${actionsSkeleton}`,
      `要求：顶层标签顺序固定、各至多一次、打开必须闭合，各块内容中不得再出现顶层标签字面量；<正文>纯文本不少于 ${options.minNarrativeChars} 字；<变量规划>为严格JSON数组，有更新时把 [] 换成数组内容；${actionsRule}写完最后一个闭合标签立即结束输出。`,
    ].join('\n');
  }
  if (stage === 'variables') {
    return [
      '【最终格式提醒】从输出的第一个字符起依次给出三个顶层区块，顺序固定、各一次、打开必须闭合，区块之外不得有任何文字或Markdown代码围栏。没有任何变化时的完整合法形状（占位文字换成真实内容）：',
      '<thinking>变量变化分析结论</thinking>',
      '<说明>',
      '- 本回合确认的变化与不能处理的事项',
      '</说明>',
      '<命令>',
      '</命令>',
      '有变化时在命令块内写指令：set / add / push / delete 每行一条，不夹杂其他文字；输出最后一个闭合标签后立即结束，不追加自检报告或解释。',
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
