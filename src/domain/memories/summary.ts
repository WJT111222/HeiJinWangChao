// 生成质量目标，不是正式存档 Schema 的硬性长度限制。
export const summaryTarget = { minHanCharacters: 100, maxHanCharacters: 200 } as const;

export function assessSummary(text: string) {
  const hanCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  return {
    hanCharacters,
    status: !text.trim()
      ? 'empty' as const
      : hanCharacters < summaryTarget.minHanCharacters
        ? 'below_target' as const
        : hanCharacters > summaryTarget.maxHanCharacters
          ? 'above_target' as const
          : 'within_target' as const,
  };
}
