# 开局 Variables：同伴资格与精确诊断修复

基线及交付前重新 fetch 的 main：`7e4cc22d8841f8449c3bdc0110620d22a2f51e23`。独立分支：`fix/opening-variables-npc-eligibility`。不依赖、不合入、不修改 #142 的模型参数兼容工作。

## 复现与修复

测试通过 `newCreation → createProfileSave → SaveRepository → 开局 TurnDraft → 正式文本解析/编译 → simulateVariablePlan` 创建隔离数据。初始同伴为 special、年龄25、正式文字资料明确为女性，但结构化 gender 缺失。前两条合法初始化后直接写专属档案，原领域执行器抛出 NPC_KIND；旧模拟器仅为时间错误定位，因而在玩家日志中退化为整批关联命令。

本次不修改创角存档，也不解析姓名、外貌或自然语言来自动填性别：

1. 在正式 Variables 的 npc_special init/update 指引中明确：只有所选 Story 或正式人物资料已有明确依据，才通过现有 `set npc[id].gender` 登记；先登记，再执行依赖资格的专属资料更新。没有依据则保持未知并省略该档案，不能为了通过资格改类型或年龄。
2. 原七个 privateProfile 字段和资格判断完全保留。未发生的初次经历字段省略，不能填 null 或编造。
3. 模拟器对于 CommandDataError 校验有效执行索引、唯一 commandId/类型及文本来源，再安全映射至原文本序号，返回从已验证命令取得的规范类型。保留原错误分类，不复制异常原文、命令值或 NPC 私密资料。程序注入命令没有文本来源、类型不符、越界索引及最终整体 Schema 错误继续保守报告相关命令集合。
4. 开局指引强调 lastInteractionAt 不晚于 Story.endAt，也不早于已有互动时间。不改时钟注入、时间推进或结算规则。

提示词清单更新三个运行资源的字符数/哈希；sources.lock 仅追加本次来源记录，原来源与旧哈希保留。来源测试继续验证完整字节哈希，没有放宽断言。

## 时间及原子性证据

固定 Story 起点 `2026-10-19T08:00:00+08:00`、结束 `08:45:00+08:00`。程序在人物更新前应用开局时钟：先合法登记 female，再更新档案并记录 08:45 的互动可完成原子提交、重载及幂等重放；08:46 的互动继续以 npc_interaction_time / UpdateNpc 精确拒绝。没有为迁就候选另行改时钟。

缺失性别、unknown、男性、未成年、普通人物及错误命令顺序均失败。合法年龄18、25及原规则允许的年龄未知保持原行为，没有放宽资格。三个初次经历字段的 null 仍在编译阶段严格拒绝，七字段合法形状仍接受。

真实 VariableStage 使用 Mock AiClient：只请求一次，模拟失败不保存变量候选，保留 Story，仅记录安全失败元数据，正式存档不变。另一测试故意在隔离库中绕过客户端模拟准备非法候选，Repository 的最终提交仍因真实 NPC_KIND 整批失败；正式资金、人物、时钟、revision、journal 与草稿均与提交前完全一致。

执行器原始命令序号采用1起算；AiError.details 沿用0起算；玩家运行日志恢复为1起算。测试分别核对三层索引，未更改既有约定。

## 先红后绿与正式检查

Node.js **v24.19.0**、npm **11.9.0**。正式项目依赖、Vitest，无垫片，无真实模型调用。

| 检查 | 实际结果 |
| --- | --- |
| 最终27项新增测试，生产文件换回未修改 main 同条件对照 | **10失败、17通过**；8项命令精确定位及2项提示词缺口，退出1 |
| 相同27项最终测试，应用修复 | **27通过、0失败、0跳过** |
| 相关回归16文件 | **481通过**，包括此前25项新增测试与456项既有测试；新增最终扩为27项后单独重跑，避免重复计数 |
| `npm run prompts:check` | **93通过，3文件，0失败** |
| `npm run lint` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，含TypeScript；仅既有大块体积提醒 |
| `git diff --check` | 通过 |

