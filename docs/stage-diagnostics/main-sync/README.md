# PR #164：同步 #163 的最终工程验收

- 原审查 HEAD：`cc744021390bdb85f473ad56775271f9a7c83731`。
- 本轮最新 main：`dcfdfac566a02d81ecd74653e2d030a0244e0355`，包含已合并的 #163。
- 在原 `fix/persisted-stage-diagnostics` 分支合入 main，保留已有提交，不变基、不强推，不新建 PR。验证日期：2026-11-16，北京时间。

## 冲突解决

只有 `src/ui/game/GameScreen.tsx` 一处相邻 JSX 块冲突。#164 的 `MobileDiagnostics` 增加了 `recovery={diagnosticRecovery}`，#163 紧邻的人物 Dialog 增加了 `sheetExpandable`。

组合保留：

1. #164 的完整诊断属性、`diagnosticScope`、筛选及恢复逻辑。
2. #163 的“此时此地”与“世界资料”两处 `sheetExpandable`。
3. `Dialog.tsx`、`useSheetGesture.ts`、`mobile-sheet.css` 从 main 原样合入，未再编辑。

相对于已审查 #164，GameScreen 产品代码只有两个 `sheetExpandable` 选项差异。去除这两个新选项后，文件与审查版本逐字节一致；其余8个诊断核心文件与审查 HEAD 逐字节一致。三份手势/弹层实现与 main 逐字节一致。

机器核对见 [source-verification.json](source-verification.json)，原始冲突及解决 diff 见 [logs](logs)。没有改变 AI、Prompt、Schema、Repository、Commit、Undo、Web Locks 或费用规则。

## Node 24 正式验收

环境：Node `v24.19.0` / npm `11.9.0`。

| 命令 | 实际结果 | 退出码 |
| --- | --- | --- |
| `npm ci` | 按锁文件安装143包 | 0 |
| `npm run check` | 文件名、ESLint、catalog、TypeScript、生产构建通过；162个Vitest文件、3977项通过，0失败/跳过 | 0 |
| `npm run prompts:check` | 3文件、93项通过，0失败/跳过；是完整单测的子集，不相加计数 | 0 |
| 新用例视口修正后 TypeScript | 通过 | 0 |
| 新用例视口修正后 ESLint | 通过 | 0 |
| `git diff --check` | 通过 | 0 |

构建只保留既有大于500kB chunk提示，本次没有调整分包或业务实现。

## 本轮 Chromium 验证

真实 Chromium `154.0.8037.57`，全部 AI 请求 Mock，重试为0。没有运行全量浏览器套件；手机为 Chromium 视口模拟，不是 iPhone 实机，未运行 WebKit。

| 独立批次 | 实际结果 | 覆盖 |
| --- | --- | --- |
| #164 双端诊断 | 12通过、0失败、0跳过，退出0 | 自动/手动 invalid_output、刷新摘要、原文不可恢复、清空、复制、取消、迟到响应、成功重试、改字重发/撤回、切档/跨回合、无 Web Locks 零请求 |
| #163 原有手机回归 | 9通过、0失败、0跳过，退出0 | 375×667、390×844、430×932：上拉展开/下拉收起关闭、按钮展开、人物长文原生滚动、七类资料、NPC/事件、横竖屏、视口缩小、关闭后锁释放及只读 |
| 新增共存用例首轮 | 0通过、1失败，退出1 | 新测试误认为世界目录在390×420展开后必定溢出，实际滚动范围为0 |
| 最新 main 同环境对照 | 1通过、1失败，退出1 | 同一420px溢出断言也失败：client=325、scroll=325；300px时client=205、scroll=270，真实滚动范围65px，触摸滚动通过 |
| 新增共存用例修正后 | 1通过、0失败、0跳过，退出0 | 使用真正390×300短视口，不注入CSS、不改产品，继续严格要求溢出>0、真实触摸scrollTop>0；两入口展开/滚动/关闭后持久摘要仍在，Repository及草稿不变，POST为0 |

保留首轮失败、main对照截图/trace与复测记录，没有降低滚动断言、删除用例、添加 skip 或自动重试；以上成绩按批次列出，不混成一次全绿。新测试只增加在 `e2e/mobile-info-sheets.spec.ts`，原有 #163 用例及全部诊断核心逻辑保持原样。

## 真实截图与证据

- [持久失败摘要与两处弹层的集成页面，390×640](screenshots/integrated-persisted-diagnostics.png)
- [人物展开后的真实长内容滚动，390×300](screenshots/integrated-status-scroll.png)
- [世界目录展开后的真实原生滚动，390×300](screenshots/integrated-world-scroll.png)
- 自动/手动正文失败的双端刷新前、清空后、刷新后12张截图已在 [上级截图目录](../screenshots) 用本轮集成版本重新采集。

[logs](logs) 保存本轮原始stdout/stderr、退出码、对照和冲突 diff 的无损 gzip 副本；解压后字节校验见 [evidence.json](evidence.json)。工作区完整独立证据目录为 `/workspace/pr164-main-sync-20261116/`，不包含真实玩家存档。

## 剩余边界

- 不在刷新后推断或恢复没有持久保存的详细分类和模型原文。
- CAS或存储失败保持拒绝写入，不为保存诊断绕过保护，不自动收费重发。
- 原 main 420px目录无需滚动是正常布局，不是 #163/#164 的产品缺陷；长内容和短视口继续验证原生滚动。
- 没有真实 iPhone/Safari/Windows 设备验证。本轮没有重做 #163 的手势实现，也没有扩展 #164 的核心逻辑。

保持 Draft，不合并 main、不手动部署生产、不发布，等待十二代目最终复审。
