# PR #187 剧情风格严格隔离：Node 24 正式验收

## 结论

**正式工程检查通过，风格请求内容隔离通过；严格验收暂不放行。**

已验证 4364 项单测、93 项 Prompt 检查和 26 项双端定向功能场景通过。但补充的真实游戏请求安全验收 **PC 1 项、手机 1 项失败**：自动记忆总结开启且还有积压时，只保存风格也会唤醒下一批 Memory 请求并保存总结。

这是 **main 已有的设置保存副作用**，不是 #187 新增的组包/解析回归；然而新风格设置也会走这条路径，所以目前无法满足本轮明确要求的“切换风格不得增加 AI 请求”。列为 **P2 严格验收阻断**，等待十五代目复核和作者授权定向修复。没有擅自改动生产代码。

## 1. GitHub 与代码基线

- 实测 PR 源码 HEAD：`77d8d0a3d5e9cb1f726dacb15e940b7eac18b21b`。
- 实测 main：`07d473d5165dfc8154dd66c58e98cb1030975bbe`。开始及结束前远端复核均与任务锚点一致。
- PR 原分支：`feat/story-styles`；Open、非 Draft、未合并，验收前 GitHub 显示可合并。此次不更改该状态，不新建 PR。
- 已完整读取第二轮 Review `5944181891`、返修报告 `6956753980`、首轮 Review 及补充隔离要求。
- main 为 PR 祖先，原 PR 相对 main 为 0 behind / 2 ahead；未混入其他分支。
- 本次交付只增加测试导航兼容及本报告/证据。最终交付 HEAD 见本报告所属提交与 PR 验收评论；全部生产文件仍与上述源码 HEAD 完全相同。

Cloudflare 状态的证据边界：第二轮 Review 记载源码 HEAD 的 Preview Build success；本轮连接器 combined-status 返回空集合，工作台直读 Check Runs API 返回 Forbidden，故**未独立实时核实最新 Cloudflare Check**。可读的旧机器人评论对应 `9d16409`，不冒充它是 `77d8d0a` 或报告提交的构建结果。没有手动部署，也不以预览构建代替工程或生产验收。

## 2. 正式环境

| 项目 | 实测版本 |
| --- | --- |
| Node | v24.19.0 |
| npm | 11.9.0 |
| Vitest | 5.0.5 |
| Playwright | 1.64.1 |
| Chromium | 154.0.8037.57，Debian 13 |

使用 `package-lock.json` 真实依赖，`npm_config_cache=/workspace/.npm npm ci` 安装 143 个包，退出码 0。未用 Node 22、离线垫片或替代运行器。

`VITEST_MAX_WORKERS=2` 只限制并发，不缩减测试集合。浏览器继承仓库 `playwright.config.ts` 的 desktop 1440×1000 和 Pixel 7 项目，仅用单 worker 与独立端口 47581。原配置端口 5174、首次备用端口 5197 已被其他服务占用，启动失败时实际执行测试数为 0；未关闭或复用其他任务服务。main 对照使用相同 Node、lockfile、Chromium、项目设置、单 worker、Mock 与端口。

## 3. 工程检查与精确计数

| 批次 | 结果 | 退出码 | 日志 |
| --- | --- | --- | --- |
| `npm ci` | 成功安装 143 包 | 0 | `npm-ci.log` |
| 源码 HEAD `npm run check` | **4364 通过、0 失败/跳过；182 文件**，Lint/TypeScript/Build 通过 | 0 | `check.log` |
| 测试导航修改后 `npm run check` | **4364 通过、0 失败/跳过；182 文件**，Lint/TypeScript/Build 通过 | 0 | `check-final.log` |
| `npm run prompts:check` | **93 通过、0 失败/跳过** | 0 | `prompts.log` |
| 原有风格/隔离/篇幅/Memory 定向 Vitest | **63 通过**，0 失败/跳过 | 0 | `targeted.log` |
| 补充完整请求及真实 Memory 路径 Vitest | **6 通过**，0 失败/跳过 | 0 | `memory-live-proof-final.log` |
| 工作区与整个 PR 的 `git diff --check` | 通过 | 0 | `diff-check.log`、`pr-diff-check.log` |

