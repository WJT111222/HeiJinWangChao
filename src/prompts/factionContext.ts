import type { GameState } from '../domain/state';

import type { AiStage } from '../services/ai/configuration';

// 按需加载：只有主角已绑定主势力时才注入，未绑定时各阶段零增量。
const policies: Record<AiStage, string> = {
  story: '主角以此身份行事，势力既是靠山也是约束；组织不替主角做决定，主角也不会自动知道组织秘密。',
  entities: '复用已有势力与成员 ID。新组织用 CreateOrganization 建档，主角的职位、绑定和已知信息留给主角与现场阶段。',
  variables: '主势力只有一个。剧情明确改变职位、部门或关系说明时，用protagonistRelation的faction.update；剧情中主角明确退出、被逐出且本人已得知，或势力覆灭且主角已得知时，用faction.unbind；改投其他组织直接对新组织bind，旧绑定自动解除。主角在剧情里真实得知该势力的据点、产业或内情时，push organizations[id].protagonistKnown逐条记录，不抄组织档案里主角不知道的秘密。该势力公开信息仍空缺的项（范围、实力、资金/经费、主要业务、名声等）按剧情与设定用state补齐；部门departments与成员members只收已建档人物，按实际变化更新；卧底、暗桩等暗中身份的成员标covert=true。',
  world: '主势力绑定和主角已知列表由Variables负责，World不写faction、不写protagonistKnown。World可按后台实际变化更新该势力的部门、成员和公开字段；势力覆灭、开除决定等只推进组织与事件本身，绑定保留到主角在剧情里得知。需要主角拍板的事照旧发起等待主角处理的事件。',
};

/** 主角主势力摘要；SAVE_STATE.protagonistFaction 是权威来源，这里只补可读名称与本阶段边界。 */
export function factionContext(state: GameState, stage: AiStage) {
  const faction = state.protagonistFaction;
  const org = faction && state.organizations[faction.organizationId];
  if (!faction || !org) return undefined;
  const department = faction.departmentId ? org.departments?.find(row => row.id === faction.departmentId)?.name : undefined;
  return {
    organizationId: org.id, name: org.name, kind: org.kind, position: faction.position,
    ...(department ? { department } : {}), joinedAt: faction.joinedAt, bondText: faction.bondText,
    policy: policies[stage],
  };
}
