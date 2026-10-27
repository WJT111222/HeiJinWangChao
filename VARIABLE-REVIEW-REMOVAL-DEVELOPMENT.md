# 变量审查机制删除报告

## 基线、目标和范围

基线：远端 `main@c55478ba307c4782e0b71d383d8110683bdd9c72`（PR #37 合并），独立分支 `codex/remove-variable-review`。

本次执行新的产品决定：删除额外变量审查，不替换为新的来源认证、封印、审批开关或 AI 裁判。此前 P0C-2 / 3A / 3B 报告描述的是历史实现，其审查部分已由本次删除取代，不是保留的备用方案。

现有正式游戏仍走原三阶段链路。本次没有接入文本变量工作流，没有修改模型调用、存档 Schema、UI、设置、凭证或模块化 Prompt。

## 实际删除

完整删除以下七个审查模块，没有空壳、兼容导出或备用实现：

- `src/candidates/variableText/model.ts`
- `src/candidates/variableText/basis.ts`
- `src/candidates/variableText/policy.ts`
- `src/candidates/variableText/coverage.ts`
- `src/candidates/variableText/hash.ts`
- `src/candidates/variableText/verify.ts`
- `src/candidates/variableText/index.ts`

同时删除专属的 `src/tests/text-variable-candidate.test.ts`（96项），从 package.json 和 lock 移除仅供该同步审查使用的 `@noble/hashes`。

其他删除项：

| 文件 | 删除的逻辑 |
| --- | --- |
| `src/executors/variableText/model.ts` | Context 的 proofs、expense、memorySource、interactions 及相关 Schema、CommandProof 导出、missing_provenance 错误 |
| `src/executors/variableText/compile.ts` | 每条指令必须匹配额外 proof；支出须匹配独立凭据；NPC记忆须匹配现场/旧记忆来源；现场互动授权；主角持有物品的额外访问限制；私人/公开记忆的额外审批；依赖外部来源的事实去重 |
| `src/bridges/variableText/index.ts` | 独立四字段预演授权白名单、同场授权、缺来源阻断、自动生成的 preview 审计伪凭据 |
| `src/bridges/variableText/model.ts` | authorization 阶段、sufficient_for_preview、commitAllowed、contextKind 和相关审批错误 |
| `src/services/validation/evidence.ts` | 整个 variablePermission 额外权限函数及仅为它服务的导入 |
| `src/services/validation/aiOutputs.ts` | 临时权限状态、互动集合、variablePermission 调用；不同 commandId 按内容相同判为同一事实的阻断 |
| `src/prompts/variableDomains.ts` / `src/workflows/variableStage.ts` | assertVariableCoverage 函数、导出、导入与真实运行调用 |

没有保留 `coverage.complete=false`、候选准备封印、独立同步候选复核或新的候选结构。代码中不再存在上述审查函数、类型和凭据字段的引用。

## 保留的真正执行功能

- `<命令>` 解析器、路径节点、JSON值、行列位置、资源限制及危险路径保护均原样保留。当前解析器原本支持 set/add/push；delete 等未实现语法仍按原规则明确拒绝，本次未删除任何已有语法，也未新增语法。
- C2 原有路径到 DomainCommand 的映射保留：文本状态 set、现金/线上资金负值 add、已有物品数量 add、NPC记忆 push。这是实际已实现的字段映射，不再叠加事实审批。未映射路径仍明确 unsupported_path，不增加任意对象赋值器。
- 编译上下文现在只有 `{draft, expectedRevision}`，没有事实凭据或互动许可。
- 支出直接按负数指令生成 SpendFunds；金额仍是整数分且余额非负，未知余额不假装为零。既有正向收入尚没有文本映射，仍明确拒绝，而原 ReceiveIncome 领域能力完整保留。
- DomainCommand 原 Schema 需要 evidence 和 purpose，因此文本执行器使用中性来源定位“文本变量指令第N条”和“剧情消费”。它们不宣称证明事实，不进入授权判断，也不要求与小说逐字一致。
- NPC记忆沿用输入的 knowledgeSource 自由说明、knowledgeKind 与 visibility；不检查独立来源是否存在，也不扫描正文证明亲历。程序仍生成稳定记忆ID、当前回合来源、目标NPC引用和游戏时间。领域 Schema 的字段、归属、认知类型格式和时间一致性保留。
- 同批同文记忆不再被事实指纹当作重复经历拦截；各条命令有自己的稳定ID。整批精确重放仍不新增记忆、扣款或改变数量。程序不再承诺识别 AI 用不同命令描述的同一次现实经历。
- 私有记忆只写指定NPC；不会因本次执行自动复制给其他NPC、写入公共摘要或升级可见性。明确传入的合法 player_known 值不再额外审批。既有玩家显示投影、历史检索和记忆维护隔离未修改；程序不再认证 AI 所写的经历在语义上为真。

