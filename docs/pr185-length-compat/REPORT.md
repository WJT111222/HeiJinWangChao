# PR #185：旧设置篇幅档位返修与 Node 24 验收

## 基线与范围

- 原 PR HEAD：`cf3e83ad74decb83a97ec6907daf9869641eaf79`。
- 实测 main：`7864c954b3290029b04b0f73aeac784ce749e615`，与任务锚点一致。
- 已完整阅读 Review `5942163799` 及行内评论 `4602366203`。
- 合入 main 的三条缺失提交，无冲突；合流只更新 README 的既有隐私/备份说明。
- 继续推送 `feat/narrative-length-tiers`，原 PR #185 保持 Draft、未合并。
- 本轮生产代码仅修改 `src/ui/settings/model.ts`、`src/ui/settings/SettingsPanel.tsx`。未更改 Prompt、续写、校验、公告、AI 请求、存档或事务逻辑。

## P2 根因与修复

原实现先经 `narrativeRange()` 推算缺失的上限，再按两个数字匹配预设；父组件也在传参前补上推算值，两处共同丢失“玩家从未保存上限”的信息。

现在保留 `maxNarrativeChars` 的 `undefined`，档位识别直接判为自定义。输入框单独推算显示建议上限，生成仍使用原有 `narrativeRange()` 与原公式。未编辑的旧设置打开、保存、关闭重开和刷新后都保持缺失字段及原最低字数；主动选择预设才明确保存两个数，手动编辑仍固定当前显示的上限。

| 原最低字数 | 显示/生成建议上限 | PC | 手机 | 打开/原样保存/重开/刷新 |
| --- | --- | --- | --- | --- |
| 1000 | 2000 | 自定义 | 自定义 | 最低字数和原始本地 JSON 不变 |
| 1500 | 2000 | 自定义 | 自定义 | 最低字数和原始本地 JSON 不变 |
| 4000 | 5000 | 自定义 | 自定义 | 最低字数和原始本地 JSON 不变 |
| 8000 | 10000 | 自定义 | 自定义 | 最低字数和原始本地 JSON 不变 |

无需新增字段、Schema 版本或数据库迁移。保留原有“自定义”会话选中语义：点击自定义或手动输入会保持本次编辑的自定义选中；若数字明确保存为预设组合，重开仍按两个已保存数字识别预设。此次不新增独立的持久化档位。

## 正式环境与命令

Node `v24.19.0`，npm `11.9.0`，Chromium `154.0.8037.57`，正式 Vitest `5.0.5` / Playwright `1.64.1`；使用锁文件真实依赖，未使用替代运行器。

命令使用 `npm_config_cache=/workspace/.npm npm ci`、`VITEST_MAX_WORKERS=2 npm run check`。限制并发不缩减测试集合。Playwright 使用原项目的 desktop/mobile 配置，仅隔离端口至 5195、单 worker，并指定 `/usr/bin/chromium`。配置副本包含在日志包。

| 批次/命令 | 结果 | 退出码 |
| --- | --- | --- |
| `npm ci` | 143 个包安装成功 | 0 |
| 首次 `npm run check` | Lint 通过；Vitest 4329 通过、12 失败，180 文件；因短路未执行 Build | 1 |
| `npm run build`（首次失败后单独补验） | 文件名、目录新鲜度、TypeScript、Vite Build 全部通过 | 0 |
| `npm run prompts:check` | 93 通过，0 失败/跳过 | 0 |
| 篇幅先红 | 9 通过、3 失败，1000/4000/8000 均错误识别预设 | 1 |
| 篇幅修复后 | 12 通过，含四组 Schema/推算/缺失字段/最低字数不变断言 | 0 |
| 浏览器先红：旧 1000 | PC/手机各 1 失败，实际 radio 为 unchecked | 1 |
| Chromium 篇幅定向 | PC 8 + 手机 8 = 16 通过，0 失败/跳过 | 0 |
| 首次测试适配后的完整 `check` | 4337 通过、4 失败：共享历史夹具影响请求尾部断言，已撤销共享夹具变更，改为本文件内固定旧设置 | 1 |
| 相关单测最终批次 | 175 通过，0 失败/跳过（五个测试文件，含真实出站 Mock 的 talent-wire） | 0 |
| 最终 `npm run check` | 4341 通过、0 失败/跳过，180 文件；Lint、TypeScript、目录检查、Vite Build 均通过 | 0 |
| `git diff --check` | 通过 | 0 |

