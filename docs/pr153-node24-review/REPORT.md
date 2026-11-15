# PR #153 · Node 24 正式验收

日期：2026-11-15。依据[十一代目审查评论](https://github.com/WJT111222/HeiJinWangChao/pull/153#issuecomment-6891240341)。在原分支返修，没有新开 PR。

## 结论及版本

原方案存在首次 World 组装的同步性能退化，已将贪心归并移至显式维护脚本预生成，保留完全相同的压缩目录。正式单测、Prompt、Lint、TypeScript、构建通过；未发现新增 Schema/存档或请求语义回归。原有 18 个手机 E2E 失败全部在干净 main 的同名场景复现，尚未到达的业务断言不冒充通过。

| 标识 | 值 |
| --- | --- |
| 原审查 HEAD | `cc6f01d7a1ff08ec30e76b6821573bb70744f090` |
| 干净 main / 起点 | `8ca06a4b998f78af4dbd5a236c53a5bc6036ae3a` |
| 本轮修复及测试提交 | `7fb7cd530457c278ccb5a7983d43afe6a7ae821e` |
| 原分支 | `refactor/world-catalog-dedupe` |
| 最终 HEAD 与对应 Workers Build | 见本报告所在提交及原 PR 的本轮验收回复，使用完整 SHA 对照 |
| 环境 | Node **v24.19.0** / npm **11.9.0** / Chromium **154.0.8037.57** |

原 PR 是 Open、非 Draft，保留原有状态、未合并。不手动部署生产、不发布、不改变 Beta 标签。推送触发现有 Workers 自动预览检查不等于人工确认生产域名更新。

## 正式工程检查

真实依赖、正式 Vitest / Playwright，无离线垫片，无真实付费模型 API。PR 与 main 均独立执行 `npm ci`，各安装 143 包。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm ci` | 成功 | `logs/npm-ci.log.gz` |
| `npm run check` | Lint、**3841 单测 /153 文件**、TypeScript、Build 全部通过 | `logs/check-final.log.gz` |
| `npm run prompts:check` | **93 通过** | `logs/prompts-final.log.gz` |
| 定向 Vitest | **620 通过 /28 文件**，全量子集，不重复累计 | `logs/targeted.log.gz` |
| 新出站链测试 | PR **24/24**，main 同一测试 **24/24** | `logs/pr-wire.log.gz`、`main-wire.log.gz` |
| 原压缩测试及新出站链 | **39/39**（15+24，包含于全量） | `logs/pr-wire.log.gz` |
| `git diff --check` / 对 main 整个 PR | 通过 | `logs/diff-check*.gz` |
| `npm run catalog:refresh` | 两次输出 SHA256 相同 | `logs/catalog-refresh*.gz`；生成文件 hash `83254eda453f396708cb5606d4b868fa7c9252683a888ef268a6cdd6517c5d69` |
| 干净 main `npm run build` | 通过 | `logs/main-build.log.gz` |

定向范围包括实际存在的 `world-*.test.ts`、`catalog-compaction`、`catalog-wire-acceptance`、`npc-final-runtime`、`npc-unified-memory`、`event-stages-v2`、`prompt-runtime`、`format-tail-wire`、`context-budget`。没有执行完整约700项浏览器回归。

## 首次失败及修复

1. 原 HEAD 完整检查在单测阶段为 **3815 通过 /2 失败**：压缩测试要求恰好存在名为“纪事时间”的公共定义，而当前真实 Zod 生成的贪心归并命名为 `time` 及各精度子结构。展开语义等价通过，属于测试把别名当契约。保留游戏时间、稳定ID、实体引用检查，并用完整 RecordHistory 展开结构与原定义相等代替该别名假设；不是删掉历史字段断言。原始 `check-initial.log.gz` 留存。
2. 新增出站探针曾让 regular 草稿配 turnNumber=0，正式编译器按既有规则拒绝；随后按真实普通回合构造正式状态及历史。四协议全部24项通过。一次 `-t` 诊断运行有23项未选中，不是添加 skip；正式完整运行没有跳过。
3. 新脚本的 Node `URL`/日志需显式导入以符合仓库 ESLint；新测试对 Zod JSON Schema 的 `const` 访问需类型守卫。红日志 `check-script-lint-red.log.gz`、`check-new-test-types-red.log.gz` 保留，最终检查全绿。
4. 新增 React regular 探针先误把已结算状态交给只允许新存档的 `repo.create()`。改为先创建隔离空档，再像既有 E2E 夹具一样写入经过既有结构要求的合成已结算记录；没有改变正式 Repository。最终开局与普通回合双端4项通过；此前3次fixture失败不隐去，也不算生产回归。

本轮不删/跳过/弱化旧业务断言，不增加无意义重试，不修复无关手机 UI。

## 实际出站收益：独立测量

使用同一固定时间、worldState 来源、开局/普通草稿、设置和四协议测试，对 PR 和干净 main 真正执行 `composePrompt → runStageRequest → AiClient/wireRequest → Mock fetch`。Mock fetch 仅一次，输入状态/草稿完全不变；不将单独序列化一个目录当作最终请求。

24 对 payload：四协议 × 两种回合 × 三阶段。Story/Variables **逐字段完整相同**；World 删除 `GAME_CONTEXT.COMMAND_CATALOG` 后整个原生 body 逐字段相同（包括 system、消息顺序、生成参数及其他上下文）。最后一条 user 消息仍为 #151 的提醒，GAME_CONTEXT 独立完整。预生成前后的压缩目录亦完全相同，见 [catalog-unchanged.json](catalog-unchanged.json)。

以下为 OpenAI 兼容请求的提示词内容统计，其他协议完整结果见 [wire-comparison.json](wire-comparison.json)：

| 同一 fixture / 指标 | main | PR | 差额 |
| --- | ---: | ---: | ---: |
| World 命令目录 JSON 字符 | 95,874 | 41,718 | −54,156（约56.5%） |
| 开局 Story 内容字符 | 37,106 | 37,106 | 0 |
| 开局 Variables 内容字符 | 90,651 | 90,651 | 0 |
| 开局 World 内容字符 | 135,632 | 81,476 | −54,156（约39.9%） |
| 普通 World 内容字符 | 137,479 | 83,323 | −54,156（约39.4%） |
| 开局三阶段内容字符合计 | 263,389 | 209,233 | −54,156（约20.6%） |
| 开局 World 项目启发式 token | 67,180 | 54,141 | −13,039（约19.4%） |
| 普通 World 项目启发式 token | 69,655 | 56,616 | −13,039（约18.7%） |
| 开局三阶段项目启发式 token | 159,204 | 146,165 | −13,039（约8.2%） |
| 开局完整 wire JSON 字符 | 151,648 | 88,898 | −62,750 |
| 开局完整 wire JSON UTF-8 bytes | 204,878 | 142,928 | −61,950 |

字符按 Unicode code point；完整请求 JSON 还包含转义和协议开销，不能把其降幅当作模型读入内容降幅。项目 `unicode-heuristic-v1` 是 ASCII/4 + 非ASCII×1.5；没有取得供应商 tokenizer 或真实计费 usage，**不是账单节省承诺**。数字与作者离线报告不同，以上是当前真实依赖、明确 fixture 和统计口径的独立值，不改写作者旧数据冒充复现。

## 冷启动性能与必要的生产修复

首次探索测量发现：原 PR 在手机4倍CPU降速下，首次 World 组装中位数约 **295.7ms**，热缓存15.6ms，最大帧间隔266.7ms；当时同环境 main 探索组约75.8ms。原贪心算法最多200轮反复遍历和序列化，确有首次同步额外开销。探索时存在其他功能测试并行，所以不把该组数字当严格单因素实验；原始值在 `logs/pr-perf-before.json.gz`、`main-perf-exploratory.json.gz`。

修复方式：

- 原 `factorRepeatedSchemas` 通用算法保留，不取消其合并能力，也不激进压缩字段。
- 新增 `npm run catalog:refresh`，使用仓库真实 Vite SSR 加载正式 Schema 和原算法，生成 `commandCatalogSchemas.json`。
- 浏览器读取静态生成结构，按阶段缓存并每次深复制；不在第一次玩家 World 请求运行贪心循环。仍从原生成器读取其余规则/命令说明。
- 两阶段测试不仅检查引用展开等价，也要求生成结构**精确等于原算法重新生成结果**；修改 Schema 却忘记刷新时，单测会失败；`npm run build` 亦先运行只读 `catalog:check`，Workers单独构建也不能静默使用过期文件。缓存测试同时篡改规则和公共定义，确认后续副本不受影响。
- 前后压缩目录逐字段一致，最终 payload 无额外内容改写。正式 Zod/解析器/权限/存储从不读取该静态展示目录。

最终 PR 与 main 分别顺序运行，未同时运行本任务的工程/功能测试。每端5个新浏览器进程，每次真正冷模块目录缓存、1次冷 World +10次热调用。模块导入和 Story 资源预热不计入 World 时间；所以不是网络全冷首页载入指标。手机为 Pixel 7 布局并CDP CPU×4，桌面 CPU×1，不是物理手机实测。

| 指标 | main 桌面 | PR 桌面 | main 手机×4 | PR 手机×4 |
| --- | ---: | ---: | ---: | ---: |
| 首次 World 中位 ms | 51.3 | 46.3 | 83.0 | 89.9 |
| 首次 World 最大 ms | 68.4 | 56.6 | 101.8 | 96.5 |
| 热缓存中位 ms（各50样本） | 6.35 | 3.4 | 23.2 | 12.4 |
| 定时器/DOM回调延迟中位 ms | 19.0 | 17.5 | 52.1 | 59.9 |
| 整个测量窗口最大帧间隔 ms | 50.1 | 83.4 | 50.1 | 66.7 |
| 渲染进程 RSS 高水位 MiB | 219.82 | 219.21 | 186.10 | 181.12 |

[performance-summary.json](performance-summary.json) 含每轮原始时间、帧和PID内存记录。RSS 来自浏览器CDP进程列表及 Linux `/proc/<pid>/status` 的 VmHWM；是包含 React、页面及模块的**渲染进程峰值**，不是单一函数的精确 V8 堆峰值或增量。计时器触发的 DOM 点击只是主线程响应探针，不是物理触控端到端延迟。

结论：原200ms级新增同步退化消除；冷调用回到 main 附近、热调用更快、未见RSS峰值增加。仍录得83.4ms桌面/66.7ms手机帧间隔，窗口覆盖首次与连续热调用，**不能宣称零阻塞或全程60fps**。本轮不扩张改造其他现有组装、校验或UI工作。

预计算引入静态前端资源，不能只讲请求节省：原始生成JSON约76KB，生产构建产物实际大小保留于 main/PR build日志；全部JS构建资源由 1,658,407 增至 1,733,394 bytes，逐文件gzip合计由572,258增至580,374 bytes（+8,116 bytes）。这是把一次目录构造计算移到维护期的体积换算，不是移除领域校验。

## Chromium 定向结果和基线

| 执行组 | 实际场景 | 通过 | 失败 | 跳过/重试 |
| --- | ---: | ---: | ---: | ---: |
| 初始相关7文件 PC+手机 | 48 | 30 | 18 | 0 |
| 干净 main 对应手机6文件 | 23 | 5 | 18 | 0 |
| 预计算后桌面7文件（含新检查器） | 25 | 24 | 1（新fixture错误，已修） | 0 |
| 最终新 React 检查器 PC+手机 | 4 | 4 | 0 | 0 |
| 最终原有手机通过用例精确复测 | 6 | 6 | 0 | 0 |
| 最终原桌面格式尾检查器 | 1 | 1 | 0 | 0 |
| 最终性能 PR / main | 各2（每项5冷+50热样本） | 各2 | 0 | 0 |

没有把上述重复运行累加为独立覆盖。最终独立功能场景范围为原48 + 新4 = **52场景**，已有通过证据34，旧手机失败18；预计算后的23个旧桌面场景全部再次通过，另一个原桌面格式尾检查器亦通过，原有6个手机成功场景精确再次通过；新开局/普通双端4项最终通过。初次48项在原实现及等价缓存探索期间执行，最终版本以上述修复后执行和全量单测为准。早期新增用例的失败尝试单独保留，不把失败改成“预期跳过”。

原有18个手机失败与 main **同名逐项对应**：continuous-turns 5、event-stages-v2 1、history-timeline-v2 3、npc-final-acceptance 2、world-npc-creation 2、world-runtime 5。包括旧存档入口/桌面标题、工作流/输入/日志定位，以及现有历史布局/返回定位问题。历史两项实测纵向差398px而断言要求<81.1875px，另一项返回后group-00不存在，main相同；不能统称为所有失败都只是导航。精确断言、行列和trace见 [CASE_RESULTS.md](CASE_RESULTS.md) 和 `logs/browser-comparison.json.gz`。它们仍未通过，不能声称那些被阻塞的手机原子保存/隐私断言已完成。

最终桌面真实10连续回合、世界人物/组织/任务/主子事件、日期精度和长历史、World失败恢复/取消/重复请求、IDB原子故障与刷新，以及新双端React真实请求检查器均有通过证据；完整字段权限、好感/记忆归属、非法时间、五数组、撤回等同时由正式单测覆盖。旧手机失败不借机修UI、不删/弱化测试。

全部失败上下文压缩留存，全部 trace 的路径、bytes、SHA256 见 TRACE_INDEX；两个代表场景的成对 trace 提交于 `traces/`，其余完整文件保留 `/workspace/pr153-evidence/`。源码与截图均使用合成隔离数据，未读取私人存档或真实凭证。

## 修改边界

原 PR 的6文件继续保留。本轮追加/修改7个代码及测试文件：

- `src/services/validation/commandCatalog.ts`：仅将首次贪心计算改为读取预生成展示Schema，保留规则、缓存及独立副本。
- `src/services/validation/commandCatalogSchemas.json`：原算法真实生成的两阶段展示结构。
- `scripts/refresh-command-catalog.mjs`、`package.json`：显式维护命令，默认构建新增只读新鲜度检查；不改请求协议或游戏自动行为。
- `src/tests/catalog-compaction.test.ts`：修正非契约别名假设，完整历史结构等价、生成文件新鲜度、缓存深隔离。
- `src/tests/catalog-wire-acceptance.test.ts`：24个正式出站Mock及可选脱敏证据导出。
- `e2e/catalog-wire-ui.spec.ts`：开局/普通双端React检查器，精确核对原生body、独立上下文、尾提醒、无正式存档写入。

`catalogCompaction.ts` 的通用算法与原 PR 一致。相对 main，domain、workflows、存储、正式解析器、Prompt模块/Manifest/来源锁均无改动。没有修改收费授权/路由/请求次数；没有 Token 激进字段压缩；不影响 NPC、事件、日期精度或任何领域规则。旧3个目录遍历测试仅先展开引用，原业务断言保留。

## 使用与交付

修改领域Schema或命令目录后执行：

```bash
npm run catalog:refresh
npm run catalog:check
npm run check
npm run prompts:check
git diff --check origin/main
```

刷新/检查脚本不触发任何模型或保存数据。另故意在生成Schema中加入过期定义，`catalog:check` 正式退出非零，随后逐字恢复原文件并再次检查通过（`stale-build-guard.log.gz` / `catalog-check.log.gz`）。具体测试命令、原性能脚本及隔离端口配置在 [COMMANDS.md](COMMANDS.md) 和 `configs/`；原始 stdout/stderr、请求body、成对报告压缩于 `logs/`，可用 `gzip -dc` 读取。目录附 SHA256SUMS。

真实模型生成正确率和掉格式率 **Mock不能证明**。模型收到的展示确实从内联变为引用、时间pattern变为自然语言说明；不改变程序允许的输出集合，不代表模型理解概率不变。若负责人合并后自愿实测，可观察开局及数回合的生成错误；必要回退是 **revert合并提交**，不是关闭已合并PR。本轮不调用真实付费模型、不自行合并、不手动部署生产、不发布或改Beta标签。

## 截图入口

- [PC 开局实际World请求](screenshots/desktop-opening-world-catalog-wire.png) / [手机普通回合实际World请求](screenshots/mobile-regular-world-catalog-wire.png)。
- 同目录有开局/普通、Story/Variables/World共12张新检查器截图，完整body与公开显示一致性由测试逐字段核对，界面末尾保留最终格式提醒。
- [NPC完整记忆](screenshots/npc-final-desktop-long-memory.png)、人物档案截图及原有格式检查器截图一并保留，未覆盖先前批次证据。
