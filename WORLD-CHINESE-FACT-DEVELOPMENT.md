# World 中文事实误判：复现与修复

## 范围与基线

从合并 PR #54 的远端 `main@f9854b0` 创建 `codex/world-chinese-fact-tense`。只修复 World 派生事实的中文名词/意图误判及安全诊断。不修改 Variables 三标签/67 项路径、Schema、存档事务、模型路由或超时。没有真实付费模型调用。

## 真实输入与复现

`src/tests/fixtures/world-school-original.json` 直接提取自用户随后提供的完整 JSON 代码块，保留原字段、值、顺序、evidence 字符串与三个 visibleHooks，只添加文件末尾换行。SHA-256：`53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb`。测试固定哈希，禁止为了通过校验改写响应。

原始 GameState、TurnDraft、Story 和 Variables 结果未提供。`worldSchoolOriginalContext.ts` **仅为合成的最小合法状态**：复用响应中的实体 ID、地点、回合 ID 和时间，并明确假设 NPC 在场/离场。为隔离权限测试，合成旁白包含响应引用的 fact；这不能证明真实 Story 曾逐字包含这些事实。金额、人物字段和正式基线时间也不是从用户存档恢复的数据。

修复前保留两个实测日志（位于仓库外 `/workspace/world-chinese-fact-verification/`）：

- `before.log`：新增首批 12 项中 11 失败、1 通过。其中真实片段及 3 个名词用法是误拒绝；另外 7 项检查的是缺失的细分诊断，并非声称出现 7 种新的业务漏洞。
- `full-original-before.log`：在未修改的 main 独立临时 worktree 运行完整原文相关 5 项，4 失败、1 通过。来源读取和整批校验均被首条 SaveTask 的 `speculative.test(proof.fact)` 拦住，报告 `taskCommands.0 / SaveTask / constraint`，与用户日志的已定位路径一致。

用户第一次 timeout 没有纳入本 PR，也没有增加超时重试。

## 修复方式

新增纯函数 `derivedFactRule()`，替换非结构化生命周期决策的 `derived.fact` 及旧协议派生成果 `outcome` 上的全词命中判断：

- 逐分句识别计划/条件、推测/转述、否定三个类别。
- `准备/计划/预计` 不因出现便直接拒绝。使用有界谓词—宾语/主语—谓词规则，区分“进行迎检准备”“启动检查准备工作”“执行整改计划”“准备工作已经启动”和“准备明天检查”“计划下周整改”。没有“迎检准备”专属白名单。
- 日期词可作为当前动作的宾语（例如“正在整理明天的材料”）；不能单凭该日期把未来行为当成已经发生。
- 混合多个分句时，一个已发生动作不能替其他尚未实施的计划、推测或否定背书。
- 保留原否定作用域函数、取消目标来源与肯定终止检查，以及“未能完成，行动已终止”的原有例外。
- `planned/reported/suspected/established` 结构化种类的权限没有改变。来源先按现有规则解析，派生事实仍需合法 fact/motive 来源；任务状态、时间窗口、阻碍、完成条件和角色知识权限仍在原验证器检查。
- 既有结构化生命周期 decision 分支保持原语义，由原目标、状态、条件、时间和来源校验约束，没有重新引入词法审判。

这只是有限、可解释的歧义词处理，不是中文 NLP、事实真实性证明器或新的 AI 审判阶段。陌生名词结构、长修饰语、反讽等仍可能保守误拒。未修改来源 `knowledgeSource` 的保守分类，也未放宽 established 原文对应和知识归属。

## 完整真实响应的逐项结果

