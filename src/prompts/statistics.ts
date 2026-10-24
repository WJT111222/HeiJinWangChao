import type { AiMessage, Usage } from '../services/ai/protocols';

export const characterCount = (text: string) => Array.from(text).length;
// 与供应商 tokenizer 无关的规模估计；不含协议固定开销，不能作为计费消耗。
export function estimateTokens(text: string) {
  let ascii = 0,
    other = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 128) ascii++;
    else other++;
  }
  return {
    estimatedTokens: Math.ceil(ascii / 4 + other * 1.5),
    method: 'unicode-heuristic-v1' as const,
  };
}
export function contextStatistics(messages: readonly AiMessage[], usage?: Usage) {
  const text = messages.map((message) => message.content).join('\n');
  return {
    characters: messages.reduce((sum, message) => sum + characterCount(message.content), 0),
    ...estimateTokens(text),
    actual: {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      ...(usage?.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    },
  };
}
