import { z } from 'zod';
import type { GameState } from '../state';
import { eventById, terminalEvent } from './lifecycle';

/** Only completes the inverse of an explicitly stored ID edge, on the transaction's cloned state.
 * No entity, action, timestamp or outcome is inferred. Conflicting edges never pick a winner.
 */
export function completeTaskEventLinks(before: GameState, after: GameState) {
  function fail(path: (string | number)[], rule: 'task_event_link' | 'task_event_reference' | 'task_state' | 'event_transition'): never {
    throw new z.ZodError([{ code: 'custom', path, message: '任务与事件关联不合法', params: { integrityRule: rule } }]);
  }
  for (const [table, events] of [['events', after.events], ['retiredEvents', after.retiredEvents]] as const) {
    for (const event of Object.values(events)) event.linkedTaskIds.forEach((id: string, index: number) => {
      const path = [table, event.id, 'linkedTaskIds', index], task = after.tasks[id];
      if (!task) fail(path, 'task_event_reference');
      if (task.linkedEventId && task.linkedEventId !== event.id) fail(path, 'task_event_link');
      if (!task.linkedEventId) {
        if (before.tasks[id] && ['completed', 'cancelled'].includes(before.tasks[id].status)) fail(path, 'task_state');
        task.linkedEventId = event.id;
      }
    });
  }
  for (const task of Object.values(after.tasks)) {
    if (!task.linkedEventId) continue;
    const path = ['tasks', task.id, 'linkedEventId'], event = eventById(after, task.linkedEventId);
    if (!event) fail(path, 'task_event_reference');
    if (!event.linkedTaskIds.includes(task.id)) {
      const old = eventById(before, event.id);
      if (old && terminalEvent(old)) fail(path, 'event_transition');
      event.linkedTaskIds.push(task.id);
    }
  }
}
