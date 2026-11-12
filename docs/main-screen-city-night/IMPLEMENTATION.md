# UI-2「城市长夜」实现与验收

基线：`origin/main` 的 `9fd0cf1d6562bc0d41bd8e5f5f1ae397ec843efc`，独立分支 `codex/ui2-city-night`。该 main 尚未收录设计附件，因此本 PR 一并收录本聊天上一轮已经修订的 [v5 HTML](heijin-main.html) 和 [交接说明](MAIN_SCREEN_HANDOFF.md)。没有引用、恢复或合并已关闭的 #105。

## 数据与业务边界

创角的 `Creation.city` 在 `buildCreationState → createGameState → SaveRepository.create` 写入正式存档时保存为 `openingCityId`，早于开局草稿生成。GameState 顶层新增 `openingCityId?: string | null`，保持 schemaVersion 9。字段省略代表旧档未处理，`null` 代表已确定使用中性视觉身份；没有对应四城美术的合法 id 同样显示素版。渲染不沿当前 `protagonist.locationId` 选择主题。

旧档沿现有 V6–V9 严格校验、迁移路径读取，仅缺字段时按原首页 `saveCity(title)` 的四城标题后缀规则补齐，无法识别时写 `null`。`readStoredState` 在 Repository 原有 readwrite 事务中读取最新记录、完整校验后写回，不提升游戏 revision；后续草稿校验、CAS 或写入失败时该事务整体回滚。只读列表与原始导出不写库。业务命令、NPC 管理、记忆维护、回合提交仍沿用各自原来的锁、版本、原子事务和回执保护。

旧撤回快照可能缺身份字段，恢复时保留当前正式存档已固定的身份（包含 `null`），不按快照标题或所在地重新猜测。

journal 新增可选 `scene: { worldClock: GameTimeSchema, locationId: IdSchema }`。普通回合记录 `current.worldClock/current.protagonist.locationId`；待定开局记录已经验证的 `openingTimeSelection(...).startAt` 和生成前的正式开场地点。创角只有城市节点时记录城市，不把本回合结束后的移动目的地当作开场地点。正式世界时钟仍按原逻辑结算到 `endAt`。scene 与 journal 在同一提交事务写入、同一撤回快照恢复；旧回合不补造场景，不新增 AI 请求。

**兼容性方向：旧存档可在新版本读取。由于顶层及 journal 使用 strictObject，携带新字段的新版存档不保证被旧版本程序读取。** 标题线索已经被外部改写、或原始信息丢失的旧档无法证明真实开局城市，识别不到时永久使用中性身份。

Story/Variables/World 协议、提示词、三阶段执行、经济/NPC/物品/事件规则和各资料面板内部 DOM 均保留。首页/存档馆的视觉与默认 skyline 输出保持原样；skyline 只增加一个默认开启的环境雪参数，游戏调用关闭首页自带雪花，让天气统一受 `weatherText` 控制。

## 设计对照

| 部分 | v5 要求与 React 实现 |
|---|---|
| 氛围 | 同源四城天际线、种子、主题色；五时段的天空/窗灯/明暗、五天气 CSS 效果；无 Canvas、逐帧 JS、网络图片；氛围不可聚焦、aria-hidden、pointer-events:none；reduced-motion 停止动画 |
| 顶栏 | 76px 城市品牌与实时地点面包屑分离；GMT+8 时钟、日期星期、天气/环境两行截断，title 保留全文；待定开局显示 `--:-- / 开局时间待确认` |
| 左栏 | 真实主角信息、两项资金、身体情绪、七项装备与原入口；长状态受限，全文在原档案面板查看，侧栏可滚动 |
| 阅读区 | 1120px 上限、玻璃稿纸与折角、四城回目及两侧装饰、中文历史副标题；可访问 h2 仍为「第 N 回合」；无朱砂结算印章 |
| 台词 | 沿用 StoryReading DOM，PC 通过 grid 显示头像、姓名、悬挂台词，主角用金色；手机仍用原气泡；完整姓名和多行台词保留 |
| 行动与输入 | 两列建议、奇数末项通栏；紧凑状态/三段进度/原 details；撤回、Roll、取消、发送条件保留；PC 数字 1–5 和 Ctrl/⌘+Enter 遵守输入、IME、弹窗、忙碌状态和发送条件 |
| Dock | 7 个原资料入口与设置/返回首页；窄栏可滚动，短屏可访问，面板内容保持原结构 |
| 响应式 | ≥1200 完整三栏；901–1199 为 220px 左栏/68px Dock；≤900 保留原手机布局，没有「移动端将单独设计」提示 |

