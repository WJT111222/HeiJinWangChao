# Story 正文失败原因精确诊断

## 基线与范围

从最新 `main@3e066a1240b1a79ec334854bfd98d748b013cea3`（已合并 PR #61）创建 `codex/story-failure-diagnostics`。

本次仅增加失败位置、子类型与安全中文提示。未修改 Story 正则成功条件、最低字数设置、Story/GameState/TurnDraft Schema、Prompt、模型请求、重试策略、Variables、World 或原子结算规则。运行代码冻结提交为 `a3ef18a551d075e0d39a6c5f95a59ee7d5e1f84c`。

## 原有问题与实际复现

原 `parseStoryEnvelope()` 将标签、空规划、空记忆、字数和行动选项等失败压成 `invalid_output`；变量规划 JSON 虽有 `invalid_json`，却无法定位到区块；Schema 失败没有字段和序号。Runtime 又把事件回执概括为 `event_entry`、时间错误概括为 `time_data`。

另外，Runtime 在返回规范化 Story 后已将临时响应标记为 `validated`；StoryStage 随后的响应版本、凭证检测或候选保存失败，未同步这个临时状态。因此原文面板可能仍显示规范化结果而没有真正的后置失败原因。

先添加 18 项解析回归：旧代码 17 失败、1 合法样例通过，失败均因缺少错误定位字段。补充到 54 项诊断单元／集成测试后全部通过。开发中顺序测试最初将错误标签预期为“正文”；实际提前放置的是“短期记忆”，测试改为精确指认该错序标签，拒绝断言保留。

最终共享入口审阅发现 `storyError()` 也用于 World：新增回归复现 Story 兜底可能覆盖 World 的 `invalid_output`。修复为只有明确的 Story 请求／日志才使用结构兜底，共享展示保留原错误，World 子类型不受影响；定向 156 项复测通过。随后重新运行完整工程和相关浏览器批次，修正前的 2229 项工程／58 项浏览器成绩不作为最终结果。

## 诊断数据流

```text
原有 Story 请求
  → 原有完整标签正则／空内容／字数／选项／JSON／StorySchema
  → 原有事件回执校验／timeOutcome
  → 原有请求版本／凭证检测／草稿 CAS 保存
失败分支追加有限诊断
  → AiError 原错误码 + storyRule／白名单元数据
  → 当前错误提示 + 临时运行日志（单条复制）+ 临时模型原文面板
```

保留原有 `invalid_output`、`invalid_json`、`time_data`、`event_entry` 等父错误码，不用改码掩盖原因。StoryStage 的 `DRAFT_CONFLICT`、`REVISION_CONFLICT` 仍抛出原 DataError，运行日志也保留原代码，仅展示时附加 `draft_conflict`，避免改变协调器、重试或事务控制流。

## 具体定位

| 原有失败位置 | 新的安全定位 |
| --- | --- |
| 必需标签缺失、未闭合、错序 | `tag_missing` / `tag_unclosed` / `tag_order` + 固定标签名称 |
| 已有保留标签嵌套／重复、关闭选项后额外输出选项 | `tag_nested` / `tag_unexpected` |
| 无法从原有结构失败确定标签问题 | `structure_unrecognized`，明确提示检查临时模型原文 |
| 空 thinking、空短期记忆 | `planning_empty` / `summary_empty` |
| 正文长度不足 | `narrative_short` + actualCount / minimumCount；沿用“去空白后 Unicode 字符数”统计 |
| 选项数量 | `actions_count` + 实际条数和原有 3～5 边界 |
| 变量规划 JSON / Schema | `guide_json` / `story_schema` + 白名单字段路径、guideIndex、Schema 问题类型 |
| 待定开局 | 区分上下文不符、混用协议、缺失／重复、JSON、字段／日历、+08:00 时区、结束早于开始、年份 |
| 事件入场回执 | 区分遗漏、重复、错误变量组、无效／过期引用、已关闭、重复呈现、说明为空和非法 action |
| 普通回合时间／历史视角 | 按既有程序异常的固定消息映射到对应子类型；不扫描小说或玩家文字，不增加检查 |
| 响应版本、草稿 CAS | `request_basis` / `draft_conflict` |
| 原有凭证检测 | `credential_output`，不回显凭证 |

`guideIndex` 和字段路径中的数组索引从 0 开始；中文“第 N 项”从 1 开始。一次报告原有执行顺序中首个失败分支／首个 Zod issue，不伪称已遍历所有错误。未知字段名不进入日志，使用安全父路径和“不支持的字段”说明。

## 校验保持不变的方式

