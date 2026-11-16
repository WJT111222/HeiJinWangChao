# PR #171：两处日间工作流对比度返修

2026-11-16。返修基线 `fbbb289c5e40103d7c3f89fa1874e8f24a3206b8`，main 核对为 `f36bc51aede49e4ac6edf9a0bda2138905f007c7`。原分支 `feat/day-appearance-dialogs`，保持 Draft。

## 根因与最小修复

唯一生产代码改动为 `src/ui/game/day-appearance.css`：

- 手机 ≤900px：日间 `--gold` 已变为深金 `#7A5B1C`，工作流可用主按钮却仍继承夜间深色前景。仅对 `.workflow-floating-drawer .workflow-primary .primary:not(:disabled)` 设置浅纸色 `#FFFBF2`，保留背景、主次层级和所有回调。
- PC：纸色 `.workflow-details` 仍继承夜间 `--feedback-err`；错误横幅又有独立的 `--banner-text`。局部设置 `--feedback-err:#7F2D23`，并让错误横幅的 `--banner-text` 读取它，覆盖实际使用变量的错误正文、失败标签与错误计数。保留错误红色语义及背景，不改其他反馈色族。

全部选择器限定日间游戏工作流，不改夜间、其他弹窗、Prompt、Schema、请求、CAS、结算或业务禁用条件。不涉及 PR #170，不更新 main。

## 真实渲染测量

Node **24.19.0**，真实 Chromium **154**，Vite + React 完整 App、正式 Repository/IndexedDB 合成存档、Mock 响应。PC 对照为 **1440×900**，手机为 Playwright Pixel 7 **412×839**（设备模拟，非手机实机）。正式回归 PC 使用项目默认 1440×1000。

同一 React 页面及同一状态，切换基线与修复后的完整 `day-appearance.css` 做 A/B；两侧均读取 `getComputedStyle`。对比度以 WCAG sRGB 相对亮度计算，逐层合成透明背景；目标无背景图片、文字及父级 opacity 均为 1。未把变量声明值当成实际颜色。

| 实际目标 | 修复前 | 修复后 | 最终前景 / 合成背景 |
| --- | ---: | ---: | --- |
| 手机主按钮，正常/聚焦 | 2.80:1 | **6.09:1** | `#FFFBF2` / `#7A5B1C` |
| 手机主按钮，悬停 | 2.18:1 | **8.09:1** | `#FFFBF2` / `#65490E` |
| PC 错误正文 | 1.26:1 | **6.26:1** | `#7F2D23` / RGB(225.62,212.02,193.04) |
| PC「失败 · 可重试」标签 | 2.25:1 | **6.68:1** | `#7F2D23` / `#E4DCCA` |

PC 错误横幅背景含原有 7% 红色覆盖，因此并非直接用纸色计算。完整颜色、字体、透明度及对比度见 [PC A/B](desktop-failure.json)、[手机 A/B](mobile-ready.json)、[手机正常/悬停/聚焦/夜间](mobile-primary-states.json)。

夜间手机主按钮仍为 **7.82:1**；夜间 PC 错误正文 **9.59:1**、失败标签 **6.15:1**。A/B 另比较了夜间启用、夜间禁用和日间禁用按钮的颜色、背景、背景图与透明度，均与基线完全相同，见两份 `*-unchanged-states.json`。禁用态对照使用原生 DOM disabled 属性探测 CSS 伪类，仅作为样式证据；实际业务禁用条件与真实结算点击另由正式回归验证。

## 前后截图

截图均来自正式 React 页面；文件名 `base` 为上述审查 HEAD，`head` 为本次修复 CSS。

| 页面 | 修复前 | 修复后 |
| --- | --- | --- |
| 手机主操作 | [前](mobile-ready-base.png) | [后](mobile-ready-head.png) |
| PC 失败 | [前](desktop-failure-base.png) | [后](desktop-failure-head.png) |

夜间保护：[手机](mobile-night-primary.png)、[PC](desktop-night-failure.png)。

## 测试批次与原始记录

新增 `e2e/day-dialog-contrast.spec.ts`，复用现有 Mock、布局和真实文字对比度辅助函数；未修改或弱化旧测试。完整存档与草稿前后对比、模型调用计数和真实点击结算均保留。

各批次独立记录，不能相加称为一次完整测试：

| 批次 | 通过 | 失败 | 跳过 | 退出码 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| 首次红测 | 0 | 2 | 0 | 1 | 手机真实对比度失败；PC 测试定位误用了手机容器，超时 |
| 修正 PC 定位后，修复前红测 | 0 | 2 | 0 | 1 | 两端均因预期对比度断言失败，保留全部实测值 |
| 修复后正式定向 Chromium | 4 | 0 | 0 | 0 | 新增双端回归 2 项 + 原日间弹层双端回归 2 项 |
| 同状态基线/修复 CSS A/B 探测 | 4 | 0 | 0 | 0 | 双端待结算与失败，夜间/禁用精确比较 |

正式定向命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/day-dialog-contrast.spec.ts e2e/day-appearance.spec.ts \
  --grep '关键文字至少|日间下游戏内弹出内容' --reporter=list,json
npm run typecheck
npm run lint
git diff --check
```

TypeScript、ESLint（零警告）及差异检查均退出 **0**。按本轮小范围要求未重复全量 Vitest、生产构建或完整浏览器矩阵。

新增回归通过真实 Mock `invalid_output` 进入 PC 失败态，确认仅 1 次 Mock 请求；查看与测量不改变正式状态/草稿。手机待结算态查看前后完全一致，实际点击原主按钮仅结算一次（正式回合数与 journal 各增加 1），**0 模型请求**，下一行动为空时发送仍禁用。全部为本地 Mock，不代表真实模型验收。

[原始日志、逐批 JSON 与 A/B 探测脚本](raw-evidence.tar.gz) 保留首红、确认红、最终绿、TypeScript、Lint、A/B 的独立退出码。探测脚本记录的是当时工作区绝对路径，复跑需按本地检出目录调整；正式回归文件可直接用上述命令运行。[生产 CSS/回归源文件 SHA-256](source-sha256.txt) 用于对应测试内容。

## 边界

本轮仅修复两项指定 P2。未扩展审查成功、警告、信息等其他反馈色族，也未声称全界面达到 AA；截图中其他既有颜色保持原样。无实际手机/iPhone/Windows 验证，无付费模型请求，无合并、部署或发布。等待十二代目复审。
