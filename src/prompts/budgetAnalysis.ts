import type { AiMessage } from '../services/ai/protocols';
import type { inspectBudget } from './budgetInspection';

export type BudgetResult = ReturnType<typeof inspectBudget>;
export type AnalysisState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'complete'; result: BudgetResult }
  | { status: 'failed' | 'unavailable' };

// Weak keys keep completed safe diagnostics only while their session snapshot exists.
const cache = new WeakMap<readonly AiMessage[], BudgetAnalysis>();
const active = new Set<BudgetAnalysis>();
export function budgetAnalysis(messages: readonly AiMessage[]) {
  let analysis = cache.get(messages);
  if (!analysis) { analysis = new BudgetAnalysis(messages); cache.set(messages, analysis); }
  return analysis;
}
export function cancelBudgetAnalyses() { for (const analysis of active) analysis.cancel(); }

export class BudgetAnalysis {
  private state: AnalysisState = { status: 'idle' };
  private listeners = new Set<() => void>();
  private worker?: Worker;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private messages: readonly AiMessage[]) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: AnalysisState) { this.state = state; for (const listener of this.listeners) listener(); }
  private stop() {
    this.worker?.terminate(); this.worker = undefined;
    clearTimeout(this.timer); this.timer = undefined; active.delete(this);
  }
  cancel = () => { if (this.state.status === 'running') { this.stop(); this.publish({ status: 'idle' }); } };
  start = () => {
    if (this.state.status === 'running' || this.state.status === 'complete') return;
    if (typeof Worker === 'undefined') { this.publish({ status: 'unavailable' }); return; }
    try {
      const worker = new Worker(new URL('./budgetInspection.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker; active.add(this); this.publish({ status: 'running' });
      const fail = () => { if (this.worker !== worker) return; this.stop(); this.publish({ status: 'failed' }); };
      worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: BudgetResult }>) => {
        if (this.worker !== worker) return;
        if (!event.data.ok || !event.data.result) { fail(); return; }
        this.stop(); this.publish({ status: 'complete', result: event.data.result });
      };
      worker.onerror = fail; worker.onmessageerror = fail;
      this.timer = setTimeout(fail, 60_000);
      // Only already-safe final messages cross the worker boundary. No request or AI call.
      worker.postMessage(this.messages);
    } catch { this.stop(); this.publish({ status: 'unavailable' }); }
  };
}
