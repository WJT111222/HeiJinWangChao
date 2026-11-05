import { extractCommandBlock } from './block';
import { failure } from './common';
import type { ParseResult } from './common';

/**
 * 适配 MoRanJiangHu variableModel 输出格式 / storyTasks.解析变量校准响应。
 * 只分离三个区块，分析/说明不执行。目标事务要求完整封套，禁止源宽容回退的坏行子集。
 * 命令内字符串里的尖括号由既有词法提取器处理，不用正则截断JSON数据。
 */
export function parseVariableResponse(text: string): ParseResult<{ analysis: string; description: string }> {
  const block = extractCommandBlock(text);
  if (!block.ok) return block;
  const prefix = text.slice(0, block.value.source.start.offset);
  const suffix = text.slice(block.value.source.end.offset);
  const match = /^\s*<thinking>([\s\S]*?)<\/thinking>\s*<说明>([\s\S]*?)<\/说明>\s*<命令>$/iu.exec(prefix);
  if (!match || !/^<\/命令>\s*$/u.test(suffix)
    || /<\/?thinking>/iu.test(match[1]) || /<\/?说明>/u.test(match[2])) return failure('block_structure', text);
  return { ok: true, value: { analysis: match[1], description: match[2] } };
}
