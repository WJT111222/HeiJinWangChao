# 记忆总结系统 V2

基线：远端 main `508697da9b6309b2fa014511ee6e6a932c1b0a3e`（开工时核实）；分支 `feat/memory-summary-v2`。

## 调查与实现边界

原实现已有独立 Memory 路由、公共两层压缩、NPC 认知分组、Web Locks、来源快照和 IndexedDB 原子保存。本轮沿用这些能力，没有新增记忆存储系统或模型阶段。

原问题：NPC 需超过20条才触发，每批10条；公共/NPC预算会缩小批次；来源上限10；只有公共自动维护总开关，且只在提交后检查；内容要求与机器协议混在固定模块里。

参考仓库只读：`MoRanJiangHu/prompts/runtime/memoryRefine.ts`、`hooks/useGame/npcMemorySummary.ts`、`components/features/Settings/MemorySummaryModelSettings.tsx`。参考分层、因果保留、最早来源与最近5条预留思路。没有移植其状态、字符串格式、整个 Hook 或存档结构。

## 默认配置与设置

| 类型 | 自动条件 | 精确批次 | 默认启用/自动 |
|---|---|---|---|
| 公共短→中 | 合格数量 >30 | 最早10条 | 开/开 |
| 公共中→长 | 合格数量 >50 | 最早10条 | 开/开 |
| NPC原始→个人中期 | 未覆盖合格数量 >=20 | 最早15条 | 开/开 |

设置 → 一级「记忆总结」分别编辑 enabled、automatic、threshold、batchSize、完整内容提示词，分别恢复默认及立即总结。原「记忆」保留即时正文窗口。沿用 AI 配置的独立 Memory 模型路由，不保存密钥副本。无有效游戏存档时可编辑但不可执行。

设置仍使用 `heijin.settings.v1`。旧文档没有 summaries 且明确 automaticMaintenance=false 时，保留三类付费自动维护关闭；缺失的新功能字段使用新默认。旧总开关只用于读取兼容，运行由三类配置决定。已有 summaries 优先，避免旧总开关覆盖玩家的新选择。

设置有未保存提醒；仅合并实际编辑字段，避免另一个后台暂停动作被旧表单覆盖。关闭或换页需处理未保存编辑。即时按钮使用已保存配置，脏表单时禁用。NPC多目标必须选择；只有一个合格目标时可直接执行，不跨人物合并。

## 内容提示词与机器协议

`src/domain/memories/defaultPrompts.ts`完整保留任务给定三份默认内容提示词（包含建议字数与事件数）。程序不解析这些文学要求。玩家编辑只影响新任务，不改写旧历史。

真实 Memory 请求为：冻结内容提示词 system → 原模块选择器读取的固定协议 system → 选定完整来源 user。固定公共返回：

```json
{"summary":"阶段概括","importantEvents":["有时间、人物、行为及结果的事件描述"]}
```

两部分均须非空，至少一个非空事件是结构底线，不检查提示词要求的3/5/99条、字数或文学质量。保存到已有 MemoryEntry.text 中的「阶段概括 / 重要事件」段落，时间与来源由程序重建。原有已保存纯文本总结继续可读；新响应不接受旧 entries 输出作为成功替代。

NPC沿用 `summaries:[{groupId,text}],unresolved:[],contradictions:[]`，程序按认知性质/可见性建立精确分组，要求每组完整对应。每组内容为第三人称连续叙述，保留既有亲历/转述/推测/未知标记，不把报告或猜测升级为亲历。NPC中期不再进入第二次压缩。

Prompt Manifest哈希已刷新，sources.lock保留原来源哈希并登记 memorySummaryV2 改动哈希。三阶段只序列化原叙事 PROMPT_SETTINGS，不重复注入总结内容提示词；完整世界读取与历史召回保持原状。

## 动态批次与兼容

运行时批次冻结 expectedCount 与来源快照；当前任务不随设置变化。公共和NPC精确取batchSize，不足一批不请求。立即总结只绕过阈值，不绕过enabled、固定数量、来源、预算或事务。

技术范围：阈值1～10000，每批1～100且不超过阈值，内容提示词1～30000字符。NPC provenance.sourceMemoryIds 上限扩为100；仍为V6原字段，无新版本/迁移。旧10条总结不会因配置18或15而失效。

