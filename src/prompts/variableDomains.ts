import { promptManifest } from './manifest';
import type { GameState } from '../domain/state';
import type { TurnDraft } from '../domain/drafts';

// 不增加 AI 分类请求。固定九组中，主角/人物/物品/经济是现场安全底座；
// 组织按实体、关键词及指导选择，无法确定类别时四类一并加载。
export function selectVariableDomains(state: GameState, draft: TurnDraft) {
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
      promptManifest.modules.flatMap((m) => (m.domain && reasons.has(m.domain) ? [m.domain] : [])),
    ),
  ];
  return {
    domains,
    reasons: domains.map((domain) => ({ domain, reason: reasons.get(domain) ?? '保守覆盖' })),
  };
}
