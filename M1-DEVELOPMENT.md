# M1 领域与存档交付说明

本阶段从 `origin/main` 的 `cc9feb1` 创建 `codex/m1-domain-storage`。正式设计文档及根目录 `prompts/` 未修改；页面和 AI 模块未接入新逻辑。

## 数据模型

领域使用 Zod 4 严格对象 Schema，TypeScript 类型直接从 Schema 推导。未知字段被拒绝；入库和读回均验证结构及引用。

| 模块 | 确定的数据结构 |
| --- | --- |
| `protagonist/schema.ts` | 人物资料、职业、自由背景、文字技能、健康/情绪、社会/法律状态、地点、当前装备及车辆引用；无传统 RPG 数值 |
| `npc/schema.ts` | 普通 NPC 保存稳定身份键、别名、身份、地点、在场状态、好感度、关系文字、记忆与知晓来源；特殊 NPC 独立增加深入背景、目标、习惯、长期记忆及任务 ID |
| `items/schema.ts` | 重要物品实体、类别、数量、归属、地点、状态；服装/饰品/武器使用槽位引用；车辆及房产仅在资产表保存 |
| `economy/schema.ts` | 现金、线上资金、收入、债务、房产、车辆、其他资产七组；收入/债务/资产均有独立明细，不由资产估值增加余额 |
| `organizations/schema.ts` | gang / government / civil / business 四个独立严格对象与判别联合；只共享身份、关系文字/历史、关键成员和任务引用，不强迫官方机构具有资金或地盘 |
| `events/schema.ts` | 事件含唯一 ID、时间、状态、参与者、可见性、影响等级、条件、任务关联与结案记录；任务含归属、目标、时间、条件、阻碍和状态；时间轴仅预留可验证的重大结案事件引用 |
| `memories/schema.ts` | 记忆条目、来源回合、可见性、NPC 知晓来源和分层容器；仅数据结构，无压缩/检索算法 |

`GameState` 组合完整正式快照，包含 `schemaVersion=2`、`revision`、独立游戏时钟、场景描述、人物、物品、资产、组织、地点、事件/任务、记忆、时间轴、永久正文及已应用命令凭据。`turnNumber` 必须与永久正文数量一致；M1 数据操作不冒充完成了一个游戏回合。

所有金额（包括余额、收入、本金、估值）统一使用**人民币分的非负安全整数**。`10000` 表示 100 元；UI 和后续模型适配器负责显式转换。未知余额/金额/估值为 `null`，不擅自初始化为零。`outstanding` 表示未偿本金，不自动推算利息；约定保存在 `repaymentTerms`。

实体 ID 在每个存档的实体表中全局唯一，不同存档可以复用。`identityKey` 是人物稳定身份，由调用方在确认同一人后复用；别名不会自动新建人物。本阶段不实现根据自然语言姓名推断身份。地点仅保存明确传入的节点，不加载全国地理数据库。

## 正式提交与事务

`SaveRepository.open()` 默认使用浏览器原生 IndexedDB，也可注入 M0 已使用的 `fake-indexeddb` 工厂进行测试。数据库结构版本为 1，两个 object store：

- `saves`：每个 `saveId` 一份完整正式快照，唯一可信来源。
- `drafts`：每个 `saveId` 一份当前草稿；与正式状态分开保存。

`create` / `load` / `list` / `save` / `delete` 提供多存档基本操作。`load` 返回校验后的独立对象，修改它不会自动写回。`save(saveId, expectedRevision, turnId, commands)` 是正式状态变更入口，不提供任意快照覆盖接口。

每次 `save` 在一个 `readwrite` 事务中读取数据库最新快照，比较 `revision`，应用已批准的命令批次，校验整个候选快照，再整体写入。只有 IndexedDB `oncomplete` 才返回成功；任何异常或事务中止都会回滚。多个对象及幂等凭据同属于一份快照，无法出现资金写入但物品未写入。删除存档和草稿使用跨两个 store 的单一事务。

