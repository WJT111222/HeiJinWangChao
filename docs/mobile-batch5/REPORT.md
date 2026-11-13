# 手机 UI 第五批：档案纸系统与内部资料阅读

## 基线、范围和交叉施工

开工 main：`fbb1f13902eff11924b5dd74f42fa91a082106c5`。实现提交 `3a20be7`，随后无冲突合入最新 main `bcc51dd97c13ed87a812accb5de471089527b3eb`（#126 备份合并），验证源码 HEAD 为 `4020da225714889260fe92b22d6b1575980ac471`。最终交付 SHA 见 PR HEAD；后续提交只含测试拦截修正和本报告、截图证据。

已核实 #120、#122、#123、#124、#125、#127、#130 均已合并。#126 的 `instance` 参数及正式调用完整保留。交付前复查 main 仍为 bcc51dd9；开放 #128（Beta 版本）和 #129（公告自动发布）与本批实现文件无交集，不合入这些未审查改动。

仅 ≤900px 启用 `mobile-archives.css`，CSS 同时限定 `.mobile-archive`，不影响 #120 非模态工作流。≥901px 使用原 PC 分支。没有修改 domain、executors、prompts、services/storage、workflows、services/ai、App、创角、公告、Cloudflare、版本或发布流程。没有修改通用 Dialog、useGameViewport、WorkflowPanel 或 MobileWorkflowDrawer。

## 实现及正式设计依据

阅读了 ZIP 与仓库 `docs/mobile-batch3/reference/` 的三个 HTML 和三个交接文件。面板 HTML 与 ZIP 对应版本一致。演示人物、金额及测试连接没有接入产品。正式用户任务优先于过时的原型说明，例如不恢复已删除的失败恢复占位，不将工作流改回原生模态，不添加测试连接请求。

| 面板 | 实际完成 |
| --- | --- |
| 统一容器 | 原 native Dialog，纸面 #E4DCCA、卡片 #EFE8D9、印章标题、10px 顶部留空、安全区、抓手；主内容唯一滚动所有者；真实 focus/Esc/遮罩/拖动关闭；reduced-motion |
| NPC | 名录/详情、横滑吸顶分节、返回滚动/回焦；原 Repository 星标；成年女性七字段资格与休眠恢复完整保留 |
| 组织 | 原四类档案、吸顶分节；人物/组织/事件以正式 ID 跳转；未知身份不建档 |
| 世界事件 | 原家族/并行/计划/退役成果/性质及历史入口保留；真实人物/组织/地点 ID 跳转；不产生第二套事件数据 |
| 记忆 | 五层及原有第六个人物记忆视图；来源正文、分页及返回回焦；只读 |
| 地图 | 原 mapProjection 安全森林；直接下级双列、路径搜索、面包屑、真实人数、四个子地点标签、定位到我；共用原河流 SVG；手机不递归展开整棵树 |
| 经济 | 复用 EconomyPanel/economyView/money/amountSummary/debtProgress；黑金余额、部分未知合计、收入/债务/资产；到账/预计/取消原样，车辆信息和原始记录可读 |
| 历史 | 原唯一排序投影，单列同时间槽世界先主角后；分类筛选、原分页、原时间精度；native 年代选择器，详情返回保留位置 |
| 物品 | 三列物证标签；只显示主角所有物；内层 native 子抽屉，外层网格不卸载；筛选、滚动、焦点恢复；原估值/描述/itemAttributes |
| 设置 | 五分类档案首页，原编辑器和真实保存反馈；AI/记忆未保存确认、提示词开关手动保存、迟到预览隔离；封面设置也监听可视区域以避开软键盘 |

与原型的必要差异：二级页保留现有语义清楚的返回按钮，置于内容顶部/吸顶区域，外层正式标题和关闭按钮保留；AI 使用已有真实渠道选择与表单，未新增演示式测试连接或强制改为横滑渠道卡；提示词管理仍有清晰可达的原手动保存入口；记忆保留原已有人物记忆第六视图。详情数据和图中原型演示数据不同，不能做数据内容像素匹配。

## 验证环境、命令及结果

Node **v24.19.0**，正式 `npm ci` 安装143个包，非浏览器 shim。Chromium `/usr/bin/chromium`，单 worker、零 retry、外部地址拦截、全部模型 Mock；截图使用 CSS 像素 DPR1。

