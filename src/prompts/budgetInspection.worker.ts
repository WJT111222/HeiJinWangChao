import { inspectBudget } from './budgetInspection';
import type { AiMessage } from '../services/ai/protocols';

// This module runs only in a dedicated Worker, never as a main-thread fallback.
self.onmessage = (event: MessageEvent<readonly AiMessage[]>) => {
  try { self.postMessage({ ok: true, result: inspectBudget(event.data) }); }
  catch { self.postMessage({ ok: false }); }
};
