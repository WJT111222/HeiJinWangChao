/**
 * 行动建议叠加到输入框：输入为空时直接填入；已包含该建议时不重复添加；
 * 否则用中文逗号接在已有内容后面（已有内容以标点结尾时直接接上），玩家自己写的文字原样保留。
 */
export function appendActionOption(input: string, option: string): string {
  const choice = option.trim();
  if (!choice) return input;
  const current = input.replace(/[ \t\u3000]+$/, '');
  if (!current.trim()) return choice;
  if (includesActionOption(current, choice)) return input;
  return /[，。；！？、,.;!?：:\n]$/.test(current) ? `${current}${choice}` : `${current}，${choice}`;
}

/** 输入框里是否已经包含这条建议（用于按钮的已选中状态）。 */
export function includesActionOption(input: string, option: string): boolean {
  const choice = option.trim();
  return Boolean(choice) && input.includes(choice);
}
