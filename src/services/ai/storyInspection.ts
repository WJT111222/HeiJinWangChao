import { estimateTokens } from '../../prompts/statistics';
import { freeze } from './snapshot';

export function storyBudget(maxOutputTokens: number | undefined, minNarrativeChars: number, mode: 'opening' | 'regular') {
  // 仅规模提示，不是供应商tokenizer/计费，也不阻止或更改用户的输出上限。
  const estimatedTokens = estimateTokens('文'.repeat(minNarrativeChars)).estimatedTokens + (mode === 'opening' ? 1800 : 3000) + 600;
  return { maxOutputTokens, estimatedTokens, warning: maxOutputTokens === undefined
    ? '输出上限未提供；规划、正文和供应商原生思考可能共享预算。'
    : maxOutputTokens < estimatedTokens ? '当前输出上限可能不足以容纳完整规划和正文；程序不会自动提高预算。' : undefined };
}
export interface StoryInspection {
  id: string;
  saveId: string;
  turnId: string;
  baseSaveRevision: number;
  basedOnStoryRevision: number;
  status: 'generating' | 'saved' | 'failed';
  planning: string;
  nativeReasoning: string;
  activity?: 'content' | 'reasoning';
  budget: ReturnType<typeof storyBudget>;
}
// 只保留本页面最近四次临时请求，受客户端单次输出上限约束；无Storage/IDB通道。刷新、clear或淘汰即清除。
class StoryInspectionStore {
  private records: readonly StoryInspection[] = [];
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  getSnapshot = () => this.records;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify = () => { clearTimeout(this.timer); this.timer = undefined; this.listeners.forEach((listener) => listener()); };
  clear = () => { this.records = []; this.notify(); };
  begin(value: Omit<StoryInspection, 'id' | 'status' | 'planning' | 'nativeReasoning'>) {
    const item = { ...value, id: crypto.randomUUID(), status: 'generating' as const, planning: '', nativeReasoning: '' };
    this.records = [freeze(item), ...this.records.filter((old) => old.saveId !== value.saveId || old.turnId !== value.turnId)].slice(0, 4);
    this.notify(); return item.id;
  }
  update(id: string, changes: Partial<Pick<StoryInspection, 'planning' | 'nativeReasoning' | 'activity' | 'status'>>) {
    this.records = this.records.map((item) => item.id === id && item.status === 'generating' ? freeze({ ...item, ...changes }) : item);
    if (changes.status) this.notify();
    else if (!this.timer) this.timer = setTimeout(this.notify, 50);
  }
}
export const storyInspections = new StoryInspectionStore();