命令批次每次成功最多增加一次 `revision`。幂等键是存档内的 `(turnId, commandId)`，凭据保留确定性编码后的完整命令：完全相同的重放不增加版本；同 ID 内容变化报冲突；部分重放只执行新命令且要求匹配当前版本。同批重复 ID 被拒绝。证据字符串必须非空；M1 不判断自然语言证据是否真实，也不推断不同 ID 是否描述同一故事事实。

已实现最小领域操作：购买物品/车辆、内部转账、收入到账、借款、还款、NPC/组织创建、组织关系记录、装备调整、物品转移、游戏时间推进、事件/任务保存。没有通用对象路径赋值。原型属性键、跨表 ID 重复、悬空引用、错误装备归属、余额不足、时间倒退、已结案事件改写等会被拒绝。

```ts
const repository = await SaveRepository.open();
await repository.create(createGameState(initialProfile));
const current = await repository.load(saveId);
await repository.save(saveId, current.revision, turnId, approvedCommands);
repository.close();
```

事务内只等待该事务的 IndexedDB 请求，不等待网络、模型或定时器。UI 和后续 AI 工作流不能绕过仓库直接写入数据库。

## 草稿与失败恢复基础

`TurnDraft` 保存 `baseSaveRevision`、独立 `draftRevision`、`storyRevision`、回合种类、原始输入、两个运行开关快照、正文、变量候选、世界候选、阶段状态和带尝试编号/错误码的失败记录。执行尝试另有 `executionRevision`、内部请求阶段清单 `requestedStages` 和各阶段的 `stageRequestRevisions`；这些是版本与来源元数据，不是新增玩家设置。

候选绑定正文版本和所属阶段的 `requestRevision`；世界候选额外绑定变量候选版本。`rerollStory` 创建新正文版本并清除旧变量/世界候选，保留输入及失败历史。改变变量候选时必须清除世界候选。缺少已验证变量时世界结果只可保存为 preview。草稿写入采用自身版本比较，并要求基础正式版本仍有效，拒绝迟到响应和双页面覆盖。过期草稿可读取作恢复检查，但不能继续写入；`deleteDraft` 显式丢弃草稿。

按技术计划 5.1、5.3、5.4 和游戏设计规范 5.3，开关只在**同次执行尝试**内冻结。玩家显式补算时调用 `startStageAttempt(draft, stages, config)`，持久化新尝试后再开始请求；正文、`storyRevision`、输入、基础正式版本和失败历史均保留。`stages` 表示本次“重新加载变量/世界”操作所请求的阶段，不是额外的玩家配置项。新的开关配置独立保存，不修改旧请求使用的快照。

仅补算变量时清除旧变量及依赖它的世界候选，并更新请求版本；仅补算世界时可复用未变化的已验证变量候选，不强制重算变量。关闭阶段禁止本次新请求；没有可复用结果时标记 skipped，已有且未失效的已验证结果可以保留 ready 供依赖校验。保留旧候选不代表本次执行了该阶段，也不自动应用候选命令。

响应必须携带**发起请求时捕获**的正文版本、阶段请求版本及变量依赖版本；不能在回写时将这些字段换成最新值。`saveDraft` 同时校验草稿 CAS 和响应来源：旧草稿直接写入会冲突；即使先读取最新草稿再合并旧响应，过期 `requestRevision` 也会被拒绝。新尝试只可按明确阶段重置依赖，不能夹带正文变化或新候选。旧版草稿缺少新增字段时默认版本 0，原有正文及候选保持不变；第一次补算即获得新的请求版本。

```ts
// 两阶段关闭、反复 Roll 后，保留选定正文重新开启。
const attempt = startStageAttempt(selected, ['variables', 'world'], {
  useVariableStage: true, useWorldStage: true,
});
await repository.saveDraft(attempt, selected.draftRevision);
// 后续阶段结果绑定 attempt.stageRequestRevisions 对应值，只保存为候选。
```