| 原始部分 | 本轮确认结果 |
| --- | --- |
| 第一条 SaveTask | 原 evidence 通过来源/时态检查；在合成合法上下文中，其组织行动者、状态、时间和依赖也能继续验证。无需改写“迎检准备”。 |
| 第一条 SaveEvent | 原事件含主角与两名现场 NPC。在合成 `onScene=true` 状态下仍被 `actor_permission / eventCommands.0` 拒绝；不放宽 World 的现场/场外边界。原存档是否在场需要实机快照确认。 |
| 第二条 SaveEvent | 原证据为 planned，新事件 visibility=partially_known；现有显式知情提升要求独立已知事实，因此被 `player_knowledge` 拒绝。即使假设前两名 NPC 已离场，完整原文仍停在 `eventCommands.1`。不把 planned 自动提升为角色事实，不悄悄改成 hidden。 |
| futureEvents 与双向任务引用 | JSON Schema、原事件镜像、开始/预计时间及 task.linkedEventId ↔ event.linkedTaskIds 在独立领域内存模拟中相符。这个模拟**不是** World 权限验证通过，更不是保存候选或正式提交。 |
| 完整真实整批 | 修复前卡在第一条任务；修复后能暴露后续独立权限问题，**仍不能保存成成功候选**。本 PR 没有为了整批全绿改变原输出或放宽这些规则。 |

验证走 `parseWorld()`、真实来源构造/依赖排序/领域内存模拟，并增加实际 `WorldStage → runStageRequest → 校验 → IDB` 测试。真实整批失败时上游 Story/Variables 保留，正式状态不变。另有明确标为“合成”的合法两事件批次验证成功候选写入，不与真实整批混称。

## 安全诊断

新增静态规则名与中文说明：`fact_plan`、`fact_uncertainty`、`fact_negated`、`task_state`；完成条件沿用 `completion_conditions`。已有 `source_missing/source_time/source_knowledge/source_owner` 继续区分来源问题。

事实误判或真实拒绝可以定位到 `taskCommands.0.evidence.fact` / `evidence.outcome`、SaveTask、命令序号；运行日志只携带规则、白名单字段路径和类型，不复制 fact、NPC 私有内容、原始响应、凭证或异常堆栈。现有 UI 通过规则字典显示说明，无需改 UI 架构。

## 修改文件

- `src/services/validation/worldFactNature.ts`：有界事实性质判断。
- `src/services/validation/worldEvidence.ts`：派生 fact 调用与精确路径。
- `src/services/validation/worldOutput.ts`：旧协议成果使用同一判断，任务状态细分诊断。
- `src/services/validation/worldDiagnostics.ts`：安全规则名与文案。
- `src/tests/fixtures/world-school-original.json`：完整真实响应，固定哈希。
- `src/tests/fixtures/worldSchoolOriginalContext.ts`：明确标为合成的最小状态。
- `src/tests/fixtures/worldChineseFact.ts`：真实 evidence 与明确标为合成的合法任务/事件。
- `src/tests/world-school-original.test.ts`：原文、依赖、权限、镜像与正式状态不变。
- `src/tests/world-fact-tense.test.ts`：名词/计划/推测/否定、成果及原有数据底线。
- `src/tests/world-fact-runtime.test.ts`：三协议 Mock、实际 WorldStage、IDB、安全失败与明确恢复。
- `e2e/world-runtime.spec.ts`：新增桌面/移动共 2 项；计划失败显示诊断，明确恢复后接受原证据片段和合成合法事件，刷新不重发。
- 本报告。

## 验证记录与验收方式

新增 44 项工程测试，保留原 2106 项；新增 2 项浏览器测试，保留原 324 项。所有模型响应为 Mock，无真实付费调用。

工程检查：`npm run check`（包含 Lint、2150 项 Vitest、TypeScript、生产构建）；提示词检查：`npm run prompts:check`（82 项）；`git diff --check`。构建原有 >500kB 包体警告不属于本次修复。

浏览器验收使用仓库 Chromium desktop/mobile 配置，先执行受影响文件，再在代码冻结的提交上执行完整批次：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/world-runtime.spec.ts --project=desktop --project=mobile
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile
```

实际退出码、逐平台数量、耗时、验收 SHA 和产物哈希记录在本分支 Draft PR 的最终验收评论，避免仅为填写测试数字而在已验证代码后生成另一个未跑浏览器的提交。尚未运行或失败的检查不得写成通过。

## 剩余限制

没有原始存档，不能宣称已完整恢复用户当时的上下文或证明真实整批可以成功；已明确暴露的事件权限/知情问题留待独立产品决策，不在本轮放宽。真实模型措辞、网络 timeout 和真实浏览器存储环境也不在 Mock 验证的保证范围内。正式存档、API 费用策略、重试次数与原子提交均不变。
