/** Fictional event, shared by protocol and browser tests; no player data. */
export const experiencedMemory = '10月18日工作室准备交付修复后的旧相机时，委托方提出此前没有约定的加急费用。自己在场核对了原始清单，指出清单只列维修项目，并请主角先保留交接凭据、不要仓促承诺。主角翻出往来的书面确认后，对方同意暂缓收费，双方约好次日重新核算。\n这次争议没有解决最终费用，但自己发现主角愿意认真核实而不是推卸责任，因此更愿意继续协作；仍需留意次日核算结果，不能把暂缓收费当成已经免除费用。';
export const reportedMemory = '自己没有参加工作室的费用交涉，傍晚收到林澄发来的消息，得知委托方暂缓收取争议中的加急费用，双方约好次日核算。自己只知道林澄转述的经过，没有见过交接凭据，也不能确认最终应付金额。计划等核算结果出来后再安排后续维修，不把这份消息当成费用已经免除。';
export const suspectedMemory = '自己核对清单时发现加急费用的口径与先前沟通不同，怀疑对方内部交接遗漏了维修约定，但尚未核实原因。暂时保留原始材料，等待次日共同核算，不能据此认定任何人故意欺骗。';
export const qualityStory = `【旁白】${experiencedMemory}\n【林澄】“我们明天一起核对原始清单。”\n【旁白】许岸亲历了交涉，并对费用口径的变化产生尚待核实的猜测；傍晚林澄把暂缓收费的消息发给不在场的周闻。`;
export function qualityVariables() {
  return `<thinking>记录不同人物的经历和认知，不改变未确定的结果。</thinking><说明></说明><命令>\n${[
    ['person', experiencedMemory, 'observed', '本人亲历交付交涉', 'npc_private'],
    ['special', suspectedMemory, 'suspected', '本人核对清单后形成的未证实判断', 'internal'],
  ].map(([id, text, knowledgeKind, knowledgeSource, visibility]) => `push npc[${id}].memories = ${JSON.stringify({ text, knowledgeKind, knowledgeSource, visibility })}`).join('\n')}\n</命令>`;
}
