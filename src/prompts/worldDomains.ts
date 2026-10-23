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
  // 自主行动可能新建相关组织/人物，不能仅凭当前正文没有类别词排除规则。
  // 九域原文体积有限；保守加载、一次世界请求，不增加 AI 分类请求。
  const domains = [
    ...new Set(
      promptManifest.modules
        .filter((module) => module.applicableStages.includes('world') && module.domain)
        .map((module) => module.domain)
        .filter((domain): domain is string => domain !== null),
    ),
  ];
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
  for (const command of commands) {
    const domain =
      command.type === 'CreateNpc'
        ? `npc_${command.npc.kind}`
        : command.type === 'UpdateNpc' || command.type === 'RecordNpcMemory' || command.type === 'RetireNpc'
          ? `npc_${state.npc[command.npcId]?.kind}`
          : command.type === 'CreateOrganization'
            ? organizationDomains[command.organization.kind]
            : command.type === 'RecordOrgRelation'
              ? organizationDomains[state.organizations[command.organizationId]?.kind]
              : undefined;
    if (domain && !domains.includes(domain)) throw new AiError('permission');
  }
}
