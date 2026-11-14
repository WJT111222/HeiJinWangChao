# PR #149 同行正文边界返修

回应[最新合并阻断评论](https://github.com/WJT111222/HeiJinWangChao/pull/149#issuecomment-6873874166)。上轮 HEAD 为 `af790a18ff29aea3c77d75c977ddde6e0ca7245e`；本轮代码提交为 `a765d8abe03ded89edf6f3ec5e86efc5952bb03b`。main 重新核实为 `086ea8f6c25b028460b71b121e42b45ee5e965c2`。后续材料提交的最终 HEAD 在原 PR 回复提供。

## 问题与最小修复

上轮夹具将转入句和小说拆成两行，未覆盖评论指出的真实结构。这是测试盲区，不能用此前通过成绩证明同行形态已支持。本轮保留原独立行夹具，另增加以下虚构、脱敏的结构样本：

```text
完整且唯一的 Step 0～15

现在按照这些规划写正文，保证层次完整，段落以【旁白】和【角色名】标签呈现，并控制字数不低于1500。【旁白】真实 Mock 小说文本……
<短期记忆>已有摘要</短期记忆>
<变量规划>已有合法数组</变量规划>
<行动选项>已有三个选项</行动选项>
```

生产改动仅在 `storyEnvelopeRecovery.ts`：

- 原独立行 `【旁白】` 路径保留。
- 同行路径先要求转入句之前存在完整、唯一、顺序正确的 Step0～15。元指令只接受评论给出的有限分句、既定顺序和可选逗号形式；句末只认可中文或 ASCII 句号，不接受逗号、冒号等模糊边界。
- 只在唯一的句号后 `【旁白】` 候选处起小说，不使用第一个标签或 `indexOf` 猜起点。指令中引用的标签不会成为起点。用于判别“是否有同行提示”的固定引用短语排除，不用于选择小说位置。
- 多个候选、额外句子或分句、重复转入句、不完整 Step、畸形保留标签、缺尾部块、空正文均拒绝。同行提示无效时不退到后面的独立行，否则可能丢掉真正的第一段。
- 原始响应完全不变。恢复仅为已有小说建立封套，不补写内容，不产生额外请求。恢复后的 JSON、StorySchema、字数、事件、时间及草稿原子保存保护全部沿用。

这不是自然语言格式万能纠错。未认可的元指令措辞及多候选同行结构仍保守拒绝。未获取玩家故障的逐字私密响应；本轮复现的是评论提供的边界形态。

## 字数与数据真实性

成功样本的 Mock 响应实际提供 **1521** 个去空白 Unicode 字符，配置最低字数为 **1500**。夹具显式重复同一段虚构小说构造长响应，以检验原样完整保留；生产恢复器没有重复或扩写小说。短样本实际 **169** 字，在同样1500配置下准确报 `narrative_short`，`actualCount:169`、`minimumCount:1500`，不再误报缺正文，也不会保存。

供应商原生思考和项目原文仍留在单一只读原文框；只对实际返回内容断言，没有伪造思考或顺序。两种路径的 narrative、summary、variableGuide、actionOptions 均与输入精确一致，正式状态不变。浏览器每场恰好一次本机 Mock 请求。无标签流式内容仍不猜边界，已有正式 `<正文>` 的流式行为不变。

## Node24 实测结果

环境：Node **v24.19.0**、npm **11.9.0**、真实 Chromium **154.0.8037.57**，使用项目真实依赖、Vitest、Playwright，无替代运行器。沿用上轮 Node24 正式 `npm ci` 安装，未变依赖，本轮未重复安装，旧安装日志保留在上级报告。

| 检查 | 本轮实际结果 | 原始日志 |
| --- | --- | --- |
| 新边界先红 | 2失败 / 43通过；新同行正例与短正文诊断确实失败 | [red.log.gz](validation/red.log.gz) |
| 修复后定向 Vitest，4文件 | **150通过 / 0失败** | [related-final.log.gz](validation/related-final.log.gz) |
| `npm run check` | Lint、**3655单测 / 149文件**、TypeScript、Build通过 | [check.log.gz](validation/check.log.gz) |
| `npm run prompts:check` | **93通过 / 0失败** | [prompts.log.gz](validation/prompts.log.gz) |
| 双端恢复 Chromium | **14通过 / 0失败 / 0跳过 / 0重试**，桌面7、手机7 | [chromium.log.gz](validation/chromium.log.gz)、[原始JSON](validation/chromium.json.gz)、[精简结果](validation/browser-results.json) |
| 截图定位辅助改动后 ESLint | 通过 | [eslint-final.log.gz](validation/eslint-final.log.gz) |
| `git diff --check` | 通过，空输出 | [diff-check.log.gz](validation/diff-check.log.gz) |

150项定向和93项Prompt是3655的子集，不累加。构建仅有Vite大chunk提示，无新增工程失败。先红不是最终失败；其后最终结果全部通过。未删除、跳过、弱化断言或增加重试。

Chromium本轮7种场景各双端一次：原独立行恢复、无thinking正式标签流式、同行双旁白且1500门槛通过、同行169字拒绝、歧义拒绝、恢复后时间倒退拒绝、恢复后无效事件引用拒绝。原文使用实际键盘复制并核对剪贴板，验证单框、只读、无横向溢出。代码为截图增加镜像测量，仅将原文框滚到真实同行边界，不参与恢复逻辑。

新增单测还验证多个候选、额外元指令、损坏/缺失结构、空小说、JSON/Schema/摘要/行动数量拒绝；StoryStage覆盖同行与独立行精确保存、事件和时间拒绝、草稿CAS、正式revision变化、事务前取消、IDB put入队后配额故障整体回滚。

上轮38项浏览器成绩和全部旧日志原样保留；本轮只运行上述14项恢复场景，没有重跑上轮全部38项，也没有跑全量E2E。不能将两轮成绩相加宣称本HEAD通过52项。最终截图定位辅助调整后重跑了同一14项，仅属复验，不重复计数。

```bash
npx vitest run src/tests/story-stage.test.ts src/tests/story-tag-compat.test.ts src/tests/story-stream-reading.test.tsx src/tests/story-raw-continuous.test.tsx
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium PR149_RESULT=/workspace/pr149-evidence/review-r2/chromium.json npx playwright test e2e/story-tag-recovery.spec.ts --config playwright.pr149.config.ts
npx eslint e2e/story-tag-recovery.spec.ts
git diff --check
```

## 修改清单与保护范围

本轮代码/测试5文件：

1. `src/services/validation/storyEnvelopeRecovery.ts`：有限同行识别，复用原Step资格判定。
2. `src/tests/fixtures/storyRecovery.ts`：新增双旁白同行长/短结构夹具，保留旧夹具。
3. `src/tests/story-tag-compat.test.ts`：边界及下游校验正负例。
4. `src/tests/story-stage.test.ts`：真实DeepSeek Mock链、保存与回滚路径增加同行覆盖。
5. `e2e/story-tag-recovery.spec.ts`：双端同行成功/短文拒绝、实际原文复制、截图。

另修改上级 `REPORT.md` 增加旧结论修正链接，本目录存放返修报告、日志与22张真实React截图。没有改动 #148 或其他功能。

除上述4个src文件，其他 **450个src文件**与本轮基线逐字节相同，见[核对记录](validation/protected-files.txt)。包括正式解析与诊断、全部提示词/Manifest/来源锁、AI传输、流式阅读、统一模型原文组件、Schema、Repository、结算及撤回。Variables与World没有改动。

## 关键截图

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 实际同行双旁白边界，原文完整保留 | [原文边界](screenshots/desktop-inline-actual-boundary.png) | [原文边界](screenshots/mobile-inline-actual-boundary.png) |
| 恢复后小说，无Step/元指令污染 | [小说](screenshots/desktop-inline-recovered-novel.png) | [小说](screenshots/mobile-inline-recovered-novel.png) |
| 单一完整原文框 | [原文](screenshots/desktop-inline-complete-raw.png) | [原文](screenshots/mobile-inline-complete-raw.png) |
| 短正文拒绝，失败原文可读 | [失败原文](screenshots/desktop-inline-short-rejected-raw.png) | [失败原文](screenshots/mobile-inline-short-rejected-raw.png) |
| 原独立行恢复仍可用 | [小说](screenshots/desktop-recovered-novel.png) | [小说](screenshots/mobile-recovered-novel.png) |

版本记录见[versions.txt](validation/versions.txt)，证据校验和见[SHA256SUMS](validation/SHA256SUMS)。均为虚构测试数据，无私人存档或真实密钥。

保持原Draft PR #149，未合并，未执行部署或发布，等待最终复审。
