# 八大开局天赋 V2：最终集成技术报告

本集成仅供验收，**禁止直接合并**。不合并 #170/#172/#174，不推送 main，不部署正式 Worker，不更新公告或 KV。

本文记录集成方法、源码核验、前置实测、风险与安全合并方案。本文及所有源码将先冻结为最终提交，之后执行同 HEAD 正式验收；**最终 HEAD、最终命令成绩及原始输出统一发布在集成 PR 正文**。下列前置成绩不能冒充冻结后成绩，也不与之累计。

## 1. 权威基线与提交关系

2026-11-16 开始时重新 fetch，main 为 `4ccf92d205cc9b1d748c49c5b647eb755de3a019`。过程中检测到 #173 被外部正式 Squash Merge，main 更新为 **`377686834589c7d63b29fea6beb48278b27ab5e9`**，已再次同步。不是本任务合并 #173。

| 批次 | 原 PR / 分支 | 实测 HEAD | 原父提交 / 基线 |
| --- | --- | --- | --- |
| A 数据 | #170 / feat/opening-talents-data | `5dc8d448ed7c8a49c6002cb1ecddc19f897cfbec` | `f36bc51aede49e4ac6edf9a0bda2138905f007c7` |
| B 三阶段 | #172 / feat/opening-talents-ai | `9de3351739aa0335ee4f1fe04d5b783167fa435b` | A 的上述 HEAD |
| C UI | #174 / feat/opening-talents-ui | `5006240b6dd9d8c71eb2d99f0dc67a2e42abb12d` | B 的上述 HEAD |

A/B/C 均仍 Draft，原分支不写入。读取了 #170 review-5920025539、#172 review-5920765108、#174 review-5921544555；三份审查均认可对应固定 HEAD，没有给出提前合并授权。

独立工作树 `/workspace/opening-talents-integration`，分支 `integration/opening-talents-v2`。先从 main 创建，再逐项 `cherry-pick --no-commit <源提交>`、独立提交，只应用 A、B、C 各自相对直接父提交的增量，而不是重复合并累计快照。三项新提交依次为 `ce0edff`、`3ecea83`、`0d1f15f`；来源 SHA 记入各提交说明。三个完整 binary/full-index patch 的 SHA-256 与原增量**逐字节一致**，见 [integration-map.json](integration-map.json)。之后的 main 同步只在集成分支执行本地 merge。两次整合均无冲突，无手工覆盖旧功能。

准备阶段曾把本地重放命令误落在 #173 工作树；未推送，已恢复到原 `ef98ed5` 并验证干净，再于本工作树重新应用。没有改动原三条开发分支或其 PR，没有改动生产 main 或玩家数据。

## 2. 完整文件边界

[完整文件清单](modified-files.tsv) / [生产代码差异](production-diff.patch.gz)。原 A/B/C 合计 120 个变更文件中，生产仅以下 **14 个**；其余是已审测试、夹具、报告和证据：

| 职责 | 文件 |
| --- | --- |
| A 固定目录与可选身份 | `src/domain/protagonist/talents.ts`、`src/domain/protagonist/schema.ts`、`src/ui/creation/model.ts` |
| B 条件政策与装配 | `src/prompts/talentContext.ts`、`src/prompts/sharedContext.ts`、`src/prompts/composer.ts` |
| C 双端展示 | `TalentPicker.tsx`、`TalentProfile.tsx`、`talents.css`、`CreationWizard.tsx`、`DesktopCreation.tsx`、`MobileCreation.tsx`、`ProfilePanel.tsx`、`GameScreen.tsx` |

本轮新增的只是 `talent-integration.test.ts`、测试辅助 `fixtures/talentWire.ts`、最新 main Golden `fixtures/talent-main-baseline.json`、独立 Playwright 配置及本报告证据。**没有追加生产修复，也没有开发第四批能力。**

验证 `src/domain/state.ts`、`drafts.ts`、`turnCommit.ts`、整个 `services/storage`、`workflows`、`services/ai`、命令定义、原始 `prompts/`、`src/app/styles.css`、`day-appearance.css`、`mobile-feedback.css`、`wrangler.jsonc` 等均与最新 main 相同。完整源码摘要见 [source-sha256.json](source-sha256.json)，供最终同 HEAD 运行后再次核对。

