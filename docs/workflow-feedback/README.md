# 三阶段工作流与全局反馈施工记录

基线：`main` 的 `0a286d6`（包含 #107、#108）。本轮在独立分支 `codex/workflow-feedback` 实施。

## 设计依据与范围

四份用户确认稿原样归档：[工作流 HTML](heijin-workflow.html)、[工作流交接](WORKFLOW_HANDOFF.md)、[反馈 HTML](heijin-feedback.html)、[反馈交接](FEEDBACK_HANDOFF.md)。稿件中的演示状态、人物及模型数据没有进入产品。

用户本轮产品决定优先于稿件中的旧「重新 Roll」说明：电脑和手机都移除主动替换有效正文草稿的入口；其余视觉施工仅在 ≥901px 生效。创角报错、手机游戏菜单和领域规则不在施工范围。

## 实现比对

| 确认稿要求 | React 实现及验证 |
| --- | --- |
| 紧凑进度轨 + 不推布局的浮层 | PC 受控详情按钮关联 region，三段进度和原状态计算保留；浮层背景 `#0f1211`，上方阴影、12px 圆角、内部滚动；输入框展开前后边界不变 |
| 三列阶段卡、中屏单列 | ≥1200px 三列；901–1199px 单列；原开关移入变量/世界卡，键盘名称保留 |
| 提示、主操作、费用、次要信息 | 保留原条件与文案；增加稿件指定的主操作旁说明；诊断与已绑定输入互斥展开，日志/响应/用量/正文检查保留 |
| 多阶段错误 | 单一 PC alert 容器中逐条保留各 Hook 错误及原设置按钮；失败码、尝试次数和诊断操作可查；手机保留原独立 alert |
| 关闭及焦点 | 详情再次点击、×、Esc 均关闭并返回详情按钮；原生模态弹窗优先处理 Esc；折叠不会卸载诊断组件或取消请求；展开时将「跟随最新正文」放入浮层头部，避免被浮层遮挡 |
| 四级反馈 | 深色与档案纸分别定义专用变量，避免与城市主题已有 `--warn` / `--ok` 冲突；级别标记 aria-hidden；原 role 不变 |
| 全局错误 | PC fixed 居中浮条，不推动页面，无自动消失，原关闭按钮及文案保留；创角保持原样 |
| 小确认弹窗 | 撤回、总结失败/待确认、未保存 AI 配置、删除存档：方印、顶色条、后果列表、底栏；Dialog 原生模态、焦点陷阱和关闭回调保留 |
| 候选查看 | PC 双栏，版本及真实计数、类型/依据/ID、拒绝与未解决事项；完整规范化结果和临时模型原文均保留，滚动代码框；手机使用原结构 |
| reduced-motion | 关闭工作流入场、生成圆点、浮条动画和开关过渡 |
| 手机样式 | 390×844 同一夹具与未改 main 对照，8 个区域的 9 项计算样式完全一致，详见 [原始数据](mobile-style-comparison.json)；两端移除 Roll 为明确产品变更 |

现有设置大面板保留深色底色，因此其内嵌提示使用深色四级色板；`.archive` 容器和「AI 配置尚未保存」纸色确认框使用档案纸色板。没有将整个设置系统重新设计。

档案纸确认稿中的金棕/墨绿用于小字时不足 AA；保留色板与装饰原色，只将小字颜色向纸上墨色混合 12%，满足 AA。深色反馈原色保持不变，计算见 [对比度](contrast.json)。

## 正文生成入口

`rerollStory()` 与 `StoryStage.generate()` 继续承担第一次生成、草稿版本递增、候选失效保护及底层协议测试。没有删除或改写这些协议。UI 和手动生成 Hook 使用同一入口策略，拒绝替换 `story` 已存在、正文状态为 ready 且摘要有效的草稿；空正文、failed 状态及升级前缺少摘要的无效草稿仍可开始/恢复，变量和世界补算入口不变。正式回合继续使用撤回。

原 UI Roll 测试按产品决定改为“有效草稿没有重生成入口、刷新不发请求”；失败重试、取消、迟到响应、切档隔离改从未完成正文执行。低层 `drafts`、`saveRepository`、`story-stage`、`turn-coordinator` 的 reroll 协议断言全部保留。

## 截图

截图由 Chromium 打开真实 Vite/React 页面产生；存档通过真实 Repository 和测试夹具建立。模型请求全部 Mock，没有调用付费服务。