`check` 包含文件名/大小写冲突检查、ESLint、完整 Vitest；其 Build 包含 `catalog:check`、TypeScript 与 Vite。目录检查确认 World/Variables 展示目录和正式 Schema 一致；Prompt 检查覆盖资源、Manifest 和来源锁一致性。Vite 仍有大 chunk 的非失败提示，未扩展到打包优化。

63 项为原有 `story-styles` 13、`story-styles-isolation` 10、`narrative-length` 12、`memory-summary-v2` 28。它们和 93 项 Prompt 都属于完整 Vitest 的子集，不重复相加。补充 6 项脚本为本次独立取证，也不把它们拼成一次 4370 项全量结果。

## 4. 七种风格的内容隔离

固定同一 GameState、draft 与其余偏好，枚举 `general / jianghu / noir / power / docu / shuang / absurd`。

| 路径 | 实际核查 | 结果 |
| --- | --- | --- |
| Story 开局、普通 | 恰好一个对应风格模块；只规范化风格模块与风格标识后，比对完整消息；尾部格式、上下文、长度及续写规则 | 通过 |
| Variables 开局、普通 | 比对完整 `messages / modules / context`；普通回合另比对整个 `<GAME_CONTEXT>` 字符串 | 与 general 相同 |
| World 开局、普通 | 同上，非 Story 出站 `PROMPT_SETTINGS.style` 固定 general | 与 general 相同 |
| Memory 组包/预览三类任务 | `short_to_medium / medium_to_long / npc_summarize` 的完整请求、模块和上下文 | 与 general 相同 |
| **真实 MemoryMaintenance** | 三类任务各枚举七种设置；实际 AiClient 出站 body 与请求检查模块；不是预览 | **21 次 Mock 调用逐类相同，每次 1 请求、1 合法保存** |
| 同一 Story Mock 回复的三阶段链 | 摘要、变量规划、候选命令、世界结果、阶段状态与下游出站消息 | 相同 |
| 风格设置 UI 保存 | 七种逐项保存刷新；除 style 外本地设置完全不变；固定正式 Repository 与草稿前后相同 | 普通无积压场景通过 |

关键源码定位：

- `src/prompts/selection.ts:13`、`:33`：先限制适用阶段，再按 `style:<id>` 互斥选择；七模块均为 Story、opening/regular、排序位 223。
- `src/prompts/composer.ts:109-119`：只在出站处将非 Story 风格投影为 general，不修改玩家保存的设置。其余偏好与字段顺序保持。
- 六份 `prompts/writing/style_*.md:2`：风格仅用于 `<正文>`，短期记忆保持客观事实，变量规划依据已成立事实，行动选项不替玩家决策；还保留人物/背景/作品笔法的边界说明。
- `src/ui/game/useMemoryMaintenance.ts:33-36`：真实维护只传记忆配置、连接与超时，没有传 Story 风格。
- `src/workflows/memoryMaintenance.ts:69-76`：以 defaultSettings 选择记忆模块，用户上下文只有 MEMORY_TASK。`:96` 通过正式 AiClient 发出单次请求。
- 原 PR 没有改动 Story 解析器、Variables/World 协议、领域权限、Commit/Undo、正式 Schema 或数据库结构。

**不能夸大的部分：** 同一 Mock 输出只证明解析与领域处理不会因为 style 设置自行改写事实。正文与短期记忆由同一次模型回复生成，提示词要求不能证明真实模型的摘要逐字一致，也不能保证文学质量、风格遵循度或示例零复用。没有为隔离增加独立付费摘要调用。

