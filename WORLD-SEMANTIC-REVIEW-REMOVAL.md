# World 内容审查移除报告

## 基线与范围

远端main核对为ea9cd1e60831a2cc8bbf60d40c7e75eb1d26b91e，已包含PR59；从该提交建立codex/remove-world-semantic-review。未改main、玩家存档、AI调用次数、渠道、版本或三阶段协议。

## 已删除的执行机制

删除worldEvidence.ts、worldFactNature.ts、worldSceneRecord.ts、validation/evidence.ts。移除World证据JSON Schema、来源池、事实/计划/传闻/否定分类器、旁白与名字锚点、目标句/助动词规则、结束/取消谓词、来源所有者审批与逐字成果交接检查。worldOutput不解析evidence，也不从decision生成成果。worldDependencies只读取结构化实体依赖，不解析证据或证据时间。

GameState的handoff正文子串检查已删除。World事件入场仍用eventId/entryId与唯一回执，去掉textEvidence和cue的逐字正文比对；不改变Story标签、规划结构或生成请求。timelineCandidates取消facts审批门槛，保留重大终态要求，现有分类可用于历史展示，缺少分类时保留实际resolutionText。

旧source_*/fact_*/completion_evidence/cancellation_evidence/player_knowledge/timeline_fact诊断退出执行链。未保留始终成功的验证器、审查开关或隐藏备用协议。

## 实际数据流

Story → Variables → 同一projectTurn投影 → 现有单次World请求 → JSON与WorldResultSchema → 命令分组/字段权限、ID/引用、依赖、时间、任务占用与事件生命周期 → 整批projectTurn → WorldStage/CAS候选保存 → Commit再次parseWorld及候选一致性检查 → SaveRepository原子写入与回执 → 等待玩家输入。

evidence仍是既有非空字符串字段，只作说明，旧JSON字符串无需迁移。终态任务直接输出已有resolution，事件直接输出resolvedAt/resolutionText等字段。没有新增数据库或状态Schema。

## 保留的底线

World不能直接修改主角、扣款、移动或推进时钟；受保护现场NPC及开局同伴仍不能被后台更新。事件actorRefs记录参与身份不执行这些行为。保留稳定ID、地点层级、版本、数量、引用、字段范围、终态不可复活、任务占用、真实结束时间、前置依赖、清理保护、轻量历史、StageGuard、CAS、幂等和整批回滚。

NPC_KNOWLEDGE仍按ownerNpcId分组、仅向适用阶段提供，Story不读取私人原始档案或内部总结；记忆命令只写指定NPC，不自动复制到其他人。World客观更新保持主角旧知情快照，visibleHooks保持内部候选。语义上哪些消息真实/人物实际知道什么由AI决定，程序不再声称可用小说字符串证明其正确性；明确设置可见性的模型命令仍可能判断错误，需要真实模型单独验收。

## 兼容与限制

V1–V5读取、旧事件及旧候选结构不变。已保存完整resolution的旧候选保留非执行evidence并重验。未规范化、只有旧decision但没有实际resolution的原始输出不再是可执行候选，需要玩家明确重新生成；不为兼容复活审批器。旧程序知情快照若不满足当前确定性元数据约束仍会安全拒绝，而非偷偷迁移或自动请求。

历史报告仅保留为历史，当前规范见docs/CURRENT_ARCHITECTURE.md、docs/WORLD_EVENT_LIFECYCLE.md和prompts/docs/OUTPUT_CONTRACT.md。无真实付费API验证，不能保证模型因果判断正确。

## 删除位置与保留边界

| 位置 | 删除内容 | 保留内容 |
| --- | --- | --- |
| `worldEvidence.ts`（删除） | `WorldEvidenceSchema`、`worldSources`、`readWorldEvidence`、`affirmativeSceneQuote`、`hasPlayerKnownFact`、`hasPlayerKnownArrangement`、取消/否定/来源审批 | `requireWorld`迁至诊断模块，仅作结构错误抛出工具 |
| `worldFactNature.ts`（删除） | `derivedFactRule`、未来助动词/目标句/计划词判断 | 无替代分类器 |
| `worldSceneRecord.ts`（删除） | `validateAnchoredScene`、姓名前缀绑定、固定事件标题/目标模板 | 事件参与者通过结构化actorRefs引用真实实体 |
| `evidence.ts`（删除） | `evidenceContext`、`worldFactEvidence`、`affirmativeWorldSceneQuote`、旁白截取 | 不改变Story格式 |
| `worldOutput.ts`、`worldDependencies.ts` | 证据解析、来源所有者审批、decision推断、按证据时间/来源排序 | 命令权限、状态/时间/依赖、ID及整批模拟 |
| `worldEventContinuation.ts`、`events/interactions.ts` | 计划变更证据、正文逐字回执/线索匹配 | 入场排队使用候选时钟；回执ID、唯一消费和状态约束 |
| `state.ts`、`turnCommit.ts` | 交接文本必须属于原成果子串、重大历史必须由facts许可 | 实际前序任务/时间、重大终态、事务写入 |
| `context.ts`、`commandCatalog.ts`、World共享/主提示词 | WORLD_SOURCES、强制凭据/锚点/decision格式 | NPC所属上下文、真实领域Schema和AI因果指导 |

