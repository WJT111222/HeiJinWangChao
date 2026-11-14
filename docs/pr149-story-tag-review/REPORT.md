# PR #149 正式审查与验收

> 最新安全边界补强见[损坏保留标签返修](review-r3/REPORT.md)。它修正了后续审查发现的非法标点/属性前缀绕过；以下及第二轮报告保留为各轮历史证据。

> **后续审查修正**：本报告使用独立行小说夹具，未覆盖转入元指令与实际小说同行、且元指令自身含 `【旁白】` 的故障边界。此前“结构等价”描述对该实际形态不成立。原始成绩保留为历史记录；请以[同行边界返修及本轮验收](review-r2/REPORT.md)查看最新代码、测试和截图。

审查对象为原 Draft PR #149，没有另开 PR。初始 HEAD：`fd542b1168c6805accdc08fec1f333cc2e46701c`；main：`086ea8f6c25b028460b71b121e42b45ee5e965c2`。开工及推送前均重新核对远端。

审查修复提交：`a92df6e01769044ffa50fdc11a3d82a83fd80a6f`。后续提交只记录本报告和验收材料，最终 HEAD 在 PR 描述／回复提供。

## 审查结论与实际修复

完成边界修复后，通过本轮 Node24 和 Mock 双端验收，没有剩余测试失败。实现没有生成故事、记忆、变量或行动选项，不增加请求；恢复后的内容仍经过原有字数、JSON、StorySchema、事件、时间、草稿版本及原子写入保护。

原 PR 的三个确定问题已在原分支修复：

1. **规划可能漏入恢复正文**：原检查只识别行首大写 `Step`，小写、Markdown 标题／加粗／列表形式会漏检。现在恢复后的叙事区域出现可识别的编号规划标题即拒绝；前缀存在额外、重复或不同分隔符的 Step 也不能被静默丢弃。
2. **畸形标签可能被丢弃**：原检查只识别完整、无属性、小写的保留标签，前缀中的属性式、大小写变体或残缺结构可能随规划一并被抹去。现在恢复路径拒绝这些保留结构；只要已有正文标签或标签残片，就不猜测修补正文边界。
3. **明确格式的误拒绝及旧断言**：同一条明确转入正文句的句号曾被拒绝；完整0–15序列的 Markdown／冒号标题也未覆盖。现在仅接受这些明确格式变体，仍要求编号恰好0～15、无多余步骤、明确转入句和行首【旁白】。旧“缺少thinking必失败”用例移为完整内容的正例，其余嵌套／重复／空规划／截断负例保留；摘要协议版本断言同步为本 PR 已更新的精确版本，没有放宽为任意字符串。

除上述恢复函数外，本轮没有修改生产代码。新增测试覆盖这些问题的先红后绿、DeepSeek真实客户端链、下游拒绝及并发／事务回滚。

## 可选规划与恢复的实际边界

项目 `<thinking>` 整块缺省合法，不会凭空补写规划。若实际输出，则仍须非空、闭合且不重复／嵌套。真正必需的正文、短期记忆、变量规划，以及启用时的行动选项保持要求。

缺失正文开闭标签时，只在以下边界明确的情况恢复：

- 原文没有正文标签或标签残片，尾部必要结构完整。
- 小说以独立行的【旁白】明确开始。若前面有裸规划，必须从完整且唯一的 Step0～15 开始，并以明确的“现在按照这些规划写正文”句衔接。
- 不知道的前言、不完整／重复／多余步骤、未知转换句、正文中的规划标题、损坏结构、截断尾部均拒绝，不通过补写数据强行成功。
- 只为已有小说建立封套，保留供应商已有摘要、变量数组及行动选项；恢复后继续全部正式校验。

支持的 Step 标题是有限格式（普通、Markdown 标题／加粗／列表及竖线／冒号分隔），不是任意自然语言纠错。没有修复缺失必要尾部块、错误JSON或其他协议掉格式。