本阶段没有候选自动执行或转正式状态接口，没有自动重试、阶段编排、正文生成或完整回合提交。后续 M4 应在此基础上补充权限/证据校验、固定事实命令 ID、完整事务提交与原文/摘要同步，而不是直接把模型 JSON 当成可执行命令。

## 迁移及损坏数据

存档 `schemaVersion` 与 IndexedDB 数据库结构版本分开。当前版本为 2；显式 V1 Schema 与 V2 相同但没有 `weatherText` / `environmentText`，V1→V2 仅增加空的场景描述，不改变余额、游戏时间、revision、原文或幂等凭据。M0 没有正式存档，V1 是本阶段定义并测试的升级基线，不声称兼容一个不存在的旧游戏版本。

`load` 先验证旧版结构、执行已知迁移、检查最终引用，再在同一事务内整体替换。迁移失败不写入；高版本、未知版本、缺字段、负金额、错误引用等返回带错误码的异常，保留原始记录，不自动重置或修补。当前 `list` 遇到损坏记录也会明确报错，避免把损坏存档隐藏为不存在；自动抢救/导出原始坏档和专用损坏档删除工具尚未提供。

## 检查与文件

运行方式与 M0 相同，新增唯一运行时依赖为 Zod。`npm run check` 包含 ESLint、全部测试、类型检查及生产构建。

自动测试覆盖用户要求的 12 类场景，并补充多连接并发、写入后中止、跨 store 删除失败回滚、候选依赖失效、来源版本、坏档保留、未知余额、四类组织边界及时间合法性。另使用 Chromium 原生 IndexedDB 验证 CRUD、多存档隔离、并发重放、整批失败回滚、草稿隔离及关闭重开恢复。

本次结果：Node.js 24.19.0 / npm 11.9.0；锁文件 `npm ci` 安装成功。补算修复后 `npm run check` 全部通过（4 个测试文件、88/88 测试、ESLint 零警告、TypeScript 类型检查、Vite 生产构建）。新增 14 项测试覆盖双关闭后开启、仅补算变量、仅补算世界、原尝试配置不变、旧响应直接/合并回写拒绝、依赖失效、旧版草稿及持久化恢复；补算及候选写入均不改变正式状态。原 M1 的 Chromium 原生 IndexedDB 检查通过；69 个正式文档/提示词文件 SHA-256 一致，`git diff --check` 通过。

新增：`src/domain/common.ts`、`state.ts`、`commands.ts`、`drafts.ts`，各领域 `schema.ts`，`src/services/storage/{saveRepository,migrations}.ts`，测试 `domain.test.ts`、`drafts.test.ts`、`saveRepository.test.ts` 和 `fixtures/game.ts`，以及本文。

修改：`package.json`、锁文件、`DEVELOPMENT.md`、领域/服务 README；删除已被实现替代的空目录标记 `src/services/storage/.gitkeep`。未改动正式 `docs/`、原始 `prompts/`、页面、AI 或提示词运行时代码。

## 分歧处理与未完成范围

1. 提示词契约比技术计划示例多出 `worldCommands`：候选结果结构保留该字段；不改变三阶段职责，不执行世界推演。
2. 技术计划示例将两种 NPC 放在同一接口：实现改为独立严格 Schema 与联合类型，满足特殊 NPC 的附加字段要求；仍使用单个按 ID 索引的 NPC 表，避免一人两份真值。
3. 技术计划用数字表示金额，未规定精度：本次明确为整数分并允许未知值，以防止浮点误差和未知金额被伪造为零。
4. 提示词列出的命令集合属于建议传输协议：本轮实现内部受类型约束的最小领域命令，尚未接入模型协议；M3/M4 需显式适配及收紧各阶段权限，不能直接复用候选命令数组执行。
5. 不含 M2 UI、角色创建页面、AI API、提示词组装、自动调度、正式记忆压缩/检索、完整 M4 状态机及事务回合编排。历史快照回退、导入导出、其他浏览器验收和存储配额恢复留待后续阶段。未擅自制定记忆阈值、额外玩法或模型设置。

本阶段完成后停止，等待验收，不合并 main 或开始 M2。
