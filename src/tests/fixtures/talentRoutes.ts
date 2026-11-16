import type { TalentId } from '../../domain/protagonist/talents';

/** Authored Mock examples from the approved logistics crisis, not generated results,
 * gameplay algorithms, production fallbacks or evidence of real model quality. */
export const talentRoutes: Record<TalentId, { route: string; narrative: string }> = {
  underworld_aura: { route: '地下人才接触意向', narrative: '既有地下运输联系人因你以往的办事名声提出推荐人才的求见意向，对方仍有自身利益。你尚未接受，也没有新增部下或忠诚关系。' },
  cyber_tyrant: { route: 'AI调度软件核心方案', narrative: '你独自理清了通常需要专业团队处理的数字调度瓶颈，拟出 AI 调度算法的核心方案。尚无运行平台，访问权限与计算资源仍需取得。' },
  golden_edict: { route: '商业资本重组方案', narrative: '你以超常商业判断构建出可检验的债务重组与资本整合思路。交易价值仍需尽调，没有投资、收购或取得任何经济收益。' },
  power_hunter: { route: '机构决策权与联盟路径', narrative: '你迅速拆解机构的利益与决策结构，拟出争取决策权的联盟谈判路径。没有任职、获得授权或绕过正式程序。' },
  public_sovereign: { route: '公众议题传播方案', narrative: '你抓住公开讨论中分散群体的共同关切，拟出将其汇聚为公共议题的传播方案。尚未公开发声，也没有虚构支持率或改变个别人物好感。' },
  engineering_genius: { route: '实体设备与制造工艺方案', narrative: '你提出具有突破性的机械结构与制造工艺方案，能够为实体效率瓶颈提供新路线。仍需材料、设备、资金和实验验证，没有凭空制造设备或取得专利。' },
  tactical_mastermind: { route: '人员时间资源协同战术', narrative: '你将人员、时间窗口与有限资源组织成高质量危机处置战术，发现可形成局部优势的协同顺序。没有预知秘密，也没有替任何人下令执行。' },
  desperate_gambler: { route: '未主动押注，不套用豪赌优势', narrative: '你没有主动押注，现有行动也没有付出重大筹码或明确的失败代价。本轮不套用逆命豪赌优势，继续普通资料核对，不凭危险措辞安排意外翻盘。' },
};