## 3. 数据、旧档、权限与事务

- `ProtagonistSchema` 的 `talentId` 仅为固定 ID 的可选字段（schema.ts:18）；Creation 同样可选（model.ts:63），只有明确选择才建档映射（model.ts:238）。不选择则无字段，不生成默认/null/none，不推断职业、性别或姓名。
- 正式状态仍 **V10**，IndexedDB 仍 **v4**，创角草稿和开局包仍 v1；未改备份协议和迁移策略。旧 V10 无天赋可以读取、继续回合、刷新及备份恢复。V6–V9 维持主干原有不支持政策，没有偷偷恢复或破坏性迁移。
- `talents-compatibility.test.ts` 对无天赋及全部八 ID 验证建档、职业切换、开局包保存/套用、备份序列化校验→确认导入→数据库关闭重开、两轮正式提交/重放/撤回。旧包完整覆盖后恢复无字段，未残留上一表单天赋。
- `talents-command-boundary.test.ts` 保留单字段/整体主角替换、push/delete、开局初始化、装备旁路和 World 三数组攻击。未把 talentId 加入任何 AI 命令白名单；合法命令前缀夹带非法修改时，五仓库原始数据不变，没有部分提交。
- `talent-workflow.test.ts` 通过真实 Coordinator→Runtime→Mock→候选→Repository，覆盖八条链、单次原子 Commit/幂等、普通回合撤回、CAS 冲突、IDB 写失败、取消及迟到结果。开局回合仍不可撤回。原 pr158/rebind、turn-commit/coordinator/undo 测试纳入定向与完整回归，互斥、费用及失败恢复实现未改。

**兼容边界**：新版读取旧 V10；不承诺旧版严格 Schema 客户端能读取新增 talentId 的 V10 存档。旧程序遇到新字段的反向兼容限制原 A 已明确，不能宣传为双向兼容。上线前应提醒更新页面，不擅自清洗字段或覆盖存档。

## 4. 真实三阶段请求对照

独立干净 main 工作树中，以相同合成 fixture 实际运行 Composer/Runtime/四协议客户端 Mock，采集最新 main 的完整请求 URL、方法、完整 JSON 请求体摘要与字符数、规范化 messages 摘要。并记录开局/普通三阶段的完整 messages/context/modules，以及三类 Memory 的摘要。不是只比一个孤立的天赋字符串。

本轮分别实测 `4ccf92d` 与新 `3776868`；两份 main Golden 的内容摘要一致，元数据基线随真实执行更新。辅助采集脚本仅临时放入独立 main 测试目录，采集完删除，tracked 源码始终不变、最后工作树干净。采集方法见本目录 `*-capture*.txt`；安全 fixture 为仓库已有 `talentPromptInput`，不读取玩家剧情或凭证。

新增 `talent-integration.test.ts` 在集成上检查：

- 四协议 × 三阶段 × 开局/普通 **24 个完整请求体**与新 main 相同，各只有 1 次请求，未改输入。它们属于 4 个循环测试，不冒称 24 个独立测试。
- 无天赋六组完整 prompt/messages/context/modules 不变，没有 PROTAGONIST_TALENT。
- 三类 Memory 对无天赋与八 ID 均保持新 main 原字节，不增加天赋政策或新的 Memory 请求。

原 B 的 context/wire/workflow 测试继续验证：所选一项的四段完整定义、只有本阶段规则、无其他七项全文；原 Prompt 协议和格式尾不变。八项差异保持为：地下人才、AI 软件/数字技术、商业资本、机构决策权、公众传播、实体工程、战术协同、玩家主动重大押注的逆转机会。

Story 不替玩家接纳/投资/任职/押注；Variables 只提交 Story 已成立事实；World 保留 NPC 动机、资源与认知边界。绝命赌徒四项条件仍为模型上下文，不新增概率判定器、不自动下注、不虚构财富/忠诚/设备/研究。正常生成仍三个请求、一次正式 Commit，幂等重放不新增请求。

**证明范围**：Mock 只证明出站契约、解析、权限与保存链路；八条差异结果由测试人工编写，不能证明真实模型一定生成理想内容。选中天赋会增加输入字符及潜在 Token 成本，不能把“无新增请求”写成“无新增成本”。本轮未调用真实付费模型。