| 批次 | 实际结果 |
| --- | --- |
| npm ci | 退出0；143 packages |
| 最终定向 Vitest（12文件） | **211通过 / 0失败 / 0跳过**，11.52秒 |
| prompts:check（独立批次） | **93通过 / 0失败 / 0跳过**，3文件 |
| typecheck、lint、build | 均退出0；构建保留常见 >500kB chunk 警告，不宣称无警告 |
| 最新 main 上档案 Chromium（21用例） | **20通过 / 1失败 / 0跳过**，2.9分钟；唯一失败为测试拦截没有命中迟到预览，详见下文 |
| 修正后仅迟到预览用例 | **1通过 / 0失败 / 0跳过**，14.4秒；不是一次21/21完整重跑 |
| 既有 #120 工作流冒烟 | **1通过 / 0失败 / 0跳过**，10.6秒；真实点击输入/发送，失败恢复/取消/原子结算/刷新 |
| 测试拦截修改后的 typecheck、lint | 均退出0 |
| diff --check / 禁改目录对照 | 通过；禁改目录相对 bcc51dd9 无差异 |

定向 Vitest 命令：

```sh
npx vitest run src/tests/mobile-archives.test.tsx src/tests/map-archive.test.tsx src/tests/archive-assets.test.tsx src/tests/inventory-v2.test.tsx src/tests/archive-reading.test.tsx src/tests/archive-step2.test.ts src/tests/event-archive-ui.test.tsx src/tests/history-chronicle.test.ts src/tests/history-time.test.ts src/tests/prompt-inspector.test.ts src/tests/npc-cabinet.test.ts src/tests/npc-roster.test.ts
```

