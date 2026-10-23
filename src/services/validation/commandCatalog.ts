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
      (stage === 'variables' && option.shape.type.value !== 'RetireNpc') ||
      (stage === 'world' && [...worldTypes, 'SaveTask', 'SaveEvent'].includes(option.shape.type.value)),
  );
  return {
    currencyUnit: 'CNY_FEN_INTEGER',
    commandTypes: options.map((option) => option.shape.type.value),
    schema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      oneOf: options.map((option) =>
        z.toJSONSchema(option, { target: 'draft-7', unrepresentable: 'any' }),
      ),
    },
    stagePermissions:
      stage === 'variables'
        ? '只提议正文已成立的现场结果；新 NPC 必须实际在场。'
        : {
            worldCommands: worldTypes,
            taskCommands: ['SaveTask'],
            eventCommands: ['SaveEvent'],
            actorBoundary: '只推进场外 NPC/组织；禁止主角交易、现场重复行动、独立推进时钟。',
          },
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      stage === 'world'
        ? 'evidence 使用 WORLD_EVIDENCE_V1 JSON 字符串；区分既有事实、新生成场外候选、计划与转述。不得要求新推演事实逐字出现在旧正文。'
        : 'evidence 引用已提供事实原文；金额为整数人民币分，price/amount 等正值限制以 Schema 为准。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。RegisterContact仅变量阶段据实际交换联系方式登记，不可撤销保护；RetireNpc仅世界阶段提议，联系人、同伴、现场和有未完职责/当前资产引用者不能删除。',
      'Schema 仅描述结构；仍须进行权限、证据、引用、金额、时间、版本与幂等校验。',
      '遵守TURN_TIME_POLICY：普通及开局正式回合必须正向SetWorldClock，由变量AI根据实际行动和对话估时，证据不必含时间词，无固定步长。只有有效HISTORICAL_PERSPECTIVE的纯过去视角允许零耗时且不更新当前变量或推演世界。',
    ],
    ...(stage === 'world'
      ? {
          evidenceEncoding:
            'evidence = JSON.stringify(WORLD_EVIDENCE_V1)。sources 引用 WORLD_SOURCES 的 id 或经过依赖校验的本批 task:/event:/handoff: 来源；derived 可描述新推演结果，不要求逐字存在于来源。',
          worldEvidenceSchema: z.toJSONSchema(WorldEvidenceSchema, { target: 'draft-7' }),
          worldStateRules: [
            'worldEventOnly标记的事件是后台世界事实，不是NPC或组织的知情来源；行动/任务/记忆须引用自身独立观察或转述来源，不能引用非公开事件ID代替知晓依据。事件本身仍可正常创建和演化，参与者列表不等同于已知者列表。',
            'npc-summary 来源仅能支持所属人物的计划任务或个人目标，不是客观事实、完成证据或其他人物的知识。',
            'player_known 记忆和事件可见信息的新增/更新必须有 playerKnownText 中的肯定事实依据；客观成立不等于主角已知，缺少公开依据时保持私有/hidden或列入unresolved。',
            'CreateLocation 只接受实际存在或合法 derived 事实，planned 建设只可记录任务/未来事件。',
            'scheduled/active/blocked 事件不得包含 resolvedAt 或 resolutionText；estimatedEndAt/dueAt 是估计，到期只应重新评估，不自动完成。',
            'NPC 的 planned/active/blocked 任务均占用唯一名额；正式状态、变量投影和本批任务一起检查，本批真实终结可按 resolution.at 释放；新任务 startAt 不早于释放或 handoff.at，依赖须先验证且无环。组织可以有多任务，禁止用组织名义规避 NPC 任务限制。',
            '只有 actorRef 能确定执行者；组织任务若实际依赖忙碌 NPC，不能仅换组织名义规避。现有 Schema 无法确定实际执行人时明确 unresolved，不声称程序已验证文字中的执行者。',
            '任务成果采用decision声明，由程序确定性重建resolution(at,outcome,result,reason,sourceTurnId)。completed需要conditionsSatisfied=true、continues=false；cancelled说明实际失败/取消原因与结果，continues=false；blocked继续占用，不要求固定词语。',
            '按需交接：新任务handoff(fromTaskId,at,channel,content,necessity,knowledgeKind)仅引用已验证终态的具体成果；旧逐字交接可直接引用前序result片段；忠实概括使用summaryBasis={mode:faithful_summary,resultExcerpt}锚定原始结果，content可概括，fact可叙述交接动作，另引接收方npc:/org:职责来源。不需要接班就不造任务；来源依赖必须无环。handoff:<新taskId>是接收方的独立知识来源，reported仍是转述，不能成为主角已知或将传闻当世界事实。',
            'task:来源只以实际resolution.result作为成果事实，任务目标/条件另在task-plan:中作为plan；收到的报告仅handoff:并保持reported。不能用任务完成替报告背书，不能把task-plan或转述升级为既成事实。',
            '旧档contactReviewNpcIds独立暂缓清理，不是联系人；退场须contactReview={conclusion:non_contact,basis:no_known_connection|player_confirmed,reason}。无联系复核仅限明确中性未接触、无既往互动/公开引用的人物；其他不确定人物需正文中的主角确认，不能只凭动机。真正联系人永不通过此复核降级。',
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
