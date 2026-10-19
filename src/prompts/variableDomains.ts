import { AiError } from '../services/ai/errors';
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
  const text = draft.story?.narrative ?? '';
  const guide = draft.story?.variableGuide ?? [];
  const kinds = {
    gang: 'org_gang',
    government: 'org_government',
    civil: 'org_civil',
    business: 'org_business',
  };
  for (const org of Object.values(state.organizations))
    if (
      text.includes(org.name) ||
      text.includes(org.id) ||
      guide.some((g) => g.subjectHint === org.id)
    )
      add(kinds[org.kind], `已有组织 ${org.id} 在正文/指导中出现`);
  const hints: [string, RegExp][] = [
    ['org_gang', /黑帮|帮派|地下组织|地盘/],
    ['org_government', /警方|警察|派出所|法院|政府|检察|机关/],
    ['org_civil', /协会|社区|志愿|工会|公益|社团/],
    ['org_business', /公司|企业|集团|雇主|商户|商场|银行/],
  ];
  for (const [domain, pattern] of hints)
    if (pattern.test(text)) add(domain, '正文出现组织类别线索');
  // 新组织可能没有类别词；语义无法排除时保守覆盖全部四类，不能只信 variableGuide。
  if (
    draft.turnKind === 'opening' ||
    draft.failures.some(
      (failure) =>
        failure.stage === 'variables' &&
        failure.storyRevision === draft.storyRevision &&
        failure.errorCode === 'permission',
    ) ||
    guide.some((g) => g.group === 'organization') ||
    /组织|势力|机构|单位|他们|部门|负责人/.test(text) ||
    ![...reasons.keys()].some((d) => d.startsWith('org_'))
  )
    for (const domain of Object.values(kinds))
      if (!reasons.has(domain)) add(domain, '组织类别不确定，保守覆盖');
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

export function assertVariableCoverage(
  domains: readonly string[],
  state: GameState,
  commands: readonly import('../domain/commands').DomainCommand[],
) {
  for (const command of commands) {
    const kind =
      command.type === 'CreateOrganization'
        ? command.organization.kind
        : command.type === 'RecordOrgRelation'
          ? state.organizations[command.organizationId]?.kind
          : undefined;
    if (
      kind &&
      !domains.includes(
        {
          gang: 'org_gang',
          government: 'org_government',
          civil: 'org_civil',
          business: 'org_business',
        }[kind],
      )
    )
      throw new AiError('permission');
  }
}
