# PR #165 最小集成验收（合入 #166）

结论：本轮要求的工程检查及 **4 个 Chromium 场景全部通过**。没有新增生产代码修复；只同步最新 main，并增加这四个场景及验收证据。未合并 PR、未部署、未发布公告，全部模型请求使用 Mock。

## 版本与保留范围

- 本轮开始时 PR HEAD：`ad87fd3cdf7c9762394b30a1a1109f1209da992e`。
- 开工及提交前重新 fetch 的 main：`ee2bd3d8b55a46558ff67e4aa27e1a87b877ca13`（#166）。
- 无冲突合入 main 的提交：`eda8ef281ccb941b6fbaa541117641d25ab33f09`。最终验收提交 SHA 见 PR 说明及交付消息；其后仅添加本报告、测试及证据。
- main 的 `actionSuggestions.ts`、`MobileActions.tsx`、#163 手势与 Dialog、#164 诊断运行链保持原样。`GameScreen.tsx` 相对 main 只有原 #165 的一行日间 CSS 导入。
- #165 已验收的 `day-appearance.css` 与公告均保持字节一致。[源码哈希与差异证据](evidence/source-verification.json)。

## 本轮实际执行

正式环境：Node **24.19.0**、npm **11.9.0**、Chromium **154.0.8037.57**、Playwright **1.64.1**；沿用本工作树此前 `npm ci` 安装的真实项目依赖，依赖清单未改动。[环境](evidence/environment.txt)。

| 命令／检查 | 实际结果 | 退出码 |
| --- | --- | ---: |
| `npm run check` | ESLint、164 文件／**3984 项 Vitest**、文件名检查、catalog、TypeScript、Build 全部通过 | 0 |
| `npm run prompts:check` | **93 通过**，是上述 Vitest 的子集，不加总 | 0 |
| `npx playwright test --config playwright.pr165-integration.config.ts` | **4 通过，0 失败、0 跳过、0 重试** | 0 |
| 新增 E2E 与配置的 ESLint、`npm run typecheck` | 两个新文件在完整 check 结束后写入，单独补验通过 | 0 |
| `node scripts/check-announcement.mjs announcements/current.json` | 公告格式合法、12 条更新 | 0 |
| `git diff --check`、暂存差异检查 | 通过 | 0 |

[原始日志与退出码](logs/)、[Playwright JSON](evidence/chromium.json.gz)、[实测对比度与请求／状态断言附件](evidence/measurements.json)。Build 仅有 chunk 大小提示，退出码为 0；不扩展打包优化。

## 四个 Chromium 场景

PC 为 1440×1000，手机为 390×844。每端只运行以下两个场景，无其他浏览器批次。

1. **整合：日间主角对白、哈尔滨铭牌与工作流文字可读**：主角正文、铭牌数字／回目／TURN、工作流标题／主按钮、手机「行动输入」实测合成对比度均 ≥4.5:1；打开查看前后完整 Repository 相同，POST 为 0。
2. **整合：日间失败后恢复旧建议，主动继续正文与剩余阶段后原子结算**：一次 Mock 401 后恢复上一已结算回合建议和阶段操作说明；点选建议只更新输入框，不改 Repository、不发请求。主动继续正文使用原已绑定行动；正文就绪时 Variables 仍待生成、正式状态不变。再次主动继续才执行 Variables、World 并结算，正式 revision、回合和 journal 仅增长一次。

双端实际 Mock 请求序列均为 `story（401）→ story（成功）→ variables → world`，没有自动重试或额外模型请求。[附件](evidence/measurements.json)记录最终 revision=2、正式结算回合数=1。

| 本轮实测对象 | PC | 手机 |
| --- | ---: | ---: |
| 主角对白 | 11.19:1 | 10.50:1 |
| 哈尔滨数字／回目 | 7.80:1 | 7.80:1 |
| 哈尔滨 TURN 小字 | 6.48:1 | 7.68:1 |
| 工作流标题 | 15.26:1 | 14.91:1 |
| 工作流主按钮 | 8.57:1 | 7.82:1 |
| 手机「行动输入」 | 不适用 | 14.91:1 |

复用已有真实浏览器背景合成测量方法，不以 CSS 颜色深浅代替对比度。手工查看截图确认主体、铭牌及工作流文字可读；结论限于本轮两个视口与场景，不宣称全站或真实 iOS Safari 已验证。

| 本轮真实 React 日间截图 | PC | 手机 |
| --- | --- | --- |
| 主角对白与哈尔滨铭牌 | [截图](screenshots/desktop-day-main.png) | [截图](screenshots/mobile-day-main.png) |
| 工作流 | [截图](screenshots/desktop-day-workflow.png) | [截图](screenshots/mobile-day-workflow.png) |
| 失败后的建议与操作说明 | [截图](screenshots/desktop-day-failed-suggestions.png) | [截图](screenshots/mobile-day-failed-suggestions.png) |
| 主动继续并结算 | [截图](screenshots/desktop-day-recovery-settled.png) | [截图](screenshots/mobile-day-recovery-settled.png) |

## 公告一致性

保留作者既有 `announcements/current.json`，版本仍为 **`1.0 Beta · 2026.11.16`**、12 条。日／夜／系统选项和弹层分批适配范围、常驻取消／继续入口、失败后输入恢复、原文诊断等说明与合流后功能相符，没有声称失败会自动重发。#166 的历史行动建议及阶段继续提示没有逐项新增为公告条目，但不与现有说明冲突。

既有公告对 iPhone Safari 和供应商缓存的发布描述，不构成本轮真机测试或实际付费缓存命中的证据；本轮只做上述 Chromium Mock 验收。没有修改公告文案或版本，也没有执行发布脚本、KV 写入或生产配置变更。

## 范围纪律

原先已通过的 **38 项视觉测试及所有夜间截图均未重新执行／采集**，旧证据保留在上级目录。本轮只运行四个独立 Chromium 场景，全部一次通过，无需干净 main 失败对照。没有修改 Schema、存档、Prompt、模型请求、Web Locks、CAS、Commit、Undo 或其他工作分支。

本轮新增文件仅为 `e2e/day-appearance-integration.spec.ts`、`playwright.pr165-integration.config.ts` 和本目录证据；主干变更通过 merge 原样保留。推送原 PR #165 后停止，等待十二代目复审。
