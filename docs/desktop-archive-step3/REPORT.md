# 桌面档案柜第三批 · 物品栏与经济资产

施工日期：2026-11-12（北京时间）。分支：`codex/desktop-inventory-economy`。起点为重新获取的 `origin/main`：`961bbbdf5103522a6814a08c351aef2fbcb24941`（#111）。本报告与实现一同提交；最终完整 HEAD SHA 见 Draft PR 与交付消息。

## 实现范围与数据安全

仅将 ≥901px 的物品栏、经济与资产接入 #110–#111 的非模态 `ArchivePanel`，复用同一个容器、回焦、dock 与遮挡层。保留深色城市主界面。≤900px 继续使用原生 Dialog 和原有内容。未施工其他面板。

没有修改正式 Schema、IndexedDB、Repository、库存/装备/经济写入、AI Prompt、协议、原子结算、撤回或领域规则。城市身份、时间、星期、天气与 NPC 星标均未改动。未恢复主动 Roll；未合并、部署、发布或操作生产存档。

所有夹具只在隔离测试浏览器中写入；产品面板没有新增保存调用。新 E2E 在浏览、搜索、分类、翻页、选择、跨面板跳转、关闭之后比较 `SaveRepository.loadGame()` 返回的完整正式状态与草稿，均与操作前一致。还拦截外部 HTTPS 请求并断言请求数为零，捕获并断言没有浏览器错误。

## 设计与真实数据的对应

依据用户 ZIP 中的 [HTML](../desktop-npc-cabinet/design/heijin-panels.html) 和 [PANELS_HANDOFF 第三节](../desktop-npc-cabinet/design/PANELS_HANDOFF.md)。源文件哈希见 [design-source.json](design-source.json) 与原始 [manifest](../desktop-npc-cabinet/design/manifest.json)。包内原始截图：[物品](screenshots/s3-inv.png)、[经济](screenshots/s3-eco.png)。其他页面仅参考已有风格；旧设计中的占位页、主动 Roll 与后续批次均未恢复。

[HTML/React 并列对照](comparison.html) · [对照长图](screenshots/comparison.png)

| 部件 | 确认设计 | React 实现及必要适配 |
| --- | --- | --- |
| 公共容器 | 暖纸、方印、衬线标题、右侧 dock | 沿用 ArchivePanel，物/财印与正确选中态；关闭与 Esc 回到对应入口 |
| 物品分类 | 11.5rem 分类栏、图标、金色选中条、实时数量 | 复用原分类和 `protagonistInventory()`；不添加类别、不改变集合顺序 |
| 网格 | 9.6rem 物证卡、穿孔、金框、已装备/任务标记 | 正式名称/数量/状态完整换行，`aria-pressed`；添加本轮要求的只读搜索与 20 条分页 |
| 详情 | ≥1200px 右侧 `minmax(300px,32%)`，≤1199px 下移 | 保留列表位置，选中后聚焦标题；完整描述、所有 `itemAttributes()` 可见属性、来源归属可展开 |
| 经济指标 | 现金、线上资金、未偿本金、估值四卡；中屏两列 | 统一 `money()`；金额缩字号或换行；未知和部分已知均明确说明，不混入可用资金 |
| 经济正文 | 左收入债务 1.15fr，右资产 1fr | 收入状态色、债务红边与比例、房产/车/其他分组；≤1199px 单列；每条完整记录可展开 |
| 手机 | 原界面 | 原 Dialog、返回背包、分类及详情行为保留；普通数据两页截图与 main 像素完全相同 |

现行 main 的背包只有分类，没有搜索和分页。本轮桌面新增名称/描述/状态搜索及每页 20 条，本地 React 状态驱动，保持原集合插入顺序。手机不新增这两个控件。

### 物品、装备与关联

继续只显示主角正式持有的物品，排除他人物品和无主物品。装备标记仍来自原 `protagonistInventory()` 的七槽引用集合，重复引用与空值处理不变；当前载具仍取人物原字段。未增加使用、出售、转移、丢弃或装备动作。

保留原有 `itemDescription()` 降级文案、分类属性可见性（例如衣物不暴露不适用的设备电量字段）、数量、参考价和状态。另可展开实际记录 ID、正式持有人、实际位置 ID/名称及来源回合。当前主角背包 Schema 没有可合法指向 NPC/组织的关联 ID，原界面也没有这种跳转；不从名字、描述或来源字符串猜 ID。仅增加正式 ownerRef → 对应主角档案的只读入口，并校验目标等于实际主角 ID。位置/来源保持真实文本，不编造地图目标。

### 资金、资产与债务

所有单项和合计均通过现有 `money()` 显示「金额 元」两位小数。纯 UI 求和使用 BigInt 分，避免多个合法整数金额相加超过安全整数范围；不写入存档、不参与结算。

