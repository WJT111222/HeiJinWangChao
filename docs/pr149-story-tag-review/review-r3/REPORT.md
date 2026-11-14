# PR #149 损坏保留标签边界返修

回应[最新安全边界审查](https://github.com/WJT111222/HeiJinWangChao/pull/149#issuecomment-6874505807)，仅在原 Draft 分支返修，没有另开 PR。审查基线 `d1d2a6ba92832de0e07c1f06006972b94ba6d24f`；代码提交 `cee09f2c18d3f1918285095a1cac1e686fab27be`。后续只提交本报告和验收材料，最终 HEAD 及 Workers Build 结果在原 PR 回复提供。

已重新 fetch。观察到最新 main 为 `35312565d2f6331663908c4eb4b74affd5f968fe`，新增 #148 设置页改造；此次仍在 #149 原分支上做单点安全返修，未合入或改动 #148，不将本报告称为最新 main 的完整整合验收。

## 根因与修改

旧恢复器要求保留名称后紧跟空白、`/`、`>` 或文本结束。损坏输出 `<正文?bad>`、`<正文：>`、`</正文?broken>` 不满足这个前瞻，因此被当成普通文字。只要它们藏在完整 Step 前缀中，后续裸正文边界恢复就可能成功，并随规划删除这些结构。

生产只修改 `src/services/validation/storyEnvelopeRecovery.ts` 两处正则及说明注释：

- 检测正文标签时，不再要求名称后的字符是合法标签分隔符。
- 检测未加标签区域的 `thinking`、`think`、正文、短期记忆、变量规划、行动选项、`judge` 时，同样将任何保留名称前缀视为有歧义。
- 因而错误标点、紧贴的非法属性、大小写变体、结束标签损坏、缺少 `>` 等形态都不能在恢复中被静默吞掉。

这是**收紧恢复条件**。疑似保留名称即保守拒绝，包括未认可的名称后缀；不会把损坏标签改写成合法标签，也不补造尾部块、JSON或正文。完整标签的正式解析器、StorySchema、诊断规则没有改动。合法独立行和同行双旁白恢复路径原样保留，正式标签流式阅读和单一模型原文视图没有改动。

## 回归与先红后绿

新增21种标签/残片，各覆盖独立行与同行两条路径，共42项：`?`、中文冒号、`!`、错误等号/点号、紧贴属性、开/闭标签残片、大小写及空白变体，涵盖正文与其他保留名称。全部断言恢复返回 `undefined`、正式解析拒绝且输入原文不变。

- 在旧生产实现上执行新增断言：**34失败 / 60通过，共94项**。42个新增负例中8个已被旧守卫保护，另外34个真实复现绕过。没有把预期红测称为最终失败。
- 改动守卫后，相关4文件最初192项通过；加入完整链测试后最终 **195项通过**。
- 新增3个 StoryStage 真正 DeepSeek 客户端 Mock 用例：审查点名的三个坏标签均拒绝，`saveDraft` 从未调用，Repository 正式状态和草稿完全一致，失败原文 `text` / `displayText` 完整保留，恰好一次请求。
- 同样3种结构各在PC/手机Chromium验证一次，共新增6项；原14项恢复回归保留，最终20项。复制使用实际键盘和剪贴板，不仅检查文字可见。

保留1500字成功/169字失败、完整Step0～15与双旁白边界、独立行、必需尾块、JSON、Schema、摘要和行动数量、时间和事件拒绝、草稿CAS、正式revision、事务前取消及IDB故障回滚断言。未删除、跳过、弱化断言或增加重试。

## 正式运行结果

Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**。沿用首轮正式 Node24 `npm ci` 安装的项目真实依赖，依赖及lockfile未变；本轮未重复安装，未使用垫片或替代运行器。

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 旧守卫红测 | 34失败 / 60通过 | [red.log.gz](validation/red.log.gz) |
| 最终4文件Vitest | **195通过 / 0失败** | [related-final.log.gz](validation/related-final.log.gz) |
| `npm run check` | Lint、**3700单测 / 149文件**、TypeScript、Build通过 | [check.log.gz](validation/check.log.gz) |
| `npm run prompts:check` | **93通过 / 0失败** | [prompts.log.gz](validation/prompts.log.gz) |
| 双端定向Chromium | **20通过 / 0失败 / 0跳过 / 0重试**；PC10、手机10 | [chromium.log.gz](validation/chromium.log.gz)、[原始JSON](validation/chromium.json.gz)、[结果摘要](validation/browser-results.json) |
| `git diff --check` | 通过，空输出 | [diff-check.log.gz](validation/diff-check.log.gz) |

195项定向、93项Prompt都是3700的子集，不累加。最终没有测试失败。构建有既有Vite大chunk提示，没有构建错误；日志中的NO_COLOR/FORCE_COLOR提示不影响测试结果。

本轮只跑 `story-tag-recovery.spec.ts` 的20个双端场景，没有跑全量浏览器测试。此前38、14项浏览器成绩保留为历史证据，不能累加为本轮执行数；本轮4文件测试覆盖流式和统一原文组件，20个Chromium场景也保留正式标签实时阅读与原文单框复制检查。所有模型响应为本机Mock，没有调用真实付费AI。

```bash
node --version
npx vitest run src/tests/story-tag-compat.test.ts # 修改生产守卫前，预期红测
npx vitest run src/tests/story-stage.test.ts src/tests/story-tag-compat.test.ts src/tests/story-stream-reading.test.tsx src/tests/story-raw-continuous.test.tsx
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium PR149_RESULT=/workspace/pr149-evidence/review-r3/chromium.json npx playwright test e2e/story-tag-recovery.spec.ts --config playwright.pr149.config.ts
git diff --check
```

## 修改文件与保护范围

代码/测试共4文件：

1. `src/services/validation/storyEnvelopeRecovery.ts`：两处疑似保留标签前缀守卫。
2. `src/tests/story-tag-compat.test.ts`：42项独立行/同行拒绝回归。
3. `src/tests/story-stage.test.ts`：3项真实执行链、原文及不保存回归。
4. `e2e/story-tag-recovery.spec.ts`：3种损坏标签各双端一次。

其他 **451个src文件**与本轮审查基线逐字节一致，见[核对记录](validation/protected-files.txt)。没有改动正式Schema、存储、结算、撤回、Variables/World、提示词、模型路由、正式标签校验、流式阅读或原文UI。

材料新增本目录，另给前两轮报告增加最新补强链接。前两轮原始日志、截图和成绩保留。

## 真实React截图

| 场景 | PC | 手机 |
| --- | --- | --- |
| `<正文?bad>` 拒绝后仍可读完整原文 | [失败原文](screenshots/desktop-malformed-question-raw.png) | [失败原文](screenshots/mobile-malformed-question-raw.png) |
| `<正文：>` 拒绝 | [失败原文](screenshots/desktop-malformed-colon-raw.png) | [失败原文](screenshots/mobile-malformed-colon-raw.png) |
| `</正文?broken>` 拒绝 | [失败原文](screenshots/desktop-malformed-closing-raw.png) | [失败原文](screenshots/mobile-malformed-closing-raw.png) |
| 合法同行双旁白原文边界保留 | [原文边界](screenshots/desktop-inline-actual-boundary.png) | [原文边界](screenshots/mobile-inline-actual-boundary.png) |
| 合法恢复小说仍完整显示 | [小说](screenshots/desktop-inline-recovered-novel.png) | [小说](screenshots/mobile-inline-recovered-novel.png) |

截图只含虚构测试资料，未使用私人存档或真实密钥。环境记录见[versions.txt](validation/versions.txt)，证据校验和见[SHA256SUMS](validation/SHA256SUMS)。Workers Build 将在推送最终HEAD后只读核查，结果及链接补充至PR回复；不拿旧HEAD的构建成功替代新HEAD结果。

保持原Draft，未合并，未手动部署、发布或更新Beta标签。