实测阅读区与输入行的左边缘、宽度均一致：[布局测量](layout-measurements.json)。1920/1440/1280/1100 四个宽度分别为 1120/1063.2/916/756px，符合 v5。

手机与未修改 main 使用相同 Mock 存档、390×844、reduced-motion 截图比较：[比较数据](mobile-comparison.json)。329160 像素中只有标签边缘 8 像素不同，99.9976% 像素相同。

| 视口 | React | 最终 HTML |
|---|---|---|
| 1920×1080 | [真实页面](screenshots/react-1920x1080.png) | [设计稿](screenshots/html-1920x1080.png) |
| 1440×900 | [真实页面](screenshots/react-1440x900.png) | [设计稿](screenshots/html-1440x900.png) |
| 1280×800 | [真实页面](screenshots/react-1280x800.png) | [设计稿](screenshots/html-1280x800.png) |
| 1100×800 | [真实页面](screenshots/react-1100x800.png) | [设计稿](screenshots/html-1100x800.png) |
| 390×844 | [手机页面](screenshots/react-390x844.png) | [未修改 main](screenshots/main-mobile-390x844.png) |

另提供 [PC 剧本台词](screenshots/react-dialogue-1440x900.png)、[手机原气泡](screenshots/react-dialogue-390x844.png)、[重庆开局人在上海](screenshots/react-cq-in-shanghai.png)、[待定开局](screenshots/react-pending-opening.png)、[工作流详情](screenshots/react-workflow-details.png)、[长文本](screenshots/react-long-text.png) 和四城截图；这些均来自真实 React 与 Repository 的 Mock 存档。

## 验证

所有命令在 Node.js `v24.19.0` 下运行。所有模型请求为 Mock；视觉与兼容场景直接使用 Repository 及隔离夹具，不调用付费模型。

- `npm ci --cache /tmp/ui2-npm-cache`：成功，143 packages。初次使用默认缓存目录时该目录不可用，指定可写缓存后成功，未改 lockfile。
- `npm run check`：lint、119 个测试文件/3105 项单测、typecheck 与 production build 全部通过。
- `npm run prompts:check`：3 个文件/93 项通过。
- 新增 41 项单测覆盖四城创角、V6–V9 旧档、同版补齐写回、未知身份、补齐失败/草稿损坏回滚、并发业务写入/CAS、旧快照撤回、场景可选兼容、天气优先级、GMT+8 跨日/星期/边界与中文数字。
- Chromium E2E：完整批次 144 用例（134 通过、9 项按平台跳过、1 项短屏建议区检查失败）；去除继承自 UI-1 的额外 16px 下边距后，该项继续执行到首页，暴露旧 `.app-header` 选择器；改为现有首页 `.topbar` 后复测通过。最终按用例取最新结果为 **135 通过、9 跳过、0 未解决失败**，不是把重复复测累加成新用例。最终截图 3 项复测也全部通过。完整批次与各次复测日志、逐项成绩见 [结果 JSON](validation/e2e-results.json) 与 [验证目录](validation/)。覆盖桌面、手机、模拟键盘、工作流、开局时间、撤回、资料入口、100 组城市/时间/天气组合以及真实截图。
- 四城白天+雾的明亮背景正文抽测：[对比度测量](contrast-measurements.json)。历史正文最低 5.346:1、最新正文最低 9.872:1，均达到 4.5:1；以截图中的实际字形及同位置背景计算，排除抗锯齿边缘，不将其声称为所有像素或所有视口的穷举。

未修改 main 的对照：`npm run check` 为 118 文件/3064 项通过，`prompts:check` 为 93 项通过。旧 action-workflow「创角、回首页、再读档」测试在 main 同样失败，因为它返回新版首页封面后直接找隐藏的「读取存档」；同组取消测试在 main 通过。日志见 [main 对照](validation/main-e2e-control.txt)。PC 阅读布局旧用例在未修改 main 也能复现返回首页后找不到 `.app-header`，见 [布局对照](validation/main-e2e-layout-control.txt)。本 PR 显式打开既有存档馆/封面并精确定位 NPC 的「查看人物」按钮，保留原业务断言；PC 几何与台词布局断言按已确认 v5 更新为精确宽度和剧本排版，手机断言保留。ESLint 排除 Playwright 生成目录，避免将生成的 trace JS 当源码扫描。

原有构建的大于 500 kB chunk 提示在 main 和分支均存在；没有为本轮 UI 引入打包或系统重构。

实际修改文件见 [文件清单](changed-files.txt)。本 PR 为 Draft，未合并、未部署、未发布，等待九代目审查与玩家最终视觉确认。
