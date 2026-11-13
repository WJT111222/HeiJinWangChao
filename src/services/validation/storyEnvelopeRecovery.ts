/**
 * Narrow, display-independent recovery for a Story response that contains all
 * post-story blocks but omits BOTH <正文> delimiters.
 *
 * No prose, planning, memory, guide or action option is generated here.
 * An unlabeled planning preface is discarded only when the exact numbered
 * Step 0–15 sequence and explicit transition sentence make the boundary
 * unambiguous. The untouched response remains available as model raw text.
 *
 * This does NOT relax StorySchema, time, event, or atomic draft validation.
 */
export function recoverStoryEnvelope(text: string, actions: boolean): string | undefined {
  const source = text.trim();
  if (!source || /<\s*\/?\s*正文\s*>/u.test(source)) return undefined;

  const tailPattern = actions
    ? /<短期记忆>[\s\S]*?<\/短期记忆>\s*<变量规划>[\s\S]*?<\/变量规划>\s*<行动选项>[\s\S]*?<\/行动选项>\s*$/u
    : /<短期记忆>[\s\S]*?<\/短期记忆>\s*<变量规划>[\s\S]*?<\/变量规划>\s*$/u;
  const tail = tailPattern.exec(source);
  if (!tail) return undefined;

  const prefix = source.slice(0, tail.index).trim();
  let beforeBody = prefix;
  let wrappedPlanning = '';
  const plan = /^<thinking>[\s\S]*?<\/thinking>\s*/u.exec(beforeBody);
  if (plan) {
    wrappedPlanning = plan[0].trim();
    beforeBody = beforeBody.slice(plan[0].length).trim();
  } else if (/<\s*\/?\s*thinking\s*>/u.test(beforeBody)) {
    return undefined; // Broken planning is never silently repaired or discarded.
  }

  // No ambiguous structural markup is permitted in the untagged region.
  if (/<\s*\/?\s*(?:thinking|think|正文|短期记忆|变量规划|行动选项|judge)\s*>/u.test(beforeBody))
    return undefined;

  // Project prose has an explicit narrator marker, unlike a free-form Step plan.
  const marker = /(?:^|\r?\n)[ \t]*【旁白】/u.exec(beforeBody);
  if (!marker) return undefined;
  const preface = beforeBody.slice(0, marker.index).trim();
  const narrative = beforeBody.slice(marker.index).trim();
  if (!narrative.startsWith('【旁白】') || /(?:^|\r?\n)\s*Step\s+\d/u.test(narrative))
    return undefined;

  if (preface) {
    // A numbered preface plus an already wrapped planning block would be
    // ambiguous; do not guess which text belongs to which section.
    if (wrappedPlanning) return undefined;
    const steps = [...preface.matchAll(/(?:^|\r?\n)\s*Step\s+(\d{1,2})\s*[｜|]/giu)];
    if (steps.length !== 16 || steps[0].index !== 0 || steps.some((step, i) => Number(step[1]) !== i))
      return undefined;
    const finalLine = preface.split(/\r?\n/u).filter(Boolean).at(-1)?.trim() ?? '';
    if (!/^现在按照这些规划写正文(?:[，,:：\s]|$)/u.test(finalLine))
      return undefined;
  }

  return `${wrappedPlanning ? wrappedPlanning + '\n' : ''}<正文>${narrative}</正文>\n${tail[0].trim()}`;
}