## 5. Chromium 功能结果与旧失败对照

| 批次 | PR 结果 | main 同环境结果 | 判断 |
| --- | --- | --- | --- |
| 风格 + 篇幅 + 七风格逐项保存补证 | **22 通过，0 失败/跳过** | 没有失败，不重复跑无关 main 场景 | 风格 4、篇幅 16、逐项真实保存补证 2 |
| 初次受影响设置用例 | **2 通过、2 失败** | **1 通过、3 失败** | 手机两项都是旧分类导航；main 另有桌面旧数量断言 |
| 最小测试导航兼容后 | **4 通过，0 失败/跳过** | main 保留原样 | 原业务断言全部保留 |
| 补充“只保存风格不额外请求” | **0 通过、2 失败（PC/手机）** | **0 通过、2 失败**（原样保存一般设置） | 见下一节，不将其忽略或计成通过 |

最终按功能场景去重：**26 项通过 + 2 项严格安全验收失败**，不能报告“28 项全绿”。不将初跑/复测重复成绩或 main 结果相加。

旧设置失败的准确定位：

- `e2e/game.spec.ts:311`：手机已进入 AI 连接页，直接找“提示词”分类，30 秒超时。main 与 PR 相同。
- 原 `e2e/prompt-inspector.spec.ts:375`：手机在提示词管理内容页直接找“提示词”，同样超时。main 与 PR 相同。
- main 同文件 `:376`：桌面旧断言预期 7 个直接 label，实际 6；#187 原实现已经按新风格选项组调整为 5 加两个独立组，该项 PR 初测已通过。

本轮只新增测试辅助函数 `settingsCategory()`，沿真实“返回设置 → 分类”路径操作；桌面仍直接切换。不删按钮/字段/禁用态/无外部请求/保存恢复等业务断言，不提高原用例超时或添加重试。对应四项复测均真正到达保存、非法值校验、刷新和独立阶段开关断言。

风格功能覆盖默认一般、七种逐项真实选择及说明、键盘切换、保存刷新、正文篇幅旧 1000/1500/4000/8000 自定义兼容、完整数字、倒置区间拒绝保存及无意外写入。七风格保存补证还比较了正式 Repository 和草稿，模型请求数为 0；这不覆盖下面的自动总结积压场景。

## 6. P2：纯风格保存仍可触发已有自动记忆请求

### 触发条件与复现

1. 使用合成存档：100 条合格短期记忆；短→中自动总结开启，其他两类关闭；真实 Repository、真实游戏页面、正常 Web Locks，模型只由 `.mock.invalid` 路由拦截。
2. 进入游戏，既有自动维护完成一批：**1 次 Memory 请求，1 条中期总结**，仍有可处理积压。
3. 仅选择“冷硬黑色”，点击保存本地设置。深比较保存前后偏好，确认除 style 外完全相同；没有发送行动、修改记忆开关或等待一分钟定时器。
4. 立即出现第二次 Memory 请求，下一批总结合法保存，中期总结数变为 2。
5. 产品期望请求数仍为 1 的断言，在 PC 和手机均实际收到 2，明确失败。

| 基线/终端 | 保存前请求 | 保存后请求 | 中期总结数 | 保存至观测耗时 |
| --- | --- | --- | --- | --- |
| PR PC | 1 | 2 | 2 | 1548 ms |
| PR 手机 | 1 | 2 | 2 | 2294 ms |
| main PC（原样保存一般） | 1 | 2 | 2 | 1258 ms |
| main 手机（原样保存一般） | 1 | 2 | 2 | 2191 ms |

main 没有七风格选择器，因此 main 对照是**同一保存链原样保存一般设置**，不冒称 main 已有“选择冷硬黑色”的相同控件操作。它证明该唤醒行为已存在于主干；不是新风格模块、composer 投影或传输器增加了请求。

### 根因

`SettingsPanel.tsx:109` → `App.tsx:246-248`：保存偏好后替换 settings 对象。

