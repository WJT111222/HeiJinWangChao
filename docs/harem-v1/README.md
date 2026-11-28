# 1.0 后宫系统验收记录

开发基线为 main `4e14d924b75ffedcf95b876cda000ad90d0d8d78`，分支为 `feat/harem-household-v1`。提交范围是一个 Draft PR。源码、锁文件依赖及全部浏览器数据来自隔离工作区和合成存档。最终 HEAD 见 PR 描述。

## 从剧情到正式档案

| 环节 | 实现及核验入口 |
| --- | --- |
| 正式数据 | [schema.ts](../../src/domain/harem/schema.ts)、[validation.ts](../../src/domain/harem/validation.ts)、[state.ts](../../src/domain/state.ts)。V10 新增可选 `harem`。没有该字段的旧档可以直接载入，浏览空面板不会写入。成员以 NPC ID 为键，并校验稳定身份。 |
| Variables 写入 | [目录](../../src/executors/variableText/catalog.ts)、[编译](../../src/executors/variableText/compile.ts)、[领域执行](../../src/domain/harem/apply.ts)。每轮有变化时提交一条 `set harem.changes = [...]`。支持加入、退出、地位更新、总览、成对关系、重要计划、妊娠、子女登记和后来确认知情。 |
| 原子结算 | [分组](../../src/services/validation/partialOutputs.ts)、[提交](../../src/domain/commands.ts)。新建 NPC 和同批家庭登记共同成功或回滚。无法从畸形家庭命令辨认新生儿 ID 时，保守跳过同批新建 NPC，独立的其他更新仍可结算。失败诊断保留输入位置。 |
| 知情范围 | [投影](../../src/domain/harem/projection.ts)、[公共上下文](../../src/prompts/sharedContext.ts)、[World 候选](../../src/prompts/context.ts)。Variables 取维护所需的当前事实。Story 优先取行动提到的、正宫及在场成员，最多 12 人。面板和 Story 只取玩家已知的计划、妊娠、关系及亲子事实。World 只读与 Variables 相同的家庭事实，并可用 `ApplyHaremBackground` 推进离场成员的计划、离场成员之间的关系和家庭总体局势；`ApplyHaremChanges` 在 World 三个命令组中仍被拒绝。 |
| 页面 | [后宫档案](../../src/ui/panels/HaremPanel.tsx)、[面板入口](../../src/ui/game/GameScreen.tsx)、[既有 NPC 档案](../../src/ui/panels/NpcPanel.tsx)。桌面资料区与手机世界资料均可打开。总览显示人数、正宫、和谐度、竞争与关系、妊娠、已知子女、计划、近期变动及退出成员。下方卡片按分值、入册时间、稳定 ID 排序并自动换行。 |
| 提示词 | [Variables 开局](../../prompts/variableGroups/npc_ordinary/init.md)、[普通回合](../../prompts/variableGroups/npc_ordinary/update.md)、[输出契约](../../prompts/docs/OUTPUT_CONTRACT.md)。Manifest、来源锁、清单断言及受影响的 Variables 快照同步更新。完整字段归属见[变量覆盖表](../VARIABLES_FIELD_COVERAGE.md)。 |

H0 工程草案中的加入、退出、地位与正宫均从每个人有来源的地位变更记录派生。一次变更保存回合、游戏时间、理由与前后值。这样可以原样撤回一次正宫交替。现役为空时没有正宫，非空时最终状态须恰好一位 100 分，其余为 0～99。不合法的整组不能改变原分数。好感、联络、身份、组织职位与这些分数分别维护。

妊娠分为未知、未妊娠、疑似、确认、结束。时间推进本身不会创建儿童。已出生子女须为独立 NPC，并已确认与主角和成员的亲子关系。生物、收养、继亲分别显示，同一子女不重复计数。原本内部的亲子事实可以后来公开，两个回合的来源分别保留。孩子的经历和年龄继续在既有联系人中维护。普通亲密、争宠或合作的剧情意义由 Variables 判断。程序核验类型、引用、时间、前值、并发版本及整组结果。

## 双端浏览器证据

桌面 1280／1440，手机 Chromium 模拟视口 320／360／390／420。24 人夹具包含重名、长文本和未知字段。正式页面逐项核对卡片顺序、边界、键盘激活、精确 NPC ID、返回时焦点与原阅读位置、刷新和零生成请求。开发页面使用夜间设置，生产页面加载此次源码实际构建的静态资源并使用日间设置。两个主题均沿用既有资料弹窗的纸色底板。

| 视口 | 日间总览 | 日间卡片 | 夜间总览 |
| --- | --- | --- | --- |
| 桌面 | [截图](screens/desktop-overview.jpg) | [截图](screens/desktop-cards.jpg) | [截图](screens/desktop-night.jpg) |
| 手机模拟 | [截图](screens/mobile-overview.jpg) | [截图](screens/mobile-cards.jpg) | [截图](screens/mobile-night.jpg) |

[正式工作流浏览器测试](../../e2e/automatic-settlement.spec.ts)在桌面和手机分别完成两轮。开局 Variables 建立家庭，刷新后可见；下一轮送入非法双正宫，保留原正宫及正式值。每轮严格断言 Story、Variables、World 各一次 Mock 传输。打开或刷新[资料页](../../e2e/harem.spec.ts)的传输计数为零。

## 检查与回归

环境为 Node 24.19.0、npm 11.9.0、Chromium 154 系 Linux 浏览器。用仓库锁文件执行 npm ci。下列批次之间包含相同用例，各行独立统计。

