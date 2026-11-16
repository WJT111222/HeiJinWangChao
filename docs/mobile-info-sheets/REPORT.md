# 手机端人物与世界资料弹层：调查、修复与验收

## 结论与基线

从实际最新 `origin/main@8ab4cf0e44829275b7e0bdacd03eb429ae2b0dad` 建立 `fix/mobile-status-directory-sheets`。交付前再次 fetch，main 未变化。该基线已包含 #161、#162；本次没有检出或修改其他任务分支。

确认的问题是这两个入口缺少“上拉展开”行为，以及内容顶部下拉与关闭手势冲突。已作局部修复。Chromium 定向验收通过；Node 24 完整工程检查通过。WebKit 下载被环境网络策略拒绝，实际 iPhone Safari 未覆盖，不能宣称真实 iOS 已通过。

最终提交 SHA 见本 PR 的 HEAD 和交付消息；本报告、源代码、测试与证据随同一分支交付。保持 Draft，不合并、不部署、不发布。

## 一、先只读调查，再修改

修改源码前已完成源码阅读、仓库外真实 Playwright 探针、合成存档复现，并写下 [第一阶段记录](INVESTIGATION.md)。原始测量见 [before-results.json](evidence/before-results.json)，过程见 [修复前 Chromium trace](traces/before-390-trace.zip)。没有使用玩家存档。

| 分项 | 未修改 main 上的实测 |
| --- | --- |
| 点击人物 | 375×667、390×844 都能打开「此时此地」 |
| 点击世界资料 | 两种尺寸都能打开目录，七个分类完整 |
| 横条上拉 | 世界目录高度约 347px，向上拖动后不变；没有展开按钮 |
| 长状态滚动 | 原生触屏上滑可改变 scrollTop，最终探针采样为 229；底部人物档案、经济资产可达 |
| 二级资料 | 人物档案、经济资产、NPC、势力组织、地图、物品栏、世界事件、历史时间轴、记忆均可进入 |
| 内容顶部下拉 | 向下滑 150px 直接关闭，阅读与关闭共用内容区域 |
| 缩小可视区 | 模拟 visualViewport 高500、offsetTop24，弹层与底部按钮仍在可见范围内，未复现工具栏裁切 |

因此，没有证据将“入口打不开”或“所有长内容不可滚动”归因于通用 CSS，也没有把 Chromium 的结果冒充 iOS Safari 的根因证明。已确认且与“拉不上去”一致的实现缺口如下：

- `GameScreen.tsx` 两入口仅传 `mobileVariant="sheet"`，没有可变高度状态。
- `useSheetGesture.ts` 原先把位移限制为 `Math.max(0, dy)`，横条只有下拉关闭，完全不处理上拉展开。
- 同一 hook 在 `.modal-body` 顶部下拉时也关闭弹层，容易与阅读动作混淆。
- `.modal-body` 已有 `flex:1 / min-height:0 / overflow:auto`；Viewport、安全区和背景锁已有实现，无需整体重写。

## 二、最小修复

只为「此时此地」与「世界资料」启用可选的 `sheetExpandable`。其他调用方默认不启用，保留原有行为。

- 收起态最大为可见高度的68%，仍允许原生内部滚动；展开态沿用可见高度减顶部安全区与18px的阅读高度。
- 顶部横条上拉超过60px展开；展开态向下拉超过110px收起，收起态再向下拉关闭。
- 标题栏提供「展开／收起」按钮，具有 `aria-expanded` 和 `aria-controls`，不依赖手势。
- 内容区只保留原生滚动，不使用下拉内容关闭；横向拖动、取消手势不切换档位。
- 展开／收起保留同一正文 DOM，恢复原滚动位置；原来已在底部时继续保持底部可达。
- 继续使用原生 Dialog 的焦点、Tab 环、Esc、遮罩关闭、回焦与背景滚动锁。

没有修改阅读主题、背景、正式字段、AI 请求、Prompt、GameState、Repository、IndexedDB、CAS、Commit 或 Undo。`GameScreen.tsx` 只在两个 JSX 调用处增加选项，未改常驻多功能按钮、工作流或原文面板。

## 三、正式环境与结果

环境：Node **24.19.0**，npm **11.9.0**，Playwright **1.64.1**，系统 Chromium **154.0.8037.57**（`/usr/bin/chromium`）。使用真实仓库依赖与正式 Vitest/Playwright，无离线垫片。

