import { variableCommandSchemas } from '../../domain/variableCommands';
import { StoredWorldEventSchema, WorldEventSchema } from '../../domain/events/schema';
import { z } from 'zod';
import { organizationChangeFields } from '../../domain/organizations/schema';
import { DomainCommandSchema } from '../../domain/commands';
import { OrdinaryNpcCreationSchema, SpecialNpcCreationSchema } from '../../domain/npc/schema';
import { WorldResultSchema } from '../../domain/drafts';
import type { AiStage } from '../ai/configuration';
export const worldTypes = [
  'CreateNpc',
  'UpdateNpc',
  'RecordNpcMemory',
  'CreateLocation',
  'CreateOrganization',
  'UpdateOrganization',
  'RecordOrgRelation',
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
        const modelOption = stage === 'world' && option.shape.type.value === 'UpdateNpc'
          ? variableCommandSchemas[1].safeExtend({changes:variableCommandSchemas[1].shape.changes.omit({name:true,aliases:true,identity:true,phoneContact:true,usualLocations:true,detailedBackground:true,habits:true,relationshipNetwork:true})})
          : option.shape.type.value === 'CreateNpc'
          ? option.extend({ npc: z.discriminatedUnion('kind', [OrdinaryNpcCreationSchema, SpecialNpcCreationSchema.omit({longTermMemories:true})]) })
          : option.shape.type.value==='SaveEvent' ? option.extend({event:z.union([WorldEventSchema,StoredWorldEventSchema.extend({status:z.enum(['resolved','cancelled'])})])}) : option;
        const schema=z.toJSONSchema(modelOption, { target: 'draft-7', unrepresentable: 'any' });
        if (option.shape.type.value === 'RecordNpcMemory') {
          if (schema.properties) delete schema.properties.layer;
          if (schema.required) schema.required = schema.required.filter(field => field !== 'layer');
        }
        if(option.shape.type.value==='SaveTask') {
          const task=schema.properties?.task;
          if(task && typeof task==='object')task.anyOf=[{required:['dueAt']},{required:['completionCondition'],properties:{completionCondition:{type:'string',pattern:'\\S'}}}];
        }
        if (stage === 'world' && option.shape.type.value === 'CreateNpc') {
          const npc = schema.properties?.npc;
          if (npc && typeof npc === 'object') for (const variant of npc.oneOf ?? npc.anyOf ?? [npc]) {
            if (typeof variant !== 'object' || !variant.properties) continue;
            const properties = variant.properties;
            // Describe existing World permissions to the model. Runtime/legacy schemas stay unchanged.
            delete properties.affinityConfirmed;
            delete properties.lastInteractionAt;
            properties.onScene = { type: 'boolean', const: false };
            properties.affinity = { type: 'number', const: 0 };
            for (const field of ['memories', 'knownInformation']) {
              const array = properties[field];
              if (array && typeof array === 'object') array.maxItems = 0;
            }
            if (properties.privateProfile) variant.allOf = [{
              if: { properties: { gender: { const: 'female' }, age: { minimum: 18 } }, required: ['gender'] },
              // Missing age retains the existing compatibility rule; a known minor does not qualify.
              else: { properties: { privateProfile: false } },
            }];
          }
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
    organizationUpdateFields: organizationChangeFields,
    rules: [
      '严格使用各 type 的同级字段，不接受 group/entityId/payload 包装或旧别名。',
      'NPC V2：正式人物由AI依据姓名与持续追踪价值建档，不为临时路人编造姓名。Variables可PromoteNpc升级或补齐待完善资料，不能降级或违背玩家ordinary选择；World不修改重要性及新增人物管理字段。休眠档案不可读取。',
      stage === 'world'
        ? 'evidence为非执行的简洁说明，可自然概括；程序不解析证据JSON或审批叙述事实。'
        : 'evidence为简洁来源说明，可概括而不必逐字引用或包含关键词；金额为整数人民币分，price/amount等正值限制以Schema为准。',
      '组织UpdateOrganization按organizationUpdateFields白名单合并当前字段，id/kind/主角关系历史不可覆盖。金额更新需financialBasis={at,note}，只更新组织自己的人民币分整数估计，不是主角交易。无变化不更新，管理层公开姓名不自动建NPC，组织间关系稀疏可选且可单向。',
      '不存在的更新操作列入 unresolved；CreateNpc/CreateOrganization 不是更新命令。RegisterContact仅保留旧联系人登记协议，不代表已掌握电话号码。所有正式NPC永久保留档案；离场、死亡、失联不删除人物。',
      'Schema描述严格结构；程序校验权限、引用、归属、金额、时间、版本与幂等。剧情及世界演化由AI判断。角色知识按人物提供，命令仅写指定对象，不自动传播。',
      '遵守TURN_TIME_POLICY：待定开局由程序统一应用Story结构化时钟，变量无需重复SetWorldClock。普通回合按实际行动估时，可零耗时，不固定步长，不要求正文时间词；禁止日期非法或倒退。有效HISTORICAL_PERSPECTIVE不更新当前变量或推演当前世界，World可以RecordHistory记录回顾内容，保持当前时钟。',
    ],
    ...(stage === 'world'
      ? {
          commandGuides: {
            UpdateNpc: {
              fields: 'activeGoals 是命令顶层字段，与 changes 同级，不允许放进 changes；仅 special 人物可写 activeGoals。changes 放 locationId/healthText/onScene 等目录允许的状态字段，仍遵守场外权限和本轮字段冲突保护。',
              version: 'expectedRevision 使用 BASE_SAVE_REVISION（等于 TURN_CONTEXT.baseSaveRevision），不是模拟次数、人物版本或下一回合版本。示例 ID、版本和内容仅说明结构，必须换为本次合法值，不据此创建人物。',
              example: { commandId: 'example-update-npc', type: 'UpdateNpc', evidence: '合法场外状态变化', expectedRevision: 1,
                npcId: 'example-npc', changes: { healthText: '本轮发生的状态变化' }, activeGoals: ['当前行动目标'] },
            },
            RecordNpcMemory: {
              time: 'TIME_WINDOW.from ≤ memory.createdAtGameTime ≤ TIME_WINDOW.to（按实际时间戳，含两端）；from 为正式起始时间，待定开局使用 Story 已确认开场时间；to 为合法 Variables 投影停止时间。variablePending 时没有已验证的新时间权限。',
              meaning: '历史事件发生时间不等于本轮记忆记录时间。本轮确实收到旧事消息时可记录本轮获知经过并标明 reported/suspected 与实际来源；不能将旧事补写为本轮亲历，也不能伪造当前时间绕过窗口。已有记忆不重复新增。',
              ownership: '复用 npcId、稳定记忆 ID 和真实 sourceTurnIds/affectedEntityRefs；可引用本批合法创建的场外 NPC，不能写受保护人物或传播其他人的私人知识。',
            },
            SaveTask: {
              plan: '新写入任务必须有 dueAt 或非空 completionCondition（更新也须保留合法结束依据）。没有真实截止安排时用有依据的完成条件，不为填字段编造日期。',
              state: 'planned/active/blocked 不填 resolution；completed 对应 success，cancelled 对应 failure/cancelled，按既有时间窗口写实际成果。复用任务 ID，保留 actorRef/goal/startAt/completionCondition；真实 handoff 仅引用有 resolution 的终态前序，resolution.at ≤ handoff.at ≤ 后继 startAt，handoff.at 在当前窗口。无必要不建交接任务。',
            },
            SaveEvent: {
              update: 'SaveEvent 保存完整最终事件对象，不是 changes 补丁。复用已有 event.id，原样保留 startAt/completionCondition/eventKind/parentEventId/fixedEndAt（原来未提供的不可变字段仍不补造）。不要再次输出已终结且不可变的事件。',
              sources: 'event.sourceTurnIds 包含 TURN_CONTEXT.turnId，保留已有全部来源；每个 ID 只能来自当前回合或正式 journal 已提交回合。不能用 commandId、eventId、示例 turn ID 替代，也不能只写当前回合覆盖旧来源。',
              timing: 'main 使用 estimatedEndAt，超过估期不强制结案；sub 使用 parentEventId/startAt/fixedEndAt，不填 estimatedEndAt，不改固定边界。未到期 sub 不例行改写，到期依 EVENT_SCHEDULE 完成必需结算。并行阶段允许重叠，不强加前序；predecessorEventIds 仅引用真实已结束且时间合法的前序。',
              knowledge: '保持 protagonistEntry/protagonistKnowledge 程序元数据和角色认知边界；客观世界变化不自动成为主角已知。',
            },
          },
          // 顶层输出不是存档投影：从真实 Schema 生成易混淆的数组值形状。
          outputFields: {
            worldCommands: { type: 'array', commandTypes: worldTypes },
            taskCommands: { type: 'array', commandTypes: ['SaveTask'] },
            eventCommands: { type: 'array', commandTypes: ['SaveEvent', 'DeleteEvent'] },
            ...Object.fromEntries((['visibleHooks', 'unresolved'] as const).map(field =>
              [field, z.toJSONSchema(WorldResultSchema.shape[field], { target: 'draft-7', unrepresentable: 'any' })])),
          },
          worldStateRules: [
            'CreateNpc按World专用Schema使用合法初值，亲属/认识关系不是affinityConfirmed；后续RecordNpcMemory分开输出，不能在创建对象内塞记忆。CreateLocation.parentId是实际地理从属，不是玩家所在国家或默认根；海外地点不硬挂china，未知父级可省略，不虚构ID。',
            '任务—事件允许单侧关联：task.linkedEventId或event.linkedTaskIds填一侧即可，程序补齐反向ID；两侧都填须一致，一个任务只能关联一个事件。引用须已存在或本批创建，不能通过补齐改写既有终态。复用已有实体ID，不重复创建或无声丢弃冲突关联。',
            'worldCommands用RecordHistory独立记录历史：entry={id,title,summary,knowledgeKind,occurredAt?,occurredTimeText?,sourceRef?,sourceText?,actorRefs?,locationId?,eventId?,relatedEntryIds?,chronicle?}。knowledgeKind为established/reported/suspected。不带chronicle的普通史料不要求正式事件、重要等级或结案；可记录传述、猜测和模糊过去，不编造精确日期，不自动授予角色知识。recordedAt/sourceTurnId由程序生成，不由AI输出。新披露用新ID并关联旧条目，无需每轮新增历史。',
            '重大纪事可选entry.chronicle：category=world/protagonist、nature=fact/statement/rumor/inference（与entry.knowledgeKind一致）、milestoneId、结构化time、narrative、process、results、impacts。world必填scope、scopeText、basis、endTime；event_result必须引用最终投影的终态eventId，以实际startAt定位、resolvedAt作endTime；historical_event保留已结束往事的真实精度且不关联事件；cancellation_decision以cancelled事件的resolvedAt记录实际撤销决定。未开始的计划不可当作已发生结果。主角重大事实发生时记录。重大性由World决定，不依据impact阈值。',
            '重大纪事time支持instant/day/month/season/year/range/unknown，保留原始文本，未知不补造日期；若提供entry.occurredAt，time须为相同精确时刻。冬季在同年12月精确与月模糊记录后、全年模糊记录前，不跨年。双视角相同milestoneId须同time且类别不同；relations仅关联真实历史，follows/corrects不成环。新发展新ID，普通旧史料不自动升级；所有节点只经原子Commit生效。',
            '事件参与者可随发展变化，保持ID与原startAt；引用本批合法创建或已有实体，参与记录不授权主角行动。未来安排只输出SaveEvent，程序从事件状态派生调度，不重复填写镜像。',
            'World创建组织时relationHistory=[]，不要复制存档中的历史数组。确需记录关系变化时另用RecordOrgRelation。gang不填funds；business不填assetsEstimate/liquidityEstimate（也不填null）。创建命令不是资产入账或历史追加。',
            '新事件提供startAt、backgroundText、goalText、actorRefs。eventKind=main的estimatedEndAt仅供参考，不强制到期处理；sub提供parentEventId及fixedEndAt，不填estimatedEndAt。sub未到期不例行改写，到期须按原fixedEndAt结案，必填outcome/resolutionText；sub不得修改fixedEndAt延期，继续用新ID。旧事件沿用原预计时间和延期语义。',
            'scheduled/active/blocked不得预填resolvedAt、resolutionText、resultKnowledge；resolved需实际resolvedAt与resolutionText，可outcome=success/failure/changed。取消未来安排不要求已经开始。',
            'prerequisites和blockers是剧情说明字符串数组，不是完成ID门槛或命令依赖；可保留未解除阻碍并推进、结案或延期，不要求清空或强制blocked。实体关联、前序事件与真实任务交接仍须合法ID及时间。',
            'SaveTask直接提供resolution={at,outcome,result,reason,sourceTurnId,resultKnowledge?}。completed对应success；cancelled对应failure或cancelled；blocked不填写resolution。AI根据因果自行决定结果，不输出decision审批字段。',
            '任务可通过handoff={fromTaskId,at,channel,content,necessity,knowledgeKind}承接终态任务成果。content可以概括；引用真实前序ID且时间有序，不要求摘抄结果或额外来源令牌。无人需要承接则不创建新任务。',
            'NPC和组织均可有多个planned/active/blocked任务，不按数量或区间重叠拒绝。任务行动者、目标、开始时间和完成条件不可改写；终态不可重新执行；交接仍须前序成果和时间合法。',
            '事件predecessorEventIds引用实际已结束且时间不晚于新事件开始的前序。DeleteEvent清理无未处理入场、无必要任务/因果/知识/历史引用的终态，V2终态安全退役保留detail中的阶段经过、实际结果、参与者、时间和认知分类；父子与前序可引用退役身份。旧事件保留轻量身份；不按impact判断清理或历史资格。',
            'continuation指定protagonist/world/end及reason。protagonist提供entry的channel/cue；旧事件到期、新sub开始后程序排队；Story通过结构化eventInteraction回执回应，合法现场结果可以提前结束sub。sub的world终态需要真实显式后继（可同窗已结案、可并行或跨父关联）；旧world终态需要同批非终态后继；end不强制续篇。protagonistEntry与protagonistKnowledge为程序元数据，不得伪造。',
            '事件客观进展不自动刷新主角旧知情快照。SAVE_STATE.npc[id].memories 和 knownInformation 仅属于该人物；亲历、转述、推测由AI区分，不能把其他人物秘密当作本人已知或把猜测当作已确认。visibleHooks仅内部候选，不公开角色知识。',
            '所有正式NPC永久保留档案、记忆与关系，不再提供RetireNpc；旧retiredNpcs仅保留历史身份，不猜补已不存在的详细资料。',
            '主角资金、物品和交易仍无后台变更权限。组织现状使用UpdateOrganization：仅本类白名单字段，金额仅funds/assetsEstimate/liquidityEstimate且须financialBasis与合法时间，不覆盖Variables本轮已确认字段或主角关系。不以事件说明假装已写入资产。',
          ],
          stageEntryPolicy:'V2到期不因pending/presented无限延期；保存结局，并创建唯一无eventKind后继互动，引用前序并原样保留channel/cue/locationId。程序移交未处理入场，不代玩家接受、拒绝或离开。合法Variables提前结案优先。',
          npcFieldPermissions: {
            UpdateNpc:
              '以本轮Variables投影判定离场；不得重写本轮Variables已修改的离场人物字段。仅合法离场 NPC：changes 内的 locationId/healthText/onScene=false 与顶层 activeGoals 分开；禁止 affinityChange、relationshipText、lastInteractionAt、onScene=true。开局同伴不得更新。',
            CreateNpc: 'World新建NPC初值：onScene=false、affinity=0仅为未确认占位；affinityConfirmed必须省略（不填true、false或null），不得填写lastInteractionAt，不得内联记忆/知晓信息。亲属关系或多年相识只描述于relationshipText/背景，不代表好感数值已确认。普通和特殊男性不得privateProfile（包括空对象）；私密档案资格仅special+female且年龄缺省或>=18，已知未成年/未知性别不允许，不能为资格伪造年龄；合资格女性原七字段保留。特殊人物补detailedBackground/activeGoals/habits/offscreenTaskIds，任务引用须真实且归属本人；不输出longTermMemories。',
            RecordNpcMemory:
              '仅写指定离场NPC的个人档案；knowledgeKind由模型判断，memory时间与引用必须合法。不得自动复制给其他NPC。visibility明确区分player_known/npc_private/internal；模型不能把私人经历无条件公开。',
          },
        }
      : {}),
  };
}
