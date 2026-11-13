# PR #125：与 #120 的最终兼容复测

本轮仅同步 main 并修正测试导航。原车票首页验收保持为历史证据，没有重跑原 26 项首页 Chromium、45 项 Vitest 或桌面六组像素对照。

## 使用的提交

- 原 PR HEAD：`2955f2f417029240cb7abade551337874a0f52ca`。
- 重新 fetch 的最新 main：`f3c66c3ce76f22931275cbe92dbdd83f01d6855f`，包含已合并 #120。
- 无冲突合入 main 的提交：`24f04facd3e52c513776d9eafdf508172cb336c1`。
- 最终推送 HEAD 见 PR #125 描述和交付答复；保持原分支 `feat/mobile-redesign-batch3`，未另开 PR。

合并使用 `git merge --no-edit origin/main`，没有生产文件冲突，也没有手工修订生产文件。#120 的 GameScreen、MobileWorkflowDrawer、WorkflowPanel、CSS、Dialog 及 gameLayout 辅助函数均与当前 main 字节一致。#125 车票首页代码与原 PR HEAD 字节一致；存储、公告、Worker 与 wrangler 也与 main 一致，见 [integration-invariants.json](integration-invariants.json)。

## 唯一旧测试适配

`e2e/npc-memory.spec.ts` 原封装在打开手机工作流后，查找 native Dialog 的“关闭资料界面”。#120 已改用非模态双层容器，该按钮不再存在。

现在导入并复用最新 main 的 `closeWorkflowSheet()`，只在 ≤900px 后续资料导航前调用，桌面不关闭工作流，不自行处理其他模态弹窗。没有修改公共 helper、工作流组件、输入区或三阶段逻辑。

从原文件“只在隔离浏览器存储中使用”注释开始的全部种子、用例和业务断言均与原 HEAD **逐字节一致**，哈希记录见上述 invariants。保留真实请求检查、NPC 内部资料不可见性、私人记忆/普通历史隔离、15 条来源保护、跨标签请求计数、取消/迟到/429/手动重试以及正式状态不变性断言。

## 本轮结果

环境：Node `v24.19.0`、npm `11.9.0`、真实 Chromium `154.0.8037.57`。package.json 与 package-lock 没有变更，沿用真实已安装依赖。

| 场景 | 平台 | 最终结果 |
|---|---|---|
| 手动仅一人一批；普通界面不暴露身份、原文、总结和秘密条数；来源完整且刷新不重复收费 | 手机 390×844 | 通过 |
| 跨标签拒绝重复付费；取消/迟到/429不删除来源，明确手动重试可成功 | 手机 390×844 | 通过 |
| 第一项 NPC 隐私/来源用例 | 桌面 1440×900 | 通过 |
| 第二项跨标签请求安全用例 | 桌面 1440×900 | 通过 |
| #125 车票主按钮进入现有存档，再验证 #120 双层非模态工作流与行动输入 | 手机 390×844 | 通过 |

四项 NPC 测试均执行到末尾的原业务断言，未仅通过界面导航。模型请求由原 `npc-memory.mock.invalid` 拦截并返回 Mock；没有真实付费模型调用。

新增冒烟通过真实 `.mh-primary` 进入游戏，确认三阶段 home → detail → home 两层切换、`aria-modal=false` 且非原生 modal；抽屉打开时可以实际键入，关闭“收起三阶段详情”后回焦、输入框和发送按钮仍可操作。未点击发送，不重测生成/取消/原子结算；正式状态前后相等，所有 POST 记录为 **0**。

共 **5 个不同场景最终通过，0 跳过，0 自动重试**。实际执行 6 次：新增冒烟首跑的测试断言把阶段导航中的“运行诊断”“已绑定输入”也算进了三个阶段按钮，得到 5 而非 3。已将新断言限定到 `.workflow-stages`，仍严格要求 3，未改生产 UI 或任何原 NPC 断言。仅单独复跑该冒烟并通过；四项已通过的 NPC 没有再跑。

原始首跑 [chromium.log](chromium.log)、[JSON](chromium-results.json) 如实保留四通过一失败。定向冒烟复跑见 [smoke-final.log](smoke-final.log)、[JSON](smoke-final-results.json)。最终汇总见 [summary.json](summary.json)。

工程检查：

- TypeScript 通过：[typecheck.log](typecheck.log)。
- 仅相关三份测试/配置文件 ESLint 通过：[eslint.log](eslint.log)。
- `git diff --check` 通过：[diff-check.log](diff-check.log)。
- 没有生产冲突或手工生产修订，依指令没有重复构建。

执行范围经 `--list` 确认恰为 5 项，见 [test-list.log](test-list.log)：

```sh
npm run typecheck
npx eslint e2e/npc-memory.spec.ts e2e/pr125-compatibility.spec.ts playwright.pr125-compatibility.config.ts --max-warnings=0
npx playwright test --config playwright.pr125-compatibility.config.ts
# 只复跑新增冒烟：
PR125_RUN_NAME=smoke-final npx playwright test --config playwright.pr125-compatibility.config.ts --project mobile --grep '#125 兼容'
```

没有运行完整 E2E、无范围的 Playwright、原 26 项首页回归、Vitest、Prompt 检查或完整生成结算链路；不宣称这些项目在本轮重跑通过。

## 证据与交付边界

原批次 `docs/mobile-batch3` 已提交的 **98 个文档、截图、日志与结果文件全部字节不变**，逐文件 SHA256 见 [original-evidence-preservation.json](original-evidence-preservation.json)。原 [第三批报告](../REPORT.md) 的 26 项 Chromium、45 项 Vitest 和六组 PC 对照仍是原批次成绩，与本轮五项兼容复测分开记录。

本轮手工修改只有 NPC 测试封装、新增一个导航冒烟、限定五场景的配置以及兼容复测报告/证据。没有重做车票、动画、撕票、桌面 UI、#123 通用交互或 #121 KV 公告，也没有改领域服务、存档 Schema、AI Prompt、模型路由或 NPC 业务。

保持原 Draft PR #125 未合并，未生产部署、发布或打标签。交九代目最终复审。
