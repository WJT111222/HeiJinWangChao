import type { DomainCommand } from '../../domain/commands';
import { requireWorld } from './worldDiagnostics';

// 只排序结构化实体依赖；保留无依赖命令的原始顺序。
export function orderWorldCommands(commands: readonly DomainCommand[]) {
  const cleanup = (c: DomainCommand) => c.type === 'DeleteEvent';
  const key = (c: DomainCommand) => c.type === 'RecordHistory' ? `history:${c.entry.id}` : cleanup(c) && 'eventId' in c ? `cleanup:${c.eventId}` : c.type === 'SaveTask' ? `task:${c.task.id}`
    : c.type === 'SaveEvent' ? `event:${c.event.id}` : c.type === 'CreateNpc' ? `npc:${c.npc.id}`
      : c.type === 'CreateOrganization' ? `org:${c.organization.id}` : undefined;
  const keyed = new Map(commands.flatMap((c) => key(c) ? [[key(c), c] as const] : []));
  const visited = new Set<DomainCommand>(), visiting = new Set<DomainCommand>(), result: DomainCommand[] = [];
  function visit(command: DomainCommand) {
    if (visited.has(command)) return;
    requireWorld(!visiting.has(command));
    visiting.add(command);
    const dependencies: string[] = [];
    if (cleanup(command) && 'eventId' in command) dependencies.push(`event:${command.eventId}`);
    if (command.type === 'SaveEvent') dependencies.push(...(command.event.predecessorEventIds??[]).map(id=>`event:${id}`));
    // prerequisites/blockers are narrative text, even when a string resembles an ID.
    if (command.type === 'RecordHistory') {
      if (command.entry.eventId) dependencies.push(`event:${command.entry.eventId}`);
    }
    if (command.type === 'SaveTask' && command.task.handoff) dependencies.push(`task:${command.task.handoff.fromTaskId}`);
    if (command.type === 'SaveTask') dependencies.push(`${command.task.actorRef.kind === 'organization' ? 'org' : 'npc'}:${command.task.actorRef.id}`);
    if (command.type === 'SaveEvent') for (const ref of command.event.actorRefs) dependencies.push(`${ref.kind === 'organization' ? 'org' : 'npc'}:${ref.id}`);
    for (const source of dependencies) {
      const prior = keyed.get(source);
      if (prior && prior !== command) visit(prior);
      requireWorld(prior !== command);
    }
    visiting.delete(command); visited.add(command); result.push(command);
  }
  for (const command of commands.filter(c => c.type !== 'RetireNpc' && !cleanup(c))) visit(command);
  for (const command of commands.filter(cleanup)) visit(command);
  for (const command of commands.filter((c) => c.type === 'RetireNpc')) visit(command);
  return result;
}
