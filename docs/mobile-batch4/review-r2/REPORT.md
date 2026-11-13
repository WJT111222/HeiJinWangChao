# PR #130 二次修复验收

依据：[九代目正式复审](https://github.com/WJT111222/HeiJinWangChao/pull/130#pullrequestreview-5884605243)。本轮仅完成评论要求的两个小范围项目，继续使用原 Draft PR #130。

- 修复前 HEAD：`f3e2018e8f2e1636c1f5eb98bc273b126e870e1c`。
- 重新 fetch 的 main：`967113fa8aba7b842621b3ddbdaf0e39e1f3b61f`，与复审基线相同，无新增整合冲突。最终 HEAD 见 PR 描述及本次提交。
- 环境：Node.js 24.19.0、项目实际依赖、系统 Chromium 154、390×844 手机触屏，reduced-motion。

## 手机确认按钮

`OpeningPacks.tsx` 仅增加三个手机条件 class；取消这些 class 后，与修复前源码逐字一致。删除确认使用赭红实心 `#A3412E`，覆盖确认使用金色渐变，取消使用中性背景。CSS 限定在 `≤900px` 的 `.mobile-opening-pack`，不修改按钮文案、回调或二次确认。901px 时不生成新增 class。

已重截并实际打开核对两张真实 React PNG：[删除](../screenshots/pack-delete-390.png)、[覆盖](../screenshots/pack-overwrite-390.png)。原始 PNG 在 [before](before/) 保留。

## 真正触屏撕票

新增一个 Chromium CDP `Input.dispatchTouchEvent` 场景，以真实 `touchStart/touchMove/touchEnd/touchCancel` 产生浏览器 touch pointer，而非 mouse 模拟：

| 手势 | 正式 Repository / 提交结果 |
| --- | --- |
| 下拉 40px 松开 | 零存档、零表单提交 |
| 下拉 85px 后 touchCancel | 零存档、零表单提交 |
| 下拉 75px 松开 | 恰好一个原 saveId 的正式存档，一次表单提交 |

同时断言原开局草稿的 saveId、turnId、turnKind、baseSaveRevision、用户偏好，以及正式状态的 revision=0、turnNumber=0、待初始化/待确认时间和开局城市。三次 pointerdown 均为 touch，并收到 touch pointercancel。所有 POST 均拦截计数，实际为 **0**；没有点击付费发送。

生产 `useTicketTear`、`useCreationTear`、CreationWizard、OpeningPackStore 和原业务测试均未修改，原按钮/键盘等价入口保持原样。

## 本轮实际成绩

两个独立场景最终均通过，实际执行共三次（首次两项，样式项单独复测一次）：

1. `复审：手机开局包删除赭红、覆盖金色、取消中性；PC 不附加这些样式`：通过；含计算后颜色、class、取消不写入、901px 无新增 class。
2. `复审：第五站 CDP 真实触摸短拉与 touchCancel 零建档，超过60px松开只建一份原开局草稿`：首次通过，没有重复执行。

首次样式测试失败：全局 `button:hover:not(:disabled)` 的优先级高于新增选择器，确认按钮实际仍为 `rgb(32,39,32)`。仅增强局部选择器为 `.mobile-opening-pack .modal-body>button.…` 后单独复测通过；没有删除或放宽断言。原失败日志、JSON、截图和 trace 均在 [initial](initial/)。

- [首次两项日志](initial/chromium.log) / [JSON](initial/chromium-results.json)：1 通过、1 失败（触屏通过）。
- [样式复测日志](chromium-style.log) / [JSON](chromium-results.json)：1 通过、0 失败。
- [TypeScript、定向 ESLint、差异检查](engineering-results.json)：均 exit 0，日志同目录。
- [证据保留检查](preservation.json)：除明确要求更新的两张 PNG 外，原已提交证据逐文件不变；两张旧 PNG 副本与原提交一致。

执行命令：

```sh
npx playwright test --config playwright.mobile-batch4-review.config.ts --list
npx playwright test --config playwright.mobile-batch4-review.config.ts
npx playwright test --config playwright.mobile-batch4-review.config.ts --grep '删除赭红'
npm run typecheck
npx eslint src/ui/creation/OpeningPacks.tsx e2e/mobile-batch4-review.spec.ts playwright.mobile-batch4-review.config.ts --max-warnings=0
git diff --check
```

原批次 **19 个独立 Chromium、87 Vitest、16 组 PC 像素对照**及早期失败记录仍见 [原报告](../REPORT.md)，本轮未重跑、未合并计分。未运行全量浏览器、Vitest、Prompt 或构建。未改 Schema、Repository、公告、AI、工作流及付费行为。未合并、部署或发布。

本轮文件见 [FILES.txt](FILES.txt)。