浏览器命令（需本地5176开发分支、5271未修改bcc51dd9基线服务）：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-archives.spec.ts --config=playwright.mobile-archives.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-archives.spec.ts --config=playwright.mobile-archives.config.ts --grep '手机提示词管理'
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/pr120-integration.spec.ts --config=playwright.mobile-archives.config.ts --grep '抽屉打开时真实输入发送'
```

未执行全量 Vitest、约700项 Chromium 或真实收费模型测试，不将定向结果冒充全量验收。具体逐项结果、每批状态/耗时见 [chromium-batches.json](validation/chromium-batches.json)；工程执行输出保存在 validation/（仅清理行末空格和末尾空行，未更改结果），没有将多个批次成绩相加伪装为一次全绿。

## 初轮失败和修复记录

| 批次（单独运行） | 通过/失败/跳过 | 原因与修正 |
| --- | --- | --- |
| Vitest initial | 34/7/0 | 合成夹具 ID 冲突、地点缺失/在场引用不一致；修正夹具，不改正式 Schema |
| Vitest round2 | 39/2/0 | 测试错误期待非直接子地点；静态 markup 金额被 em 分隔；改为真实层级与纯文本断言 |
| Vitest round3 | 41/0/0 | 上述测试修正后通过 |
| Vitest targeted | 201/0/0 | 十文件直接回归 |
| Chromium initial | 0/6/0 | Repository.create 正确拒绝导入已提交历史；测试改为合法 Schema 夹具的测试专用 IDB seed |
| round2 | 2/5/0 | 纸面 CSS 优先级、夹具金额、相对 locator、设置状态/超时；修正文案断言、样式及等待 |
| round3 | 4/3/0 | 设置旧四列表单/hidden被覆盖、PC对照超时；手机单列与 scoped hidden、PC120秒测试预算 |
| round4 | 0/3/0 | 新设置 effect 在 tab 初始化前引用；移动到初始化后，未改业务 |
| settings-r5 | 1/0/0 | 设置修正后通过 |
| complete-r6 | 14/3/0 | PC1440 Pixel7分数DPR导致14像素细微差异；旧主页seed不适配#125；错误AI标签；统一真实PC DPR1、直接seed、实际标签 |
| extras-r7 | 4/1/0 | 混合CDP拖动及触摸click未派发；保留诊断，未改通用生产手势 |
| boundaries-r8 | 2/1/0 | 同上；史料分页与封面可视区通过 |
| gesture-diagnostic-r9 | 0/1/0 | 捕获pointer/touch但无click，native dialog/scale均正常 |
| gesture-paced-r10 | 0/1/0 | rAF分帧拖动仍不解决混合输入工具问题 |
| gesture-keyboard-r11 | 1/0/0 | 真实拖动后用键盘重新打开，再真实touch点遮罩，保留开关/回焦/存档断言 |
| final-chromium | 20/1/0 | 同步#126后的prototype测试拦截未命中（存在热更新模块实例差异风险）；不是repository.load被移除。改在测试route暂停真实buildStagePreviews，不修改生产组装、generation或存储 |
| preview-r12 | 1/0/0 | 真实组装完成、切换编辑器后释放旧预览，旧结果不能覆盖新选择；开关/刷新/只读/零POST断言保留 |

所有既有安全断言保留：只读前后 state/draft 深比较、模型 POST 为零、星标正式写入路径、七字段全量往返、摘要与原始记忆保持、手动保存/失败反馈、旧预览失效。测试只在隔离浏览器使用合成档案，未接触真实玩家数据。

## 双端截图及设计核对

[截图目录](screenshots/)包含全部七资料页390×844、392×420，设置首页375×667、390×844、430×932、392×420、900×800，以及经济、物品子抽屉、历史详情、人物/组织分节、记忆来源、设置AI/记忆/提示词、封面键盘可视区和#120发送状态。

| 面板 | HTML设计稿与真实React并排 |
| --- | --- |
| 地图 | [对照](comparisons/地图-design-react.png) |
| 经济 | [对照](comparisons/经济-design-react.png) |
| 历史 | [对照](comparisons/历史-design-react.png) |
| 物品 | [对照](comparisons/物品-design-react.png) |
| 设置 | [对照](comparisons/设置-design-react.png) |

左图明确是HTML参考，右图为真实React、合法合成世界。逐项核对纸色、方印、头栏、安全区、搜索/分类、卡片、地图网格、钱包、单轴、三列物证和五设置入口；并排图使用不同内容状态，不声称设计像素完全相同。

PC：901px与1440px，NPC/组织/地图/物品/经济/事件/历史/记忆/设置各九页，真实React主干与开发分支同一状态/字体/DPR1/固定动画截图，**18组完全相同**。[901结果](validation/pc-901.json)、[1440结果](validation/pc-1440.json)，原始 `main-pc-*` / `react-pc-*` PNG均保留。除视觉外，手机交叉档案导航、星标及设置真实保存，跨桌面/手机编辑器实例保存也有浏览器断言；未声称全部PC业务全量重测。

## 剩余边界

- 未在真实iOS/Android设备验收输入法、系统安全区、读屏或持续触摸。392×420及visualViewport mock只能证明可视区重排逻辑，不等同系统键盘实测。
- CDP拖动后Playwright touchscreen.tap的混合输入未派发click，单独记录为未解决的自动化/设备交互边界；未通过弱化断言或修改已验证的通用Dialog掩盖。真实硬件连续触摸仍需复核。
- 深层地图1500级、搜索/分页和大量物品有合成测试；没有真实低端手机性能测量。长路径本身仍有构建/排版成本，未引入新的领域裁剪。
- 原生内层资料是模态，只有#120工作流仍非模态；未统一改造其他弹窗权限。
- 没有真实付费模型请求、没有部署、没有合并PR；本批完成后停止，等待审查，不启动第六批。

## 修改文件

具体源码、测试及配置见 [implementation-files.txt](validation/implementation-files.txt)。另新增本报告、按批测试证据、真实截图与五张设计并排图，不提交参考ZIP、私人数据或依赖目录。


## 十代目定向返修：手机地图跨档案定位（2026-11-13）

**返修前 HEAD**：`71af04a92c51bf083c701be4793d7d8dcd211dba`。开工通过 GitHub PR/完整 review `5889088083` 及 fetch 再核对；main 仍为 `bcc51dd97c13ed87a812accb5de471089527b3eb`，分支 `feat/mobile-redesign-batch5` 无后续提交，工作区干净。本轮继续原 Draft PR #131；返修后完整 SHA 见 PR HEAD/交付回复。

### 根因与最小修复

`selected` 初始化优先采用 `initialId`，但 `layerId` 优先恢复 `uiState.layer`，旧搜索也继续生效：新地点详情可能配上旧父层、旧区域块，甚至因旧查询完全看不到区域块。仅 useState 初始化还无法处理同一个 MapPanel 挂载期间目标变更。

只调整 `MapPanel.tsx` 的手机初始化和目标同步，不改 mapProjection、GameScreen 或共享 Dialog：

1. 通过原安全森林 `nodes/parent` 验证目标。**有效外部 initialId → 目标直接父层、目标选中**；清除遮挡它的旧查询，仅提高目标所属层的显示限额，保证第50项之后的目标也可见，其他阅读限额不清空。
2. 没有新目标时保留有效选中、父层、查询和限额；明确保留 `layer: undefined` 的“全部地点”阅读状态，不将其误当作未初始化。
3. 无效目标不创建、不猜测地点。初次挂载时使用合法旧阅读状态，否则回到主角有效地点/安全森林根；挂载期间收到无效新目标则保留当前合法阅读。正式地点集合变化导致选中地点消失时安全回退；失效父层使用原森林父层。
4. ref 记录已消费的原始目标 ID；只在 ID 变化时同步，不因渲染、手动下钻、面包屑或搜索重复应用旧导航。原焦点、选择、定位、NPC/事件链接与滚动处理继续复用。
5. 所有新导航分支仅在 `mobile=true` 执行，PC 构造条件与处理路径保留。没有清空整套阅读状态，没有修改正式数据、AI输入或权限。

### 新增回归及分批执行结果

- 三项 Vitest：旧父层/查询/分页与新目标冲突；普通重开（含全部根地点与查询）；无效/失效目标及异常父级安全回退。初轮 **7通过 / 3失败 / 0跳过**（原七项通过，新增三项复现）；修复后连同 `map-archive.test.tsx` **17通过 / 0失败 / 0跳过**，2文件，1.34秒。
- 新 Chromium 真实 GameScreen 导航：主动下钻海外A→选中地点→关闭→普通重开保持A→留下搜索→世界事件以正式locationId跳转阅览室B。检查详情、空查询、直接父层面包屑、层标题、唯一目标区域块与 aria-pressed；再次普通打开、搜索、定位到我保持一致。state/draft 深比较不变，模型POST为零。
- 新 Chromium 同挂载场景：真实 React MapPanel/Dialog 在测试专用 root 中更换 initialId、选中分页外目标、手动面包屑/搜索后同ID重渲染、无效目标、选中地点从投影移除、异常父级孤立节点。生产组件和 native Dialog 没有被 shim；测试通过 render 更新 props，不需要新的产品入口。

| 独立批次 | 通过 / 失败 / 跳过 | 结果含义 |
| --- | --- | --- |
| 修复前新增Chromium两项 | 0 / 2 / 0 | 第一项复现旧查询遮住新目标；第二项测试root自动ID冲突，不能当作第二个产品缺陷的证据 |
| 修复后定向Chromium六项 | 5 / 1 / 0 | 跨档案核心场景、既有地图搜索/定位/NPC跳转、世界家族导航与两个PC对照通过；同挂载测试仍因root的ID冲突失败 |
| 仅修正测试root唯一前缀后单项复测 | 1 / 0 / 0 | 同挂载全场景通过，7.0秒；没有删除或弱化原断言，不是一次6/6整批重跑 |
| TypeScript、Lint、生产Build | 均退出0 | Build有原有大chunk提醒；无新增正式数据契约 |

测试root的独立 `createRoot` 曾与主React root生成相同useId，导致 `aria-labelledby` 指向主界面城市文本。页面实际已有地图内容，但按正确Dialog名称定位失败。仅在**测试**root设置 `identifierPrefix: 'map-navigation-'`，保持原可访问名称断言和完整导航/只读断言。未修改通用Dialog或产品ARIA规则。所有修复前/后日志和每项结果保存在 [本轮证据目录](validation/map-navigation-review/)，只去除日志行末空格及末尾空行，不改结果；完整trace原件留在本任务 `/tmp/pr131-map-*-chromium/`，不能将临时trace目录视为长期备份。

复现/复测命令：

```sh
npx vitest run src/tests/mobile-archives.test.tsx src/tests/map-archive.test.tsx
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-archives.spec.ts --config=playwright.mobile-archives.config.ts --grep '地图跨档案新目标|地图同一挂载|地图逐层下钻|世界家族并行|PC 901px|PC 1440px'
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-archives.spec.ts --config=playwright.mobile-archives.config.ts --grep '地图同一挂载'
npm run typecheck
npm run lint
npm run build
git diff --check
```

### PC保护、实际改动及边界

PC901px/1440px本轮再次执行既有九档案/设置与未修改 main 的真实截图对照，18组逐像素一致，结果文件仍为 `pc-901.json` / `pc-1440.json`；含地图在内的原图没有变化。新增 [手机跨档案定位图](screenshots/地图跨档案定位-390x844.png)。

本轮仅修改 `src/ui/panels/MapPanel.tsx`、`src/tests/mobile-archives.test.tsx`、`e2e/mobile-archives.spec.ts`、本报告，另新增本轮日志/结构化结果与一张真实React截图。没有修改其他八类档案、CSS、GameScreen、mapView、V9 Schema、IndexedDB V4、Repository、备份、Commit、Undo、Prompt、AI、记忆维护或#120工作流。与返修前HEAD逐目录diff核对保护范围无变化。

没有重复约700项全量E2E，没有付费AI请求、合并、部署或发布。真实iOS/Android软键盘、读屏、连续触摸及低端手机性能边界仍按上一轮标注，不能由本次Mock宣布通过。无本轮已知阻断项；等待十代目复审，不开始第六批。