- 资产估值只包含主角名下房产、车辆及其他资产。全部已知才称完整合计；部分已知明确「合计不完整」及未知数量；全部未知显示「未确认/无法计算合计」；空集合显示 0.00 元和 0 项。
- 未偿本金只汇总 `status === 'active'` 的 outstanding，卡片明确统计范围；有争议、还清、取消记录仍完整展示但不混入该合计。未知不当作零。
- 本金/余额未知或本金为零不绘比例；正常比例为未偿/本金。防御性投影对超本金截到 100%，保留原金额并注明；非安全整数、负数、NaN、Infinity 不生成比例。
- 正式 DebtSchema 本来禁止余额超过本金。端到端存档使用合法值；超本金防御仅在 UI 单元/SSR 测试验证，没有绕过或修改 Schema。正式结构无独立债务人、利率、违约金字段，因此不虚构。
- 收入保留来源、状态、账户、预计/实际入账时间和安排；资产保留类型、位置、来源、取得时间、权属、型号/车牌、当前载具等正式信息。每条均提供 `WorldRecord` 完整记录，原 ID、来源、授权、抵押、账户、精确 ISO 时间及历史元数据可达，不删技术字段。可选时间缺失时不制造日期。
- 每类超过 20 条使用现有 RecordList 的搜索和分页。不会一次渲染无限记录；资产仍保持正式 property/vehicle/other 分组。

边界输入及实际 helper 输出见 [amount-boundaries.json](validation/amount-boundaries.json)，五尺寸金额文字/字号/宽度见 [amount-layout.json](validation/amount-layout.json)。

### 同时修正的显示精度

极端金额验收发现既有 `money()` 先做浮点 `/100`，导致合法 `Number.MAX_SAFE_INTEGER` 分被显示成 `90,071,992,547,409.90 元`，少一分。现在仅在共用 UI formatter 内用整数拆分，正确显示 `.91`；普通金额格式不变。正式领域金额和结算没有变更。该显示修正也适用于手机，但不改变手机结构或样式。

旧 E2E 用同一浮点表达式生成期望值，固化了该错误。现改为独立的精确字面量，保留全部布局、完整金额和 Repository 断言。未修改业务断言以迁就错误。

## 交互、焦点与遮挡

- 打开/切换使用同一个 ArchivePanel；非原生 modal，不阻止 dock。正文与行动台维持 `inert`，数字及 Ctrl+Enter 不穿透。
- 选物品时聚焦详情标题；列表滚动位置不变。返回物品栏保留原目标 ID。
- 人物档案 → 经济资产、物品 → 对应主角档案、dock 切换、再次点击当前经济入口关闭均通过。
- 关闭按钮与 Esc 回到对应物品 dock / 左栏经济按钮。切到未改造地图时由原生 Dialog 接管焦点和 Esc；关闭后可继续打开新面板。
- 发现原工作流详情的 Esc 监听器会先消费按键，妨碍档案柜关闭。只在该 UI 监听器现有“原生 Dialog 打开时让出 Esc”的条件中加入 `.archive`。执行阶段、取消、结算和工作流状态不变；新测试特意先打开工作流再打开档案柜验证。

## 验证成绩

