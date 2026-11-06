import { StoredWorldEventSchema, WorldEventSchema } from '../../domain/events/schema';
import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import { WorldResultSchema } from '../../domain/drafts';
import type { AiStage } from '../ai/configuration';
export const worldTypes = [
  'CreateNpc',
  'UpdateNpc',
  'RecordNpcMemory',
  'CreateLocation',
  'CreateOrganization',
  'RecordOrgRelation',
  'RetireNpc',
] as const;
export function commandCatalog(stage: Exclude<AiStage, 'story'>) {
  const options = DomainCommandSchema.options.filter(
    (option) =>
      (stage === 'variables' && !['RetireNpc','DeleteEvent','ArchiveEvent'].includes(option.shape.type.value)) ||
      (stage === 'world' && [...worldTypes, 'SaveTask', 'SaveEvent','DeleteEvent','ArchiveEvent'].includes(option.shape.type.value)),
  );
  return {
    currencyUnit: 'CNY_FEN_INTEGER',
    commandTypes: options.map((option) => option.shape.type.value),
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      oneOf: options.map((option) => {
        const schema=z.toJSONSchema(option.shape.type.value==='SaveEvent' ? option.extend({event:z.union([WorldEventSchema,StoredWorldEventSchema.extend({status:z.enum(['resolved','cancelled'])})])}) : option, { target: 'draft-7', unrepresentable: 'any' });
        if(option.shape.type.value==='SaveTask') {
          const task=schema.properties?.task;
          if(task && typeof task==='object')task.anyOf=[{required:['dueAt']},{required:['completionCondition'],properties:{completionCondition:{type:'string',pattern:'\\S'}}}];
        }
        if (stage === 'world' && option.shape.type.value === 'CreateOrganization') {
          const organization = schema.properties?.organization;
          if (organization && typeof organization === 'object') {
            for (const variant of organization.oneOf ?? organization.anyOf ?? [organization]) {
              if (typeof variant !== 'object' || !variant.properties) continue;
              const history = variant.properties.relationHistory;
              if (history && typeof history === 'object') history.maxItems = 0;
              // 仅描述既有 World 创建权限，不改变正式 OrganizationSchema。
              for (const field of ['funds', 'assetsEstimate', 'liquidityEstimate'])
                if (field in variant.properties) variant.properties[field] = false;
            }
          }
        }
        return schema;
      }),
    },
    stagePermissions:
      stage === 'variables'
        ? '只提议正文已成立的现场结果；新 NPC 必须实际在场。'
        : {
            worldCommands: worldTypes,
            taskCommands: ['SaveTask'],
            eventCommands: ['SaveEvent','DeleteEvent','ArchiveEvent'],
            actorBoundary: '只自主推进场外NPC/组织；SaveEvent以稳定ID记录事件参与者，不执行参与者动作。引用参与者不是后台行动授权。禁止主角交易、现场重复行动、独立推进时钟。',
          },
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      stage === 'world'
        ? 'evidence为非执行的简洁说明，可自然概括；程序不解析证据JSON或审批叙述事实。'
        : 'evidence为简洁来源说明，可概括而不必逐字引用或包含关键词；金额为整数人民币分，price/amount等正值限制以Schema为准。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。RegisterContact仅变量阶段据实际交换联系方式登记，不可撤销保护；RetireNpc仅世界阶段提议，联系人、同伴、现场和有未完职责/当前资产引用者不能删除。',
      'Schema描述严格结构；程序校验权限、引用、归属、金额、时间、版本与幂等。剧情及世界演化由AI判断。角色知识按人物提供，命令仅写指定对象，不自动传播。',
      '遵守TURN_TIME_POLICY：待定开局由程序统一应用Story结构化时钟，变量无需重复SetWorldClock。普通回合按实际行动估时，可零耗时，不固定步长，不要求正文时间词；禁止日期非法或倒退。有效HISTORICAL_PERSPECTIVE不更新当前变量或推演世界。',
    ],
    ...(stage === 'world'
      ? {
          // 顶层输出不是存档投影：从真实 Schema 生成易混淆的数组值形状。
          outputFields: {
            worldCommands: { type: 'array', commandTypes: worldTypes },
            taskCommands: { type: 'array', commandTypes: ['SaveTask'] },
            eventCommands: { type: 'array', commandTypes: ['SaveEvent', 'DeleteEvent', 'ArchiveEvent'] },
            futureEvents: { type: 'array', description: '同批新 scheduled SaveEvent.event 的完整相同对象；无符合项则 []' },
            ...Object.fromEntries((['visibleHooks', 'timelineCandidates', 'unresolved'] as const).map(field =>
              [field, z.toJSONSchema(WorldResultSchema.shape[field], { target: 'draft-7', unrepresentable: 'any' })])),
          },
          worldStateRules: [
            'timelineCandidates是事件ID字符串数组，例如["event_major_closed"]；ID须引用投影中impact=major、已resolved/cancelled且有实际resolvedAt的事件。significant/minor或未结案不符合；无符合项输出[]。不输出时间线对象、标题、日期或新编历史。',
            'World创建组织时relationHistory=[]，不要复制存档中的历史数组。确需记录关系变化时另用RecordOrgRelation。gang不填funds；business不填assetsEstimate/liquidityEstimate（也不填null）。创建命令不是资产入账或历史追加。',
            '新事件必须提供startAt、estimatedEndAt、backgroundText、goalText及actorRefs。completionCondition不能代替预计日期。EVENT_SCHEDULE按预计时间和依赖处理；到期需要推演，不自动成功。受阻/延期更新晚于窗口结束的预计时间；旧缺规划事件终结可保持缺失，不编造历史日期。',
            'scheduled/active/blocked不得预填resolvedAt、resolutionText、resultKnowledge；resolved需实际resolvedAt与resolutionText，可outcome=success/failure/changed。成功需结构化前置条件已满足；失败不要求成功条件。取消未来安排不要求已经开始。',
            'SaveTask直接提供resolution={at,outcome,result,reason,sourceTurnId,resultKnowledge?}。completed对应success；cancelled对应failure或cancelled；blocked继续占用且不填写resolution。AI根据因果自行决定结果，不输出decision审批字段。',
            '任务可通过handoff={fromTaskId,at,channel,content,necessity,knowledgeKind}承接终态任务成果。content可以概括；引用真实前序ID且时间有序，不要求摘抄结果或额外来源令牌。无人需要承接则不创建新任务。',
            '每名NPC最多一个未终结任务；本批终结可按resolution.at释放，后续startAt不得早于释放。任务行动者、目标、开始时间和完成条件不可改写；终态不可重新执行。组织可有多个任务。',
            '事件predecessorEventIds引用实际已结束且时间不晚于新事件开始的前序。DeleteEvent只清理minor、无主角/主线关联、无必要任务/因果/知识引用的终态，保留轻量身份。ArchiveEvent及timelineCandidates仅归档重大实际终态，不要求每个事件归档或承接。',
            'continuation指定protagonist/world/end及reason。protagonist提供entry的channel/cue；到期后程序排队，Story通过结构化eventInteraction回执回应。world终态需要同批非终态后继；end不强制续篇。protagonistEntry与protagonistKnowledge为程序元数据，不得伪造。',
            '事件客观进展不自动刷新主角旧知情快照。NPC_KNOWLEDGE每项仅属于ownerNpcId；亲历、转述、推测由AI区分，不能把其他人物秘密当作本人已知或把猜测当作已确认。visibleHooks仅内部候选，不公开角色知识。',
            'futureEvents必须是同批新scheduled SaveEvent的相同镜像，不是额外写入路径。',
            'RetireNpc只适用无当前职责或资产引用的离场非联系人；联系人、同伴永久保护。旧档contactReviewNpcIds在存在历史联系时继续保护，当前没有可信player_confirmed入口，不能从玩家输入子串或AI正文取得删除授权。retainMemoryIds引用真实原始记忆ID。',
            '不支持资金、物品或组织经营字段的后台变更；写入unresolved，不以事件说明假装正式资产已经改变。',
          ],
          npcFieldPermissions: {
            UpdateNpc:
              '仅离场已有 NPC：locationId/healthText/activeGoals 与 onScene=false；禁止 affinityChange、relationshipText、lastInteractionAt、onScene=true。开局同伴不得更新。',
            CreateNpc: '离场、好感中性0且未确认、无互动时间、不得内联记忆/知晓信息。',
            RecordNpcMemory:
              '仅写指定离场NPC的个人档案；knowledgeKind由模型判断，memory时间与引用必须合法。不得自动复制给其他NPC。visibility明确区分player_known/npc_private/internal；模型不能把私人经历无条件公开。',
          },
        }
      : {}),
  };
}