`src/ui/game/useMemoryMaintenance.ts:54`：`useEffect(() => { void queue.current?.wake(); }, [settings])` 对整个 settings 对象变化唤醒队列。

`src/workflows/memorySummaryQueue.ts:93-126`：每次 wake 在仍有合格积压、自动配置允许且无失败/限流阻断时，再处理一个批次。`MemoryMaintenance.ts:96,112` 发出请求并保存。

这是**额外唤醒下一批合法自动维护**，不是同一批失败重试或重复结算；仍可能产生真实费用及记忆写入。因此“请求内容隔离通过”不能等同于“保存风格绝不增加请求”。

### 最小建议（尚未实施）

将设置变化触发维护的条件收窄为与维护真正相关的**语义配置**，排除 `prompts.style` 等纯写作偏好；保留首次加载、原有定时器、记忆配置更改、手动维护、节流、失败回执和 Web Locks 保护。不能简单改为 memory 对象引用依赖，因为 Schema 解析也可能克隆对象；应使用稳定的记忆配置指纹等方式。

补足真实游戏回归：自动积压且纯风格保存时请求数不增；更改合法记忆自动配置仍正确调度；手动/定时维护和失败不自动重试保持原状。本轮权限以验收为主，**没有修改 Hook 或调度器来通过断言**。

## 7. 本轮修改与证据

生产代码、六个 Prompt、Manifest、来源锁、设置 Schema、公告均未修改。

实际测试兼容修改仅：

1. `e2e/helpers/aiSettings.ts`：新增九行设置分类导航辅助函数。
2. `e2e/game.spec.ts`：该设置场景改用辅助函数。
3. `e2e/prompt-inspector.spec.ts`：该设置场景改用辅助函数。

另附本报告、截图、原始日志和可复制的补充验收脚本。补充脚本在正式 Vitest/Playwright 下临时运行，原文保留在 `reproduce/`；它们不冒充原仓库全量套件的一部分，也没有删除原有测试。

- [日志及版本、配置与观测数据](logs.zip)
- [关键 PC/手机 trace](traces.zip)
- [PC 一般](screenshots/desktop-general.png) · [PC 荒诞](screenshots/desktop-absurd.png)
- [手机 一般](screenshots/mobile-general.png) · [手机 冷硬](screenshots/mobile-noir.png)
- [PC 保存后记忆唤醒](screenshots/pr-desktop-memory-wake.png) · [手机 保存后记忆唤醒](screenshots/pr-mobile-memory-wake.png)

`screenshots/` 包含七风格各自双端截图及旧篇幅对照。原始证据全保留于 `/workspace/pr187-evidence`；main 对照工作树为 `/workspace/pr187-main-control`，未提交任何改动。

调查脚本的首个版本只观察请求数 1→2，随后增加安全断言；加深比较时曾发现种子写入后未刷新 React 设置，导致探针先在偏好比较处失败。已修正为首页刷新加载种子再进入游戏，最终有效的双端失败位置都是末尾请求数断言（预期 1 / 实际 2），全部前置“仅 style 改变”断言通过。初次无效探针日志保留，未用于 P2 结论。关键有效 trace 可核查所有步骤与 JSON 观测。

没有实机 iOS/Safari、真实模型或真实生产站点验收。没有真实玩家存档、API Key、付费请求、生产部署、公告发布或合并。

## 8. 最终意见

- **P0/P1：未发现。**
- **风格组包、协议、事实处理的新增 P2 回归：未发现。**
- **仍有 1 项继承 main 的 P2 严格验收阻断：纯风格保存可额外唤醒自动 Memory。** 不能将旧路径当作已经符合作者的请求隔离要求。
- 建议十五代目复核此明确边界，并在作者授权的最小修复后复测；**当前不建议作最终合并放行**。保留原 PR 未合并，不自行实施生产修复或发布公告。
