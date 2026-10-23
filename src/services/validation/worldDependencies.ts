import type { DomainCommand } from '../../domain/commands';
import { WorldEvidenceSchema, requireWorld } from './worldEvidence';

// 仅排序具体来源依赖，不从自然语言猜测职责，也不把尚未验证的输出加入事实池。
export function orderWorldCommands(commands: readonly DomainCommand[]) {
  const key = (c: DomainCommand) => c.type === 'SaveTask' ? `task:${c.task.id}`
    : c.type === 'SaveEvent' ? `event:${c.event.id}` : c.type === 'CreateNpc' ? `npc:${c.npc.id}`
      : c.type === 'CreateOrganization' ? `org:${c.organization.id}` : undefined;
  const keyed = new Map(commands.flatMap((c) => key(c) ? [[key(c), c] as const] : []));
  const visited = new Set<DomainCommand>(), visiting = new Set<DomainCommand>(), result: DomainCommand[] = [];
  function visit(command: DomainCommand) {
    if (visited.has(command)) return;
    requireWorld(!visiting.has(command));
    visiting.add(command);
    let raw: unknown;
    try { raw = JSON.parse(command.evidence); } catch { requireWorld(false); }
    const checked = WorldEvidenceSchema.safeParse(raw);
    requireWorld(checked.success);
    const dependencies = [...checked.data.sources];
    if (command.type === 'SaveTask' || command.type === 'SaveEvent') {
      const work = command.type === 'SaveTask' ? command.task : command.event;
      for (const ref of [...work.prerequisites, ...work.blockers]) {
        const normalized = keyed.has(ref) ? ref : keyed.has(`task:${ref}`) ? `task:${ref}` : `event:${ref}`;
        dependencies.push(normalized);
      }
    }
    if (command.type === 'SaveTask' && command.task.handoff) dependencies.push(`task:${command.task.handoff.fromTaskId}`);
    for (const source of dependencies) {
      const lookup = source.startsWith('handoff:') ? `task:${source.slice(8)}`
        : source.startsWith('task-plan:') ? `task:${source.slice(10)}`
          : source.startsWith('task-result:') ? `task:${source.slice(12)}` : source;
      const prior = keyed.get(lookup);
      if (prior && prior !== command) visit(prior);
      // task:<self> 可引用旧正式任务；新建任务自证会在来源查找中被拒绝。
      if (prior === command && source.startsWith('handoff:')) requireWorld(false);
    }
    visiting.delete(command); visited.add(command); result.push(command);
  }
  for (const command of commands.filter((c) => c.type !== 'RetireNpc')) visit(command);
  for (const command of commands.filter((c) => c.type === 'RetireNpc')) visit(command);
  return result;
}
