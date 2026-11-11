import { GameStateSchema } from '../../domain/state';
import type { DomainCommand } from '../../domain/commands';
import { npcRosterState } from './npcRoster';
import { organizations } from './game';

/** Synthetic social world. No player session or inferred NPC identity. */
export function organizationState(extra = 0) {
  const state = npcRosterState();
  state.title = '势力档案馆测试';
  const names = ['霁川同盟', '江岸公共事务处', '旧城互助会', '澄川工贸'];
  organizations.forEach((template, i) => {
    const org = { ...structuredClone(template), id: `org-${template.kind}`, name: names[i], description: `${names[i]}的既有背景与当前工作。`,
      protagonistRelation: '闻所未闻', relationHistory: [], keyNpcIds: [], currentTaskIds: [] };
    state.organizations[org.id] = org;
  });
  state.organizations['org-business'] = { ...state.organizations['org-business'],
    ...{sectors:['机械制造','维修服务'],operatingStatus:'经营稳定，正在推进业务整合',ownershipText:'独立经营主体，按已确认的股权安排运行'},
    description: '位于沿江地区的制造企业。'+ '专注机械维修、零件制造与稳定的社区合作。'.repeat(30),
    leadership: [{position:'董事长',publicName:'顾行远',description:'公开登记负责人'}, {position:'实际控制人',publicName:null},
      {position:'项目顾问',publicName:'林澄',npcId:'person',description:'已确认参与该企业项目管理'}], keyNpcIds:['person'],
    relations:[{organizationId:'org-civil',relation:'长期支持',description:'支持公益维修活动，但不参与协会日常决策。'}],
  };
  state.organizations['org-civil'].keyNpcIds = ['person'];
  for (let i = 0; i < extra; i++) state.organizations[`fixture-org-${i}`] = { ...structuredClone(state.organizations['org-business']), id:`fixture-org-${i}`,name:`虚构企业${String(i).padStart(4,'0')}`,leadership:[],relations:[],keyNpcIds:[] };
  return GameStateSchema.parse(state);
}
export function organizationUpdate(organizationId = 'org-business', changes: Extract<DomainCommand,{type:'UpdateOrganization'}>['changes'] = { operatingStatus:'完成新业务整合，维修业务保持运行' }, expectedRevision = 10): Extract<DomainCommand,{type:'UpdateOrganization'}> {
  return { type:'UpdateOrganization',commandId:'update-business',evidence:'本轮正式发展结果',organizationId,expectedRevision,changes };
}
export function organizationWorld(worldCommands: DomainCommand[] = []) {
  return { worldCommands,taskCommands:[] as DomainCommand[],eventCommands:[] as DomainCommand[],visibleHooks:[],unresolved:[] };
}

export function organizationArchiveState(extra = 0) {
  const state = organizationState(extra), now=state.worldClock;
  const base={eventKind:'main' as const,startAt:now,estimatedEndAt:new Date(Date.parse(now)+3600000).toISOString(),actorRefs:[{kind:'organization' as const,id:'org-business'}],linkedTaskIds:[],prerequisites:[],blockers:[],visibility:'hidden' as const,impact:'significant' as const,sourceTurnIds:['roster-turn-0'],backgroundText:'正式业务整合安排',goalText:'完成业务交接'};
  state.events['org-active']={...base,id:'org-active',title:'业务整合与新车间交接',status:'active'};
  state.events['org-ended']={...base,id:'org-ended',title:'此前设备更新',status:'resolved',resolvedAt:now,outcome:'success',resolutionText:'设备更新已经完成，维护安排继续。'};
  const task={actorRef:{kind:'organization' as const,id:'org-business'},startAt:now,dueAt:new Date(Date.parse(now)+3600000).toISOString(),prerequisites:[],blockers:[]};
  state.tasks['org-work']={...task,id:'org-work',goal:'核对新车间交接清单',status:'active'};
  state.tasks['org-finished']={...task,id:'org-finished',goal:'已经完成的旧交接任务',status:'completed',resolution:{at:now,outcome:'success',result:'核对完成',reason:'正式结束',sourceTurnId:'roster-turn-0'}};
  state.organizations['org-business'].currentTaskIds=['org-work','org-finished'];
  return GameStateSchema.parse(state);
}