完整来源输入上限16000字符/12000估算Token；完整请求20000字符/16000估算Token；结果文本技术上限64000字符。超过任一上限明确失败，保留原记录，不截断、不缩小、不悄悄换NPC。长提示词与来源共同受请求上限约束。旧超预算自动跳过目标的规则已被明确失败取代。

NPC默认20→覆盖最早15，5条活跃剩余；再增15→活跃20→再处理最早15。所有原始记录继续保存。自定义25/18已通过真实执行器Mock请求及保存验证。公共压缩仅替换已有公共摘要，永久journal不动。

## 后台队列、费用与恢复

`useMemoryMaintenance`仍仅在GameScreen持有一个执行器，设置只传递动作。`MemorySummaryQueue`串行调度三类任务；挂载读档、正式Commit成功及每60秒唤醒。一次唤醒每类至多一批，轮换类别优先级与NPC稳定ID游标，跨刷新保存游标。大量积压不会一次清空。

原每存档 Web Lock 贯穿选源→请求→保存，跨标签互斥；不支持时失败且不调用模型。自动请求上限每分钟3次、每小时12次（含已发出但失败的请求），手动一次明确授权不占自动限额。正常三阶段请求次数不变；新增默认自动NPC与读档积压检查会带来玩家已启用的Memory费用场景。无额外修复AI或自动失败重试。

付费前保存 `heijin.summary.attempt:<saveId>:<createdAt>:<kind>` 的批次摘要ID；成功保存后清除。失败/中断/刷新不自动重放未完成尝试。IDB已保存但确认标记清除前崩溃，会按确定性结果ID确认已有来源覆盖，不再为旧来源收费。只有摘要ID与限额时间戳进入本地调度记录，没有原始私人记忆、供应商正文或凭证。

失败按类别独立保存安全代码/目标，最多显示一个弹窗。重新生成仅一次手动授权，重新选择/验证当前来源；暂停仅将本类enabled/automatic都关闭并持久化，其他类别继续。×仅暂时关闭失败提示，不清除失败保护或擅自重试；刷新可再次提示。暂停后在设置重新启用可恢复新任务。

队列卸载/切档停止、请求取消；读档等待期间再次检查停止与启用状态。保存阶段沿用不可假取消语义。请求期间仍可游戏；原 saveMemoryCompression/saveNpcSummary 在事务中读取最新正式状态、验证来源，只替换记忆字段，保留新revision、时钟、NPC、经济和journal。没有改动保存仓库或正式Commit实现。

## 测试、截图与真实限制

开发先运行失败回归：20条NPC未触发15批次、公共预算偷偷缩小，两项在旧实现失败。修复后在同一来源上通过。

旧测试保留来源归属、权限、CAS、原子保存、密钥脱敏、取消/超时/迟到/跨标签、读档与主流程断言；只更新已明确改变的产品规则（默认自动开启、NPC20/15、超预算整批拒绝、新公共输出结构、独立设置入口）。NPC来源历史断言改为永久journal保留，未更改PR74对无关召回的准入规则。

执行结果最终冻结后填写，不把中间批次或历史成绩合计成最终结果。

截图来自真实React + Mock网络：

- [桌面设置](memory-summary-v2/screenshots/settings-desktop.png)
- [移动设置](memory-summary-v2/screenshots/settings-mobile.png)
- [桌面失败提示](memory-summary-v2/screenshots/failure-desktop.png)
- [移动失败提示](memory-summary-v2/screenshots/failure-mobile.png)

本地Mock验证的是执行、安全与交互，不代表真实长期剧情总结质量或真实供应商兼容性。没有真实付费模型测试。浏览器关闭后不运行；Web Locks不可用时不降级为无锁请求；完整来源太大时需要用户调整批次或提示词，而不是静默截断。localStorage与IDB并非跨库事务，使用未完成标记与已保存结果ID进行安全恢复；存储整体不可用时明确失败。

### 大范围浏览器检查发现的基线测试漂移

使用与 main `508697d` 对相关文件无差异的 PR77 工作树，独立端口5191复现以下旧断言问题；没有改其生产代码：

