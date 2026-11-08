# UI-1.1 · PC 阅读布局与导航精修

本次仅精修 **大于 900px 的正式游戏页**，延续 PR #76 夜幕金印的配色和字体。开发模型按任务指定为 GPT-6.1 Sol High；基线为开工时 fetch 后核对的 `main@11115a1f15732f0df27a7544156e22ca577ea330`。独立分支 `ui/pc-reading-layout`，保持 Draft，交六代目审查，不合并、不部署。

## 阅读宽度与顶部空间

保留全局 `--reading-width: 680px`。只在 `@media (min-width: 901px)`、`.app-shell-game .game-layout` 内设置 `--pc-reading-width: min(calc(100vw - 280px), 1180px)`。右侧资料坞仍为 104px；阅读和行动区使用同一 padding 与原生 `scrollbar-gutter: stable` / thin gutter，让滚动条出现与消失时仍然对齐。当前 Chromium 的原生 gutter 为 10px，所以实际内容最大 1170px；其他平台原生滚动条可能使有效宽度略有差别。

| 视口 | 旧正文宽 | 新正文/行动宽 | 旧阅读区高 | 新阅读区高 | 新状态条高 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1650×927 | 680 | 1170 | 653.56 | 710.41 | 78 |
| 1440×900 | 680 | 1150 | 626.56 | 683.41 | 78 |
| 1280×800 | 680 | 990 | 506.41 | 583.41 | 78 |
| 1024×768 | 680 | 734 | 494.56 | 551.41 | 78 |
| 1024×520 | 680 | 734 | 328.97 | 349.81 | 78 |
| 390×844（手机，保持） | 358 | 358 | 537.81 | 537.81 | 97 |

PC 的 `.app-shell-game > .app-header` 隐藏，释放普通窗口原有 60px 顶栏；短窗口原 container query 顶栏为 44px。外壳原本为 flex，隐藏后状态条自然从 y=0 开始；全局错误提示仍占原独立 flex 行。新状态条固定为常规 78px，较旧条的高度差使实际阅读空间增量略有不同。行动区高度、textarea 与 Roll/发送按钮的高度没有因品牌而增加。

THE STORY、章节标题、旁白、对话容器、行动建议、工作流状态与展开内容、输入操作行共用一列。气泡保留原来的主角右置/NPC 左置和按内容伸缩，最大范围约束在该阅读列内；Roll/发送保持正常按钮宽度，输入框占余下空间。正文解析与 1.05rem/2 的中文排版规则未变。

## 品牌与导航

左下品牌是 App shell 的直接子元素，`position: absolute; left: 12px; bottom: max(16px, env(safe-area-inset-bottom))`，由既有 fixed shell 定位，不属于 reader，也不随正文滚动。使用原黑字双线金印、黑金王朝和真实 `PRODUCT_VERSION`，64px 竖排占用，印章 26px。阅读和行动左右至少 88px 留白，品牌右界为 76px，与输入/工作流左界至少留 12px；无需提高 composer 高度，没有背景卡片。`pointer-events: none`，z-index 1，原生模态仍在 top layer。1024×520 的展开工作流/运行中取消也核查输入与按钮可见。

七项世界分类仍由原 `panelNames` 与 `setPanel(name)` 映射。PC 坞在记忆下面增加独立 `nav[aria-label="系统操作"]`，用细线分隔：

| 新入口 | 原回调 | 实际行为 |
| --- | --- | --- |
| 设置 | `onOpenSettings` | 打开现有设置 Dialog；Escape 关闭后焦点回到设置按钮，正文滚动位置保持 |
| 返回首页 | `onSaves` | 回到原首页/存档列表；继续使用原选择和读取存档入口 |

两项只在 `!compactSidebars` 时渲染，手机世界目录仍恰好七项。没有添加 router、导航状态或资料状态。原侧栏 `overflow: auto` 保留，加 thin scrollbar 和滚动边界；短 PC 测试逐个滚入全部九项，记忆与两项系统操作都可达。

## 顶部真实状态