环境：Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57（`/usr/bin/chromium`），两套隔离浏览器项目。没有真实模型请求。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm ci` | 通过，143 packages | [ci.log](validation/ci.log) |
| `npm run check` | ESLint + 125 文件/3185 单测 + TypeScript + 生产构建通过 | [check.log](validation/check.log) |
| `npm run prompts:check` | 3 文件/93 测试通过 | [prompts.log](validation/prompts.log) |
| Chromium 10 组相关套件 | 80 通过，8 个既有/平台条件跳过，0 失败 | [e2e.log](validation/e2e.log)、[结构化结果](validation/e2e.json) |
| 工作流 Esc 相关补充 | 22 通过，0 跳过，0 失败 | [workflow.log](validation/workflow.log)、[结构化结果](validation/workflow.json) |
| 原 main 手机同夹具对照 | 2 通过；两页像素及 SHA256 完全一致 | [main-mobile.log](validation/main-mobile.log)、[pixel-comparison.json](validation/pixel-comparison.json) |
| 原 main 既有资金 E2E | 1 通过，证明旧断言确实固化浮点期望 | [main-funds.log](validation/main-funds.log) |
| 原 main 分币精度探针 | 1 预期失败：`.90` ≠ `.91` | [main-money-control.log](validation/main-money-control.log) |

新增 33 个 UI 单测覆盖完整数据、归属/属性边界、七槽重复、集合顺序、分页、空集合、全未知/部分未知、精确大额、BigInt 合计以及债务防御边界。

相关套件：`archive-step3`、`inventory-v2`、`archive-step2`、`desktop-cabinet`、`npc-directory`、`npc-final-acceptance`、`organization-archive`、`game-window`、`city-night-followups`、`character-creation-v2`。新增第三批两项桌面专属压力用例在手机项目声明跳过；其余跳过沿用原平台条件，没有新跳过业务断言。

旧用例的必要 UI 适配：物品桌面卡片按本轮要求显示状态；桌面选中后列表不替换、返回背包按钮隐藏，手机原返回/焦点断言保留；物品和经济桌面容器由原生 DIALOG 改为 SECTION/非模态，手机仍断言 DIALOG。原正式字段、私密边界、库存归属、草稿/状态一致性与跳转断言保留。

调试阶段出现过本轮测试夹具重复 ID（资产 home 与地点 home）、非法超本金债务、HTML 中单位标签分割导致的字符串断言，以及新 E2E 的缺少类型标注；均修正夹具/测试后完整复跑。首轮广回归 79 通过/1 失败对应上述旧浮点期望；最终记录使用修正后的完整复跑结果。没有把它们当作可忽略的 main 失败。

主分支对照使用独立 detached 工作树 `961bbbdf…`，生产源码 tracked diff 为空，只增加未跟踪探针/测试夹具以便复现；没有修改 main 的 formatter 或领域实现。普通手机截图对照见下方。

### 可复现命令

```sh
npm ci --cache /tmp/ui2-npm-cache
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/archive-step3.spec.ts e2e/inventory-v2.spec.ts e2e/archive-step2.spec.ts e2e/desktop-cabinet.spec.ts e2e/npc-directory.spec.ts e2e/npc-final-acceptance.spec.ts e2e/organization-archive.spec.ts e2e/game-window.spec.ts e2e/city-night-followups.spec.ts e2e/character-creation-v2.spec.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/workflow-feedback.spec.ts
```

生产构建有 Vite 的 >500kB chunk 提示（最大 index 712.37kB），未在本批额外重构拆包；构建退出码为 0。

本机为避开此前工作树服务，最终使用单独测试配置将 main 配置的服务端口改为 5189；测试内容、workers、重试次数与双端项目不变。对照 main 端口为 5190。机器原始时间日志使用 UTC，报告日期用北京时间。

### 视口、长文本与压力记录

| 验收 | 实际覆盖 |
| --- | --- |
| 五个桌面视口 | 1920×1080、1440×900、1280×800、1100×800、901×800；无文档/档案柜横向滚动 |
| 手机 | 390×844，两页旧 Dialog；另由原 suite 覆盖 Pixel 项目原行为 |
| 分类 | 全部9、穿戴4、设备1、证件1、工具武器2、杂物1；数字从正式物品实时派生 |
| 大集合 | 129 主角物品、123 收入、124 债务、123 资产；20 条分页、原顺序、筛选、选择后列表滚动保留 |
| 长物品 | 名称重复30次、180段描述+600字符无空格串、最大安全整数数量/参考价；完整详情可读 |
| 金额 | 普通、百万、亿级、MAX_SAFE_INTEGER 分、2×MAX_SAFE_INTEGER 分的精确合计；五尺寸字号不低于12px，允许换行 |
| 只读性 | 全状态+草稿前后严格相等，无外部请求、无 pageerror |

[performance.json](validation/performance.json) 记录自动化包含等待的打开耗时，仅用于此次回归观测，不是独立渲染基准或性能保证。

## 截图索引

所有 React 截图来自实际 Vite/Chromium 页面与正式 Schema 夹具；未合成产品画面。设计 HTML 独立在同一浏览器截图；对照页只并排展示原始图片。

- 物品完整三栏：[1920](screenshots/inventory-1920.png)、[1440](screenshots/inventory-1440.png)、[1280](screenshots/inventory-1280.png)。
- 物品中屏重排：[1100](screenshots/inventory-1100.png)、[901](screenshots/inventory-901.png)；[来源与归属](screenshots/inventory-provenance-901.png)。
- 资金与经济：[1920](screenshots/economy-1920.png)、[1440](screenshots/economy-1440.png)、[1280](screenshots/economy-1280.png)、[1100](screenshots/economy-1100.png)、[901](screenshots/economy-901.png)。
- [资产](screenshots/economy-assets-1440.png)、[债务完整记录](screenshots/economy-debt-1440.png)、[窄屏底部技术字段](screenshots/economy-details-901.png)。
- 压力：[大量物品](screenshots/inventory-many-1100.png)、[大量经济记录](screenshots/economy-many-1100.png)、[长描述](screenshots/inventory-long-901.png)、[极大金额901](screenshots/economy-extreme-901.png)、[极大金额1440](screenshots/economy-extreme-1440.png)。
- 手机：[物品](screenshots/inventory-mobile.png)、[经济](screenshots/economy-mobile.png)；未修改 main：[物品](screenshots/main-inventory-mobile.png)、[经济](screenshots/main-economy-mobile.png)。

## 文件与兼容性

[FILES.txt](FILES.txt) 包含最终提交完整文件清单；产品改动限于 7 个 UI 文件，另外是测试、夹具及施工证据。正式存档结构无变化，不需要迁移；BigInt 仅存在于 UI 派生值和格式化，不会写入保存对象。本批不改变存档的新旧版本读取能力，也不承诺较新存档能被旧程序读取。

需九代目审查及玩家最终视觉确认；Draft PR 不自行合并。
