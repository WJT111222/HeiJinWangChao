// 仅处理明确否定的分句作用域，不是中文语义证明器。
// 不把普通的“不慌不忙”、无关人物的否定或另一事实的否定升级为整句禁令。
const negator =
  /不是|并非|尚未|并未|未能|不曾|未曾|没有|不(?=跟|同行)|未(?=跟|同行)|没(?=用|付|支|买|转|到|收|借|跟|陪|和|与|同|一起|一同)/;
const elidedSubject = /^(?:也|还|仍|又|并|且|已经|已|用|支付|跟随|跟着|一起|一同|走进|进入)/;
const retrospectiveDenial =
  /^(?:这|那|此事|这件事|上述说法)?(?:也|却|确实|最终|实际上)?(?:(?:并非|不是)(?:事实|真的|真实|如此|属实)|(?:并未|没有|没)(?:发生|完成|成功|付成|成行))(?:了|过)?$/;
const content = (text: string) => text.replace(/^\s*【旁白】\s*/, '').trim();

export function isNegatedFact(text: string, start = 0, end = text.length): boolean {
  const clauses: { start: number; end: number; text: string; boundary: string }[] = [];
  let left = 0,
    boundary = '';
  // 转折另起事实；不把“不但”误识别成转折。逗号保留省略主语的否定延续。
  for (const match of text.matchAll(/[，,；;。！？\n]|(?<!不)但(?:是)?|而是|然而|不过|却/g)) {
    clauses.push({
      start: left,
      end: match.index,
      text: content(text.slice(left, match.index)),
      boundary,
    });
    left = match.index + match[0].length;
    boundary = match[0];
  }
  clauses.push({ start: left, end: text.length, text: content(text.slice(left)), boundary });
  // 合并连续分隔符（例如“，但”），同时保留句号/换行，防止跨句回指。
  const scopes: typeof clauses = [];
  let pendingBoundary = '';
  for (const clause of clauses) {
    pendingBoundary += clause.boundary;
    if (!clause.text) continue;
    scopes.push({ ...clause, boundary: pendingBoundary });
    pendingBoundary = '';
  }
  let previousNegative = false;
  for (let index = 0; index < scopes.length; index++) {
    const clause = scopes[index];
    const inherited: boolean =
      previousNegative &&
      /^[，,]$/.test(clause.boundary) &&
      (elidedSubject.test(clause.text) || /^(?:不是|并非)$/.test(scopes[index - 1]?.text ?? ''));
    const negative: boolean = negator.test(clause.text) || inherited;
    const next = scopes[index + 1];
    const deniedAfterwards =
      next && !/[；;。！？\n]/.test(next.boundary) && retrospectiveDenial.test(next.text);
    if (clause.start < end && clause.end > start && (negative || deniedAfterwards)) return true;
    previousNegative = negative;
  }
  return false;
}