**无标签内容不做流式边界猜测**：裸 Step 与无标签小说在完整响应验收前不进入小说阅读区；通过后呈现已保存草稿。已有正式 `<正文>` 的流式路径继续即时清空思考，从空白显示正文。公开原生思考仍按原功能显示。统一原文框保留所有实际公开返回内容及原始无标签文本，未把恢复用的标签写回原文。

## DeepSeek 故障结构的复现范围

当前对话和 PR 没有那次故障的完整逐字响应。本轮使用[明确标注为虚构的结构样本](../../../src/tests/fixtures/storyRecovery.ts)：16个Step章节、每步三条公开规划、明确转正文句、以【旁白】开头且含对白的完整小说、短期记忆、非空变量规划数组及3项行动选项。

通过真实 `newChannel('deepseek')`、`AiClient`、SSE、Prompt Composer、恢复／正式解析及 Repository 草稿保存链运行；网络为本机 Mock。不会把这个样本称为玩家私人原文的逐字重放，也没有发真实付费请求。

断言恢复结果与供应商已有 narrative、summary、variableGuide、actionOptions 深度相同；没有规划章节或转入句混入故事，没有新增资料或额外请求。成功只保存一次草稿，正式 GameState 完全不变。关键后续保护另有专门回归：

- 时间倒退和不存在的事件引用，恢复成功后仍分别以原 `time_data` / `event_entry` 及准确规则失败，草稿保存函数不被调用。
- 生成期间其他标签页改写草稿或正式 revision，仍拒绝迟到响应覆盖；两类场景同时覆盖正常标签和恢复路径。
- 完整响应到达但进入事务前取消，整份草稿回滚。
- 已把草稿 put 排入真实 IDB 事务后注入配额异常，仍整体回滚，正式状态与旧草稿完全一致。

## 正式运行结果

环境：Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**。使用正式 `npm ci`、Vitest 和 Playwright，没有离线替代运行器，见 [versions.txt](validation/versions.txt)。

| 检查 | 实际最终结果 | 原始证据 |
| --- | --- | --- |
| `npm ci` | 成功，143 packages | [日志](validation/npm-ci.log.gz) |
| `npm run check` | Lint、**3628单测／149文件**、TypeScript、Build全部通过 | [日志](validation/check-final.log.gz) |
| `npm run prompts:check` | **93通过** | [日志](validation/prompts-final.log.gz) |
| 4文件定向Vitest | **123通过** | [日志](validation/related.log.gz) |
| 新增恢复双端Chromium | **10通过，0失败／跳过／重试** | [日志](validation/recovery-browser.log.gz)、[JSON](validation/recovery-browser.json.gz) |
| 既有流式阅读双端Chromium | **20通过，0失败／跳过／重试** | [日志](validation/reading-browser.log.gz)、[JSON](validation/reading-browser.json.gz) |
| 既有统一原文双端Chromium | **8通过，0失败／跳过／重试** | [日志](validation/raw-browser.log.gz)、[JSON](validation/raw-browser.json.gz) |
| `git diff --check` | 通过 | [空输出](validation/diff-check.log.gz) |

最终 Chromium 合计 **38个独立场景**（PC19、手机19）；仅运行明确文件范围，没有跑全量浏览器回归。123项定向及93项Prompt属于3628总数的子集，不累加。构建仅有Vite大chunk提示，没有构建错误，本轮不扩大到拆包。

新增5种浏览器场景各双端一次：完整DeepSeek结构恢复、缺省thinking的实时标签正文、含歧义规划时拒绝、恢复后时间倒退拒绝、恢复后事件引用拒绝。每项均断言只有一次Mock请求，成功或失败后的正式状态与草稿符合预期。原文为单一只读文本框，并用实际键盘复制／剪贴板核对完整原文；没有插入恢复标签或复制额外思考区。

主要命令：

```bash
node --version
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/story-stage.test.ts src/tests/story-tag-compat.test.ts src/tests/story-stream-reading.test.tsx src/tests/story-raw-continuous.test.tsx
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-tag-recovery.spec.ts --config playwright.pr149.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-stream-reading.spec.ts --config playwright.story-reading.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-raw-continuous.spec.ts --config playwright.story-raw.config.ts
git diff --check
```