顶部继续读取真实 GameState 的姓名、年龄、性别、职业、时间、地点、天气、现金、线上资金、身体、情绪，以及人物档案/经济入口。环境从同一 `state.environmentText` 补入桌面状态栏。长姓名、职业、日期地点、天气环境、金额使用单行省略并提供完整 title；身体/情绪保留原 title。1024px 也保留身体和线上资金。长值测试验证状态条低于 100px，正式资料对话框保留全部长姓名和完整身体描述；未裁剪正式数据。

## 同场景截图

截图来自本地真实 React + Chromium，没有静态仿页。测试通过真实 SaveRepository 的 create、bindTurnAction、completeDraft、commitTurn 建立两回合历史及一段长第三回合，含真实协议解析的对话气泡和行动建议；点击建议填入 textarea。测试数据只存在隔离浏览器上下文，不写入生产 UI。

before 使用独立冻结 `main@11115a1` worktree/5181 端口，after 使用本分支/5180 端口。旧任务的 5174/5175 server 未修改。对照使用同一 fixture 与视口；截图测试阻断并断言零 HTTPS 外部请求。

| 视口 | 改前 | 改后 | 建议与气泡 | 展开工作流 |
| --- | --- | --- | --- | --- |
| 1650×927 | [before](screenshots/before-1650x927.png) | [after](screenshots/after-1650x927.png) | [底部](screenshots/after-options-1650x927.png) | [展开](screenshots/after-workflow-1650x927.png) |
| 1440×900 | [before](screenshots/before-1440x900.png) | [after](screenshots/after-1440x900.png) | [底部](screenshots/after-options-1440x900.png) | [展开](screenshots/after-workflow-1440x900.png) |
| 1280×800 | [before](screenshots/before-1280x800.png) | [after](screenshots/after-1280x800.png) | [底部](screenshots/after-options-1280x800.png) | [展开](screenshots/after-workflow-1280x800.png) |
| 1024×768 | [before](screenshots/before-1024x768.png) | [after](screenshots/after-1024x768.png) | [底部](screenshots/after-options-1024x768.png) | [展开](screenshots/after-workflow-1024x768.png) |
| 1024×520 | [before](screenshots/before-1024x520.png) | [after](screenshots/after-1024x520.png) | [底部](screenshots/after-options-1024x520.png) | [展开](screenshots/after-workflow-1024x520.png) |
| 390×844 | [before](screenshots/before-390x844.png) | [after](screenshots/after-390x844.png) | 原样保留 | 原样保留 |

额外证据：[矮屏九入口滚到底](screenshots/after-short-dock.png)、[长姓名/金额/身体](screenshots/after-long-status.png)、[Mock 运行中取消](screenshots/after-running-short-pc.png)。具体几何：[before](before-measurements.json)、[after](after-measurements.json)。

手机 390×844 before/after PNG 经 Pillow ImageChops 比较，差异 bbox 为 None，即逐像素相同；header=52px、状态=97px、正文=358px、输入行=44px，各几何值也完全相同。手机四栏导航和七项世界目录断言通过。新增品牌在手机隐藏，系统两入口不进入手机 DOM；手机 header/hamburger、底部导航、输入框、键盘适配的规则与 `useGameViewport` 均未改。

## 验证与范围

- 新 PC 布局/长值 Playwright：2/2 通过；全部六种视口无页面横溢、输入/发送可见、各列对齐、设置关闭焦点/阅读位置保持，资料前后正式 state/draft 不变。
- 定向既有 Playwright：运行中，最终结果在冻结验收后补录。只覆盖受影响的 game-window、story-reading、action-workflow；不声称全库 E2E 通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 首轮通过；构建保留既有超过 500kB 主包提示，无新依赖。
- 没有付费 AI、合并、部署。Mock 测试验证真实工作流回调，不改执行逻辑。

生产变更仅 App 品牌 JSX、GameScreen 系统导航 JSX、PlayerStatus 只读字段/title 和桌面 scoped CSS。首页/存档/创角布局、复杂面板内部、StoryReading/解析、历史逻辑、工作流生成/自动结算/手动 Roll/取消/发送、引擎、schema、IndexedDB、CAS/Commit、记忆/NPC、提示词、上下文和 AI 路由均未修改。

验证限于 Chromium 桌面与 Playwright Pixel 7 上下文；原生滚动条宽度随平台变化，未声称 Safari/Firefox 或实机输入法验收。移动端键盘继续由既有 VisualViewport 回归验证。