现有领域命令、GameState、TurnDraft、存档迁移、SaveRepository、commitCommands 和正式事务均未修改。实体存在性、数量、资金精度、装备/归属引用、地点一致性、合法日期、幂等、命令ID冲突、正式版本及旧响应保护继续由原引擎处理。

C2 内存模拟仍重建当前版本的执行计划并整批调用 commitCommands；计划中的 state/context 摘要只用于防止模拟输入被替换或用错旧版本，不是批准剧情或许可结算的封印。3A 仍保留只读预演和输入快照保护，返回原有精简文本摘要，不返回正式可写存档，不另造审查状态机。

原 Runtime 返回值标注“不能直接提交”以及 TurnDraft 中原有阶段完成/校验状态仍属于实际请求与事务流程，不是3B的审批许可。本轮没有改动它们，也没有使用这些标签恢复任何已删除的来源门槛。

世界阶段原有任务/事件协议、后台实体职责边界和知识隔离不属于本轮新增文本变量审查；本次没有重构世界阶段。开局时间协议、普通时间单向校验、历史视角约束与正式提交数据一致性检查保留，不增加文学事实判断。

## 失败复现和测试调整

先新增 `variable-execution-without-review.test.ts` 的7项验收并在原main实现运行：**7项全部失败**。它们实际复现：无proof的普通消费、离场NPC健康更新、observed/reported/suspected记忆新增、桥接消费、原JSON变量入口离场更新被额外门槛阻断。删除后7项全部通过，之后增加7项数据与幂等回归，共14项。

新增测试还验证NPC持有物品的合法数量更新、私人记忆不自动传播、显式 player_known 无额外许可、同批独立push及精确重放、非法余额/物品/NPC整批失败。测试使用真实解析、编译、DomainCommand及commitCommands内存模拟，不用伪造成功的编译器Mock。

按新要求删除过时审批测试，而非恢复审查逻辑：

- 删除3B候选审查文件的96项测试。
- C2从144项保留105项，删除39项独立来源、互动凭据、额外访问审批及依赖来源的事实去重测试。
- 3A从70项保留41项，删除29项授权白名单、伪凭据及缺来源阻断测试。
- 原JSON变量测试中，初始NPC合法知识、离场更新、不同ID同额交易改为直接验证正常执行；组织模块选择测试保留，删除完整性审批断言。
- 开局测试保留冲突时间拒绝，将“等值、不同ID时间命令必须拒绝”的旧内容去重断言改为验证既有 variableCommandsForTurn 确实只注入一个程序时钟。没有放松非法日期、时钟冲突、倒退或未确定时钟保护。
- 原有解析器、三阶段、存储事务、费用授权和浏览器安全测试未删除或跳过。

首轮全量运行暴露上述等值时间旧断言仍依赖按内容去重，已按唯一程序时钟的真实行为更新；不是恢复剧情审查，也没有改动时间实现。

## 最终验证

- 新增14项无审批执行/数据安全回归；原main上先运行的7项全部失败，删除门槛后全部通过。
- 定向：`npx --cache /tmp/heijin-npm-cache vitest run src/tests/variable-text-executor.test.ts src/tests/variable-text-bridge.test.ts src/tests/variable-execution-without-review.test.ts src/tests/variable-commands.test.ts src/tests/opening-time.test.ts`，252/252通过。五文件分别105、41、14、33、59项。
- `npm run prompts:check`：3文件、82/82通过（属于工程测试子集，不重复计数）。
- `npm run check`：44文件、1593/1593通过，ESLint、TypeScript与Vite生产构建通过。原1743项中按产品决策删除164项过时审查测试（96+39+29），新增14项，净减少150项；没有跳过测试。修复后再次完整执行也通过：1593项、测试64.91秒、生产构建1.60秒。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：290/290通过，桌面145、移动145，18.4分钟，未删除、跳过或重试原E2E。
- `npm ls --omit=dev --depth=0`：仅React、React DOM、Zod；审查专用依赖已移除。
- 静态清理检查：审查模块目录已删除，源码中上述专用类型、函数、导出及调用均不存在。
- `git diff --check` / `git diff --cached --check`：通过；受保护目录对基线diff为空：解析器、domain、存储、UI/app、AI Runtime、Story/World/Coordinator、prompts与e2e。

构建仍有既有大于500kB的分块提示，本次不扩大范围处理。

## 已知限制和费用

本轮仅拆除审查和依赖，不扩大文本映射、不实现新候选或正式文本工作流。AI 对事实的理解和变量变化的合理性不再由这些额外规则证明；有效数据但语义错误的变化不在本轮程序保障内。重复提交保护不等于识别两条不同ID是否描述同一次故事经历。

未修改模块化提示词；历史文档与Prompt的表述不作为重新启用已删除代码的理由。本轮没有新设置、审查开关、AI裁判、额外网络请求或收费场景，未调用真实付费模型。测试通过只代表Mock与确定性执行回归通过，不代表真实模型效果经过验证。

不自动合并、不主动部署生产环境；Draft PR预览可由现有Cloudflare自动流程部署。完成后等待审查。