## 5. 双端 UI 与 #171 / #173

原生 9 个 radio（八选一＋不选），保持五步顺序；选择、切换、取消回焦、方向键、触控、刷新草稿、职业手动技能、背景、城市与同伴、第五步核对和正式建档均进入真实 React 测试。四段目录不复制：介绍/长期影响完整显示，机制/边界展开。正式档案无编辑回调，raw Repository/草稿前后相同、零模型 POST；无 ID 不显示假天赋。

前置双端测试覆盖 PC 901×500、1100×580、1440×900、项目默认 1440×1000；手机 375×667、390×844、430×932、900×600、项目默认 Pixel 7 412×839。检查了内部滚动、底栏可达、44px 触控、Esc、焦点、无横向溢出和无长文截断。

前置实测 48 个 computed style 样本：创角文字 **14.80:1**、强调标签 **10.62:1**；正式纸色档案正文 **12.91:1**、标签/展开 **5.91:1**、只读标识 **6.20:1**。天赋卡是既有深色创角桌与暖纸档案各自不透明实色；测量器遇到渐变、透明合成或父级 opacity/filter 会拒绝伪造结果。[逐样本数据](contrast.json)。未把 Chromium 手机视口当成真机。

- **#171**：`day-appearance.css` 与最新 main 逐字节一致；复跑 day-appearance 和 day-dialog-contrast，包括手机主按钮、PC 失败正文与标签、日夜切换和原结算回调。
- **#173**：开始时未合并，因此首轮未引入；检测到其正式进入 main 后才本地同步。现在 `mobile-feedback.css` 与 `mobile-select-sheet.spec.ts` 和新 main 逐字节一致，最终矩阵额外包含它的两条手机选择抽屉测试。天赋选择是局部原生 radio，不使用模型列表抽屉，没有重构设置入口。

## 6. 前置实测、失败归因与最终执行入口

环境 Node **24.19.0** / npm **11.9.0** / Chromium **154.0.8037.57**，正式锁文件安装、真实运行器，无垫片。

以下均为前置源码 `25a8a339901c21adff14c64996bd5d9bcf740d13`（main=4ccf92d）上的实际记录：

| 批次 | 实际结果 | 退出码 |
| --- | --- | ---: |
| npm ci | 成功 | 0 |
| 首次受限 npm run check | 172 文件通过、2 文件失败；4182 单测通过、11 失败，公告 suite 收集失败；Build 未执行 | 1 |
| 允许本地子进程后 npm run check | **174 文件 / 4212 单测通过**，Lint / 目录 / catalog / TS / Build 通过 | 0 |
| Prompt 检查 | **93通过** | 0 |
| 初次定向 9 文件 | 221通过 | 0 |
| 最终定向 13 文件 | **307通过** | 0 |
| 前置 PC/手机 Chromium | **28通过、0失败/跳过** | 0 |

221、307、93 是完整单测的重叠子集，不加总；28 Chromium 为独立浏览器批次。原始记录见 [preflight-evidence.tar.gz](preflight-evidence.tar.gz)。

首次失败没有改代码掩盖：公告本地假 Wrangler/Git 演练在 `execFileSync('sh',...)` 收集时遭 EPERM；文件名 CLI 11 项遭 `spawnSync node/git EPERM`。未修改的 main@4ccf92d 同环境定向复现相同两类错误（公告无用例执行、文件名11失败），允许本地子进程后完整4212通过。测试仅操作临时本地 Git/KV 文件，不连接 Cloudflare。没有删除、skip、弱化断言或增加自动重试。

同步 #173、更新最新 Golden、纳入 #173 的手机用例后，将**本报告与源码一起冻结**，再在同一最终 HEAD 执行：

```sh
node --version
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/talent-integration.test.ts src/tests/talents-catalog.test.ts \
  src/tests/talents-command-boundary.test.ts src/tests/talents-compatibility.test.ts \
  src/tests/talent-context.test.ts src/tests/talent-wire.test.ts src/tests/talent-workflow.test.ts \
  src/tests/talent-ui.test.tsx src/tests/turn-undo.test.ts src/tests/turn-commit.test.ts \
  src/tests/turn-coordinator.test.ts src/tests/pr158-rebind-acceptance.test.ts \
  src/tests/rebind-after-story-stop.test.ts
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  --config=playwright.talent-integration.config.ts --reporter=list,json
git diff --check
```

