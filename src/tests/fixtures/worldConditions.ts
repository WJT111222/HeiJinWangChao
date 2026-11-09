import { WorldResultSchema } from '../../domain/drafts';
import { teahouse } from './teahouse';

/** Synthetic equivalent of a blocked errand alongside an ongoing scene discussion.
 * Reuses only PR72's fictional exhibition fixture, never player names or conversation.
 */
export function worldConditions() {
  const a = teahouse(), response = WorldResultSchema.parse(a.response);
  const task = response.taskCommands[0], event = response.eventCommands[0];
  if (task.type !== 'SaveTask' || event.type !== 'SaveEvent') throw Error('fixture command types');
  task.task.status = 'blocked';
  task.task.prerequisites = ['核对展台标识清单'];
  task.task.blockers = ['工坊值班员暂未到场'];
  event.event.prerequisites = ['各方核对展览安排'];
  event.event.blockers = ['展台标识尚未取回', '双方对布置方案仍有分歧'];
  return { ...a, response, task: task.task, event: event.event };
}
