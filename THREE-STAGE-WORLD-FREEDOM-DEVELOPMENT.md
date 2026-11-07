# 三阶段审查精简与 World 自由化

## 基线与范围

- 基线：`main@a0a7665ba59dfe3bdf7cdd095e5de21013bfd7e9`（PR #69 已合并）。开发期间再次 fetch，远端 main 未变化。
- 分支：`codex/world-freedom-timeline`。
- 本轮遵循用户允许破坏旧测试存档的要求，采用 V6 单一格式，不保留旧历史写入协议或迁移。没有修改真实玩家存档、调用真实付费模型或主动部署。

## 先复现，再修改

最小六例首先在旧实现上运行。五项直接证明：Story 强制所有 pending 回执、单 NPC 多任务被拒、活动事件参与者被锁定、五数组 World 缺少旧镜像字段、独立历史命令不存在。场景移动首个夹具遗漏了 UpdateProtagonist 的必要字段，不能算有效产品复现；补齐字段后单独使用基线场景函数重跑，确认真实抛出 `SCENE_TRANSITION`。修复后六例全部通过，并扩充为 34 项正反例。

新浏览器用例首次 4 通过、2 失败（同一新增场景桌面/手机）：Mock 地点创建错误使用 `push locations`。按实际协议修成 `set locations[office-gate] = {"name":"办公楼门口"}`，未修改或放宽执行器。后续结果见验证记录。

## 已删除的硬限制

| 位置 | 原限制 | 新行为 |
| --- | --- | --- |
| events/interactions | Story 必须一次处理所有 pending | 只校验已提交的回执，其余保持 pending |
| sceneTransitions | 主角移动必须逐个写原在场 NPC | 未明确同行者只设 onScene=false，地点、关系、记忆与任务不变 |
| npc/lifecycle、World | 单 NPC 一项未终结任务、执行区间不重叠 | 多个 planned/active/blocked 可共存，无数量/重叠评分 |
| events/lifecycle、World | 活动事件 actorRefs 永久不变 | 有效当前参与者可增减，事件 ID、起点及终态仍受保护 |
| ArchiveEvent、timelineCandidates、isHistoricalEntry、settleTurn | 历史须重大且结案，并绑定事件 | 删除这些入口与复核，统一 RecordHistory 独立写入 |
| drafts、World、候选 UI | futureEvents 重复完整事件对象 | 删除镜像协议，未来计划由实际 SaveEvent 与正式 scheduled 状态派生 |
| DeleteEvent | impact 与主角/主线关联成为永久保留理由 | 只依终态、待处理入场和真实必要引用检查清理 |

对应旧错误码、诊断分支及旧测试断言已清理。没有换名保留重要性审批、语义相似度、事实核验或新的模型调用。事件 impact 仍是描述数据，不决定历史写入、保留或展示。

## 新历史结构与写入

`HistoryRecordSchema`：id、title、summary、knowledgeKind（established/reported/suspected）；可选 occurredAt、occurredTimeText、sourceRef、sourceText、locationId、eventId；actorRefs 和 relatedEntryIds 默认空数组。

`TimelineEntrySchema` 在上述结构上增加由程序维护的 recordedAt 与 sourceTurnId。准确发生日期不能晚于记录日期；记录日期来自当前 worldClock，不读取现实时间补造历史。

```json
{
  "worldCommands": [{
    "type": "RecordHistory", "commandId": "history-disclosure", "evidence": "本幕谈话",
    "entry": {
      "id": "history-university", "title": "大学时期的合作分歧",
      "summary": "同事声称曾在大学期间与朋友因合作发生分歧。",
      "occurredTimeText": "大学时期", "knowledgeKind": "reported",
      "sourceRef": {"kind":"npc","id":"npc-colleague"},
      "actorRefs": [], "relatedEntryIds": []
    }
  }],
  "taskCommands": [], "eventCommands": [], "visibleHooks": [], "unresolved": []
}
```

例中 npc-colleague 必须是存档或本批合法实体。没有实体时可用 sourceText，不伪造 ID。eventId 可省略，也可关联活动、普通或重大事件。relatedEntryIds 可链接补充说法，不是事件因果 DAG。ID 全局唯一；重复 commandId 的精确重放沿用原幂等机制，同一历史 ID 的不同创建拒绝。相同文字不同 ID 不作语义去重。

历史性质完全由模型声明；reported/suspected 不转换为 established。不写入主角或任何 NPC 的认知。World 的 OFFSCREEN_STATE 提供已保存历史便于后续记载，Story/Variables 不自动获得全历史；人物仍通过原有私有记忆、已知投影和合法写入渠道获取信息。纯历史视角可记录历史，但不推进当前时钟或执行当前世界变化。

## 真实数据流

