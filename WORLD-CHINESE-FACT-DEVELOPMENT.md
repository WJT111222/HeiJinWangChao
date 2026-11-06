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

首轮新增 44 项工程测试，第二轮新增 17 项，第三轮新增 32 项，共新增 93 项，保留原 2106 项；新增 2 项浏览器测试，保留原 324 项。所有模型响应为 Mock，无真实付费调用。

工程检查：`npm run check`（包含 Lint、2199 项 Vitest、TypeScript、生产构建）；提示词检查：`npm run prompts:check`（82 项）；`git diff --check`。构建原有 >500kB 包体警告不属于本次修复。

浏览器验收使用仓库 Chromium desktop/mobile 配置，先执行受影响文件，再在代码冻结的提交上执行完整批次：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/world-runtime.spec.ts --project=desktop --project=mobile
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile
```

实际退出码、逐平台数量、耗时、验收 SHA 和产物哈希记录在本分支 Draft PR 的最终验收评论，避免仅为填写测试数字而在已验证代码后生成另一个未跑浏览器的提交。尚未运行或失败的检查不得写成通过。

## 剩余限制

没有原始存档，不能宣称已完整恢复用户当时的上下文或证明真实整批可以成功；已明确暴露的事件权限/知情问题留待独立产品决策，不在本轮放宽。真实模型措辞、网络 timeout 和真实浏览器存储环境也不在 Mock 验证的保证范围内。正式存档、API 费用策略、重试次数与原子提交均不变。

## 合并前审查修补：实际行动与目的从句

审查基线 `ff3748d90f94ab5e2968251e3346d89fa4d886a9` 中，`governor` 将“力保/确保/保障”与执行谓词同列，并允许 `after === '落实到位'`。因此独立目标句可以让 `parseWorld()` 接受 active 任务、active 事件，甚至作为旧协议 completed 任务的 outcome。

先添加真实 `parseWorld()` 反例，在改代码前运行 `world-fact-tense.test.ts`：48 项中 **12 失败、36 通过**（`/workspace/world-chinese-fact-round2/before.log`）。失败包括三种目标句的任务、事件、成果误放行，以及跨句/跨显式主体借用执行依据；另发现同一分句“已启动工作以确保目标”的误拒绝。不是只调用一个正则判断。

本轮只修改三处文件：`worldFactNature.ts`、`world-fact-tense.test.ts` 和本报告：

1. 执行谓词和目的谓词分离，移除“落实到位”这一独立放行条件；没有把三个目的词列为一律禁用词。
2. 目的之前必须有明确的正在/已经/动作完成或“在校内排查”等实际行动表达。目的从句省略主语时，只可关联同一句中紧邻的实际行动分句；锚点上限 128，不跨句号、分号、换行、显式新主体、另一条命令或另一份 outcome，也不由目标从句继续充当执行锚点。
3. 真正的事实部分继续执行原名词、计划、推测、转述、否定检查。目的从句只作为当前动作的目的说明，不作为已完成结果；`fact` 与 `outcome` 各自独立检查。
4. “保障部门”等名词结构仍需自身明确实际动作，不能仅因后面有“工作”等名词就免检。新增正反测试保留该区分。
5. 原始完整 JSON 的 SHA-256 和全部内容不变；两条 SaveEvent 的 `actor_permission`、`player_knowledge` 问题保留，整批原文仍不能宣称验证成功。

新增 17 项用例，覆盖独立目标支持任务/事件/成果的拒绝、原始真实句和三种合法目标衔接、同分句“启动工作以确保”、名词角色及跨句/跨主体限制。原未来计划、推测、传闻、否定、来源缺失、时间、前置条件与知识隔离断言不删不改。World/原始 JSON/Runtime/认知/现场权限相关定向回归 **231/231**。

这是有限的局部作用域判断，不证明任意中文因果、目标是否真的完成或主体指代。很长的修饰、显式重复主体、连续多个目标从句和未覆盖的名词结构可能被保守拒绝；本轮不增加中文 NLP、独立 AI 裁判或新字段。最终提交上的完整 Chromium 326 项及 CI 结果另见 PR 最新验收评论，上一轮 `ff3748d` 的 326 项不能代替本轮验证。

## 第三轮审查修补：将/会与实际动作

审查基线 `37f09b431d2d31e8e85084d6397c311c76f21c80` 的 `prospective` 只覆盖“将要/即将”等完整短语，遗漏“将进行/会开展/将启动/会执行”。名词判断会因此把尚未实施的准备工作当成 derived 事实。

先增加真实 `parseWorld()` 路径的首批 25 项新用例，在未改业务代码时运行：原 50 项加首批新增共 75 项中 **18 失败、57 通过**（`/workspace/world-chinese-fact-round3/before.log`）。未来表达可错误支持 active SaveTask、active SaveEvent 与 completed outcome，证明不是仅正则 helper 的推断。之后补全词汇重叠、介宾及否定助动词回归，本轮共新增 32 项。

本轮仍只修改事实判断函数、对应测试和本报告：

- “将/会”必须连接既有动作谓词；可包含最多两项有限修饰成分，以及最长 12 的在/于/由介宾跨度，不扫描任意长文本来推断时态。
- “会议/会计”不满足助动词—动作结构；“工会/协会/学会”等有限词汇用途不会把其中的“会”单独当作助动词。扫描仍继续，因此“工会会开展”中第二个“会”仍必须拒绝。
- 紧邻“已经/已/现已”等实际时态的“将”保留处置用途，例如“已将材料提交”“已将启动方案提交”，不会单凭“将”或后面的“启动”误拒。
- 明确未来动作，包括“将不再开展”，继续返回 `fact_plan`；其他已经发生的分句不能替未来动作背书。task、event 与 outcome 各自经过原有完整验证。
- 上一轮“准备/计划”正常名词、真实原句及“力保/确保/保障”目的从句逻辑均保留；不修改来源、时间、NPC/主角知情、Schema、CAS、事务、路由、超时或重试。

新增 32 项覆盖七组未来表述的任务/事件/outcome 三路径、有界修饰与混合时态，以及七组正常词汇/处置表达。World、完整原始响应、Runtime、现场权限与知识隔离定向 **263/263**。原始 JSON 固定哈希仍为 `53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb`；第一条任务通过，两个 SaveEvent 的独立权限问题不变，不宣称真实整批可成功。

这是有限动作/词汇语法规则，不是完整中文时态或专名分析。未覆盖的动词、长修饰或罕见词汇仍可能漏识别/保守误拒；本轮不无限扩充语言规则。最终提交的 2199 项工程检查、82 项提示词与完整 326 项 Chromium 的实际退出码、数量和 Workers Builds 结果见 PR 最新验收评论，不能沿用上一轮 `37f09b4` 的浏览器成绩。