93 项 Prompt 和定向单测属于完整 Vitest 的子集，不将不同批次重复相加。没有运行无关的全量 Chromium 套件。

## 首次 12 项失败的同环境归因与处理

相同 Node、依赖与 Mock，干净 main 的 `thinking.test.ts` 48/48、`m2.test.ts` 与 `talent-context.test.ts` 合计 110/110；返修前原 PR 同三个文件为 146 通过、12 失败，与本轮首次完整检查失败集合一致。因此它们来自原 #185，而非本次 P2 修复，也不能归为 main 既有失败。

1. `thinking.test.ts:90`、`m2.test.ts:339`：原断言要求七个设置字段，#185 原实现新增第八个字段。改为精确断言八个合法字段，保存恢复与其他业务断言完整保留。
2. `talent-context.test.ts` 10 项：历史快照使用 `defaultSettings()`，原 #185 增加默认上限使输入漂移。仅在 `talent-context.test.ts` 内显式使用七字段旧设置（不含上限）；恢复 Variables、World、Memory 的原始哈希断言，不重录它们。
3. 剩余两项 Story 快照：逐条消息对照 main，确认仅 `writing.min_length` 正文篇幅模块和末尾篇幅提醒改变，所有上下文相同，其他消息与模块相同。新增单独 Story 篇幅快照，保留原 PR-A JSON 证据不动，仍逐字节验证完整请求、上下文与模块；详细差异见日志包 `story-baseline-diff.txt`。

中间一轮尝试在共享夹具固定旧设置，导致 `talent-wire.test.ts:27` 四个 Story 出站断言失败；已撤销共享夹具修改，把旧输入限定在历史快照测试文件中，最终共享夹具与原 PR 完全相同。该轮日志也原样保留。

没有删除、跳过、放松安全断言或改动生产 Prompt 来制造通过。上述测试维护超出最初两个篇幅测试文件，但仅用于适配原 #185 已批准的可选设置与篇幅提示变化。

## 浏览器覆盖与截图

- 新玩家默认低；主动中/高保存刷新恢复，高档提醒；旧设置主动低保存刷新恢复。
- 任一数字编辑后自定义；倒置区间标红并拒绝保存；无效设置不写本地。
- 四组旧最低字数：自定义、显示建议上限、原始本地 JSON 不变、保存、关闭/重开、刷新。
- 旧设置改最低字数时上限固定，保存刷新仍正确。
- 外部请求全部拦截，不调用模型，不使用真实玩家存档/密钥。
- 截图为真实 React 原生设置 Dialog 内的篇幅区域。已检查手机 1000、桌面 8000：自定义选中、完整数值和说明可读。

[PC 1000](screenshots/desktop-legacy-1000.png) · [PC 4000](screenshots/desktop-legacy-4000.png) · [PC 8000](screenshots/desktop-legacy-8000.png)

[手机 1000](screenshots/mobile-legacy-1000.png) · [手机 4000](screenshots/mobile-legacy-4000.png) · [手机 8000](screenshots/mobile-legacy-8000.png)

截图目录另含 1500 对照。本次未重新进行四城视觉矩阵、真实 iOS Safari 或真实模型文学输出验证。Vite 保留大 chunk 提示（非失败），未借此扩展到打包优化。

## 本轮文件清单

- 生产：`src/ui/settings/model.ts`、`src/ui/settings/SettingsPanel.tsx`。
- 专项：`src/tests/narrative-length.test.ts`、`e2e/narrative-length.spec.ts`。
- 必要的原 PR 测试兼容：`src/tests/thinking.test.ts`、`src/tests/m2.test.ts`、`src/tests/talent-context.test.ts`、`src/tests/fixtures/talent-story-length-baseline.json`。
- 本报告、日志包与截图。README 仅是合入最新 main 的既有变化，不是本轮另写。

完整原始日志保留于 `/workspace/pr185-evidence`；可移交副本见本目录 `logs.zip`，先红的双端 trace 见 `red-traces.zip`。原开发记录、原 Review 和原 PR-A 字节快照均保留。

## 结论

本轮 P2 已修复，四组旧设置与双端交互验证通过；最终正式工程检查无剩余失败。先前两轮失败已按上文归因并修复必要测试兼容，不宣称它们原先通过。建议交十五代目重新审查。

保持 Draft、未合并；没有手动部署、生产公告发布或付费模型请求。最终 HEAD 记录在对应提交和 PR 验收评论中，等待十五代目复审。
