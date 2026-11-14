# PR #150 Node24 正式审查与验收

结论：畸形分隔符绕过已用正式 Vitest 先红复现并最小修复。Fable 的通用中间段补全、连续两段/三段、可选项目规划及 #149 两种恢复能力全部保留。正式工程检查和新增功能 Chromium 通过；旧 `story-runtime` **没有全绿**，12项失败与干净 main 一致，详见下文。

审查原 PR：[PR #150](https://github.com/WJT111222/HeiJinWangChao/pull/150)。初始远端 HEAD `107ce54a3d858ed3314c112d771346f768d772f0`；main `ba97b6c198107bdfcd58915f17c0891af4285a05`，开工及提交前均重新 fetch/核对。代码提交 `ba7d7bc1c2585f076328f64a5093d599a1b40df6`；后续提交只添加本报告和证据，最终 HEAD 及其 Workers Build 在原 PR 回复提供。

## 发现、修复与保留范围

回应[审查评论6876535585](https://github.com/WJT111222/HeiJinWangChao/pull/150#issuecomment-6876535585)。原探测器只允许 `<` 后空白和一个 `/`，看不到 `<//正文>`、`<\正文>`、`<:正文>`。它们会被误当作“闭合完全缺失”，插入合法闭合后，坏结构留在小说里。

本轮生产只改 `storyEnvelopeRecovery.ts` 的 `reservedTagProbe` 和注释：在保留名称前允许探测非字母、非数字的损坏分隔符，但不跨越其他尖括号或普通词语。随后仍用原精确 `canonicalReservedTag` 判定；不是原样合法标签就拒绝补全。`3<5` 等普通符号不含保留名称，不受影响。这个守卫仅在修补 fallback 内执行，完好结构的直接解析路径不变。

新增21项“7种保留名称 × //、反斜线、冒号”负例，全部采用其他内容合法、正文实际超过最低字数的响应：

- **旧实现：21失败 / 115通过（136项）**，真实证明错误接受，不借字数不足掩盖结构错误。
- 修复后转绿，再补充5项业务拒绝、10项执行链/事务回归；最终完整成绩如下。
- 没有删除或弱化 Fable 的既有正负例，没有改为强制 thinking，也没有收缩通用补全范围。

审查确认保留：

| 能力/边界 | 验证 |
| --- | --- |
| 项目 `<thinking>` 完全可选；有规划则归位 | 原有带/不带规划及新增真实SSE |
| #149 独立行、同行双旁白缺正文双标签恢复 | 原实现逐字不变，20项既有双端恢复场景保留 |
| 中间 thinking/正文/短期记忆/变量规划分别缺闭合 | Fable 原逐字段正例保留并通过 |
| 连续两段、连续三段缺闭合 | Fable 原正例保留，循环算法本体与初始HEAD逐字相同 |
| 最后行动选项缺闭合；关闭选项时最后变量规划缺闭合 | 仍拒绝，保留原诊断 |
| 重复/乱序/嵌套、无意义前言、坏标签 | 原拒绝保留，新增名称前分隔符拒绝 |
| 字数、空摘要、行动数量、JSON/Schema、时间、事件 | 均在补全后继续正式校验，不改门槛 |
| 原文、单次请求、草稿原子保存 | 下述真实SSE和双端原文复制/事务断言 |

## 真正 DeepSeek SSE 保存链

新增链路为正式 `newChannel('deepseek')` → AiClient → SSE/UTF-8解析 → StoryStage → 正式Repository IDB草稿事务，所有响应来自Mock：

1. `reasoning_content` 单独返回公开思考，`content` 无项目 `<thinking>`，有 `<正文>` 但缺 `</正文>`，后续必需块完整。
2. 测试供应商实际提供1521字，设置门槛1500；不补字，不减低门槛。夹具是明确标注的虚构长响应，不是私人玩家原文。
3. SSE按UTF-8字节、中文、标签任意分块。思考先显示，真正 `<正文>` 到达后只流式读小说；最终小说与供应商文本精确一致，不含原生思考、摘要、变量或选项。
4. 单测精确断言一次fetch、成功仅一次saveDraft、正式GameState不变。PC/手机通过实际React读取，草稿revision仅增1，恰好一次本机Mock请求。
5. 原文单一只读框实际键盘复制到剪贴板，与“真实思考事件 + 原始content”精确一致，没有把补出的 `</正文>` 写回原文。
6. 三种点名坏标签都经真正DeepSeek SSE拒绝，saveDraft零调用、正式状态及草稿不变、失败原文完整保留。
7. 缺闭合新路径专门加入时间倒退、无效事件、草稿CAS、正式revision冲突、事务前取消及IDB put入队后故障回滚覆盖；这些失败不产生部分保存。

本轮新增SSE测试初次有1项失败：测试把流式正文尾部实际存在的排版换行漏出预期前缀。已改为对完整wire正文（小说加该换行）的精确前缀断言；最终保存仍精确等于去尾换行的正式小说。**只修正本轮新增测试预期，没有改生产阅读器或宽松过滤内容**。两份初次日志保留。

## 正式Node24结果

Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**。PR及干净main分别执行真正 `npm ci`，各安装143 packages。使用真实项目依赖、Vitest和Playwright，无离线垫片或替代运行器。

| 命令/检查 | 实际结果 | 原始材料 |
| --- | --- | --- |
| `node --version` | v24.19.0 | [日志](validation/node-version.log.gz) |
| PR `npm ci` | 成功，143 packages | [日志](validation/npm-ci.log.gz) |
| main `npm ci` | 成功，143 packages | [日志](validation/main-npm-ci.log.gz) |
| `npm run check` | Lint、**3779单测 / 150文件**、TypeScript、Build通过 | [日志](validation/check.log.gz) |
| `npm run prompts:check` | **93通过** | [日志](validation/prompts.log.gz) |
| 用户指定6文件Vitest | **322通过 / 0失败** | [日志](validation/targeted.log.gz) |
| `git diff --check` | 通过，空输出 | [日志](validation/diff-check.log.gz) |
| `story-tag-recovery` PC+手机 | **28通过 / 0失败 / 0跳过 / 0重试**，各14 | [日志](validation/recovery.log.gz)、[原始JSON](validation/recovery.json.gz)、[摘要](validation/recovery-results.json) |
| PR `story-runtime` PC+手机 | **10通过 / 12失败 / 0跳过 / 0重试** | [日志](validation/pr-runtime.log.gz)、[JSON](validation/pr-runtime.json.gz) |
| 干净main `story-runtime` PC+手机 | **10通过 / 12失败 / 0跳过 / 0重试** | [日志](validation/main-runtime-isolated.log.gz)、[JSON](validation/main-runtime.json.gz) |

322定向和93Prompt均为3779的子集，不累加。PR实际Chromium共50场景：38通过、12既有失败；另外运行main22场景作对照。不是全量E2E，更不宣称浏览器全绿。构建仅有大chunk提示，另有NO_COLOR/FORCE_COLOR提示，没有工程错误。

## 旧E2E失败逐项对照

PR与main的22项按“项目 + 完整用例名称”比对，状态差异集合为空，详见[完整对照JSON](validation/runtime-comparison.json.gz)。实际失败比此前“约5项”的描述多，本轮如实记录为12项，不能沿用旧数字。

| 项目/用例 | main | PR | 原因 |
| --- | --- | --- | --- |
| PC：P6截断请求不保存正文、失败重试 | 超时 | 超时 | `story-runtime.spec.ts:349` 等待旧“供应商公开返回的原生内容”入口 |
| 手机：真实开局流式分片/资料面板/刷新 | 失败 | 失败 | seed:148的角色heading不可见 |
| 手机：快速重复点击/取消/迟到请求/切档 | 失败 | 失败 | 同一seed:148 |
| 手机：有效草稿无主动重生成入口 | 失败 | 失败 | 同一seed:148 |
| 手机：已有合法草稿普通模板/空闲草稿正式输入 | 失败 | 失败 | 同一seed:148 |
| 手机：长篇流式跟随/手动上滚 | 失败 | 失败 | 同一seed:148 |
| 手机：P6完整文本与原生思考/刷新清除 | 失败 | 失败 | 同一seed:148 |
| 手机：P6截断/重试 | 失败 | 失败 | 同一seed:148 |
| 手机：1268/1500精确诊断/原文 | 失败 | 失败 | 同一seed:148 |
| 手机：Story标签与变量规划诊断/明确重试 | 失败 | 失败 | 同一seed:148 |
| 手机：后置凭证拒绝/脱敏 | 失败 | 失败 | 同一seed:148 |
| 手机：保存版本冲突/原文失败状态 | 失败 | 失败 | 同一seed:148 |

11个手机用例都没越过旧seed入口，**不能据此宣称它们的后续业务断言已验证**。本轮新增功能通过另外的正式双端SSE场景验证，没有修改这些旧测试的导航、断言或生产UI。桌面P6确实先通过生成/重试，最后卡在 #147 已移除的分区定位。新功能测试没有新增失败，旧12项留待独立UI测试维护。

保留全部24个失败的error-context及两侧完整日志/JSON；[trace索引](validation/runtime-trace-index.json)记录全部trace的原路径、大小和校验和。为避免重复提交相同入口快照，每侧保存桌面/手机代表trace各一份，共4份，见[traces](validation/traces)；另外20份完整trace仍保留在 `/workspace/pr150-evidence/{main,pr}-runtime-output/`，没有删除。

最初按默认配置运行main时，5174端口已被其他服务占用，**没有启动任何测试**，见[首次启动日志](validation/main-runtime.log.gz)。没有停止或复用其他服务。随后使用独立5531/5532端口、相同项目/视口/worker/重试设置，同时执行PR与干净main；只改运行配置的端口、cwd与证据输出位置，不改main文件。临时配置原样提交于validation目录，干净main的git status为空。

```bash
node --version
npm ci
npx vitest run src/tests/story-tag-compat.test.ts # 先红
npm run check
npm run prompts:check
git diff --check
npx vitest run src/tests/story-tag-compat.test.ts src/tests/story-diagnostics.test.ts src/tests/thinking.test.ts src/tests/deepseek-native.test.ts src/tests/story-stage.test.ts src/tests/story-stream-reading.test.tsx
CHROMIUM_PATH=/usr/bin/chromium PR149_RESULT=/workspace/pr150-evidence/recovery.json npx playwright test e2e/story-tag-recovery.spec.ts --config playwright.pr149.config.ts
# PR及main：因默认端口占用，使用已保存的同条件隔离配置
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-runtime.spec.ts --config /workspace/pr150-evidence/pr-runtime.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-runtime.spec.ts --config /workspace/pr150-evidence/main-runtime.config.ts
```

## 本轮修改文件与权限保护

生产仅1文件：`src/services/validation/storyEnvelopeRecovery.ts` 的畸形探测正则和说明。新增/扩展测试4文件：`src/tests/story-tag-compat.test.ts`、`src/tests/story-stage.test.ts`、`src/tests/fixtures/storyRecovery.ts`、`e2e/story-tag-recovery.spec.ts`。另新增本报告目录。

作者既有的 `aiOutputs.ts`、`story-runtime.spec.ts`、diagnostics/thinking/deepseek测试等本轮未改，保留Fable实现与原审查成果。与main比较，其他**449个src文件**逐字节相同；#149恢复器原实现相同；Variables/World入口至文件末尾相同；Fable `repairUnclosedTags` 循环函数本体与初始PR HEAD逐字相同，见[保护范围证据](validation/protected-files.txt)。没有动Schema、IndexedDB、结算、撤回、提示词、模型路由、玩家存档、阅读器或原文显示组件。

## 关键真实React截图

| 场景 | PC | 手机 |
| --- | --- | --- |
| SSE缺正文闭合，最终小说精确归位 | [小说](screenshots/desktop-pr150-sse-repaired-novel.png) | [小说](screenshots/mobile-pr150-sse-repaired-novel.png) |
| 原生思考与原始content单框完整保留 | [原文](screenshots/desktop-pr150-sse-untouched-raw.png) | [原文](screenshots/mobile-pr150-sse-untouched-raw.png) |
| `<//正文>` 拒绝，失败原文可读 | [失败原文](screenshots/desktop-pr150-rejected-slashes-raw.png) | [失败原文](screenshots/mobile-pr150-rejected-slashes-raw.png) |
| 反斜线坏闭合拒绝 | [失败原文](screenshots/desktop-pr150-rejected-backslash-raw.png) | [失败原文](screenshots/mobile-pr150-rejected-backslash-raw.png) |
| `<:正文>` 拒绝 | [失败原文](screenshots/desktop-pr150-rejected-prefix-colon-raw.png) | [失败原文](screenshots/mobile-pr150-rejected-prefix-colon-raw.png) |

全部为虚构测试资料，不含私人存档或真实凭证。环境见[versions.txt](validation/versions.txt)。原始红测、初次新增SSE断言失败、最终绿测和全部正式运行日志均保留；证据校验和见[SHA256SUMS](validation/SHA256SUMS)。

最新Workers Build将在推送最终HEAD后只读核查并补充至原PR描述/回复，不以初始HEAD的成功替代。未另开PR、未合并、未手动部署正式生产、未发布版本或更新Beta标签，交十一代目最终复审。