- event-entry-feedback 的两项检查仍禁止 Story 读取后台事件背景；memory 的一项检查仍禁止读取NPC私人记忆，与已经合并的PR73全量作者读取相冲突。改为正向验证完整SAVE_STATE/NPC_KNOWLEDGE，同时继续检查入场提示、近期正文不自动添加私人知识；保留原正式状态、回执、请求次数及Commit/刷新断言。
- 历史时间轴按钮使用旧“06”标题，改用现有世界资料目录和可访问名称，移动端也实际打开目录。
- 设置零外部请求检查写死5174，隔离端口下把本地静态资源误计为外部。改为与Playwright真实baseURL的origin比较，外部请求零断言仍保留。

这些修改仅对齐已经生效的PR73/76/77契约，没有恢复遮挡、修改事件业务或放宽数据校验。未将中止批次与定向复测相加冒充最终全量结果。
- 手机记忆阅读测试关闭记忆弹窗后仍保留世界目录，导致点击目录背后的诊断区超时；使用已有openGameTools关闭目录后再检查，不触发任何生成。Trace确认阻挡者为原目录弹窗。
- 一次并行定向复测复用了大批次的本地Vite服务；中止大批次使该服务退出，余下8项连接拒绝。该批不计为通过；改为独立拥有服务后重新执行，非产品错误。

### NPC失败后的目标切换保护

新增失败回归复现：A失败→手动B成功→原NPC失败记录被按类别清掉→后续自动再次请求A。修复为同类未处理失败必须先处理原任务；切换立即总结目标不会发出请求或清除保护，也不偷偷改为另一个NPC。提示明确说明当前选择未请求模型，可处理原失败，或暂停本项后重新启用。这个保护只管理未处理的付费任务，不评判记忆内容。新增回归先红后绿；原始记忆、其他两类任务及NPC选择机制不变。

## 实际修改文件

- `e2e/event-entry-feedback.spec.ts`
- `e2e/game.spec.ts`
- `e2e/helpers/memorySummary.ts`
- `e2e/memory-maintenance.spec.ts`
- `e2e/memory-summary-v2.spec.ts`
- `e2e/memory.spec.ts`
- `e2e/npc-memory.spec.ts`
- `e2e/player-memory.spec.ts`
- `prompts/manifest.json`
- `prompts/memory/medium_to_long.md`
- `prompts/memory/npc_summarize.md`
- `prompts/memory/short_to_medium.md`
- `prompts/sources.lock.json`
- `src/app/App.tsx`
- `src/app/styles.css`
- `src/domain/memories/compression.ts`
- `src/domain/memories/configuration.ts`
- `src/domain/memories/defaultPrompts.ts`
- `src/domain/memories/npcMemory.ts`
- `src/domain/memories/schema.ts`
- `src/prompts/context.ts`
- `src/tests/memory-compression.test.ts`
- `src/tests/memory-summary-v2.test.ts`
- `src/tests/npc-memory-review.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/prompts.test.ts`
- `src/ui/game/GameScreen.tsx`
- `src/ui/game/useMemoryMaintenance.ts`
- `src/ui/panels/MemoryMaintenanceControls.tsx`
- `src/ui/settings/MemorySummarySettings.tsx`
- `src/ui/settings/SettingsPanel.tsx`
- `src/ui/settings/UnsavedAiChanges.tsx`
- `src/ui/settings/model.ts`
- `src/workflows/memoryMaintenance.ts`
- `src/workflows/memorySummaryQueue.ts`

开发报告及四张实际界面截图另见本文件与上述截图链接。没有修改saveRepository、正式三阶段工作流、recall或sharedContext。
- 开局与时间预检中的精确状态文字断言遗漏PR76已有的「三阶段 · 」前缀。`git show 508697d:src/ui/game/GameScreen.tsx`可见相同前缀，本轮未修改该状态栏。仅补全精确期望字符串，保留非法日期拒绝、World失败不提前初始化、正式状态/草稿/请求次数及恢复断言。
- Story旧流式夹具仍用创角性别“女”，PR71基线创角接口明确只接收“男性/女性”，导致11项在发请求前失败；只将测试输入改为“女性”，不修改创角验证。提示词检查器另有一处5174写死，同样改为实际baseURL的origin，零外部请求断言保留。
- Story/Variables/Coordinator各有一个切档测试仍点击已由PR77移除的桌面顶部“切换存档”。改用已有响应式goHome helper进入同一存档列表，再按原断言切档，保留取消/迟到/恢复和不串档验证。