1. Story 选择呈现哪些 pending，提交对应结构化回执；回执仍检查事件/入场身份、重复与状态。
2. Variables 继续使用原文本解析、编译与模拟；整批最终状态维护现场成员，不生成 NPC 虚构位移。
3. World 使用原请求读取变量投影，输出五数组 JSON。任务/事件按既有依赖顺序处理；历史使用 RecordHistory。没有镜像数组、额外 AI 或修复请求。
4. `projectTurn → commitCommands` 在副本内执行；历史、场景维护、真实引用与时间采用同一规则。
5. `validateTurnCandidates` 在正式提交前重验 Variables、World、时钟、版本及命令 ID。`SaveRepository.commitTurn` 原事务保存正式状态、journal、记忆、下一草稿和幂等回执，任何步骤失败整体回滚。
6. 原自动结算成功后等待下一条玩家行动。读取、刷新、打开时间轴不会请求 AI。

## 保留的数据底线及复核审计

- Schema/类型/整数金额、余额与归属、稳定 ID、有效实体引用、全局 ID 唯一。
- 任务 actorRef/goal/startAt 身份与终态、合法结果/交接时间；事件 startAt、必要规划、时间、终态与前后引用。
- Variables 仍只改已有现场事件 sceneState；World 不可替主角付款/签约/移动，不改变其私有状态。
- 未处理入场/必要任务、知识、组织、历史引用阻止直接清理，避免悬空；这种保留不读取 impact。
- StageGuard、草稿修订、CAS、候选隔离、完整候选要求、Commit 重验、幂等和回滚原样保留。
- 重复投影属于事务边界重验，使用同一领域函数。删除 Commit 的旧历史后处理，避免生成接受而结算再按 major 拒绝。
- 未扩大到重写三阶段。现有开局初始化、经济、记忆维护、协议解析和模型路由未重构。

## Prompt 与版本

同步共享时间、Story 输出、Variables 现场规则、World 五数组契约、开局/普通 World、普通/特殊 NPC 场外模块，更新实际 COMMAND_CATALOG 的 JSON Schema 和示例。保留原模块装配、开局区别及域选择；Manifest 的版本/字符数/hash 同步，sources.lock 追加本轮来源记录，原来源 hash 不伪造。

当前权威说明：`docs/WORLD_EVENT_LIFECYCLE.md`、`prompts/docs/OUTPUT_CONTRACT.md`、`prompts/docs/ASSEMBLY.md`。旧开发报告仅保留历史事实，不作为当前协议。冻结的学校原始 JSON 未修改，SHA-256 仍为 `53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb`；旧响应外壳已不兼容，相关历史测试明确提取仍适用的五数组，并不声称原始完整旧响应可直接通过。

## 存档边界

V6 新建、保存和重载使用独立历史格式。V1–V5 被明确识别为不支持版本，不转换、不覆盖；已有无法读取卡片可原始导出与确认删除。旧 World 候选含已删除字段明确失败，不能绕过 Commit。旧版本迁移测试按此次授权改为不改写旧数据/当前 V6 读取与联系人保护测试；没有把旧数据静默伪装为新协议。

## 验证记录（最终结果待本次执行完成后填写）

- 新增 `world-freedom.test.ts` 34 项：选择性回执、留守/同行顺序、并行任务、参与者、独立/模糊/关联历史、不同影响等级、精确重放与非法日期/引用/权限。
- `live-text-turn.test.ts` 新增开局/普通 2 项：真实 Runtime + Coordinator + 文本 Variables + World + IDB 原子 Commit、回执写入故障回滚、重放重载与下一轮；既有遗漏回执失败用例改为三轮延后处理。
- 浏览器新增一项场景，在 desktop/mobile 各执行：两 pending 只处理一项、留守离场、并行任务、独立 reported 历史、自动结算、刷新和时间轴读取。
- 已完成定向：313/313（8 文件）；新增与 live-text 集成 67/67；最后调整的三个文件 39/39；新规则与 Prompt 61/61。批次有重叠，不相加作为总数。
- 早期全量失败主要来自未刷新 Prompt hash 及旧协议/迁移/单任务断言，已同步契约与夹具；不删除 CAS、原子性、知情隔离等安全断言。

最终工程、提示词、浏览器与 diff 结果将在收尾记录。

## 剩余限制

只做离线 Mock 与确定性验证，没有验证真实模型会如何选择并行任务或历史记录。程序不证明陈述真实性、模糊时间的语义或任务能否现实并行，也不自动纠正模型选错 knowledgeKind。已删除的旧协议与 V1–V5 存档不可继续游玩，需要新开局。必要引用仍可能保守保留已结束事件；本轮没有设计因果引用迁移或无限历史的分页/压缩系统。