最终结果、各命令退出码与原始输出在 PR 正文。专用端口5189且禁止复用其他工作树服务器；最终配置只选五个相关 spec，不运行约700项全量 E2E。手机专属选择抽屉用例原有 desktop skip 应明确单列，不算通过。

## 7. 图片与证据

[全部图片摘要](screenshots.json)，前置截图均来自本次集成 React App，不复用原 C 图片冒充新执行：

- 第二步：[PC](screenshots/desktop-selection-cyber.png) / [手机](screenshots/mobile-selection-cyber.png)
- 第五步：[PC](screenshots/desktop-confirmation.png) / [手机完整车票](screenshots/mobile-confirmation-ticket.png)
- 矮屏：[901×500](screenshots/desktop-short-901x500.png) / [375×667](screenshots/mobile-short-375x667.png)
- 正式档案：[PC日间](screenshots/desktop-profile-day.png) / [手机日间](screenshots/mobile-profile-day.png) / [PC夜间](screenshots/desktop-profile-night.png) / [手机夜间](screenshots/mobile-profile-night.png)
- #171：[手机主操作](screenshots/mobile-workflow-day-primary.png) / [PC失败](screenshots/desktop-workflow-day-failure.png)

最终冻结 HEAD 将重新产出截图，核对与这些目标图片的像素文件摘要是否一致；同样结果不重复累计。原 character-creation 测试写出的旧证据路径已恢复，未把历史图片改动混入集成。

## 8. 后续 A→B→C 安全合并方案（仅方案，本轮不执行）

1. 作者逐批明确授权后，再读取当时 main、各 PR HEAD/审查与检查。若与本次固定源码不同，先评估差异，不能把本结论迁移给未经审查的新代码。
2. A 相对 f36 的精确增量在最新 main 验证后，才由作者决定 Squash Merge。记录真实 squash SHA 和 tree，不能把原 A SHA 当成已进入主干的父关系。
3. B 必须重新计算 **A原HEAD→B原HEAD** 的增量，在含 A squash 的新 main 上应用，而不是只改 base 或把旧 A/B 祖先整批合入。可在安全副本 `cherry-pick --no-commit B原HEAD` 后核对完整 patch/tree；确认只有 B 三个生产文件及其测试证据。更新原 B 分支前需另行授权与精确 lease，不能本轮擅自重写。
4. B 合入后记录其真实 squash SHA；C 同理只应用 **B原HEAD→C原HEAD** 的增量，保留届时主干 UI（尤其 GameScreen.tsx）与 #171/#173。重算 PR 差异，不能把 A/B 重复引入 C。
5. 每次重新基线后运行对应数据/权限、完整请求、创角与档案定向回归；如三阶段 Prompt 或协议变化，重新采集无天赋最新 main Golden。最终合流再核对普通旧 V10、CAS/Undo 与日夜界面。
6. **本集成 PR 不作为合并入口**，也不授权一次性合并三批。作者未来若批准，应使用审查过的分批增量。上线、生产部署、公告/KV 均需另外明确授权。

## 9. 已知边界与人工决策

- 尚无真实收费模型效果、胜率、长期叙事质量或费用/缓存命中率验证；不编造这些结论，也不为验收新增请求。
- 没有真实 Windows、iPhone/Safari 或 WebKit 测试环境；本轮是 Linux Chromium 双端视口，不声称实机通过。
- 新含 ID 的 V10 不保证旧客户端反向读取；主干既有大于500kB chunk 的构建提示保留，不借机重构。
- PR #173 已记录的 `ai-settings.spec.ts:66` 旧模块名断言债务不在本轮矩阵内；不拿旧报告代替本轮复现，不修改其 Prompt/断言。本轮新增失败均有独立 main 同环境证据。

最终是否达到「可提交最终人工合并决策」，只由集成 PR 正文的最终固定 HEAD 实测结论回答 A 或 B；无任何自动合并、部署或公告动作。

证据打包记录：统一 diff 文件的空行上下文自带空格，直接作为文本提交会触发 `git diff --check`。已改用 gzip 原样保存生产差异，没有修改源代码或削弱差异检查；最终同时检查工作树和 main→HEAD 的完整已提交差异。
