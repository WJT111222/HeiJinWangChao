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
  'RecordHistory',
] as const;
export function commandCatalog(stage: Exclude<AiStage, 'story'>) {
  const options = DomainCommandSchema.options.filter(
    (option) =>
      (stage === 'variables' && !['RetireNpc','DeleteEvent','RecordHistory'].includes(option.shape.type.value)) ||
      (stage === 'world' && [...worldTypes, 'SaveTask', 'SaveEvent','DeleteEvent'].includes(option.shape.type.value)),
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
            eventCommands: ['SaveEvent','DeleteEvent'],
            actorBoundary: '以合法Variables投影判断现场：新离场NPC可承担后台任务，仍在场者和开局同伴受保护；只自主推进场外NPC/组织；SaveEvent以稳定ID记录事件参与者，不执行参与者动作。引用参与者不是后台行动授权。禁止主角交易、现场重复行动、独立推进时钟。',
          },
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      stage === 'world'
        ? 'evidence为非执行的简洁说明，可自然概括；程序不解析证据JSON或审批叙述事实。'
        : 'evidence为简洁来源说明，可概括而不必逐字引用或包含关键词；金额为整数人民币分，price/amount等正值限制以Schema为准。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。RegisterContact仅变量阶段据实际交换联系方式登记，不可撤销保护；RetireNpc仅世界阶段提议，联系人、同伴、现场和有未完职责/当前资产引用者不能删除。',
      'Schema描述严格结构；程序校验权限、引用、归属、金额、时间、版本与幂等。剧情及世界演化由AI判断。角色知识按人物提供，命令仅写指定对象，不自动传播。',
      '遵守TURN_TIME_POLICY：待定开局由程序统一应用Story结构化时钟，变量无需重复SetWorldClock。普通回合按实际行动估时，可零耗时，不固定步长，不要求正文时间词；禁止日期非法或倒退。有效HISTORICAL_PERSPECTIVE不更新当前变量或推演当前世界，World可以RecordHistory记录回顾内容，保持当前时钟。',
    ],
    ...(stage === 'world'
      ? {
          // 顶层输出不是存档投影：从真实 Schema 生成易混淆的数组值形状。
          outputFields: {
            worldCommands: { type: 'array', commandTypes: worldTypes },
            taskCommands: { type: 'array', commandTypes: ['SaveTask'] },
            eventCommands: { type: 'array', commandTypes: ['SaveEvent', 'DeleteEvent'] },
            ...Object.fromEntries((['visibleHooks', 'unresolved'] as const).map(field =>
              [field, z.toJSONSchema(WorldResultSchema.shape[field], { target: 'draft-7', unrepresentable: 'any' })])),
          },
          worldStateRules: [
            '任务—事件允许单侧关联：task.linkedEventId或event.linkedTaskIds填一侧即可，程序补齐反向ID；两侧都填须一致，一个任务只能关联一个事件。引用须已存在或本批创建，不能通过补齐改写既有终态。复用已有实体ID，不重复创建或无声丢弃冲突关联。',
            'worldCommands用RecordHistory独立记录历史：entry={id,title,summary,knowledgeKind,occurredAt?,occurredTimeText?,sourceRef?,sourceText?,actorRefs?,locationId?,eventId?,relatedEntryIds?}。knowledgeKind为established/reported/suspected。不要求正式事件、重要等级或结案；可记录传述、猜测和模糊过去，不编造精确日期，不自动授予角色知识。recordedAt/sourceTurnId由程序生成，不由AI输出。新披露用新ID并关联旧条目，无需每轮新增历史。',
            '事件参与者可随发展变化，保持ID与原startAt；引用本批合法创建或已有实体，参与记录不授权主角行动。未来安排只输出SaveEvent，程序从事件状态派生调度，不重复填写镜像。',
            'World创建组织时relationHistory=[]，不要复制存档中的历史数组。确需记录关系变化时另用RecordOrgRelation。gang不填funds；business不填assetsEstimate/liquidityEstimate（也不填null）。创建命令不是资产入账或历史追加。',
            '新事件必须提供startAt、estimatedEndAt、backgroundText、goalText及actorRefs。completionCondition不能代替预计日期。EVENT_SCHEDULE按预计时间和依赖处理；到期需要推演，不自动成功。受阻/延期更新晚于窗口结束的预计时间；旧缺规划事件终结可保持缺失，不编造历史日期。',
            'scheduled/active/blocked不得预填resolvedAt、resolutionText、resultKnowledge；resolved需实际resolvedAt与resolutionText，可outcome=success/failure/changed。成功需结构化前置条件已满足；失败不要求成功条件。取消未来安排不要求已经开始。',
            'SaveTask直接提供resolution={at,outcome,result,reason,sourceTurnId,resultKnowledge?}。completed对应success；cancelled对应failure或cancelled；blocked不填写resolution。AI根据因果自行决定结果，不输出decision审批字段。',
            '任务可通过handoff={fromTaskId,at,channel,content,necessity,knowledgeKind}承接终态任务成果。content可以概括；引用真实前序ID且时间有序，不要求摘抄结果或额外来源令牌。无人需要承接则不创建新任务。',
            'NPC和组织均可有多个planned/active/blocked任务，不按数量或区间重叠拒绝。任务行动者、目标、开始时间和完成条件不可改写；终态不可重新执行；交接仍须前序成果和时间合法。',
            '事件predecessorEventIds引用实际已结束且时间不晚于新事件开始的前序。DeleteEvent清理无未处理入场、无必要任务/因果/知识/历史引用的终态，保留轻量身份；不按impact判断清理或历史资格。',
            'continuation指定protagonist/world/end及reason。protagonist提供entry的channel/cue；到期后程序排队，Story通过结构化eventInteraction回执回应。world终态需要同批非终态后继；end不强制续篇。protagonistEntry与protagonistKnowledge为程序元数据，不得伪造。',
            '事件客观进展不自动刷新主角旧知情快照。NPC_KNOWLEDGE每项仅属于ownerNpcId；亲历、转述、推测由AI区分，不能把其他人物秘密当作本人已知或把猜测当作已确认。visibleHooks仅内部候选，不公开角色知识。',
            'RetireNpc只适用无当前职责或资产引用的离场非联系人；联系人、同伴永久保护。旧档contactReviewNpcIds在存在历史联系时继续保护，当前没有可信player_confirmed入口，不能从玩家输入子串或AI正文取得删除授权。retainMemoryIds引用真实原始记忆ID。',
            '不支持资金、物品或组织经营字段的后台变更；写入unresolved，不以事件说明假装正式资产已经改变。',
          ],
          npcFieldPermissions: {
            UpdateNpc:
              '以本轮Variables投影判定离场；不得重写本轮Variables已修改的离场人物字段。仅离场已有 NPC：locationId/healthText/activeGoals 与 onScene=false；禁止 affinityChange、relationshipText、lastInteractionAt、onScene=true。开局同伴不得更新。',
            CreateNpc: '离场、好感中性0且未确认、无互动时间、不得内联记忆/知晓信息。',
            RecordNpcMemory:
              '仅写指定离场NPC的个人档案；knowledgeKind由模型判断，memory时间与引用必须合法。不得自动复制给其他NPC。visibility明确区分player_known/npc_private/internal；模型不能把私人经历无条件公开。',
          },
        }
      : {}),
  };
}
