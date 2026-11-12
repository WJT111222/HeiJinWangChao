# 主界面四项修复

基于最新 main `2e85ae5`（已合并 #107）创建独立分支 `codex/ui2-status-clock-funds-details`。本次只修正状态全文、中文时段、资金显示和天气/环境详情；存档 Schema、时间推进、AI Prompt、Story/Variables/World 协议与结算流程没有修改。

## 修正内容

1. **身体、情绪全文**：PC 卡片改为随内容增长的 block，移除两行 clamp 和隐藏溢出，保留段落换行，异常长字符串也能折行。侧栏子项不再压缩，外层继续独立纵向滚动。资金、七项装备、人物档案和经济资产入口仍可访问，不依赖 title 查看全文。
2. **时段与天空分离**：`timeOfDayLabel()` 仅按正式 `worldClock` 的 `chinaCalendar()` 小时计算。00–04 深夜、05–06 黎明、07–08 早晨、09–11 上午、12 中午、13–16 下午、17–18 黄昏、19–22 夜晚、23 深夜。07:50 显示“早晨”；原五档天空保持不变。待定开局不输出时段文字。中等 PC 宽度仍显示简短时段，日期星期仍保留于原时钟 title；宽屏日期与星期照常显示。
3. **完整资金**：沿用原 `money()` 的分、千位分隔、小数和“元”格式，不缩写金额。PC 卡片使用 CSS 容器单位与按原等宽字体估算的字符宽度自动选取 12–17.92px 字号；空间不足时金额移到下一行，达到最小字号后自然换行，不省略、不裁掉单位。未增加 ResizeObserver 字号循环，不修改资金值。
4. **天气/环境浮层**：两行顶栏仍省略长文本，任意一行的按钮可打开共同的黑金半透明详情。复用现有主题，使用浏览器原生非模态 Popover 顶层，避免被 header 的 backdrop-filter 或页面 overflow 裁切。浮层内同时显示当前 GameState 的完整天气和环境，长文本在内部滚动。悬停移入浮层有 180ms 过渡容错；键盘焦点可打开，Esc/关闭按钮恢复触发器焦点；触控支持点击开关与外部点击关闭。手机通过原时间地点行进入同一浮层，不新增资料面板。ResizeObserver 和 visualViewport 只负责浮层布局，限制其尺寸并预留行动输入区；打开人物档案等现有模态框后，Esc 继续由该模态框处理。

固定开局城市身份、历史 scene、游戏时钟值与星期计算均沿用原有逻辑。UI 操作前后的 Repository 快照在测试中逐项保持相同。

## 真实 React 截图

全部使用真实 React + Repository，测试夹具写入存档后再由主界面读取；生产组件不包含这些样例文案。

- [1440×900：07:50“早晨”、两张完整状态卡片与完整百万/亿级资金](screenshots/desktop-0750-status.png)
- [PC 天气/环境详情](screenshots/desktop-scene-details.png)
- [1100px 极大金额完整显示](screenshots/desktop-extreme-funds.png)
- [异常长状态后仍可到达七项装备与底部按钮](screenshots/desktop-long-status-bottom.png)
- [PC 长详情滚动至结尾](screenshots/desktop-long-scene-details.png)
- [390×844 手机界面](screenshots/mobile-0750-status.png)、[手机详情浮层](screenshots/mobile-scene-details.png)
- [模拟缩放/VisualViewport 后的浮层边界](screenshots/mobile-visual-viewport-details.png)

布局数据：[状态卡片](status-measurements.json)、[金额字号/换行](funds-measurements.json)。PC 覆盖 901、1100、1280、1440、1920px，金额覆盖普通值、百万级、亿级和 `Number.MAX_SAFE_INTEGER` 分；字号随空间在 12–17.92px 变化，两项金额的 scrollWidth 均未超过 clientWidth。

## 验证

Node.js `v24.19.0`；`npm ci --cache /tmp/ui2-npm-cache` 成功，依赖与 lockfile 未修改。测试服务使用独立 5176 端口，避免误连上一轮 worktree 的服务。模型请求全部 Mock；新增视觉场景禁止外部 HTTPS 请求，不调用真实付费模型。

| 检查 | 结果 |
|---|---|
| `npm run check` | lint、120 文件 / 3129 单测、typecheck、production build 全部通过 |
| `npm run prompts:check` | 3 文件 / 93 项通过 |
| Chromium 相关回归（桌面 + 手机） | 54 个独立用例，47 通过、7 项按平台跳过、0 失败；定向复测不重复计数 |

新增 24 项单测覆盖全部时段边界、07:50、UTC 到 GMT+8 跨日、星期、设备时间/天气独立性、待定开局、原始状态全文/金额单位与两位小数、详情字段与转义。Chromium 覆盖长中文/1600 字符异常字符串、侧栏独立滚动、两项资金的多宽度布局、七项装备/底部按钮、悬停跨入、内部滚动、移出关闭、键盘焦点/Esc/现有模态框、触控开关、外部关闭和 VisualViewport 边界、打开状态下跨手机/PC 断点的关闭与重新打开。

既有 `game-window`、`story-reading`、`night-seal` 的双端回归，以及选定的自动开局/行动/取消恢复、固定城市/跨城、旧档身份与待定开局回归通过。原 `city-night` 测试的天气全文断言从原生 title 改为新的可访问浮层；其余业务断言没有删减。

[逐项 E2E 成绩](validation/e2e-results.json) · [完整检查](validation/check.txt) · [提示词](validation/prompts.txt) · [双端回归](validation/chromium-regression.txt) · [工作流与城市不变性](validation/chromium-workflow.txt) · [最终四项定向复测](validation/chromium-followups-final.txt) · [最终缩放/断点复测](validation/chromium-viewport-final.txt) · [npm ci](validation/npm-ci.txt)

构建仍有原有的大 chunk 提示，没有为本轮修复扩大打包或系统重构范围。没有未解决的测试失败。本修复没有存档格式变化，不需要迁移。

[实际修改文件](changed-files.txt)。以同一个 Draft PR 提交，未合并、未部署或发布，等待九代目复审。
