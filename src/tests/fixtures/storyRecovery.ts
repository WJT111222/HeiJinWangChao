// Fictional reconstruction of the reported DeepSeek output STRUCTURE, not a
// transcript from a player's save or a claim to reproduce private model text.
export const recoveryPlanning = Array.from({ length: 16 }, (_, i) =>
  `### Step ${i}｜规划独有标记${i}\n- 依据已有场景保持人物、时间及信息边界。\n- 不把计划当作已发生事实。\n- 先核对本轮输入，再确定叙事取舍。`).join('\n\n');
export const recoveryTransition = '现在按照这些规划写正文，保证层次完整。';
export const recoveryNarrative = '【旁白】站台边的雨声渐渐小了，林舟把笔记本放在膝上，重新看了一遍已经记下的事项。\n'
  + '【林舟】先把手边这一页核对清楚。\n'
  + '【旁白】他沿着纸面逐行检查，没有替尚未发生的事写下结论。路灯照着被雨水打湿的地面，远处有人收起雨伞走向车站。'
  + '他没有离开当前位置，也没有支出资金，只把笔停在需要继续确认的一行旁边。眼前的场景仍然安静，接下来做什么，等待玩家决定。';
export const recoverySummary = '林舟留在原处核对笔记，暂未离开、消费或作出新的决定。';
export const recoveryGuide = [{ group: 'protagonist', subjectHint: 'emotionText', observedFact: '林舟留在原处核对笔记。', textEvidence: '先把手边这一页核对清楚。' }];
export const recoveryActions = ['继续核对笔记', '看看站台周围', '留在原地等候'];
export const recoveryTail = `<短期记忆>${recoverySummary}</短期记忆><变量规划>${JSON.stringify(recoveryGuide)}</变量规划><行动选项>${recoveryActions.join('\n')}</行动选项>`;
export const deepSeekUntagged = `${recoveryPlanning}\n\n${recoveryTransition}\n\n${recoveryNarrative}\n${recoveryTail}`;

// Review-reported layout: the instruction contains one narrator label, then
// its full stop is immediately followed by the actual narrator on the SAME line.
// All text is fictional; the long prose is supplied by the mock, never padding
// inserted by the production recovery function.
export const inlineRecoveryTransition = '现在按照这些规划写正文，保证层次完整，段落以【旁白】和【角色名】标签呈现，并控制字数不低于1500。';
export const inlineRecoveryNarrative = Array.from({ length: 9 }, () => recoveryNarrative).join('\n\n');
export function inlineRecoveryOutput(narrative = inlineRecoveryNarrative, transition = inlineRecoveryTransition) {
  return `${recoveryPlanning}\n\n${transition}${narrative}\n${recoveryTail}`;
}
