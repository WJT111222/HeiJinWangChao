import { promptManifest } from './manifest';
import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';

// 基础模块按职责选择。组织类型来自正式存档和已启用的上游建档候选。
export function selectVariableDomains(state: GameState, draft: TurnDraft, stage?: 'entities' | 'variables') {
  const reasons = new Map<string, string>();
  const add = (domain: string, reason: string) => reasons.set(domain, reason);
  for (const domain of ['protagonist', 'npc_ordinary', 'npc_special', 'items', 'economy'])
    add(domain, '现场基础覆盖：指导可能遗漏人物、消费、物品与时间地点事实');
  const organizations = [
    ...Object.values(state.organizations),
    ...(draft.entities?.result.commands ?? []).flatMap(command =>
      command.type === 'CreateOrganization' ? [command.organization] : []),
  ];
  for (const org of organizations) add('org_' + org.kind, '存档或前段候选包含该类组织');
  const domains = [
    ...new Set(
      promptManifest.modules.flatMap((m) => (m.domain && reasons.has(m.domain) && (!stage || m.applicableStages.includes(stage)) ? [m.domain] : [])),
    ),
  ];
  return {
    domains,
    reasons: domains.map((domain) => ({ domain, reason: reasons.get(domain) ?? '保守覆盖' })),
  };
}