使用原项目真实依赖，可写 npm cache；三个配置使用独立本机端口，JSON结果写入独立证据目录，仅改变文件输出位置。

## 初次失败与修复记录

- [check-initial.log.gz](validation/check-initial.log.gz)：3601通过／3失败。一个旧thinking必需断言、两个旧提示词版本断言未随产品变更同步；保留用例并改为新规则的准确正例／精确版本，未删除其他业务断言。因为单测失败，该次check未继续执行类型和构建，最终已完整重跑。
- [recovery-red.log.gz](validation/recovery-red.log.gz)：新边界回归在原实现上12失败／17通过，真实复现规划标题漏检、畸形标签吞掉和相同转入句句号被拒绝。
- [recovery-green.log.gz](validation/recovery-green.log.gz)、[recovery-runtime.log.gz](validation/recovery-runtime.log.gz)保存分步修复过程，最终[related.log.gz](validation/related.log.gz)123项全通过。
- 本轮三个Chromium批次首次均通过，没有添加skip、删除断言、放宽请求次数或浏览器重试。

## 守恒审查

与main比较，**241个文件**及 `parseVariables`、`parseWorld` 两个函数体逐字节不变，见[核对记录](validation/protected-files.txt)。包括领域Schema和规则、IndexedDB／Repository、所有AI传输与渠道参数、阅读组件、单框原文组件、工作流执行器和非Story提示词。

PR原有5个提示词模块的 `applicableStages` 均仅为story。Manifest其他模块未变；来源锁的原始 origin/sourcePath/sourceSha256 保留，只追加本次Story适配记录。Prompt93项通过。本轮未进一步修改提示词、Manifest或来源锁。

## 关键真实React截图

| 场景 | PC | 手机 |
| --- | --- | --- |
| 恢复后小说，无规划污染 | [小说](screenshots/desktop-recovered-novel.png) | [小说](screenshots/mobile-recovered-novel.png) |
| 原文保留全部无标签Step结构 | [原文](screenshots/desktop-untouched-recovery-raw.png) | [原文](screenshots/mobile-untouched-recovery-raw.png) |
| thinking缺省，标签正文实时显示 | [流式](screenshots/desktop-optional-thinking-stream.png) | [流式](screenshots/mobile-optional-thinking-stream.png) |
| thinking缺省的完整单框原文 | [原文](screenshots/desktop-optional-thinking-raw.png) | [原文](screenshots/mobile-optional-thinking-raw.png) |
| 歧义结构拒绝 | [失败原文](screenshots/desktop-rejected-ambiguous-raw.png) | [失败原文](screenshots/mobile-rejected-ambiguous-raw.png) |
| 恢复后时间校验拒绝 | [时间](screenshots/desktop-rejected-time-raw.png) | [时间](screenshots/mobile-rejected-time-raw.png) |
| 恢复后事件校验拒绝 | [事件](screenshots/desktop-rejected-event-raw.png) | [事件](screenshots/mobile-rejected-event-raw.png) |

## 修改文件

本轮生产修改只有 `src/services/validation/storyEnvelopeRecovery.ts`。

本轮测试修改：`src/tests/story-tag-compat.test.ts`、`story-stage.test.ts`、`thinking.test.ts`、`summary.test.ts`；新增 `src/tests/fixtures/storyRecovery.ts`、`e2e/story-tag-recovery.spec.ts`、`playwright.pr149.config.ts`。另外加入本报告、14张截图及原始日志。

整个PR相对main的代码文件清单见 [CHANGED_FILES.txt](validation/CHANGED_FILES.txt)，包含原作者的Story解析／诊断、5份Story提示词与元数据、相关测试，本轮没有混入其他功能。

日志gzip无损保存；JSON仅把重复截图base64改为独立图片引用或附件哈希，结果元数据完整。原始JSON留工作证据目录，哈希见 [JSON_SOURCES.txt](validation/JSON_SOURCES.txt)，材料校验见 [SHA256SUMS.txt](validation/SHA256SUMS.txt)。

推回原 Draft PR #149，不新建PR；未合并、未部署、未发布，等待最终复审。
