# PR #148 持续存储故障安全返修与 Node 24 验收

审查 HEAD：`591ea9a18a3f685acfa9872d47cdb347e2792f28`；开工重新 fetch 后一致。

main：`086ea8f6c25b028460b71b121e42b45ee5e965c2`。原分支：`feat/ai-settings-redesign`。首轮修复代码：`4ebb50d3f72e51bc664521e7d16a87a448da8248`。首次推送前发现原分支新增 `29070a5dcdf31a7498883428c31d5af2830de049`；普通推送被拒绝，没有覆盖远端。已完整保留该提交，并在 `3260de3009c117f759ff22d6be139ee46ecf143a` 整合；后续提交仅收录本报告、日志和截图。

审查依据：[十一代目第二轮复审](https://github.com/WJT111222/HeiJinWangChao/pull/148#issuecomment-6873932051)。本轮未合入 main 或 #149，未创建新 PR，未部署或发布正式生产环境。

## 根因与最小修复

1. 原 `CredentialVault.restore()` 无条件删除两处原值，再写回，持续拒写会让本来完好的旧密钥额外丢失；且异常被吞掉，调用方无从判断。
2. `AiConnections.save()` 将快照读取放在 try 外，读取异常逃过受控提示；保存失败后不论实际恢复结果都声称“密钥和配置都保持原样”。
3. 同时确认 `CredentialVault.set()` 在迁移密钥时也先删除原位置再写目标。目标持续拒写时会不必要地先丢掉旧副本，因此同处改为先写目标、成功后清理另一位置。相同 Store 测试替身不重复清理自己；正常浏览器 session/local 的存放语义不变。

现在 restore 的流程：

- 逐项读取；已经一致的原值不 set/remove，不移动。只尝试恢复不一致的非空原副本，保留原始字节及 session/local 位置。单项故障不阻止其他渠道恢复。
- 只有该渠道所有原始非空副本均已恢复后，才清理快照中原本为空的位置；原副本不能恢复时，保留现存副本，不为腾空间或清理而先删掉它。
- 保留 `29070a5` 的本地容量恢复策略：其他渠道清理成功后，对尚未恢复的原副本再尝试一次。该重试仅限本地存储，不是 AI 或网络重试。新增测试验证释放空间后恢复原副本，且不先删除唯一备份。
- 最后再次读取两处，与快照精确比较，包括额外副本。返回 `{ restored, failedIds }`，不返回密钥值；读取不可用也属于未能确认恢复，不能报告成功。

保存操作先在 try 内完成整个快照，再开始删除/写入/保存配置。快照失败时不进行任何密钥或配置写入。恢复完全核验通过时才报告与保存前一致；否则指出受影响渠道并提示“密钥未能完全恢复或核验，请检查密钥存储状态”，保留未保存编辑供玩家处理。

快照只存在同步 save 调用的临时内存中，不进入日志、异常消息、调试面板、游戏存档或持久配置。提示只用渠道名与固定文案，不插入凭证值、原始异常或堆栈。`heijin.ai.v1` 的格式和配置读写函数均未改动。

## 持续故障场景

| 场景 | 实际核验 |
| --- | --- |
| A：旧密钥在 local，每次 set 均拒绝 | 原旧值仍在，不因 restore 删除或重写；最终一致才能报告已核对，编辑仍未保存 |
| B：三个渠道混合存储，甲已变更，乙拒写且甲回滚也持续拒写 | 乙原 session 密钥保留，已删除丙可恢复；甲无法恢复时保持现存副本并准确报告甲，不误称全恢复 |
| C：同渠道 remove 持续拒绝 | 原始 local 副本不被无故覆盖；多余 session 副本无法清理时报告未恢复，不能静默当成成功 |
| D：getItem 拒绝快照读取 | 密钥 set/remove 和配置写入次数均为零，未保存状态保留，错误受控而非 pageerror |

继续保留原三种单次失败：配置写入失败、第二个密钥写到一半失败、删除失败，以及解除故障后的明确点击重试。新增“删除渠道→放弃”不写凭证，“删除→保存→重载”才清理该渠道且其他渠道不变。

## 远端后续提交整合

`29070a5` 的新单测、持续写失败浏览器用例、快照受控读取和本地容量重试逻辑全部保留。内部 restore 返回值增加 `failedIds` 以精确指出未恢复/未核验渠道；其三条新测试仅将布尔返回断言改为同一结果对象的 `.restored` 布尔断言，原凭证值、位置及不写不删断言均保留。没有删除或放宽远端新增测试。

同时保留每个存储位置独立恢复，避免第一位置失败就短路跳过仍能恢复的另一位置；以及相同 Store 的既有测试/适配用法，防止目标写完后把自己删除。

## 先红后绿与工程结果

环境：Node **24.19.0**，npm **11.9.0**，系统 Chromium **154.0.8037.57**。正式锁文件 `npm ci` 安装 143 包成功，未替换测试运行器或模拟编译。

| 命令 / 批次 | 退出码 | 真实结果 |
| --- | --- | --- |
| 新 Vault 单测，生产修复前 | 1 | 7 失败、4 通过（原三项及快照读取测试通过）；原始失败保留 |
| 持续 set 旧密钥丢失的桌面 Chromium，修复前 | 1 | 1 失败，快照差异直接显示旧 local 副本被删除 |
| 首轮相关 Vault / AI Client / mobile-feedback Vitest | 0 | 3 文件、50 通过，0 失败/跳过；其中 Vault 11/11 |
| 首轮 `npm run check` | 0 | ESLint、149 文件 / 3597 Vitest、TypeScript、生产 Build 全部通过，0 失败/跳过 |
| `npm run prompts:check` | 0 | 3 文件、93 通过，0 失败/跳过 |
| 补充删除/放弃场景后的 Lint | 0 | 项目正式 ESLint，无放宽规则 |
| `git diff --check` | 0 | 无差异格式问题 |

### 整合 `29070a5` 后的最终正式成绩

以下是代码 `3260de3` 的独立新批次，不能用上面的首轮成绩代替：

| 命令 / 批次 | 退出码 | 实际结果 |
| --- | --- | --- |
| 相关 Vault / AI Client / mobile-feedback | 0 | 3 文件、54 通过，0 失败/跳过；Vault 15/15，包含远端新增三项和容量恢复一项 |
| `npm run check` | 0 | ESLint、149 文件 / **3601 Vitest**、TypeScript、生产构建全部通过，0 失败/跳过 |
| `npm run prompts:check` | 0 | 3 文件、93 通过，0 失败/跳过 |
| 双端安全、旧配置、故障恢复、删除/放弃定向 Chromium | 0 | **24/24 通过**，含远端新增持续失败测试；0 失败/跳过 |
| 两端原多渠道长流程，默认 30 秒、零重试 | 0 | **2/2 通过**，0 失败/跳过 |
| `git diff --check` | 0 | 通过 |

最终 24 项与 2 项是两个独立命令；没有把首轮 21/22 或基线失败拼接成一次全绿。

生产构建只有既有的大分包体积警告，本轮不改打包、路由或其他代码。

## PC / 手机 Chromium

保持项目原 runner、desktop/mobile、retries=0；没有运行全量 E2E。

- 第一轮相关两文件定向 **22 项：21 通过、1 超时，0 跳过**。四种持续故障、原三种失败、成功重试、未保存/放弃、旧配置和路由都得到通过证据。
- 超时是既有多协议、多渠道、连接测试、路由、删除及放弃合并在一条中的长流程，30 秒总预算耗尽。生产修复前的审查 HEAD 与 main 的各自原测试，在默认 30 秒预算对照也各超时；未据此改动功能或删减断言。
- 对照诊断仅在命令行给这条测试 90 秒总预算，main 与审查 HEAD 随后分别通过，整个运行器耗时约 20.1 / 24.9 秒；原用例和单步断言没有修改。
- 返修版在工程检查结束、单 worker 的独立复测中，**仍用默认 30 秒**，PC/手机原长流程及新增删除/放弃/保存共 **4/4 通过**。没有改变测试超时配置，没有增加自动重试。

以上是分开的执行批次，不合并为一次全绿。首轮 24 个不同双端相关场景均已取得通过证据；详细用例名、项目、状态、耗时及失败批次见 [browser-batches.json](browser-batches.json)。

新持续故障/删除测试断言保存、回滚、浏览不产生模型 POST；旧显式“测试回复”和四阶段请求测试仍按原断言 Mock 处理，未调用付费模型。校验原配置 JSON 不含密钥、页面正文不泄露凭证、没有 pageerror、重载后值/位置一致。涉及的游戏数据与请求协议均未变更。

## 截图

16 张整合后代码 `3260de3` 的完整 React App 实拍：PC **1440×1000**；手机使用项目原 Pixel 7 **412×839、DPR 2.625**。每种故障各有失败提示与成功保存两态。使用的凭证均是隔离 Mock 值，截图保持密码掩码。没有重新设计任何视觉布局。

- [PC：无法完整恢复并指出渠道](screenshots/desktop-partial-failure.png)
- [手机：无法完整恢复并指出渠道](screenshots/mobile-partial-failure.png)
- [PC：快照读取失败、未开始写入](screenshots/desktop-read-failure.png)
- [手机：快照读取失败、未开始写入](screenshots/mobile-read-failure.png)
- [PC：成功重试](screenshots/desktop-partial-saved.png)
- [手机：成功重试](screenshots/mobile-partial-saved.png)
- [完整视口、提交与校验清单](screenshots.json)

## 修改文件与范围

- `src/services/ai/credentials.ts`：安全写入顺序、无损尽力恢复与明确核验结果。
- `src/ui/settings/AiConnections.tsx`：快照纳入 try、受控读取错误、按实际恢复结果显示反馈。
- `src/tests/credential-vault-restore.test.ts`：保留原三项、首轮新增八项、远端新增三项，并补充一项容量释放后的原副本恢复测试，共十五项。
- `e2e/ai-settings.spec.ts`：只追加四种持续故障和删除/放弃测试，保留既有用例与断言。
- `docs/pr148-security/`：本次要求的报告、真实截图、原始日志与失败对照。

没有改动 AI 设置视觉、服务商/模型/输出档位逻辑、配置格式、Prompt/Manifest/来源锁、Story/Variables/World、存档、结算或撤回，也没有混入 #149。

## Cloudflare 状态

开工时官方 Cloudflare Bot 确认审查 HEAD `591ea9a` 的 Workers Build / Preview 均 success。最终交付 SHA 必须在推送后重新核对：最新状态与对应提交记录在原 PR 的终轮说明和 Cloudflare 官方 Bot 评论中，不用旧 HEAD 的结果冒充新 HEAD 成功。不手动触发部署，不更新 main。

## 原始日志、对照方法与边界

`logs/*.log.gz` 是未经内容改写的原始 stdout/stderr 压缩件，`*.json.gz` 是原 Playwright reporter，`*.exit` 为退出码。`failure-contexts/` 保存原错误页面及定位上下文。所有数据都是合成 fixture，没有读取私人玩家存档或真实 API Key。用 `gzip -dc 文件.log.gz` 查看；SHA-256 清单可核验交付证据。

运行命令：

```bash
node --version
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/credential-vault-restore.test.ts src/tests/ai-client.test.ts src/tests/mobile-feedback.test.tsx
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/ai-settings.spec.ts e2e/ai-route-persistence.spec.ts --grep '持续存储异常|保存失败（|长期存储持续|旧配置|放弃|删除单独指定|未保存关闭|存储失败不清除' --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/ai-settings.spec.ts --grep 'AI 多渠道|删除渠道后放弃' --workers=1
git diff --check
```

main / 审查 HEAD 通过各自未修改源码和原测试的独立工作树、端口 5189 / 5188 对照，未借用返修版 App。诊断性 90 秒预算只用于这些对照命令，不修改仓库测试或验收默认预算；原日志保留。

**安全边界**：Web Storage 没有跨 session/local 的事务。若第一渠道已成功覆盖，而后续浏览器永久拒绝恢复所需写入，软件不能保证恢复所有原值；当前会尽力恢复其他渠道、保护尚存副本并明确报警，绝不声称一切原样。快照不因此写到磁盘或调试面板。该已知边界属于任务明确要求处理的持续故障，不能以模拟测试通过声称已消除浏览器存储失效。