| 批次 | 结果 |
| --- | --- |
| 首次加入与正宫替换，先红后绿 | 开发前 2 项因缺少正式领域命令失败；接入后相同 2 项通过 |
| npm run check，单 Vitest worker | 文件名检查、零警告 ESLint、完整 Vitest 216 文件／5109 项、正式命令目录核对、TypeScript、生产构建通过；测试失败 0，跳过 0 |
| npm run prompts:check | 3 文件／93 项通过，失败 0，跳过 0 |
| 后宫、NPC、组织、部分结算、撤回、提示词、关闭阶段及响应取消定向 | 10 文件／195 项通过，失败 0，跳过 0 |
| 后宫 Chromium 专项 | 桌面 4／4、手机模拟 4／4，通过 8，失败 0，跳过 0 |
| 额外原有资料导航测试 | 桌面通过。手机在 392×480 调用 `e2e/helpers/gameLayout.ts:66` 寻找“人物档案”按钮超时。干净 main 在同一个定位器复现，发生在断言后宫入口之前 |
| git diff --check | 开发分支相对 main 通过 |

[领域测试](../../src/tests/harem.test.ts)与[存储测试](../../src/tests/harem-workflow.test.ts)覆盖资格与身份、退出重入、唯一正宫、错误前值、重复命令、反向关系对、知情边界、双胞胎、妊娠日期、未成年人档案、父子循环和部分提交。实际使用两条独立 IndexedDB 连接检验重放，经过 Commit、备份导入导出、Undo，再拒绝撤回前的旧候选。重生成及禁用 Variables 不会写入家庭。取消时使用[正式 VariableStage 与延迟 Mock 响应](../../src/tests/stage-response-observation.test.tsx)，核对一次请求、候选为空、正式状态相同。真实模型按剧情判断一段关系是否成立的准确率仍需另行评估。开发中的一次并行全检因测试子进程 SIGKILL 中止，改为单 worker 后整套通过；证据包保留原始输出。

同一组合成输入，在干净 main 与本分支分别装配开局和普通回合。无后宫旧档的 Story、World 消息和模块哈希相同；Memory 原有固定快照通过。Variables 的固定文本命令说明增加 6120 个 UTF-8 内容字节。开局本地估算由 60632 增到 62410，普通回合由 57491 增到 59268。该测量涵盖消息内容，不代表 HTTP 全包字节或平台计费。40 人存档用例单列投影上限，增加 200 笔历史地位调整时，旧理由列表不会进入请求。

## 与「我的势力」的合流演练

开发期间 #218 从 `1bcabe3072f302fdd47d1a088cb92f9e5c237342` 前进到 `fe45bd271434ffa0938cae911fcfd67ebca43340`。在独立工作区先合入前者，再合入后续两个提交。首次出现的文本冲突为：

- `src/prompts/sharedContext.ts` 和 `src/ui/game/GameScreen.tsx`，分别保留双方只读投影和两个面板入口。
- `prompts/manifest.json`、`src/tests/prompts.test.ts` 和 `src/tests/fixtures/talent-scene-prompt-baseline.json`，按两边的规则、命令和实际输出重新校核。更新 #218 时其目录精简又触及同一快照，重新核对 Variables 与 #218 的 World 基线。

对最终 #218 在同一个存档中同时绑定组织与登记成员，交换正宫时核对组织及绑定数据相同，改变组织职位时核对家庭状态相同，再检查 V10 序列化往返。合流工作区 11 文件／230 项定向测试、TypeScript 和桌面／手机 6 项 Chromium 均通过。#218 仍由 Claude 维护；其中部分主角势力绑定由 Variables 承担。先落地的一方会改变合并基线，另一方合入后应按以上文件重核实际生成物。

## 交付边界

专项无已知新增阻断。旧手机矮屏资料导航失败单列保留，未执行全仓完整 Playwright 套件、真实手机或收费模型。构建仍提示部分 JS 资源超过 Vite 的 500 kB 提示线。未来成员与关系大量增长时，Variables 的当前事实投影仍会随存档规模增加。模型语义表现、真实设备可读性与大型长期存档的耗时不能从本轮 Mock 成绩推断。

[原始检查日志、Mock 对照数据与合流测试夹具](evidence.zip)

## 场内／场外分工（Claude 修订）

| 内容 | Variables | World |
| --- | --- | --- |
| 加入、退出、地位（正宫更替） | ✓ 剧情中确立 | ✗ |
| 妊娠、子女登记、亲子知情 | ✓ | ✗ |
| 成员的重要计划 | ✓ 剧情中发生或主角在场得知 | ✓ 仅离场成员，不覆盖本回合 Variables 已写的同一人 |
| 成员之间的关系 | ✓ | ✓ 仅双方都离场，不覆盖本回合 Variables 已写的同一对 |
| 家庭总体局势（和谐度、竞争、整体） | ✓ | ✓ 本回合 Variables 未写时 |

- World 读到与 Variables 相同的家庭事实（含内部记录），以免场外剧情与后宫身份、地位、妊娠或子女状况矛盾；存在现役成员时才注入 `HAREM_WORLD_POLICY`。
- 领域层：`ApplyHaremBackground` 结构只含 plan、pair、overview，必须已有现役成员；在同一批次中排在 Variables 的 `ApplyHaremChanges` 之后执行，每个阶段至多一组。
- World 目录新增该命令，因此无后宫存档的 World 请求也随目录变化，相关基线已重新生成。

## 界面改版（Claude 修订）

- 总览：正宫卡（姓名、年龄身份、关系一句话）与四个数据块（现役成员、和谐度进度条、已确认妊娠、主角子嗣），下方并列竞争态势与整体局势。
- 成员卡：地位序号、正宫/成员标签与分数、地位进度条、年龄·身份·所在地、关系描述（两行截断）、妊娠/计划/子女标签、上次联络；正宫卡金色描边。
- 成员关系（合作/矛盾标签）与近期变动（地位、妊娠、子女的统一时间线）并排；已退出成员折叠。