- 完整标签正则原样保留；只有正则拒绝后才进行标签错误定位。
- 保留标签嵌套检测使用同一正则，只返回匹配到的固定标签名。
- 空规划、`assessSummary`、字数、3～5 选项及 `StorySchema` 的谓词和顺序保持不变。
- `openingTimeSelection` 与 `validateStoryEventInteractions` 的原条件、DataError 代码和消息保留；`requireStoryData` 是原有真假判断的带诊断标记版本，不是第二套校验器。这样能在真实失败处标注时间／回执原因，不另写一套推测逻辑。
- 普通时间诊断仅匹配现有 DataError 的固定程序消息；未知消息使用安全的时间预检提示，不回显原异常。没有修改 `timePreflight.ts`。
- 响应版本比较、凭证检测、StageGuard、CAS、保存及自动结算均保留。后置失败仅同步同一个 response ID 的临时失败状态，并移除其临时规范化展示，避免将未接受的结果展示成验收成功。

## 安全与生命周期

诊断只允许固定 rule/tag/Schema 问题类型、白名单路径、非负有限整数计数与索引，不包含模型正文、JSON 非法值、NPC ID、供应商响应、URL 或密钥。错误构造及日志出口均有白名单过滤。现有原文面板仍按原规则展示完整且凭证已脱敏的临时响应。

诊断不写进 Story、journal 或正式世界；不增加存档字段。刷新会清除临时诊断与原文，既有草稿失败记录仍只保存原错误码。读取、复制、查看不会发起请求。原有“只检测准备写入 Story 的凭证、临时原文脱敏”边界不扩大。

## 修改文件

- `src/domain/storyDiagnostics.ts`：有限诊断类型、中文说明、白名单与带元数据的 DataError。
- `src/domain/openingTime.ts`、`src/domain/events/interactions.ts`：在既有条件失败处标记原因。
- `src/services/validation/storyDiagnostics.ts`：失败标签定位、Schema 路径提取、Story 错误展示适配。
- `src/services/validation/aiOutputs.ts`：Story 原有拒绝分支附加诊断。
- `src/services/ai/errors.ts`：复用错误码，格式化并过滤 Story 元数据。
- `src/services/ai/runtime.ts`：保留回执／时间具体原因。
- `src/workflows/storyStage.ts`：后置版本、凭证及保存失败同步临时原文面板。
- `src/ui/game/runtimeLog.ts`、`RuntimeLogPanel.tsx`、`StageResponsesPanel.tsx`：显示与复制安全失败子类型。
- `src/tests/story-diagnostics.test.ts`、`story-diagnostics-runtime.test.ts`：54 项新增测试。
- `e2e/story-runtime.spec.ts`：4 个新增场景，各跑 desktop/mobile；保留全部已有断言。
- `STORY-FAILURE-DIAGNOSTICS-DEVELOPMENT.md`：审计、边界与验收记录。

## 实测结果

| 命令／范围 | 最终实际结果 |
| --- | --- |
| `npm run check` | 71 个文件，2230/2230 工程测试通过（原有 2176 + 新增 54）；Lint、TypeScript、生产构建通过 |
| `npm run prompts:check` | 3 个文件，82/82 通过，属于上述工程测试子集，不重复累加 |
| 修复共享入口后的定向回归 | 6 个文件，156/156 通过，随后又被完整工程检查覆盖 |
| 最终 Chromium desktop | 29 通过，0 失败，0 跳过 |
| 最终 Chromium mobile | 29 通过，0 失败，0 跳过 |
| 浏览器最终批次 | 58/58 通过，约 3.4 分钟；其中 8 项新增、50 项既有回归 |
| `git diff --check` | 通过 |

最终浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-runtime.spec.ts e2e/story-reading.spec.ts e2e/automatic-settlement.spec.ts e2e/game-window.spec.ts --project=desktop --project=mobile
```

只运行本轮受影响的浏览器文件，没有将其描述为全仓库 E2E。覆盖精确诊断、复制、后置凭证／CAS 失败、原文、刷新、Roll、取消、自动结算、World 错误恢复及正文气泡兼容。修正共享入口后重新运行最终批次，未复用此前通过数量。运行代码与测试随后未改动，最后一笔提交只补充本报告。构建仍有既有的 >500 kB 分块提示，本轮未扩大为构建优化。

所有模型响应为 Mock，包含真实 Composer、AiClient SSE 解析、StoryStage、fake-indexeddb 保存及浏览器 IndexedDB 链路。测试核对合法结果仍成功、失败保持草稿和正式存档不变、每次显式执行一次请求、刷新不补发，以及原文中的密钥不会进入面板、日志或复制内容。

没有真实模型请求，无法声称复现用户任何未提供原文的历史故障。多个同时存在的问题按原有校验顺序报告首个；未知结构提供明确的无法识别提示。没有新增自动修复或付费重试。实体手机、Safari/Firefox 不在本轮验证范围。

保持 Draft，等待六代目复审；不合并、不主动部署、不修改玩家正式存档。
