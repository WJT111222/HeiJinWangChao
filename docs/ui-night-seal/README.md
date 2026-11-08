# PR UI-1「夜幕金印」设计实施报告

**正式视觉基准：Claude 方案 A。** 本 PR 将既有 React 游戏界面调整为夜幕金印布局；所有人物、金额、日期、正文、建议、存档及工作流状态仍来自正式 GameState / Draft 和既有投影。

- 开发模型：按任务指定使用 Astra High。
- 开发基线：开工前 `git fetch origin main`，确认 `8cc44e64ca214bfb62c65d1bc1c73bf01246f98d`（PR #75）。
- 分支：`ui/night-seal`；[Draft PR #76](https://github.com/WJT111222/HeiJinWangChao/pull/76)。保持 Draft，不合并、不部署，等待六代目复审。
- 参考方式：实际渲染并逐页查看用户 PDF 的三页；解包 HTML 后只阅读「方案A 游戏主界面」「方案A 首页」「方案A 手机主界面」的结构和 inline CSS。B/C 未用于实现；打包器、演示页面、PDF、内嵌字体均未进入生产代码。

## 1. 从设计稿到真实页面

| 方案 A 元素 | React 实现 | 数据与实际入口 |
| --- | --- | --- |
| 双线金印品牌、克制顶栏 | `App.tsx` 品牌、桌面主导航、手机游戏菜单 | 版本仍取 `PRODUCT_VERSION`；首页、切换存档调用原导航，设置打开原设置 Dialog |
| 首页左侧品牌主视觉、右侧档案卡 | `home-hero` / `save-library` / `SaveCard` 的统一主题 | 原存档列表、选择、继续、读取、刷新、确认删除、坏档提示和原始数据导出原样保留 |
| 人物顶部状态条 | 新的只读 `PlayerStatus` | 直接读取 protagonist、worldClock、locations、weatherText、cash、onlineBalance；完整状态、穿戴和候选开局时间进入原人物档案 |
| 居中小说与章节分隔 | 原 `reader`、`StoryReading` 加章节标题和建议列表 | `view.journal.map` 保留全部历史；当前 Draft、流式预览、顺序、自动跟随／手动阅读逻辑保留 |
| 右侧窄世界资料坞 | 同一 `worldNavigation` | NPC、势力组织、地图、物品栏、世界事件、历史时间轴、记忆，均打开原 `Panels` |
| 三阶段与行动区 | 原 workflow disclosure + composer | 自动执行、阶段详情和候选、手动正文、重新 Roll、取消、发送、错误与重试、诊断和高级开关仍使用原回调 |
| 手机故事／人物／世界资料／设置 | `mobile-game-nav` | 故事聚焦原阅读区；人物打开原档案；世界打开七项目录；设置打开原设置。目录不复制资料状态 |
| 全局资料、创角、设置基础主题 | 共享 token 和既有组件 CSS | Dialog、人物/经济、世界、物品栏、记忆、创角、AI 设置和提示词检查器保留原内部信息结构 |

## 2. 与原 UI 的主要变化

旧游戏页的左右常驻大栏改为顶部人物状态和 104px 世界资料坞，正文得到更宽的连续空间。正文和行动输入按同一 680px 阅读宽度居中；不再使用绿色径向背景和大块嵌套的工作流卡片。金色集中用于品牌、章节、主按钮及选中态。

手机使用独立布局。人物状态压缩为身份/时间地点、现金与两条简洁状态；完整资料通过展开入口访问。底部输入与四栏导航占据布局中的独立行，正文在中间独立滚动。世界资料使用原 Dialog 和同一七类导航，关闭具体资料返回目录，关闭目录恢复到底部入口。

首页保留全部真实存档行为。品牌标题改为中文衬线，城市天际线使用简单 CSS 边线与窗点，不新增图片或字体下载。原公告链接、未完成创角恢复、本地保存提示也继续存在。

## 3. 设计 Token

| 用途 | Token / 值 |
| --- | --- |
| 页面 | `--bg: #0B0D0C` |
| 面板 | `--panel: #131614` |
| 状态/行动底色 | `--status-bg: #0E110F` |
| 较高层表面 | `--surface: #1B201C` |
| 主要文字 | `--text: #E8E4D8` |
| 次级文字 | `--muted: #A3A396` |
| 香槟金 / 悬停重点 | `--gold: #C9A961` / `--gold-hover: #E3CB8A` |
| 边界 / 轻分隔 / 选中边界 | `#2C322D` / `#1E231F` / `#75623A` |
| 警示 / 可读警示文字 | `--warning: #C26A4A` / `--warning-text: #E6A18A` |
| 完成状态 | `--success: #6FA58A` |
| 间距 | 4、8、12、16、24、32px |
| 阅读宽度 | `--reading-width: 680px` |
| 标题字体 | Noto Serif SC → Noto Serif CJK SC → Songti SC / STSong → serif |
| 正文字体 | Noto Sans SC → Noto Sans CJK SC → 系统中文无衬线字体 |
| 数字/英文标签 | IBM Plex Mono → SFMono-Regular → Consolas → Liberation Mono → monospace |

字体声明仅选择可用的本地字体。没有 `@font-face`、字体二进制或远程字体请求；离线字体回退不阻止界面使用。正文桌面 17px/2 行高，手机 16px/1.95 行高。

## 4. 响应式、滚动与无障碍

- 桌面：品牌栏 → 人物状态条 → 正文与窄资料坞；高级工作流按需展开，并有自己的滚动容器。
- 900px 及以下：紧凑状态 → 正文/行动 → 四栏导航。正文保存全部历史，不按屏幕尺寸裁减记录。
- 手机高级设置的焦点回归暴露了按 textarea focus/blur 隐藏状态条引发的点击位移；已删除该规则。只在实际可视高度不足时收紧布局，输入与按钮之间切换焦点不再改变顶部高度。
- `useGameViewport` 原实现未改：继续响应 VisualViewport 的 height、offsetTop、resize、scroll 和缩放。新增基于游戏外壳实际高度的 container query，使软键盘缩小可视区但不触发 CSS 屏幕高度查询时也能收紧顶部。
- 手机导航保留 `safe-area-inset-bottom`，外壳保留顶部和左右安全区。未用固定 `100vh` 替代既有视口变量。
- 长姓名/状态在紧凑条内收敛；原文在人物档案完整可读。大金额换行，不撑破布局。无数据时仍显示原有「未确认」「待开局确认」等空状态。
- 原 Dialog 的原生模态、Tab 循环、Escape、关闭按钮及焦点恢复继续使用；嵌套世界目录也验证返回焦点。阅读位置不随打开资料而重置。
- 保留 `focus-visible`，为 `prefers-reduced-motion` 禁用装饰性过渡；主操作、目录和导航有触控高度。

## 5. 保留的全部功能入口

首页：新游戏、继续游戏、创角恢复、刷新列表、选择和读取存档、删除确认、坏档说明及原始导出、公告、设置。

游戏：首页、切换存档、真实版本、人物档案、经济资产、完整穿戴与装备、全部七类世界资料、完整历史及搜索资料、当前正文草稿、流式正文、行动建议填入、自由输入与发送。

工作流：默认一行状态；展开后自动生成/继续/完成结算，变量与世界手动生成和取消，候选详情、预览/验证标记、失败说明、重试与变更详情、已绑定输入、运行开关、模型原文、usage、上下文检查器和运行日志。正文手动生成/重新 Roll/取消移到输入旁，沿用原禁用条件和原回调。

设置仍管理 AI 配置、提示词、本地偏好及原记忆维护控制器。没有新建第二套任务生命周期、资料缓存或生成状态。

## 6. 与设计稿的差异及原因

1. 设计稿使用固定人物、金额、两回合文案及假版本。本实现全部来自实际存档；开局、生成、错误和未确认状态按真实业务显示。
2. 没有添加设计稿左侧装饰性两回合轨。正式游戏可能有大量历史，已有连续阅读和历史检索承载真实行为，避免让固定两点装饰暗示只有两回合。
3. 正文采用任务要求的无衬线字体。参考图正文更接近衬线排版；中文标题和章节仍保留文学感，正文优先保证长篇阅读。
4. 桌面行动区采用同一行的正文生成/重新 Roll、输入、发送，以减少真实工作流展开时的垂直占用。详情保留全部三阶段操作，不用静态阶段文案替代执行入口。
5. 已结算历史不可重新 Roll，按钮遵循原规则禁用；等待输入时发送可用。不会为了还原演示截图而重新打开已提交回合或触发新调用。
6. 手机保留所有历史，并允许正文连续滚动；参考图仅放一回合。长记录时某些建议需要滚动可见，输入和导航不会覆盖阅读区。
7. 参考稿未展示的真实公告、草稿恢复、无效存档、协议对话气泡和高级设置继续保留。人物完整状态在原档案里，不让任意长度内容撑高顶部。
8. 手机世界目录使用现有 Dialog，打开类别后关闭会回到目录。复杂资料内部采用基础主题适配，留待下一独立 PR 精修。

## 7. Playwright 截图与视觉验收

截图为本地真实 React 页面，由 Chromium/Playwright 生成。主存档由测试夹具通过真实 `create → completeDraft → commitTurn` 完成两回合，保留合法的下一回合等待行动草稿。截图中姓名与金额只是隔离测试数据，没有写入生产 UI。主图点击真实建议后输入框有值，发送处于可用状态。

前后截图使用同一测试场景与数据生成流程、同一视口（保存时间由真实写库产生）：before 来自未改 UI 的 main@8cc44e6；after 来自本分支。before 环境只复用新增测试夹具的可选 actionOptions 参数，未修改正式源码。

| 场景 | 改造前 | 改造后 |
| --- | --- | --- |
| 首页 1440×900（全页） | [before](screenshots/before-home-desktop.png) | [after](screenshots/after-home-desktop.png) |
| 首页 390×844（全页） | [before](screenshots/before-home-mobile.png) | [after](screenshots/after-home-mobile.png) |
| 游戏 1440×900 | [before](screenshots/before-game-desktop.png) | [after](screenshots/after-game-desktop.png) |
| 游戏 390×844 | [before](screenshots/before-game-mobile.png) | [after](screenshots/after-game-mobile.png) |
| 手机七项世界目录 | — | [after](screenshots/after-world-mobile.png) |
| 手机输入聚焦，可视高度 420px | — | [after](screenshots/after-keyboard-mobile.png) |
| 桌面三阶段展开，合法候选 | — | [after](screenshots/after-workflow-desktop.png) |
| 手机三阶段展开 | — | [after](screenshots/after-workflow-mobile.png) |
| 大量文字人物档案 | — | [after](screenshots/after-long-profile.png) |

人工对照 PDF 与 HTML A：顶部横向状态、中心留白、香槟金细线章节、右侧金印资料坞和手机底部四栏导航一致；页面不混入 B 的霓虹或 C 的纸张风格。正文密度、字体和行动区的适配差异见上节。

**验证边界：** 软键盘图为输入聚焦后模拟 VisualViewport 缩至 420px，空白下方代表浏览器可视区域以外，未绘制假键盘。测试还模拟 height=320/296 和 offsetTop=24 后恢复。使用 Chromium 桌面和 Pixel 7 移动配置及 iPhone 相近尺寸；未声称完成 iOS Safari/Android 实机输入法测试。

## 8. 检查结果

最终冻结批次在 2026-11-08 完成：**142/142 通过，8.0 分钟，0 失败、0 跳过、0 flaky、0 重试**。桌面 71、手机 71；指定九组共 124，新增视觉/响应式 4，坏存档回归 14。所有 AI 使用 Mock，无真实付费调用。[机器可读验收摘要](validation.json)。

| E2E 文件 | 桌面 | 手机 |
| --- | ---: | ---: |
| `action-workflow.spec.ts` | 20 | 20 |
| `automatic-settlement.spec.ts` | 8 | 8 |
| `character-creation-v2.spec.ts` | 3 | 3 |
| `continuous-turns.spec.ts` | 6 | 6 |
| `game-window.spec.ts` | 9 | 9 |
| `game.spec.ts` | 4 | 4 |
| `inventory-v2.spec.ts` | 2 | 2 |
| `night-seal.spec.ts` | 2 | 2 |
| `prompt-inspector.spec.ts` | 6 | 6 |
| `story-reading.spec.ts` | 4 | 4 |
| `unreadable-saves.spec.ts` | 7 | 7 |

最终批次独立写入 `/tmp/night-final-results`，未同时启动其他浏览器测试，也未边跑修改源码。前期诊断中发现并修复手机 focus/blur 点击位移；同时更新旧侧栏和状态文本定位。前期并跑导致的 trace 目录冲突及 HMR 干扰不计入最终结果，上述用例已在冻结批次全部通过。

复现命令（本机 Chromium 路径可按环境调整）：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/game-window.spec.ts e2e/story-reading.spec.ts e2e/game.spec.ts \
  e2e/continuous-turns.spec.ts e2e/action-workflow.spec.ts e2e/automatic-settlement.spec.ts \
  e2e/character-creation-v2.spec.ts e2e/inventory-v2.spec.ts e2e/prompt-inspector.spec.ts \
  e2e/night-seal.spec.ts e2e/unreadable-saves.spec.ts \
  --output=/tmp/night-final-results
```

- `npm run typecheck`、`npm run lint`、`npm run build`：全部通过；构建仍报告现有主包超过 500kB 的体积提示，本 PR 未增加依赖。
- 定向单元：`story-reading`、`player-memory`、`inventory-v2`、`character-creation-v2`、`unreadable-saves` 共 140 条通过。
- 必查尺寸：1440×900、1280×800、900×700、390×844、375×667、320×568、667×375。
- 另外对使用旧侧栏/首页定位的历史 E2E 做了共享导航 helper 迁移；除上述最终批次外，未整套重跑这些历史 specs，不代表全库 E2E 通过。
- 新增断言：全部历史、建议填入与发送可用、四栏真实导航、七面板关闭返回、长姓名和巨大金额、正文最小阅读空间、无页面横溢、视觉视口收缩/恢复、资料浏览前后正式 state/draft 完全相同且零外部请求。

## 9. 后续精修范围

NPC 多层认知、组织/事件长记录、地图、记忆分层与历史检索、AI 配置、提示词管理和预算检查器继续使用既有内部结构。本次只统一基础颜色、字体、按钮、输入、选中/警示状态和滚动表面。进一步信息架构或复杂组件美术作为独立 PR，不扩展本次 UI 范围。

## 10. 未改变的机制

没有修改 GameState Schema V6、IndexedDB 协议/迁移、Story → Variables → World 协调器、AI 请求/提示词/路由/计费、上下文读取、共享记忆召回、Worker 检查器执行、记忆压缩总结、World Variables 投影、revision/CAS/Commit/回滚/幂等或权限逻辑。`useGameViewport`、`StoryReading` 解析、SaveCard 功能、Dialog 焦点逻辑及各复杂面板的业务实现也保留。

测试夹具的新增可选 actionOptions 仅用于建立可重现的合法演示存档；没有为了截图放宽 Schema 或候选版本校验。生产改动集中于 App 展示导航、GameScreen JSX、只读 PlayerStatus 与 CSS。
