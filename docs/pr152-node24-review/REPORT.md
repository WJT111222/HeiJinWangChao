# PR #152 · Node 24 正式验收报告

日期：2026-11-15。依据 [十一代目最后一轮评价](https://github.com/WJT111222/HeiJinWangChao/pull/152#issuecomment-6890383135)。本轮在原分支返修，没有另开 PR。

## 结论与版本

未发现本次 V10 / 好感协议修改引入的新增生产回归。本轮修复了测试中的过期模块 ID、旧好感 Mock 和 Lint 问题，并新增旧档保护、真实模块加载和好感重放验证；**生产代码没有追加修改**。

工程检查通过。Chromium 定向 96 个独立场景中 69 通过、27 失败，0 跳过、0 重试。27 个失败均有干净 main 同环境对应失败证据，属于仍存在的手机旧定位/入口问题；不能称为全绿，也不能据此宣称那些被阻塞的手机业务断言已经完成验证。合并仍需项目负责人授权。

| 标识 | 值 |
| --- | --- |
| 起始审查 HEAD | `45fce91f3ae81ca31493969f8289d719b1d03801` |
| 实测最新 main | `cb8a3f548664e4275b50872076266e2572173fbf` |
| 本轮测试修复提交 | `abb1391c771158478ee6ea28711240ca8afaac81` |
| 分支 | `refactor/v10-legacy-cleanup` |
| 最终交付 HEAD / 最新 Workers 状态 | 见本报告所在提交及原 PR 的本轮验收回复，使用完整 SHA 对应检查 |
| 环境 | Node **v24.19.0** / npm **11.9.0** / Chromium **154.0.8037.57** / `/usr/bin/chromium` |

PR 当前为 Open、非 Draft；保持其既有状态、未合并。未手动部署生产、发布版本或修改 Beta 标签。推送后既有 Workers 自动检查可能自行执行，不能等同于人工确认生产域名更新。

## 正式工程成绩

全部使用项目真实依赖和正式 Vitest / Playwright 运行器，没有离线垫片或替代运行器。PR 与 main 均实际执行 `npm ci`，各安装 143 个包。

| 命令/范围 | 结果 | 原始日志 |
| --- | --- | --- |
| `node --version` | v24.19.0 | `logs/node-version.log.gz` |
| `npm ci` | 成功，143 packages | `logs/npm-ci.log.gz` |
| `npm run check` | Lint、151 文件 **3802 项单测**、TypeScript、生产构建通过 | `logs/check-delivery.log.gz` |
| `npm run prompts:check` | **93 通过**，3 文件 | `logs/prompts-delivery.log.gz` |
| 先前定向 Vitest | **859 通过**，28 文件；为全量的子集，不相加统计 | `logs/targeted-final.log.gz` |
| 最终定向 Vitest | **516 通过**，21 文件，包含最终好感重放断言 | `logs/targeted-delivery.log.gz` |
| 保存保护单套件 | **48 通过**，含 V6–V9 四个参数化样本 | `logs/v10-backup-final.log.gz` |
| 好感及取值语义单套件 | **35 通过**，含首次确认后整批重放 | `logs/affinity-replay.log.gz` |
| 干净 main 对旧档样本校验 | **4 通过**，四个样本均真能迁移至 V9 | `logs/legacy-baseline.log.gz` |
| `git diff --check` | 通过 | `logs/diff-check.log.gz` |

各单独运行与全量之间存在重叠，不将多轮成绩累加为新增覆盖。未跑约 700 项完整 E2E、其他未列出浏览器文件或真实付费 API。`city-night.spec.ts` 本轮未执行，不沿用他人的历史成绩声称本轮通过或复现；其相关单测包含于全量检查。

## 先红后绿及必要修正

1. 原 HEAD 正式 Lint 报 11 个问题：`e2e/npc-v2-foundation.spec.ts` 一个无效初值赋值、`variable-source-runtime.test.ts` 十处模板字符串无用引号转义。只调整测试语法；运行时 Mock 文本不变。原日志 `check-initial.log.gz`，修复过程 `lint-test-fix.log.gz`。
2. 首次 Prompt 检查 **91 通过 / 2 失败**：检查器仍期待删除前的 `.text` 模块 ID。替换为精确的现行 ID，继续检查具体模块，不放宽为任意包含。日志 `prompts-initial.log.gz`。
3. Lint 修复后全量单测 **3790 通过 / 12 失败**：10 个为过期 `.text` 模块 ID 断言，2 个为 Mock 仍让模型填写被正式新决定禁止的 `from`。Mock 改成三字段新协议，并新增断言检查程序生成的内部 `from`、原因和关系；非法 `from` 的负例继续保留。日志 `check.log.gz` 与 `compat-repairs.log.gz`。
4. 新增旧档浏览器用例初次 8 项失败：测试错误期待首页直接显示后端“只支持 V10”的长错误，且手机误用桌面 `.save-card` 入口。新测试改为检查实际首页降级文案，同时独立核对 Repository 的 `UNSUPPORTED_VERSION` 与完整重置提示，手机按真实车票入口下载。不是删原业务断言或修改生产 UI。初次和最终日志均保留。

5. 最终对整个 PR 执行 `git diff --check origin/main`，发现作者原有 `e2e/world-handoff.spec.ts:82` 一处尾部空格；仅清理空格，定向 ESLint 与整个 PR 差异检查通过。日志 `diff-check-base-initial.log.gz`、`diff-check-base.log.gz`、`whitespace-lint.log.gz`。

本轮未删除/跳过/弱化旧业务断言，未增加重试。原作者此前已删除退出使用的联系人复核/RetireNpc 专属测试，这是该 PR 已批准的功能清理；本轮不把它描述成“整个 PR 没有删除任何测试”。

## 好感协议与实际执行链

最后一轮评价采用项目负责人最新决定，模型唯一合法写法是：

```text
set npc[id].affinityChange = {"to":5,"reason":"本回合具体剧情原因","relationshipText":"当前关系与态度"}
```

- 模型不写 `from`；`sourceValues` 读取正式前值，`trackSourceValues` 按同批上一笔结果更新。内部领域命令仍含 `from`，供原有前值校验使用。
- 未确认初始同伴首笔内部 `from:null`；本轮强化同批 null→2→5 的两笔准确原因、关系描述、最终确认状态，以及编译/模拟重放全等断言。
- `to` 的负值及 ±100 正例，±101、坏 JSON、缺/空白 reason、缺/空 relationshipText、额外 `from`、纯数值 `set/add affinity` 和非法实体负例继续通过；无部分状态修改。其他合法 `add economy.cash` 等仍通过真实执行链。
- `live-text-turn.test.ts` 使用真正 TurnCoordinator → Variables 文本解析/编译 → World JSON → 原子提交 → 刷新/撤回，并核对内部 `affinityChange:{from:0,to:5,reason:...}` 与关系描述。不是另造一个脱离生产的解析器。
- `reason` 不自动生成永久记忆；同批 `push npc[id].memories` 继续由独立记忆系统处理。好感值不用于推定恋爱关系。
- 正式目录、常驻提示词 07、普通/特殊 NPC init/update、输出契约、Manifest 和 sources.lock 同步；Prompt 检查通过。

## V10 旧档重置与原始数据保护

新增四个单位测试样本包含真正的 V6/V7/V8/V9 旧字段及版本差异；另用干净 main 的正式 `migrateSave()` 实际读取，四个样本都可迁移至 V9。样本在 `fixtures/legacy-v*.json`，main 对照测试/配置在 `configs/`。因此不是只用一个损坏对象随意改版本号，就声称证明了旧档行为。

在 PR 上，旧记录列表为 unreadable、读取抛 UNSUPPORTED_VERSION；原始导出保留保存记录、草稿、回执原文。旧备份经解析拒绝；即使绕过类型且附带有效 V10 覆盖确认凭据，compare/import 也失败。测试前后五个仓库 `saves`、`drafts`、`turnReceipts`、`turnUndo`、`saveControls` 深度相等，当前 V10 仍可读。未来版本 FUTURE_VERSION 与不覆盖保护仍由现有回归覆盖。

新增 PC/手机各四项真实 React 测试，从首页实际按钮取得下载，核对原始 JSON，检查版本拒读、旧备份防覆盖及五仓库不变。浏览器样本另外故意带未知原始字段，以证明未知内容也能原样救援；其可读性与单位测试的合规旧档样本分开验证。全部 POST 被计数并阻断，实际为 0。

界面当前显示“无法读取 / 当前版本无法读取这条记录”，允许“导出原始数据”；后端给出明确的只支持 V10/请重新开局提示。并没有为了测试擅自改首页文案。

## Chromium 真实结果与 main 对照

使用仓库原有 Desktop Chrome（1440×1000）与 Pixel 7 项目、workers=2、retries=0，独立端口 5761/5762/5763，未复用旧开发服务器。配置完整留在 `configs/*.txt`，JSON 报告完整保留，包括截图附件、精确报错及 trace 路径。

| PR 文件 | 桌面通过/失败 | 手机通过/失败 |
| --- | --- | --- |
| `event-stages-v2.spec.ts` | 4 / 0 | 3 / 1 |
| `format-tail-wire.spec.ts` | 1 / 0 | 1 / 0 |
| `npc-directory.spec.ts` | 7 / 0 | 0 / 7 |
| `npc-final-acceptance.spec.ts` | 2 / 0 | 0 / 2 |
| `npc-unified-memory.spec.ts` | 2 / 0 | 2 / 0 |
| `npc-v2-foundation.spec.ts` | 3 / 0 | 3 / 0 |
| `save-backup-upgrade.spec.ts` | 2 / 0 | 2 / 0 |
| `turn-undo.spec.ts` | 9 / 0 | 6 / 3 |
| `unreadable-saves.spec.ts` | 7 / 0 | 0 / 7 |
| `world-handoff.spec.ts` | 7 / 0 | 0 / 7 |
| 原有相关套件小计 | **44 / 0** | **17 / 27** |
| 新增 `v10-save-reset.spec.ts` | **4 / 0** | **4 / 0** |
| 合计 | **48 / 0** | **21 / 27** |

原有相关套件 88 场景：61 通过、27 失败。新增 8 场景全通过；共 96 个独立场景，69 通过、27 失败。新增用例初次定位修正执行另有 8 个失败尝试，未将其重复计入独立场景数，也未隐去日志。

干净 main 只跑对应手机范围，合计 36 项：9 通过、27 失败（第一组 3/8，第二组 6/19）。26 个失败名称完全相同，另一个 world-handoff 用例因 V10 政策改变标题，但两端均在公共 seed 的“林舟”桌面标题定位阻塞；不把 main 的旧迁移断言当作 V10 重置验证，后者由新增 8 项单独覆盖。

实际失败类别：

- NPC 名录 7 项及最终 NPC 验收 2 项：手机仍找桌面存档读取入口，导航超时。
- world-handoff 7 项：seed 仍等待手机页面没有的桌面主角标题“林舟”。
- unreadable-saves 7 项：6 项仍找桌面 `.save-card`，另 1 项在存储整体失败状态等待不存在的 `.mh-rail`；main 同样失败。
- turn-undo 3 项：手机旧输入/发送/撤回定位不可达或按钮找不到；main 同位置失败。
- event-stages-v2 1 项：`getByTestId('runtime-log')` 在手机同时匹配两个容器，触发 strict mode violation；main 同样重复匹配。

本轮未改这 27 个旧失败测试，未重做 UI，也未将导航没到达的隐私、收费、事务业务断言标记为通过。桌面相应用例全部通过；手机永久身份、原文/总结来源、真实进程重启、原子撤回、备份保护和格式尾检查器有已通过场景，但不代替未达断言。`npc-directory.spec.ts:92` 桌面本轮一次通过；没有发生需重跑对照的桌面抖动，不替他人的“多次概率结果”背书。

逐项名称、状态及 27 对失败映射见 [CASE_RESULTS.md](CASE_RESULTS.md)。全部失败上下文压缩保存于 `logs/error-contexts.json.gz`，四个代表性成对 trace 在 `traces/`；全部 62 个失败尝试 trace 的路径、长度、SHA256 见 [TRACE_INDEX.json](TRACE_INDEX.json)，其余完整文件保留在执行工作区 `/workspace/pr152-evidence/`，未把大量重复 zip 全部提交进仓库。

## 保留能力的源码核对

- NPC 正式档案永久保留，移除 RetireNpc/contactReview/retiredNpcs 是已批准的 V10 规则，不等于删除死亡/离场人物。NPC 原始记忆、总结、稳定身份引用、休眠恢复、来源权限与历史完整保留。
- `retiredEvents` 仍在现役；`src/domain/events/stages.ts`、`lifecycle.ts` 与 main 无差异，旧无 eventKind 的承接仍保留。
- `saveRepository.ts`、`domain/turnCommit.ts`、`services/validation/turnCommit.ts` 与 main 无差异；CAS、IDB 事务、撤回及幂等提交实现未被此次清理重写。
- Story #149/#150 的恢复、诊断、storyStage/storyStream、小说阅读投影与 main 无差异；#151 的 `src/prompts/formatTail.ts` 无差异。双端 `format-tail-wire` 实际 React 检查器验证出站最后一条提醒、原生请求体、独立上下文及浏览不写档。
- Variables 保持文本三块，World 保持五数组 JSON；World 人物引用验证仅移除已经不再存在的 retiredNpcs 后备分支，没有放松引用权限。
- 80 个 Manifest 模块可校验；四类组织各有独立 init_world 模块。新增测试用正式 composePrompt/readPromptResource 校对磁盘原文与实际消息，确认四种开局路径都真正加载，shared 04/05 各一份，没有只改路径不执行的假验证。
- 本轮没有 Token 优化，不以删行数声称模型费用下降，没有真实模型调用。

## 本轮修改文件

测试修复提交仅改 12 个文件：

- `e2e/npc-v2-foundation.spec.ts`：修复测试局部变量 Lint。
- `e2e/world-handoff.spec.ts`：清理作者原改动的一处尾部空格，使整个 PR 对 main 的 `git diff --check` 也通过。
- `e2e/v10-save-reset.spec.ts`：新增 V6–V9 拒读、原文下载、备份防覆盖、五仓库不变双端测试。
- `src/tests/save-backup.test.ts`：新增合规旧版本样本四例；可选环境变量仅导出合成夹具供干净 main 核验。
- `src/tests/v10-prompt-load.test.ts`：新增四种组织 World 初始化真实原文加载验证。
- `src/tests/live-text-turn.test.ts`：Mock 服从三字段协议，新增内部前值/原因/关系断言。
- `src/tests/variable-source-port.test.ts`：加强首次确认、连续前值、记忆独立及重放断言。
- `src/tests/variable-source-runtime.test.ts`：删无用转义，运行时文本不变。
- `src/tests/live-text-variables.test.ts`、`prompt-inspector.test.ts`、`turn-coordinator.test.ts`、`variable-stage.test.ts`：精确更新现役模块 ID 断言。

另新增本目录验收资料。旧 docs/assets 的测试自动生成截图已恢复，真实新截图复制至本目录，不覆盖先前批次证据。

## 真实 React 截图

- [PC V9 拒读与原文下载](screenshots/desktop-v9-raw-kept.png) / [手机 V9 拒读与原文下载](screenshots/mobile-v9-raw-kept.png)；V6/V7/V8 同目录齐全。
- [PC NPC 永久详情](screenshots/pr-npc-v2-batch5-desktop-detail.png) / [PC 特殊人物](screenshots/pr-npc-v2-final-desktop-special.png) / [完整长记忆](screenshots/pr-npc-v2-final-desktop-long-memory.png)。
- [PC Variables 真实尾提醒](screenshots/desktop-variables-wire-tail.png) / [手机 Variables 真实尾提醒](screenshots/mobile-variables-wire-tail.png)；Story/World 双端同目录。

截图与 Mock 都是隔离测试数据，不含玩家存档或真实 API 密钥，不拿静态设计 HTML 冒充 React 验收。

## 复现与证据

原始 stdout/stderr 以 gzip 压缩保存，可用 `gzip -dc logs/<文件>.gz` 查看，不对失败日志做删节。`SHA256SUMS` 对本目录除报告及清单本身外的证据校验；报告后续补充元数据不影响已有原始文件。

```bash
node --version
npm ci
npm run check
npm run prompts:check
git diff --check

# PR 88 个相关场景，两项目均执行；使用 configs/pr-browser.config.ts.txt 的实际配置
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/world-handoff.spec.ts e2e/npc-v2-foundation.spec.ts \
  e2e/npc-unified-memory.spec.ts e2e/npc-final-acceptance.spec.ts \
  e2e/npc-directory.spec.ts e2e/unreadable-saves.spec.ts \
  e2e/save-backup-upgrade.spec.ts e2e/event-stages-v2.spec.ts \
  e2e/turn-undo.spec.ts e2e/format-tail-wire.spec.ts \
  --config /workspace/pr152-evidence/pr-browser.config.ts

# 新增 8 项；真实首页按钮下载
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/v10-save-reset.spec.ts \
  --config /workspace/pr152-evidence/v10-browser.config.ts

# 干净 main，仅比较相关手机场景（实际执行目录 /workspace/pr152-main-baseline）
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/npc-directory.spec.ts e2e/event-stages-v2.spec.ts --project mobile \
  --config /workspace/pr152-evidence/main-browser.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/npc-final-acceptance.spec.ts e2e/turn-undo.spec.ts \
  e2e/unreadable-saves.spec.ts e2e/world-handoff.spec.ts --project mobile \
  --config /workspace/pr152-evidence/main-more.config.ts

# 合规旧档样本真实性：PR 生成，干净 main 正式迁移器验证
PR152_OLD_SAMPLES=/workspace/pr152-evidence npx vitest run src/tests/save-backup.test.ts
# 切换到 /workspace/pr152-main-baseline 后：
npx vitest run /workspace/pr152-evidence/legacy-baseline.test.ts \
  --config /workspace/pr152-evidence/legacy-baseline.config.ts
```

最终 21 文件定向命令见 [COMMANDS.md](COMMANDS.md)。以上配置固定工作区是为了保留本轮真实运行环境；在其他机器可等价替换目录、端口与证据输出位置，不能把配置当产品代码。

验收结论仅覆盖列出的范围。27 个旧手机 E2E 定位问题仍须独立维护；本轮无新增已确认生产阻断，保留原 PR，等待十一代目与负责人最终复审，未经授权不合并。
