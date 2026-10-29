import { StoredWorldEventSchema, WorldEventSchema } from '../../domain/events/schema';
import { z } from 'zod';
import { DomainCommandSchema } from '../../domain/commands';
import type { AiStage } from '../ai/configuration';
import { WorldEvidenceSchema } from './worldEvidence';
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
            actorBoundary: '只推进场外 NPC/组织；禁止主角交易、现场重复行动、独立推进时钟。',
          },
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      stage === 'world'
        ? 'evidence 使用 WORLD_EVIDENCE_V1 JSON 字符串；区分既有事实、新生成场外候选、计划与转述。不得要求新推演事实逐字出现在旧正文。'
        : 'evidence为简洁来源说明，可概括而不必逐字引用或包含关键词；金额为整数人民币分，price/amount等正值限制以Schema为准。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。RegisterContact仅变量阶段据实际交换联系方式登记，不可撤销保护；RetireNpc仅世界阶段提议，联系人、同伴、现场和有未完职责/当前资产引用者不能删除。',
      'Schema描述严格结构；程序校验权限、引用、归属、金额、时间、版本与幂等。变量语义由AI判断，不以正则审判小说；世界来源协议继续独立保护私有知识。',
      '遵守TURN_TIME_POLICY：待定开局由程序统一应用Story结构化时钟，变量无需重复SetWorldClock。普通回合按实际行动估时，可零耗时，不固定步长，不要求正文时间词；禁止日期非法或倒退。有效HISTORICAL_PERSPECTIVE不更新当前变量或推演世界。',
    ],
    ...(stage === 'world'
      ? {
          evidenceEncoding:
            'evidence = JSON.stringify(WORLD_EVIDENCE_V1)。sources 引用 WORLD_SOURCES 的 id 或经过依赖校验的本批 task:/event:/handoff: 来源；derived 可描述新推演结果，不要求逐字存在于来源。',
          worldEvidenceSchema: z.toJSONSchema(WorldEvidenceSchema, { target: 'draft-7' }),
          worldStateRules: [
            '事件创建必须提供estimatedEndAt、backgroundText、goalText及actorRefs。completionCondition不能替代日期。EVENT_SCHEDULE.due按预计时间和依赖处理，保留积压；一次World请求处理本轮全部可处理节点，到期不是成功。受阻/延期需合理下一预计时间且晚于窗口结束；原始缺规划事件列unplannedLegacy，不编造过去日期。',
            'resolved表示已经结束，可outcome=success/failure/changed；失败结束不要求成功条件已满足，不能把受阻伪装成功。cancelled仍按原终止来源约束。无需强制后继；只有合理发展才创建新事件，以predecessorEventIds及event:来源承接真实结果。',
            'DeleteEvent(eventId,expectedStatus,reason)只清理终态完整对象，保留轻量身份和必要成果引用；ArchiveEvent(eventId,title,summary)只把重大实际结案的公开文本归档并清理。后者必须有独立主角已知事实，不自动公开秘密成果；已知重大也可继续使用timelineCandidates。两个命令不得用于未终结事件。',
            'worldEventOnly标记的事件是后台世界事实，不是NPC或组织的知情来源；行动/任务/记忆须引用自身独立观察或转述来源，不能引用非公开事件ID代替知晓依据。事件本身仍可正常创建和演化，参与者列表不等同于已知者列表。',
            'npc-summary 来源仅能支持所属人物的计划任务或个人目标，不是客观事实、完成证据或其他人物的知识。',
            'player_known 记忆和事件可见信息的新增/更新必须有 playerKnownText 中的肯定事实依据；客观成立不等于主角已知，缺少公开依据时保持私有/hidden或列入unresolved。',
            'CreateLocation 只接受实际存在或合法 derived 事实，planned 建设只可记录任务/未来事件。',
            'scheduled/active/blocked 事件不得包含 resolvedAt、resolutionText或resultKnowledge；estimatedEndAt/dueAt 是估计，到期只应重新评估，不自动完成。',
            'NPC 的 planned/active/blocked 任务均占用唯一名额；正式状态、变量投影和本批任务一起检查，本批真实终结可按 resolution.at 释放；新任务 startAt 不早于释放或 handoff.at，依赖须先验证且无环。组织可以有多任务，禁止用组织名义规避 NPC 任务限制。',
            '只有 actorRef 能确定执行者；组织任务若实际依赖忙碌 NPC，不能仅换组织名义规避。现有 Schema 无法确定实际执行人时明确 unresolved，不声称程序已验证文字中的执行者。',
            '任务成果采用decision声明，由程序确定性重建resolution(at,outcome,result,reason,sourceTurnId,resultKnowledge?)。result保留混合叙述；用resultKnowledge={facts,reported,suspected}区分实际行动/独立核验成果、收到的未核实主张、猜测。facts不复制未证实引述。completed需要conditionsSatisfied=true、continues=false；cancelled说明实际失败/取消原因与结果，continues=false；blocked继续占用，不要求固定词语。',
            '按需交接：新任务handoff(fromTaskId,at,channel,content,necessity,knowledgeKind)仅引用已验证终态的具体成果；旧逐字交接可直接引用前序result片段；忠实概括使用summaryBasis={mode:faithful_summary,resultExcerpt}锚定原始结果，content可概括，fact可叙述交接动作，另引接收方npc:/org:职责来源。不需要接班就不造任务；来源依赖必须无环。handoff:<新taskId>是接收方的独立知识来源，reported仍是转述，不能成为主角已知或将传闻当世界事实。',
            'task:来源只投影程序终态/时间及resultKnowledge.facts；完整resolution.result和reported/suspected在task-result:中始终是statement，旧成果缺少分类不补造事实。目标/条件另在task-plan:中作为plan；handoff:保持接收者知识性质。不能用任务完成替报告背书，不能把task-result、task-plan或转述升级为既成事实。observed交接还需明确事实锚点，未核实内容只能reported。',
            '事件复用resultKnowledge={facts,reported,suspected}，由程序从终态decision建立到WorldEvent。event:的结案事实只含确定性元数据和显式facts；完整resolutionText与标题在event-result:中保持statement，计划说明在event-plan:中保持plan；隐藏事件各来源保留worldEventOnly。接收举报不证明举报内容属实，旧事件缺少分类也不补造facts，独立核验成果仍可正常使用。',
            '旧档contactReviewNpcIds独立暂缓清理，不是联系人；当前无独立可信玩家删除确认入口，player_confirmed/playerConfirmation仅兼容存量，不授予退场权限。自由文本、肯定子串、条件、引述及AI正文都不能替代授权。存在旧journal或公开记忆时继续保护；无历史、无联系迹象的临时人物仍可用no_known_connection复核。真正联系人永久保护。',
            '退场需decision.status=retired、targetId、reason/result、conditionsSatisfied=true、continues=false；retainMemoryIds选取确需留存的原始私有材料ID。公开记忆必保留，其他必要材料进入internal历史，不授予其他NPC知识。',
            '旧任务/事件完成必须引用自身 task:<id>/event:<id> 来源，仍可结合动机自主推演新结果，不要求正文预先记载。',
            '任务成功使用 completed；失败且终止或取消使用 cancelled，并在 evidence.fact/rationale/outcome 记录实际结果；暂时受阻用 blocked，不宣称成功。',
          ],
          npcFieldPermissions: {
            UpdateNpc:
              '仅离场已有 NPC：locationId/healthText/activeGoals 与 onScene=false；禁止 affinityChange、relationshipText、lastInteractionAt、onScene=true。开局同伴不得更新。',
            CreateNpc: '离场、好感中性0且未确认、无互动时间、不得内联记忆/知晓信息。',
            RecordNpcMemory:
              '当回合有来源的自身知识，不是记忆压缩；正文与evidence.fact一致，来源写入knowledgeSource，认知类型由命令固定；player_known另需公开事实来源，不能凭自己的私有记忆公开。',
          },
        }
      : {}),
  };
}
