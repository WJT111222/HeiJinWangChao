import { freeze } from './snapshot';

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
