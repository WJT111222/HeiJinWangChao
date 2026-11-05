import { isNegatedFact } from '../../domain/factPolarity';

type FactRule = 'fact_plan' | 'fact_uncertainty' | 'fact_negated';
const uncertainty = /可能|或许|声称|自称|谎称|听说|据说|传闻|据传|猜测/;
const prospective = /打算|将要|即将|如果|假如|假设/;
// 有限的谓词/宾语规则，不是事实真实性证明器。只识别已有词法保护中的歧义词。
// “执行整改计划”“启动检查准备工作”描述执行动作；“计划下周整改”描述未来意图。
const action = '(?:进行|开展|启动|执行|落实|编制|制定|调整|更新|完善|检查|排查|核查|整理|完成|开始)';
const governor = new RegExp(`${action}(?:了|着)?[^，,。！？；;\\n]{0,48}$`);
// 目的谓词不是执行谓词；保障部门/人员/工作等名词仍需其自身的实际动作。
const goalPredicate = /力保|确保|保障/;
const nominalHead = /^(?:部门|人员|工作|体系|机制|制度|系统|设施)/;
const execution = new RegExp(`(?:(?:正在|已经|现已|已|正)(?:在[^，,。！？；;\\n]{0,12})?|在[^，,。！？；;\\n]{0,12})${action}|${action}(?:了|着)`);
const elidedGoalSubject = /^(?:以便|以|并且|并|从而)?$/;
const goalConnector = /(?:以便|以|并且|并|从而)$/;
const objectEnd = /^(?:工作|事项|材料|方案|书|表|清单|阶段|流程|任务|活动|进度|内容|终止时间|结束时间|完成时间|日期|耗时|成本)?(?:了|中)?$/;
const subjectPredicate = /^(?:(?:工作|事项|方案)(?:已经|现已|已|正在|正)?|(?:已经|现已|已|正在|正))(?:落实到位|完成|启动|开始|执行|推进|结束)(?:了|中|完毕)?$/;

export function derivedFactRule(text: string, affirmedTermination = false): FactRule | undefined {
  for (const sentence of text.split(/[。！？；;\n]/)) {
    let precedingExecution = false;
    for (const part of sentence.split(/[，,]/)) {
      const clause = part.trim();
      if (!clause) { precedingExecution = false; continue; }
      if (uncertainty.test(clause)) return 'fact_uncertainty';
      if (prospective.test(clause)) return 'fact_plan';
      let factual = clause;
      const goal = goalPredicate.exec(clause);
      if (goal) {
        const prefix = clause.slice(0, goal.index).trim();
        const after = clause.slice(goal.index + goal[0].length);
        const nominalRole = goal[0] === '保障' && nominalHead.test(after) && execution.test(after);
        const activity = prefix.replace(goalConnector, '').trim();
        if (nominalRole) factual = clause;
        else if (activity.length <= 128 && execution.test(activity) && !isNegatedFact(activity)) factual = activity;
        else if (precedingExecution && elidedGoalSubject.test(prefix)) factual = '';
        else return 'fact_plan';
      }
      // 只把当前分句实际做了什么作为锚点；不跨句、不跨显式主体、不连续传递目标从句。
      precedingExecution = factual.length <= 128 && execution.test(factual) && !isNegatedFact(factual);
      for (const match of factual.matchAll(/准备|计划|预计/g)) {
        const before = factual.slice(0, match.index), after = factual.slice(match.index + match[0].length);
        const nominal = (governor.test(before) && objectEnd.test(after)) || subjectPredicate.test(after);
        if (!nominal) return 'fact_plan';
      }
      // 日期词本身也可能只是已执行动作的宾语，例如“正在整理明天的资料”。
      for (const match of factual.matchAll(/明天|后天|下(?:周|个月|月|季度|年)/g)) {
        if (!governor.test(factual.slice(0, match.index))) return 'fact_plan';
      }
    }
  }
  // 沿用既有分句否定范围与“未能完成，行动已终止”的明确终止例外。
  if (!affirmedTermination && isNegatedFact(text)) return 'fact_negated';
}
