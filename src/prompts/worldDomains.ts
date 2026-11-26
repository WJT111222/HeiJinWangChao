import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';
import type { DomainCommand } from '../domain/commands';
import { promptManifest } from './manifest';
import { AiError } from '../services/ai/errors';

const organizationDomains = {
  gang: 'org_gang',
  government: 'org_government',
  civil: 'org_civil',
  business: 'org_business',
};
export function selectWorldDomains(state: GameState, draft: TurnDraft) {
  const kinds = new Set(Object.values(state.organizations).map(org => organizationDomains[org.kind]));
  const domains = [...new Set(promptManifest.modules.flatMap(module =>
    module.applicableStages.includes('world') && module.domain && (!module.domain.startsWith('org_') || kinds.has(module.domain))
      ? [module.domain] : []))];
  return {
    domains,
    reasons: domains.map((domain) => ({
      domain,
      reason: `${draft.turnKind} 场外规则安全覆盖；已有场外人物 ${Object.values(state.npc).filter((npc) => !npc.onScene).length} 名，允许有依据的新行动`,
    })),
  };
}
export function assertWorldCoverage(
  domains: readonly string[],
  state: GameState,
  commands: readonly DomainCommand[],
) {
  // A valid World batch can create an offscreen NPC and then record its memory.
  const createdKinds = new Map(commands.flatMap(command => command.type === 'CreateNpc' ? [[command.npc.id, command.npc.kind] as const] : []));
  for (const command of commands) {
    const domain =
      command.type === 'CreateNpc'
        ? `npc_${command.npc.kind}`
        : command.type === 'UpdateNpc' || command.type === 'RecordNpcMemory'
          ? `npc_${state.npc[command.npcId]?.kind ?? createdKinds.get(command.npcId)}`
          : command.type === 'CreateOrganization'
            ? undefined // Creation has its own complete schema, including previously absent organization kinds.
            : command.type === 'RecordOrgRelation' || command.type === 'UpdateOrganization'
              ? organizationDomains[state.organizations[command.organizationId]?.kind]
              : undefined;
    if (domain && !domains.includes(domain)) throw new AiError('permission');
  }
}
