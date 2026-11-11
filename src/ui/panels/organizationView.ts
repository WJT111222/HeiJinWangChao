import type { Organization } from '../../domain/organizations/schema';
import type { PlayerView } from './playerView';
import { eventArchive } from './eventArchive';

/** Explicit stable references only. Never infer membership from names/jobs. */
export function organizationNpcIds(org: Organization) {
  return [...new Set([...org.keyNpcIds, ...(org.leadership ?? []).flatMap(row => row.npcId ? [row.npcId] : [])])];
}
export function organizationDynamics(view: PlayerView, id: string) {
  const events = [...eventArchive(view).records.values()].filter(event => event.detail?.actorRefs.some(ref => ref.kind === 'organization' && ref.id === id));
  return {
    currentEvents: events.filter(e => !['resolved', 'cancelled'].includes(e.status)),
    endedEvents: events.filter(e => ['resolved', 'cancelled'].includes(e.status)),
    tasks: view.tasks.filter(task => task.actorRef.kind === 'organization' && task.actorRef.id === id && ['planned','active','blocked'].includes(task.status)),
  };
}
