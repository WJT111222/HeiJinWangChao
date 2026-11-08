# 三阶段上下文预算与检查器 V1（PR C）

开发基线为远端 main `436baa02704f475caaf6ab92a39a188ec2e47fde`（已合并 PR #73/#74）。独立分支 `feat/context-request-inspector`，仅提交 Draft PR；不合并、不部署、不调用真实 AI。

## 审计与接入

检查了 `composer.ts`、`context.ts`、`sharedContext.ts`、`statistics.ts`、`recall.ts`、`preview.ts`，以及 AI runtime/client/protocols/inspection/configuration/snapshot、现有 PromptInspector/ContextInspection、单元与浏览器检查器测试，并对照 [PR #73 报告](THREE_STAGE_CONTEXT_V2.md)、[PR #74 报告](SHARED_MEMORY_RECALL_V2.md)。

沿用设置中的提示词检查器：选择真实存档，点击“生成三阶段组装预览（不联网）”。第一层 Story/Variables/World 概览展示准确字符、启发式估算及窗口未知，详细来源尚未分析；第二层主动展开后由专用 Worker 分析分类、正式 NPC/记忆数量、近期/召回数量、原始预算诊断和重复；第三层仍使用“主动查看完整内部上下文”，核对最终 messages、GAME_CONTEXT，或实际原生请求体。预览缺合法正文草稿时沿用原失败原因，不伪造 Variables/World。

离线预览经真实 `composePrompt` 取得最终 messages。实际记录从客户端已序列化的同一个原生 payload 经 `payloadMessages` 解码，只在发送边界计量原始轻量总量，然后保留脱敏副本；详细分析按需从副本执行，不额外组装或请求模型。未发生内容脱敏时，副本等于实际最终消息，可精确对账；发生脱敏时，分类、重复及召回诊断明确标为副本口径，显示原始/副本总量及差额，不能精确还原原始分类。不会保留原始密钥或未脱敏请求的额外长寿命缓存。只有实际 API 返回的 usage 才显示供应商用量。请求记录继续仅保留会话内存最近 12 条；NPC 私人维护继续遵守原有隐藏规则。

## Review 修订：请求优先与后台按需分析

评审基线 `c8059ee227fa37018e754b312aac58dcd85ea9f4` 的调用链是 `AiClient.generate → operation（已开始超时计时）→ requestInspections.start → inspectBudget → response/HTTP`。上表的 1000 NPC 合成样本中，三个阶段原完整诊断分别占约 4.1/3.7/6.7 秒；即使没有打开检查器，也会阻塞发送和主线程。这是本次修订处理的问题，表中的原始同步诊断耗时保留为历史证据，不代表修订后的发送延迟。

现在 `start` 只捕获原生请求的安全副本、轻量字符/UTF-8/估算总量及模块/路由元数据，随后立即进入原 HTTP 路径；不会调用或等待详细分类、重复扫描或 Worker。观察器 start/finish 抛异常也不会改变请求成功、原始错误或使用量。原 timeout、stream、请求体和模型路由均沿用。`buildStagePreviews` 同样先生成合法的三阶段最终消息与基础统计，不再同步调用三次详细诊断。Composer 的合法草稿检查不变。

选中实际请求或预览并展开“数据分类、召回预算与重复诊断”才创建专用 module Web Worker（`budgetInspection.worker.ts`），只发送已脱敏的最终 messages；Worker 执行原 `inspectBudget` 算法，返回结构化测量。没有 `Promise.then`、定时器主线程重算或 Worker 失败后的重型回退。60 秒定时器仅用于结束失联的诊断 Worker，不参与游戏超时或重算。无 Worker、启动/传递受阻、运行异常均显示不可用/失败，可重试，基础快照与实际 usage 保留。

界面区分尚未分析、正在分析、完成（缓存）、失败/不可用；未计算值不会展示成零。按稳定 messages 引用用 WeakMap 保存会话内结果，finish 更新实际 usage 不更换该引用；重复展开、切换后返回已完成请求均复用结果。关闭详情、切换请求/阶段/来源、离开组件或清空记录会终止正在运行的 Worker；旧 Worker 回复以实例身份检查丢弃，不能覆盖新选择。清空记录不会被迟到响应重新插入。没有新增 localStorage、IndexedDB 或其他持久化。

边界：轻量统计、JSON 解码、既有脱敏与冻结仍在主线程，随请求体大小增长；Worker 的 structured clone、结果传回和 UI 渲染也有成本。修订只移走完整诊断阻塞，不承诺零发送开销、硬性帧率、内存上限或性能 SLA。1000 NPC 完整分析仍需数秒，用户可取消。完整内容主动揭示仍是独立的用户操作。

## 统计口径与最终消息映射

字符为 Unicode code point，UTF-8 字节逐条消息计算。`contentBytes` 是消息内容字节之和；`serializedMessagesBytes` 是 JSON 消息数组字节，不是 HTTP/供应商完整请求体。人工消息间换行仅沿用旧 Token 估算方法，不加入字符和字节实总。启发式 `unicode-heuristic-v1` 为 ASCII/4、其他字符×1.5 后取整；无外部 tokenizer、计费推算或费用预测。

新 `budgetInspection.ts` 对最终 GAME_CONTEXT 原始 JSON 文本解析位置，保留实际转义、引号和空白；只读遍历，不重新 stringify 值以假设传输大小。标量值按下表分类，JSON 键名、标点、容器和空白单列，所以各类字符与字节可以精确加回实总。模块级来源和 system 的固定/世界书/阶段/领域细项沿用现有 composer 模块 ID/版本/角色/顺序/字符记录；Gemini/Anthropic 可能合并 system，不能把记录中每个模块当作仍独立发送的 message。

| 分类 | 实际路径/消息 |
| --- | --- |
| 系统 | 最终 role=system 消息；模块 ID 可核对 identity/shared/worldbooks/stages/variableGroups 等来源 |
| 主角 | SAVE_STATE.protagonist/economy/items、PROTAGONIST_PROFILE、CREATION_PROFILE.protagonist；items 包含正式物品表，不推测物品归属后删减 |
| NPC 档案 | SAVE_STATE.npc、SCENE_NPCS、OFFSCREEN_STATE.npc、开局同伴档案，排除独立统计的记忆字段 |
| NPC 记忆 | 上述 NPC 的 memories/longTermMemories、SAVE_STATE.memories.npcSummaries、NPC_KNOWLEDGE 全部只读知识分区 |
| 世界 | SAVE_STATE 和 OFFSCREEN_STATE 的 organizations/locations/tasks/events/timeline/history/退役资料，以及 KNOWN_EVENTS/EVENT_ENTRIES/EVENT_SCHEDULE |
| 分层记忆 | SAVE_STATE.memories 的 short/medium/long 等，个人总结单列 NPC 记忆 |
| 近期 | MEMORY_CONTEXT.recentTurns 完整已提交 Story 与来源元数据 |
| 召回 | MEMORY_CONTEXT.recalledTurns、recallDiagnostics、recallPolicy（零召回仍可能有诊断/政策体量） |
| 当前候选 | PLAYER_ACTION、STORY_RESULT、VARIABLE_RESULT、VARIABLE_GUIDE |
| 命令协议 | TEXT_COMMAND_CATALOG、COMMAND_CATALOG（包含现有 World 命令 Schema）；固定协议说明仍按系统模块 |
| 其他/结构 | 其余元数据、政策、确认消息；JSON 键名、标点、容器、标签、空白独立结构行 |

NPC 数和正式 NPC 记忆数从最终 SAVE_STATE 对象计算，一条记忆在专项分区再出现不会增加“正式条数”，但其全部字符照实计入体量。分类采用路径数组，含点 ID 不混淆层级。无法解析的容器整条归其他并提示，不能双计或使请求因诊断失败。分类 Token 分别取整与整体 Token 的差额明示，亦包括人工消息间换行造成的估算差别；不把差额伪装成供应商协议 token。

## 可验证重复与只读边界

同 NPC ID 的完整档案与专项知识/场内外表示、同 owner 的 memory ID、近期/召回同 turnId、任务/事件/组织/地点 ID，以及长度至少 80 个 UTF-16 单位的完全相同序列化对象均可报告。不同 owner 的同名 memory ID 不直接认定同记录；相同内容检测严格比较原始序列化文本，不进行语义相似判断。

每组列明括号路径、次数、首处之后的表示体量、是否完全相同及协议兼容说明。“同一 ID 的不同表示”不宣称全文相同，不推断都可删。父 NPC、子 memory、专项对象可能重叠；逐组 extra 不能相加。额外提供全部后续 occurrence 的按 message 文本区间并集字符/字节，排除嵌套双计。**并集是重复身份/内容的后续表示占用，不是可删除、可节省或语义冗余的保证。** 保留原完整请求，不对重复对象引用去重造小数。

## 召回诊断

复用 PR #74 的 eligibleTurns/selectedTurns、omittedTurns、narrativeCharacters/serializedCharacters、当前 budget、cue 截断、派生线索省略、词项省略与高频词抑制。新增的仅为 query 原始长度/词数、已用词数、strong/auxiliary/truncated 计数及元数据序列化计数，位于检索完成后；评分、排序、候选选择、预算和同行降噪未变。

UI 另外展示实际已发召回原文的 Unicode 字符数、strong/auxiliary/truncated 记录数；元数据采用实际已转义行范围减 narrativeExcerpt 序列化值，仍含字段名、标点和摘要。原始 PR #74 预算计数/截取范围使用 UTF-16，明确与 Unicode 字符口径区分。界面固定说明：“召回预算只影响旧journal原文，不影响完整正式世界状态”。300 回合早餐测试保留 293 原始 + 6 长期 + 3 个人总结，共 302 条正式同伴记忆，旧史召回不超过 3；不能把零旧史召回说成零 NPC 记忆。

## 窗口与真实 usage

现有 Channel/config/model-list 没有可靠的输入上下文窗口字段；maxOutputTokens 是输出限制，不是上下文窗口。所有现行路由如实显示“当前模型上下文窗口未知，无法确认请求是否超限。”不根据模型名、名单或常识猜规格，不显示虚假剩余额度。

纯函数 `windowRisk` 仅接受明确可靠的窗口参数，测试覆盖已知上限与输出预留、超限、缺输出预留、缺窗口；现有产品配置没有此数据，因此不接入虚构配置。即便已知也只比较启发式输入与预留，仍有协议开销/估算误差；从不阻止游戏、自动裁剪、换模型或加请求。真实 usage 沿原供应商解析保留 input/output/total/reasoning，缺任何项就“未提供”，不求和补 total，也不拿估算补真实 input。Mock API 的 usage 有/无及 output=0 均已覆盖。

## 合成规模与增长

确定性夹具为 `contextScaleFixture`，保留原富状态的 5 个合法 NPC、完整记忆和引用，再扩到总 NPC 数 10/100/300/1000。新增每个 NPC 含背景、原始/长期/总结各 1 条，并同步增加任务、事件、组织、地点；journal 同步扩为相应回合数。近期窗口 N=3；本批日常查询不强行添加匹配旧史。这是合成压力样本，**不是生产存档或玩家平均规模**。

完整结果见 [机器可读测量](../CONTEXT-BUDGET-V1-METRICS.json)。下表按最终 composePrompt messages 统计；构建时间只含组装，诊断耗时单独记录，不是网络或模型延迟。比例按已序列化标量值，结构体量另计。

| NPC/回合规模 | 阶段 | 字符 | 内容 UTF-8 字节 | 估算 Token | 世界% | NPC记忆% | 召回% | 重复组 | 后续表示并集 字符/字节 | 组装ms / 诊断ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | story | 186,642 | 317,130 | 128,223 | 2.87 | 27.06 | 0.15 | 163 | 60,663 / 74,997 | 36.59 / 178.4 |
| 10 | variables | 206,462 | 316,942 | 120,668 | 2.59 | 20.6 | 0.14 | 187 | 60,555 / 70,725 | 106.28 / 261.69 |
| 10 | world | 240,536 | 364,276 | 137,474 | 4.28 | 22.42 | 0.14 | 245 | 100,481 / 121,979 | 30.22 / 182.78 |
| 100 | story | 598,023 | 1,022,931 | 415,081 | 13.2 | 32.73 | 0.05 | 553 | 205,315 / 320,389 | 158.96 / 592 |
| 100 | variables | 580,211 | 959,791 | 382,293 | 13.6 | 29.84 | 0.05 | 547 | 167,605 / 253,195 | 143.86 / 769.07 |
| 100 | world | 810,603 | 1,338,203 | 532,403 | 19.18 | 26.37 | 0.04 | 1145 | 390,895 / 622,573 | 274.63 / 952.12 |
| 300 | story | 1,521,046 | 2,600,502 | 1,054,929 | 16.07 | 34.38 | 0.02 | 1420 | 529,868 / 869,090 | 482.15 / 2356.76 |
| 300 | variables | 1,418,564 | 2,396,144 | 965,631 | 17.23 | 32.94 | 0.02 | 1347 | 407,555 / 660,745 | 475.68 / 1199.42 |
| 300 | world | 2,088,601 | 3,513,287 | 1,412,582 | 23.08 | 27.46 | 0.02 | 3144 | 1,041,485 / 1,739,849 | 395.43 / 1593.17 |
| 1000 | story | 4,750,431 | 8,119,539 | 3,293,308 | 17.35 | 35.11 | 0.01 | 4453 | 1,664,147 / 2,786,621 | 839.38 / 4101.98 |
| 1000 | variables | 4,353,437 | 7,424,017 | 3,007,474 | 18.93 | 34.38 | 0.01 | 4147 | 1,247,555 / 2,087,345 | 821.04 / 3730.31 |
| 1000 | world | 6,565,237 | 11,131,437 | 4,495,187 | 24.77 | 27.93 | 0.01 | 10145 | 3,321,459 / 5,654,937 | 804.61 / 6688.51 |

复现：`CONTEXT_BUDGET_METRICS=1 npm run test -- src/tests/context-budget.test.ts`。显式变量启用时覆盖根目录测量 JSON；正常测试不写此文件。每个规模的三阶段组装、测量均验证源状态/草稿无变化，分类对账为零。耗时受机器负载、冷模块缓存影响，不是性能 SLA；1000 规模明显增加本地诊断成本。

本夹具中增长最快的是完整 NPC 档案/记忆和同步世界资料，加上 World 的专项表示重复；system 基础模块相对固定，近期 N 固定，旧史召回仍独立受 PR #74 预算限制。可供后续单独设计的优化包括：核实专项表示是否可改成来源引用、共享档案引用协议、稳定缓存测量/延迟展开、明确可靠的模型窗口元数据、经过验证的本地 tokenizer。任何删减、摘要替换或新预算需单独评审；本次均未实施。

## 验证与交付限制

- 定向单元/运行时/资源回归：9 文件、141 个唯一用例通过，已包含 prompts.test / prompt-runtime / prompt-inspector，不能把后续 prompts:check 重跑再累计。覆盖最终三阶段字符/字节对账、转义 Unicode、重复只读与 owner/含点 ID、损坏容器降级、300 回合同行噪音、长原文截取/预算、可靠/未知窗口、Mock usage 有无、正式 revision 与读写权限和 12 行规模测量。
- `npm run typecheck`、`npm run lint`、`npm run build` 通过。构建仅有既有 500kB chunk 提醒；未针对无关分包改动。
- `npm run prompts:check` 通过（上述 141 用例中的重跑子集）。未修改提示词正文/manifest，因此未刷新元数据。
- 仅 `e2e/prompt-inspector.spec.ts`：desktop/mobile 共 8 用例通过，含三阶段概览、分类展开、零字符/字节差额、窗口未知提醒、最终消息主动揭示、Mock API 真实 usage/脱敏、刷新不持久化及正式状态隔离。没有运行无关浏览器全量。
- 浏览器初轮暴露旧测试仍假设 Story 隐藏正式世界背景，与已合并 PR #73 相冲突；只修正该断言为完整背景可读。编辑期间 HMR 曾清空会话内存记录；冻结源码后的最终 8 用例全通过。沙箱无法绑定 localhost，按环境规则使用获准的同命令外部沙箱重跑。
- `git diff --check` 通过；基线差异仅上述检查器、只读召回诊断计数、相关测试与报告。无生产存档、真实 AI、外发 tokenizer 或自动裁剪。

新增检查器只读测量；未改 GameState/TurnDraft Schema、journal 存储、压缩阈值、NPC 总结、PR #74 检索评分预算、PR #73 完整读范围、Variables/World 写权限或 CAS/commit/rollback/幂等。没有新增 AI 调用、请求体参数、付费 tokenizer 或外部服务。Mock 和合成规模证明传输测量与隔离，不证明真实模型能有效利用全部上下文或估算能代表真实计费。