`sourceTurnIds`、NPC总结的`sourceMemoryIds`是实际记录的关联ID，保留引用完整性；它们不再用于批准一段World叙述。NPC原有显式认知类型/标记的编码格式仍属于共享Schema，不推断自然语言的真假。历史视角和普通时间预检未重写。

## 本轮验证记录

- 新增`world-data-boundary.test.ts`：修改前24项中17失败、7通过，主要触发旧`source_format`；修改后扩充至26项，全部通过。
- 最终定向单元/集成：9个文件、196项通过，包括新边界、World生命周期、任务交接、NPC记忆、旧档、原始学校夹具和事务。
- Prompt检查：82项通过；资源数量100，哈希已刷新。类型检查和Lint已通过。
- 初始宽回归264通过/110失败；第二批325/50，第三批364/3，扩展批650/7及656/2。失败分别来自旧语义审批断言、依赖旧decision自动生成成果的Mock、旧证据时间与结构化结束时间不一致、已删除的分支引用和Prompt哈希未刷新。已改为直接合法领域字段、实际数据错误的失败Mock，不保留旧审批代码来获得绿灯。
- 定向Chromium：desktop 23/23、mobile 23/23，共46通过、0失败、0跳过（3.5分钟）。浏览器保持所有原有用例，仅将审查专用失败Mock改为无效actor/location引用，继续检验取消、刷新、原文查看、只补World、自动提交及回滚；不以无效证据文字制造产品失败。
- 已保留联系人/初始同伴保护、V1–V5读取、数据类型、时间、经济、隐私上下文、CAS和原子性断言；删除仅要求旧来源/语义审查拒绝的专项用例与`world-fact-tense.test.ts`。
- `world-school-original.json`字节未改，SHA-256为`53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb`。完整3条命令在合成合法状态下可解析/模拟；没有原始玩家存档，不能声称实机历史故障完整复现。

冻结提交后的完整验收使用下列命令，最终SHA、通过/失败/跳过数量记录在本PR验收报告中，避免把开发中成绩混为最终HEAD结果：

```sh
npm run check
npm run prompts:check
git diff --check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile
```

`check`包含Lint、全部Vitest、TypeScript和生产构建。所有模型响应使用Mock；无真实付费调用或新自动收费入口。未主动部署生产环境；PR预览环境若运行，由现有Cloudflare自动流程部署。

## 变更文件

- `WORLD-SEMANTIC-REVIEW-REMOVAL.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/WORLD_EVENT_LIFECYCLE.md`
- `e2e/event-entry-feedback.spec.ts`
- `e2e/world-handoff.spec.ts`
- `e2e/world-runtime.spec.ts`
- `e2e/world-scene-contract.spec.ts`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/06_story_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/stages/opening/world.md`
- `prompts/stages/regular/world.md`
- `src/domain/events/interactions.ts`
- `src/domain/state.ts`
- `src/domain/turnCommit.ts`
- `src/prompts/context.ts`
- `src/services/ai/errors.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/evidence.ts`
- `src/services/validation/worldDependencies.ts`
- `src/services/validation/worldDiagnostics.ts`
- `src/services/validation/worldEventContinuation.ts`
- `src/services/validation/worldEvidence.ts`
- `src/services/validation/worldFactNature.ts`
- `src/services/validation/worldOutput.ts`
- `src/services/validation/worldSceneRecord.ts`
- `src/tests/automatic-settlement-diagnostics.test.ts`
- `src/tests/event-handoff-composition.test.ts`
- `src/tests/event-lifecycle-runtime.test.ts`
- `src/tests/fixtures/handoff.ts`
- `src/tests/fixtures/world.ts`
- `src/tests/npc-memory-review.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/runtime-log.test.ts`
- `src/tests/time-preflight.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/variable-source-port.test.ts`
- `src/tests/world-data-boundary.test.ts`
- `src/tests/world-event-handoff.test.ts`
- `src/tests/world-event-knowledge.test.ts`
- `src/tests/world-fact-runtime.test.ts`
- `src/tests/world-fact-tense.test.ts`
- `src/tests/world-handoff-review.test.ts`
- `src/tests/world-handoff-review2.test.ts`
- `src/tests/world-handoff-review3.test.ts`
- `src/tests/world-handoff.test.ts`
- `src/tests/world-lifecycle.test.ts`
- `src/tests/world-observer.test.ts`
- `src/tests/world-scene-contract.test.ts`
- `src/tests/world-scene-record.test.ts`
- `src/tests/world-school-original.test.ts`
- `src/tests/world-stage.test.ts`
- `src/tests/world-validation.test.ts`
