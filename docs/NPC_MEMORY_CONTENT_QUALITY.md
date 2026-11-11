# NPC 原始人物记忆内容质量优化

## 范围与基线

- 开工核对的远端 main：`8debc189bfcbdfade737b2871aa13c19958ea10e`（NPC V2 六批已合并）。独立分支：`feat/npc-memory-quality`。
- 只改未来新记忆的提示词、命令目录说明和测试。没有迁移、重写或补齐玩家旧记忆，没有修改领域执行器、GameState V9、数据库、总结算法、模型路由或请求策略。
- 参考源码：`MoRanJiangHu@74aa92722b1ea1304210393679328aed07476972` 的 `prompts/core/memory.ts`、`prompts/stats/npc.ts`，核对了人物记忆归属、来源连续性和有依据的再登场刷新。没有复制其字段树、建档阈值、记忆存储或总结后清理策略。六项内容维度和弹性篇幅来自本轮产品要求，不声称是参考项目原有算法。

## 修改文件

- `prompts/shared/07_command_output.md`、`prompts/shared/08_world_output.md`：两阶段共用写作标准、Variables 再登场刷新提示及详细示例。
- `prompts/variableGroups/npc_ordinary/init.md`、`update.md`；`prompts/variableGroups/npc_special/init.md`、`update.md`：引用共用规则、替换一句话示例。
- `prompts/manifest.json`、`prompts/sources.lock.json`：六个资源的当前元数据与追加来源记录。
- `src/executors/variableText/catalog.ts`：只增加规则说明字符串，不改变目录路径/Schema/编译行为。
- `src/tests/prompts.test.ts`：来源校验纳入本轮追加记录，保留旧哈希检查机制。
- `src/tests/npc-memory-quality.test.ts`、`src/tests/fixtures/npcMemoryQuality.ts`：最终消息、详细写入、个体认知、持久化及费用边界回归。
- `e2e/npc-memory-quality.spec.ts`：真实桌面/手机三阶段、刷新、人物记忆阅读与撤回。
- 本报告 `docs/NPC_MEMORY_CONTENT_QUALITY.md`。

## 实际加载路径与改动

`composePrompt(stage=variables)` → `composeTextVariablesPrompt()` → `selectPromptModules(text)`：实际加载的是 `shared.07_command_output.text` 指向的 `prompts/shared/07_command_output.md`，以及 `variableGroups.npc_ordinary/npc_special.*.text` 指向的四份 init/update 文件；没有修改或重新接入 `legacy/variables_json`。

`composePrompt(stage=world)` 继续加载 `shared.08_world_output`。完整内容质量规则各集中于 Variables、World 的共享输出协议，四份 NPC 模块只引用规则和给出具体命令示例，不各自复制整段要求。`textVariableCatalog().rules` 增加简短同义说明，正式路径与值 Schema 不变。

新规则要求按人物自身认知保留：事件背景、具体经过、本人表现、个人认知、已发生结果及未决问题、持续影响。不是逐项填表。40～100、100～200、150～300字只是弹性写作参考；简单事实可简短，重大经历必要时更长。没有新增 minLength、硬性字数审批、关键词过滤或补字机制。

普通/特殊人物完全同标；不强迫每回合写记忆，不机械拆分连续事件，不为同一经历重复写 memories 与 knownInformation。不同独立经历仍可分别保存。亲历/转述/推测与 visibility 保持原协议，不复制全知视角给每个人。

Variables 在重大变化或长时间离场后重逢时，考虑是否需同步刷新现有身份、位置、健康、关系、好感和特殊资料；只能依据选定 Story 或正式背景更新目录内原有字段，不凭空改变人物。

World 同样使用内容质量标准，但可记录自主推演的合法场外经历，不要求这些经历逐项出现在 Story 中。原场内保护、开局同伴保护、Variables 同轮写入边界均未扩大。

`manifest.json` 刷新六个资源的字符数、SHA-256；`sources.lock.json` 在每个相关资源下追加 `npcMemoryContentQuality`（含本轮基线、实际参考源码哈希和适配说明），保留全部旧来源记录。来源校验测试优先核验新增适配记录。

## 内容对照（虚构示例）

原引导：

> 共同处理现场问题。

新引导：

> 工作室交付旧相机时，委托方临时提出加急费用。自己核对清单并请主角保留凭据、暂不承诺；主角出示书面确认后，对方同意暂缓收费、次日核算。费用仍未确定，这次合作让自己愿意继续协助核实，但不会把暂缓当成免除。

另一条约定示例记录谁与谁约定了什么、具体待办、尚未确定的结果及未来承接，不再只有“记住共同作出的约定”。这些均为提示词示范，实际输出必须依据当轮信息，不要求复用此情节。

## 协议、执行与持久化验证

新增 `src/tests/npc-memory-quality.test.ts` 及完全合成的 `fixtures/npcMemoryQuality.ts`，验证：