| 状态/界面 | React | 确认 HTML |
| --- | --- | --- |
| 等待开局 | [电脑](screenshots/react-opening-desktop.png) · [手机](screenshots/react-opening-mobile.png) | [设计](screenshots/html-workflow-opening.png) |
| 候选待结算 | [电脑](screenshots/react-ready-desktop.png) · [手机](screenshots/react-ready-mobile.png) | [设计](screenshots/html-workflow-ready.png) |
| 生成中 | [电脑](screenshots/react-busy-desktop.png) | [设计](screenshots/html-workflow-busy.png) |
| 某阶段失败 | [电脑](screenshots/react-error-desktop.png) · [手机](screenshots/react-error-mobile.png) | [设计](screenshots/html-workflow-error.png) |
| 阶段关闭 | [电脑](screenshots/react-off-desktop.png) · [手机](screenshots/react-off-mobile.png) | [设计](screenshots/html-workflow-off.png) |
| 已结算 | [电脑](screenshots/react-settled-desktop.png) · [手机](screenshots/react-settled-mobile.png) | [设计](screenshots/html-workflow-settled.png) |
| 变量候选 | [电脑](screenshots/react-variables-desktop.png) · [手机](screenshots/react-variables-mobile.png) | [反馈规范](screenshots/html-feedback.png) |
| 世界候选 | [电脑](screenshots/react-world-desktop.png) · [手机](screenshots/react-world-mobile.png) | 同上 |
| 多阶段错误 | [电脑](screenshots/react-multiple-errors-desktop.png) | 同上 |
| 全局错误 | [电脑](screenshots/react-global-error-desktop.png) · [手机](screenshots/react-global-error-mobile.png) | 同上 |
| 撤回确认 | [电脑](screenshots/react-undo-desktop.png) · [手机](screenshots/react-undo-mobile.png) | 同上 |
| AI 未保存 | [电脑](screenshots/react-unsaved-desktop.png) · [手机](screenshots/react-unsaved-mobile.png) | 同上 |
| AI 连接说明 | [电脑](screenshots/react-ai-info-desktop.png) | 同上 |
| 总结失败 | [电脑](screenshots/react-memory-failure-desktop.png) · [手机](screenshots/react-memory-failure-mobile.png) | 同上 |
| 手机 main 对照 | [未改 main](screenshots/react-mobile-main-comparison.png) · [本分支](screenshots/react-mobile-current-comparison.png) | — |

## 验证记录

Node.js `v24.19.0`，系统 Chromium，Playwright desktop/mobile 两个 project。桌面重点尺寸 1440×900、1280×800、1100×800；手机 390×844，另保留既有小窗口与软键盘回归。

- `npm ci --cache /tmp/ui2-npm-cache`：通过，143 个依赖，未修改 lockfile。
- `npm run check`：通过；122 个测试文件、3138 项测试；lint、TypeScript 与生产构建通过。
- `npm run prompts:check`：通过；3 个文件、93 项测试。
- Chromium 扩展矩阵：244 项，238 通过、4 项因设备范围跳过、2 项首轮失败。两个失败均已修复并经双端定向复核 10/10 通过；最终代码在全新安装与独立服务下完成正文/反馈专项 **44/44 通过**，无失败、无跳过。
- 4 项跳过沿用原设备范围：桌面不运行触控详情用例；手机不运行 PC 状态卡、PC 资金排版、鼠标悬停详情用例。

首轮两个失败的说明：缺失草稿时应保留原禁用生成按钮，移除 Roll 时误将其一并隐藏，已恢复禁用入口；存储写入失败的测试不能使用要求勾选状态改变的 `uncheck()`，已改为真实点击并断言开关保持原值、错误提示完整显示。没有删除相应断言。两项均包含在最终专项中。

完整记录：[安装](validation/npm-ci.txt)、[check](validation/check.txt)、[Prompt](validation/prompts-check.txt)、[扩展矩阵日志](validation/e2e-expanded.txt) / [JSON](validation/e2e-expanded.json)、[修正复核](validation/e2e-focused.txt) / [JSON](validation/e2e-focused.json)、[最终专项](validation/e2e-delivery.txt) / [JSON](validation/e2e-delivery.json)。浏览器使用系统 Chromium；独立端口配置只调整 server 地址与目录，测试总体超时为 60 秒，所有断言保持有效。

既有导航失败对照见 [未修改 main 日志](validation/main-baseline.txt)：记忆维护和记忆设置测试均在两个项目中等待存档馆内按钮超时。补充 [时间预检与开局控制组](validation/main-baseline-additional.txt)：开局测试两端通过，时间预检两端在同一旧导航处失败。修正只让导航先等待首页渲染并打开存档馆，不删除、跳过或削弱业务断言。

## 数据及交付边界

没有修改 GameState、IndexedDB Schema、存档读写、Story/Variables/World 协议、Prompt、三阶段协调器、原子结算、撤回、人物记忆领域规则、城市视觉身份或时间天气规则。无需迁移存档。

最终修复项全部复核通过，无遗留失败。提交 Draft PR 等待九代目审查和玩家视觉确认；不合并、部署或发布。

## 实际修改文件

完整逐文件清单见 [changed-files.txt](validation/changed-files.txt)。业务边界检查：`src/domain`、`src/services`、`src/workflows`、`src/prompts`、`package.json` 与 lockfile 没有差异。

主要产品文件为 `GameScreen`、`Dialog`、`Feedback`、两种候选查看器、撤回控制、AI 连接/未保存确认、本地设置通知与全局错误容器；正文手动入口在 UI 策略与 Hook 共用保护。其余为相应 UI/浏览器测试、确认稿和验收资料。