因此本轮去重后验证了 **483项相关测试（456既有 + 27新增）及93项提示词检查**；这不表示全项目或浏览器全量通过。本次没有 UI 变化，没有运行 Chromium、完整 `npm run check` 或全量 E2E。

新增27项覆盖：真实创角缺失性别；安全日志；三种合法年龄；原子提交/重载/重放；真实阶段失败；最终提交防护；无依据保持未知；unknown/男性/未成年；普通NPC；错误顺序；三种 null；原七字段；未来互动时间；整体Schema；五种不可安全定位的异常元数据；开局及普通回合正式 Composer。

完整命令和退出码：[首轮相关检查](validation-results.json)、[最终检查](final-validation-results.json)。原始 stdout/stderr 无损 gzip 保存，使用 `gzip -dc <file>` 查看，压缩前哈希见 [logs/sha256.json](logs/sha256.json)：

- [红色 main 对照](logs/red-complete.log.gz)、[最终27项绿色](logs/final-new-vitest.log.gz)、[481项相关回归](logs/related-vitest.log.gz)。
- [提示词检查](logs/final-prompts-check.log.gz)、[Lint](logs/final-lint.log.gz)、[TypeScript](logs/final-typecheck.log.gz)、[Build](logs/final-build.log.gz)。
- [环境版本](logs/environment.log.gz)、[正式npm ci成功](logs/npm-ci-retry.log.gz)、[差异检查](logs/final-diff-check.log.gz)。

复现新增测试：

```bash
node --version
npm ci
npx vitest run src/tests/opening-npc-eligibility.test.ts
npm run prompts:check
npm run lint
npm run typecheck
npm run build
git diff --check
```

红色对照在本分支临时恢复 main 的执行器及三份提示词/清单，仅运行同一份最终新增测试；完成后原样恢复修复内容。没有修改其他工作树或玩家数据。

## 失败及修正记录

- 初次 npm ci 使用默认 `/home/agent/.npm`，因缓存目录不可写失败（ENOENT）。改用工作区内可写 npm cache 后，正式 npm ci 成功安装143包；未更改依赖或使用替代包。
- 首次提示词检查92通过/1失败，因旧来源哈希仍指向修订前资源。追加本次来源记录并沿用原完整哈希断言后93全部通过，原失败日志保留：[日志](logs/prompts-check.log.gz)。
- 测试开发时纠正了普通回合 Composer 夹具（必须先完成开局）、日志层的1起算约定，以及 Repository 将原领域错误封装为 data_integrity 的既有约定。最终提交测试同时确认底层真实抛出 NPC_KIND，未修改生产接口来迎合测试。

## 文件与边界

- `src/executors/variableText/index.ts`：唯一执行代码修改，仅安全诊断归因。
- `prompts/variableGroups/npc_special/init.md`、`update.md`：有据登记性别、先后顺序、未知与未发生字段边界。
- `prompts/stages/opening/variables.md`：互动时间与 Story 开局时钟的既有约束指引。
- `prompts/manifest.json`、`prompts/sources.lock.json`：资源元数据与追加来源。
- `src/tests/opening-npc-eligibility.test.ts`：27项真实链路回归。
- `src/tests/prompts.test.ts`：在既有最新来源列表加入本次来源键，保留完整哈希等值断言。
- `docs/opening-variables-npc-eligibility/`：报告及原始日志。

未修改 GameState/NPC/IndexedDB Schema、创角 UI、玩家存档、七字段定义、资格限制、领域规则、命令执行顺序、原子结算、撤回、请求参数、模型路由、自动重试或World校验。没有静默清洗或重写非法候选。

所有响应均为手工 Mock；未用付费模型验证遵循率。未知性别直接写入仍会被严格拒绝，现有失败草稿不会自动修复或自动重发。新指引仅作用于之后明确启动的 Variables 请求。保持独立 Draft PR，未合并、部署或发布。