1. 开局和普通回合经实际 `composePrompt()`、实际 Variables 域选择，最终 system messages 包含共同标准、六项维度、弹性长度和不补造事实要求；World 保留自主场外推演和原权限说明。
2. `parseTextVariables()` → 文本编译/候选模拟 → World 校验 → Repository 原子 Commit → 关闭并重开 IndexedDB：1987字符的多行亲历原文完整保留，没有新增截断或内容改写；另一次独立经历使用独立稳定记忆 ID 追加，旧记忆不变。
3. 转述、推测继续沿用既有 `[转述]` / `[推测]` 标记及 knowledgeKind、knowledgeSource、visibility；这些标记是原有行为，不是本次新增的改写。来源回合与所属人物引用正确。
4. 真实 `TurnCoordinator` → `AiClient` → Runtime → Mock transport → 候选 → Commit：在场普通人物的亲历、特殊人物的推测、离场人物收到的转述分属本人，仅调用 Story、Variables、World 各一次。
5. 两字简单事实仍可写入，不因篇幅不足被拒绝；World 不能用同一记忆命令接管现场人物。
6. 新增 Chromium 用例在正式 React 游戏界面验证发送、自动结算、原文阅读、刷新、原子撤回和输入回填，整个过程只有三次 Mock 请求。

既有统一记忆/上下文/Runtime 回归、完整 Vitest 及相关浏览器回归继续覆盖旧 V6/V7/V9 读取、可靠总结来源、休眠恢复、七项 privateProfile 字段、并发与 epoch/撤回安全。特殊人物 init/update 的私密档案提示块逐字未变，SHA-256 均为 `830d8711b84f461925e8cb12dfcb64bcee1b8343b932adf6403ed47bbe147e98`。

## 验证记录

最终结果见下表（不同批次分别列出，不相加）：

| 冻结后批次 | 实际结果 |
| --- | --- |
| `npm run check`：Lint → 完整 Vitest → TypeScript → Vite生产构建 | 全部通过；114个测试文件、2997通过 / 0失败 / 0跳过；Vitest 89.26秒 |
| `npm run prompts:check` | 3个测试文件、93通过 / 0失败 / 0跳过；1.95秒 |
| 相关 Chromium 最终完整批次（5个文件，桌面+手机） | 22通过 / 0失败 / 0跳过；desktop 11/0/0，mobile 11/0/0；不含历史初跑结果 |
| `git diff --check`、完整 Diff 自查 | 通过；14个文件，仅提示词/目录说明/元数据/测试/报告 |

Chromium 实际命令（无真实模型调用）：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/npc-memory-quality.spec.ts e2e/npc-unified-memory.spec.ts \
  e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts \
  e2e/npc-context-tiers.spec.ts --project=desktop --project=mobile
```

最终批次额外使用 `--reporter=list,json` 与 `PLAYWRIGHT_JSON_OUTPUT_FILE` 导出机器可核对的项目结果。未运行无关全量 Chromium。生产构建只有现有大于500kB资源包提示，没有构建失败。

开发过程中的失败与修正：最初新增用例尚无新规则，且误用仅限新游戏的 `create()` 种入已提交状态；改为向测试 fake-indexeddb 种入合法合成正式存档。随后修正测试对 Variables 域选择、原有推测/转述前缀以及 World 完整记忆命令格式的错误假设，没有修改生产校验。依次出现 0/4、0/4、0/4、3/4 通过的开发批次；修正后四个定向测试文件 52/52 通过。新增浏览器初跑 desktop/mobile 各 1/1 通过，提示词定向初跑 93/93 通过。

完整工程检查曾在未结束时主动中止一次：自查发现共用文案“正文没有的行动不补造”可能误限 World 场外自主推演，已在 World 文案明确其合法场外经历不要求 Story 逐项写出。中止批次没有完整结果，不算通过；下表为冻结此修正后的重新验收。

## 体量与剩余限制

共享规则替代四份模块的重复长说明：普通人物 init/update 各减少63字符，特殊人物 init/update 各增加34字符（示例展开）；Variables 公共模块增加1034字符。World 公共模块增加929字符（最终10266字符），可由 manifest 直接核对，未裁剪任何人物或记忆资料来抵消增长。

新记忆更完整会增加后续存档、完整撤回快照与 AI 输入成本；本轮没有调整总结门槛、召回、人物上下文或原有预算。文本协议原有单条8192字符上限仍在，未新增长度限制。压力用例的重复内容仅用于验证较长字符串不会被截断，不作为文学质量正例。

Mock 只能证明最终提示词已加载、详细文本可完整执行与持久化、原权限和事务兼容，不能证明真实模型一定生成理想内容/篇幅，也不能保证真实模型永不重复或虚构。真实模型的事件取舍、个体视角、信息密度与长线承接质量仍需后续单独授权验证。本轮零真实付费模型请求，没有自动重试或额外总结请求；没有改动玩家存档。