| 命令／最终批次 | 通过 | 失败／跳过 | 退出码 |
| --- | ---: | --- | ---: |
| `npm ci --cache /workspace/.npm` | 安装143个包 | 0 | 0 |
| `npm run check` | 161文件、3965项 Vitest；ESLint、TypeScript、文件名／命令目录检查、生产 Build | 0 | 0 |
| `npm run prompts:check` | 3文件、93项 | 0 | 0 |
| 新增定向 Chromium | 11 | 0／0 | 0 |
| 既有相关 Chromium | 8 | 0／0 | 0 |
| `git diff --check` | 通过 | 0 | 0 |
| `playwright install webkit` | 无 | 下载403 Domain forbidden | 1 |
| WebKit 390启动尝试 | 无 | 1项在浏览器启动前阻断，测试体未执行 | 1 |

Prompt 93项也包含在完整 Vitest 中，不能重复相加。开发期和最终复核的重复运行也不累加通过数量。最终浏览器为 **19个独立场景**，不是全量 E2E。

完整原始输出以 gzip 保存于 [logs](logs/)，保留每批 `.exit`。最终机器结果为 [新增 Chromium JSON](evidence/chromium-verified.json.gz) 和 [既有相关 JSON](evidence/related-final.json.gz)。构建有超过500kB的 chunk 提示，退出码为0，本次未扩大到打包优化。

### 新增 Chromium：11项

375×667、390×844、430×932各运行以下3项，共9项：

1. 人物打开、横条上拉、点击展开／收起、原生长文滚动、内容顶部下拉不关闭、底部入口、人物／经济二级页面、浏览前后完整 Repository 相同。
2. 世界目录上拉、下拉先收起再关闭、七分类进入与关闭；120个额外NPC的搜索、分页和详情；长档案滚动与只读。
3. 取消手势；缩小 VisualViewport；预留底部区域；844×390横屏与竖屏切换；连续5次打开关闭；遮罩、Esc、设置和工作流隔离；无残留滚动锁。

901×900、1440×900各运行1项，共2项：同一合成存档的主界面、人物档案、NPC，与干净 main **六组 PNG 字节完全一致**；同时核对浏览前后 Repository 与零 POST。见 [桌面图片哈希](evidence/desktop-comparison.json)。

新增资料浏览测试实际监听 POST 计数并断言0，PC另对真实新建页面计数，非写死的“零请求”结论。所有涉及剧情、人物与档案的数据均来自合法合成夹具。

### 既有相关 Chromium：8项

- `mobile-main-batch1`：Tab环／Esc／遮罩／短拉／取消；完整状态与金额及输入法可视区；真实触屏内容滚动与横条关闭；正常动效回弹。4项。
- `mobile-archives`：内层物品弹层手势与遮罩，外层保留；设置跨尺寸未保存编辑、二次确认和Esc。1项。
- `mobile-select-sheet`：选择抽屉避开底部区域及无渠道降级。1项。
- `stage-response-observation`：Variables、World失败原文主动查看、凭证脱敏、复制／滚动／关闭／重试／刷新、草稿与正式状态保护。2项，所有响应为Mock。

原有Tab测试增加对新展开按钮的焦点验证，原关闭按钮断言仍保留。原有内容下拉关闭断言按本次明确交互改为“内容不关闭、横条关闭”，仍核对真实触屏、正式状态不变与 reduced-motion。未修改其他业务断言。

## 四、开发期失败与基线对照

没有隐藏失败、添加 skip、扩大容差或增加自动重试（配置 retries=0）。原始批次日志保留：

1. 新压力夹具最初新增NPC的位置与正式世界引用不一致，11项在读档时失败；修正测试夹具位置，并先用 `GameStateSchema.parse` 校验，之后正常执行。没有修改领域校验或产品数据。
2. 新桌面1440逐像素断言初期失败：差异仅为人物入口圆角边框39个像素，主界面与NPC一致。记录了干净main自比较、外部独立探针、相同边界与全部计算样式，以及原始 trace。改为键盘激活资料入口，排除悬停渲染状态后保留原先严格的 PNG 字节断言，最终901／1440全部一致。没有为此修改生产代码。
3. 既有选择器用例最初因自定义项目名 `related-mobile` 触发其原有 `project.name !== 'mobile'` 跳过条件。修正本次配置项目名为 `mobile` 后实际执行通过，最终8项批次无跳过，没有修改原 skip 或断言。
4. WebKit安装所有官方备用入口均403；实际启动尝试也因缺可执行文件阻断。不能归为游戏断言失败，更不能算通过。

已知 `e2e/game.spec.ts:299` 手机设置旧定位失败本次未运行、未改动、未删除；本次以真实设置入口和既有跨尺寸确认场景验证相关边界。没有宣称全量浏览器通过。

## 五、截图与尺寸实测

配对截图使用相同合成档案状态、相同390×844视口、相同浏览器与 reduced-motion。它们来自真实 React，不是静态稿或正式玩家存档。

| 对象 | 修复前 | 修复后 |
| --- | --- | --- |
| 人物初始 | [截图](screenshots/matched-before-人物-initial.png) | [截图](screenshots/matched-after-人物-initial.png) |
| 人物展开 | 无展开行为 | [截图](screenshots/matched-after-人物-expanded.png) |
| 世界目录 | [截图](screenshots/matched-before-世界资料-initial.png) | [初始](screenshots/matched-after-世界资料-initial.png)／[展开](screenshots/matched-after-世界资料-expanded.png) |
| 长资料底部可达 | [调查截图](screenshots/before-人物-375.png) | [375](screenshots/after-status-expanded-375.png)／[390](screenshots/after-status-expanded-390.png)／[430](screenshots/after-status-expanded-430.png) |
| 可见高度／底部预留 | [调查截图](screenshots/before-toolbar-390.png) | [测试截图](screenshots/after-viewport-reserved-390.png) |
| PC901人物 | [main](screenshots/before-desktop-人物档案-901.png) | [修复分支](screenshots/after-desktop-人物档案-901.png) |
| PC1440主界面 | [main](screenshots/before-desktop-game-1440.png) | [修复分支](screenshots/after-desktop-game-1440.png) |

390×844下，配对测量：人物初始从826px改为约573.91px，可展开至826px；世界目录初始347.06px保持，可展开至826px。完整边界见 [matched-bounds.json](evidence/matched-bounds.json)。

## 六、覆盖限制与复核方式

- 无iPhone真机；WebKit无法下载和启动。真实Safari工具栏伸缩、橡皮筋回弹和系统边缘手势仍需真机确认。
- VisualViewport为事件驱动模拟；底部34px预留通过测试样式增加padding验证。CDP的 `Emulation.setSafeAreaInsets` 在本环境不可用，**不声称真实 safe-area env 或Safari工具栏仿真通过**。产品保留原有 `env(safe-area-inset-*)` 与 Viewport 逻辑。
- 未运行数百项无关E2E，未触碰真实生产站点，没有新增模型请求或存储机制。

复跑时先在干净基线工作树启动 `npm run dev -- --host 127.0.0.1 --port 54152 --strictPort`，再在本分支运行：

```bash
SHEET_REPORT=/tmp/info-sheets.json CHROMIUM_PATH=/usr/bin/chromium \
  npx playwright test --config playwright.info-sheets.config.ts
SHEET_REGRESSION=1 SHEET_PORT=54154 SHEET_REPORT=/tmp/info-sheets-related.json \
  CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config playwright.info-sheets.config.ts
# WebKit安装完成的环境才可执行；本环境失败日志如实保留。
SHEET_WEBKIT=1 PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
  npx playwright test --config playwright.info-sheets.config.ts
```

## 七、修改清单

- `src/ui/Dialog.tsx`：可选展开状态、按钮、正文关联与滚动恢复；原模态生命周期保持。
- `src/ui/useSheetGesture.ts`：可选双档手势；启用时内容只滚动，其他弹层沿用原规则。
- `src/ui/mobile-sheet.css`：仅≤900px且显式启用的两档高度与新按钮尺寸。
- `src/ui/game/GameScreen.tsx`：仅两个入口增加 `sheetExpandable`。
- `e2e/mobile-info-sheets.spec.ts`：触屏、长数据、Viewport、只读、请求计数、PC对照。
- `e2e/mobile-main-batch1.spec.ts`：只适配这次确认的焦点顺序与内容／横条分工。
- `playwright.info-sheets.config.ts`：独立端口、明确文件范围、零重试、Chromium／WebKit配置。
- `docs/mobile-info-sheets/`：本报告、修改前调查、原始日志、截图、trace与哈希。

交付到此停止，等待十二代目审查与项目负责人授权。
