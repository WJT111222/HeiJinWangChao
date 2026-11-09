# 多回合撤回 V1

开发基线：最新远端 main `61e76c11815034f7a2a53d435b4f17ddc9d3d5c0`（2026-11-09 核验）。独立分支 `feat/multi-turn-undo-v1`。已阅读 `/workspace/rollback-research-20261109/REPORT.html` 和测量材料；没有采用、合并或移植 `feat/reversible-turn-rollback` 的代码。

## 玩家行为

行动区增加独立「撤回（可用次数）」按钮，与未结算草稿的「重新 Roll」分开。确认撤回后恢复上一正式回合，原输入回填到可编辑输入框，等待玩家主动发送。连续撤回会替换回填；如果已有编辑或未完成草稿，确认框明确提示覆盖或丢弃。没有 Redo。

开局不支持退回创角，最早可回到已完成的第一回合。没有恢复点的旧存档显示禁用按钮，不伪造旧历史。生成/结算期间禁用撤回；取消生成后可明确丢弃部分草稿并撤回。跨标签页操作冲突要求重新读取。

回填原输入在撤回事务内持久化；回填后的编辑在停笔 250ms 后保存到独立控制记录。极快关页可能来不及保存最后 250ms 的编辑，原输入与正式世界不受影响。绑定发送时原子清除回填、解除撤回暂停；若某类总结还有未确认请求或失败记录，仍需手动处理。撤回后的刷新或读档本身不会启动三阶段或自动总结。

## 存储与事务分层

- `turnUndo.ts`：恢复点编码/索引、连续性检查、容量政策与恢复校验；不调用 React、网络或 AI。
- `saveRepository.ts`：正式提交、撤回与记忆写入的事务边界。
- `idb.ts`：原有 request/transaction 实现原样提取，仍只在 IDB 事务中等待同一事务的请求。
- `TurnUndoControl.tsx`：轻量可用性信息、确认、输入恢复；React 不缓存完整快照链。

IndexedDB 结构版本从 2 升至 3，仅新增 `turnUndo`（复合键 saveId/turnId）和 `saveControls`（saveId）。**GameState 仍为 V6，TurnDraft Schema 不变，无正式字段迁移。** 原始导出与两种删除入口同步包含这些关联记录。恢复点采用完整状态 JSON；索引单独存储 turnId、前驱 turnId 与计量字节，界面只读取索引/键及当前状态，执行撤回时才读取一份快照载荷。

每次正式 `commitTurn()`：

1. 保留原有 Web Lock、StageGuard、草稿 CAS、正式 revision、候选重验和幂等回执校验。
2. 在同一个 IDB 读写事务中读取最新正式状态（包括此前落库且未增加 revision 的合法总结）。
3. `settleTurn()` 保持原实现；记录回合前快照和该回合原输入，安全淘汰最旧恢复点。
4. 原子写正式状态、下一草稿、回执和恢复点元数据。

一次 `undoTurn()` 在同一个五表事务中：

1. 核验期望正式 revision、确认时的完整草稿、恢复点索引与当前 journal 末尾的一致性。
2. 严格解析快照并重新验证完整 GameState、存档身份、创建时间、回合数和历史前缀。
3. 恢复全部世界业务数据；唯一例外是 `revision = 当前 revision + 1`、`updatedAt = 本次操作时间`，避免 ABA。历史 journal 原有 revision 保留。
4. 创建全新 UUID 的空待输入草稿，保持阶段启用配置；原输入写入独立控制记录，不能自动绑定并发起模型请求。
5. 删除已消费快照，保留更早连续后缀；统一清除该存档撤回前的提交回执，避免再重放旧分支；其中前驱回执的 nextTurnId 也已指向被丢弃的草稿。恢复后的 `appliedCommands` 保留有效历史；旧提交会被当前草稿/revision 拒绝。
6. 旋转持久化 epoch，暂停此存档的自动总结，保存撤回操作 ID 回执。精确重试同一撤回操作只恢复结果，不继续退一层。

任何步骤失败整笔事务回滚。快照损坏不报告成功，不部分替换世界。正常回合仍使用原 `projectTurn`、`settleTurn`、`commitCommands`，没有手写领域命令逆操作。

## 并发、总结与迟到结果

记忆总结开始前，`loadMemoryContext()` 在同一事务读取正式状态和 epoch。模型请求前再检查 epoch，最终 `saveMemoryCompression`/`saveNpcSummary` 在写事务内强制检查该令牌。**不以 revision 替代总结隔离**：普通回合推进但来源仍有效时，总结依然可以保存；撤回后即使原来源仍存在，旧 epoch 的总结也不能写入。

撤回与总结写入都包含 saves/saveControls 表，因此跨标签页 IDB 事务串行化：总结先写，随后撤回恢复快照；或撤回先完成，迟到总结被拒绝。删除后重建存档也会获得新 epoch。取消网络只用于节省工作，不承担写入隔离保证。现有收费尝试/节流台账不回滚，也不自动重试旧失败。

撤回后持久化 `memoryPaused`，阻止挂载、刷新、计时器触发新的自动总结；下一次主动发送解除撤回暂停；没有未确认尝试/失败的类型才恢复自动调度，用户明确点击立即总结仍是有效授权。UI 撤回后重建游戏控制器、取消旧本页任务；父组件拒绝不匹配正式 revision 的旧草稿/记忆回调。

独立 `save()` 领域命令入口若实际改变正式状态，会作废旧恢复链并旋转 epoch，避免把不属于完整回合的写入误当成可连续撤回的正式回合。精确幂等重放不作废恢复点。

## 容量预算与存储失败

每个存档最多 **5 份**，合计最多 **64 MiB（67,108,864 字节）**。计量是完整恢复记录未压缩 JSON 的 UTF-8 长度，包含 JSON 字符串封装成本；不是浏览器物理磁盘分配，也不包括当前正式存档、草稿、回执、索引和事务日志。

选择 64 MiB，是为了覆盖研究中约 10 MiB 的 300 回合存档五份，同时避免千回合游戏默认追加数百 MiB。保留连续最新后缀，数量/容量任一达到上限就淘汰最旧记录。单份已超预算时清空断开的旧恢复链，并明确显示「回合已正式保存；受存储容量限制，本回合不支持撤回」。

若正常提交遇到真实 `QuotaExceededError`，先等待整笔事务中止，再以同一个提交内容进行**一次**无快照的存储事务，重新执行全部 CAS/候选校验，并删除旧链、记录 quota 提示。没有模型重试。若正式状态本身仍写不下，第二笔也完整失败，原正式状态/草稿/回执/快照均不变。不会先删除快照再做不受保护的写入。

## 合成容量与性能实测

复现：`node scripts/measure-turn-undo.mjs`。独立子进程、Node v24.19.0、真实 Repository + fake-indexeddb，每组五次真实提交，再撤回所有可用记录。仅种子世界由合成夹具生成；新回合经过原领域模拟和正式提交。原始数值见 [capacity.jsonl](turn-undo-v1/capacity.jsonl)。

| 历史回合 / NPC / 每回合字符 | 初始正式 JSON MiB | 可撤回 | 恢复记录 MiB | 提交中位 ms | 撤回中位 ms | 进程峰值 RSS MiB |
|---|---:|---:|---:|---:|---:|---:|
| 10 / 10 / 6000 | 0.383 | 5 | 1.941 | 13.6 | 3.5 | 227.9 |
| 100 / 50 / 6000 | 3.179 | 5 | 16.075 | 188.3 | 25.0 | 398.7 |
| 300 / 150 / 6000 | 9.357 | 5 | 47.301 | 328.2 | 81.9 | 539.0 |
| 1000 / 500 / 6000 | 30.945 | 2 | 62.567 | 1135.5 | 480.4 | 1043.9 |
| 1000 / 1000 / 20000 | 66.447 | 0 | 0 | 1270.1 | 不可撤回 | 1481.6 |

这些耗时包含整个正式提交/恢复与 Schema 校验，不是纯快照编码耗时。峰值含 Vite SSR、合成数据、fake-indexeddb 的内存数据库与临时副本，不能声称是 React 常驻内存或玩家浏览器用量。较大状态依然存在主线程序列化/校验停顿风险，V1 不承诺大型存档零卡顿。不会因测量结果而裁剪 NPC、记忆或历史。

测量调试记录：最初将所有规模放进单个未主动 GC 的进程，最后压力组触发 Node 默认约 2 GiB 堆上限；该批只完成前四组，未当作完整通过。改为独立子进程、明确 GC 和 4 GiB 测量堆上限后五组完成。此限制调整仅属于测量脚本，不改变游戏运行参数。沙箱禁止 Vite 服务端监听/子进程的初始尝试亦未计为浏览器通过。

## Chromium 中的真实 IndexedDB 测量

用相同夹具，在真实 Chromium 中经 Repository 完成五次 Commit，再消费全部可用快照；没有 AI 请求。两种规模各一组，不能代表低端手机性能。测试源码：`e2e/turn-undo-capacity.spec.ts`；原始数组：[300 回合](turn-undo-v1/indexeddb-300.json)、[1000 回合](turn-undo-v1/indexeddb-1000.json)。

| 历史回合 / NPC | 可撤回 | 快照逻辑 MiB | Commit 中位 / 最大 ms | 撤回中位 / 最大 ms | 最终回合 |
|---|---:|---:|---:|---:|---:|
| 300 / 150 | 5 | 47.301 | 215.3 / 232.3 | 80.5 / 84.1 | 300 |
| 1000 / 500 | 2 | 62.567 | 839.7 / 1508.4 | 832.0 / 898.4 | 1003 |

`navigator.storage.estimate()` 返回整个测试 origin 的估算值，300/1000 样本分别为 3,072,000 / 4,812,800 字节。合成文本高度重复、浏览器可能压缩及舍入，且该值不是单个对象仓库的物理大小；**预算始终采用未压缩记录的 UTF-8 长度**，不采用这些偏小的 origin 数字。没有测得真实手机的峰值 RAM，不能用 Node RSS 或此处磁盘估算替代。

## 首轮开发验证记录（逐批记录，不累加当作一次验收）

- 新接口实现前：6 项初始测试中 5 项因缺少接口失败，1 项只覆盖失败不写入；没有将其当作实现通过。
- 初次 Repository + 原提交 + 总结回归：6 文件 **153 通过**。
- 扩展撤回测试：最初 **19 通过、1 失败**；失败夹具使用不存在的事件 sourceTurnId，改成测试真实当前草稿 ID，未修改领域校验。随后 **20/20 通过**。
- 完整 Vitest 首轮：93 文件，**2651 通过、2 失败**。失败为旧导出结构断言和自建 v2 数据库夹具。显式断言新增导出表，更新夹具结构版本/表；不降低数据断言。
- 补充升级、损坏、链缺失、独立写入、中止事务后：撤回与坏档管理 **52/52 通过**（其中撤回 25 项）。
- 新撤回首轮 Chromium：**desktop 5 / mobile 5，合计 10 通过**。
- 最终完整 Vitest：93 文件，**2658 通过、0 失败、0 跳过**，197.09 秒。
- `npm run prompts:check`：3 文件 **91 通过、0 失败**；独立批次，不能与 Vitest 数字累加成独立用例总数。
- 扩展 Chromium 首轮：6 文件 desktop/mobile，**82 通过、4 失败、0 跳过**（86 项）。两个坏档导出断言需要显式包含新表；两个 mobile 测试的原型注入被测试运行期间的 Vite 热更新分成了不同模块实例，Trace 中可见同一路径含时间参数和不含参数的两份模块。前者只更新导出结构断言；后者冻结源文件、关闭旧服务，冷启动复测，没有削弱业务约束。失败日志与 Trace 保留在本任务 `/workspace/undo-v1-validation/initial-failures/`。
- 冻结后的 Chromium 冷启动复测：4 文件，**desktop 31 / mobile 31，共 62 通过、0 失败、0 跳过**，4.3 分钟；包括新增 18 项撤回浏览器测试、原自动结算、记忆维护、坏档管理。未重跑无关全量 Chromium。上批未失败且代码未再改动的记忆总结 V2（18 项）与 NPC 记忆（10 项）仍单列为该批结果，不相加冒称一批。
- 真实 IndexedDB 容量测量：desktop 2 项 **2 通过**（12.8 秒）；为留存具体计量附件再用 JSON reporter 执行该两项，**2 通过、0 失败、0 跳过**（15.8 秒）。不是对全浏览器回归的重复计数。
- TypeScript、Lint、生产构建、`git diff --check` 均通过。构建保留现有大 chunk 提醒。初次脚本 Lint 的 Node 全局引用已改为显式导入；既有测试的未用参数改为类型签名，测试行为不变。

实际命令：

```sh
npx vitest run
npm run prompts:check
npm run typecheck
npm run lint
npm run build
git diff --check
# 扩展首轮（82/86，失败明细见上）
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/turn-undo.spec.ts e2e/automatic-settlement.spec.ts e2e/memory-summary-v2.spec.ts e2e/memory-maintenance.spec.ts e2e/npc-memory.spec.ts e2e/unreadable-saves.spec.ts --project=desktop --project=mobile
# 冻结后冷启动（62/62）
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/turn-undo.spec.ts e2e/unreadable-saves.spec.ts e2e/automatic-settlement.spec.ts e2e/memory-maintenance.spec.ts --project=desktop --project=mobile
# 真实 IndexedDB 测量（2/2）
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/turn-undo-capacity.spec.ts --project=desktop --workers=1 --reporter=json
```

新增场景覆盖：连续五次及窗口、原输入和编辑持久化、再次发送/旧提交拒绝、精确撤回重试、真实领域资金/物品/装备/NPC/任务/事件/记忆/历史恢复、迟到公共/NPC 总结、自动总结暂停、事务中止、容量淘汰、配额降级与正式写入失败、旧数据库升级和旧档无回退记录、损坏快照、跨标签页竞争、部分草稿丢弃与旧响应拒绝。浏览器使用真实 React、Repository 和 IndexedDB，模型网络全部 Mock。

## 修改清单与界面

- 存储：`src/services/storage/{saveRepository,turnUndo,idb,saveManagement}.ts`。
- 总结隔离：`src/workflows/{memoryMaintenance,memorySummaryQueue}.ts`、`src/ui/game/useMemoryMaintenance.ts`。
- 交互：`src/ui/game/{TurnUndoControl,GameScreen}.tsx`、`src/app/{App.tsx,styles.css}`。
- Repository 回归：`src/tests/turn-undo.test.ts`、`memory-summary-v2.test.ts`、`unreadable-saves.test.ts`。
- 浏览器：`e2e/turn-undo.spec.ts`、`turn-undo-capacity.spec.ts`、`unreadable-saves.spec.ts`。
- 可复现容量材料：`src/tests/fixtures/undoCapacity.ts`、`scripts/measure-turn-undo.mjs`、本报告及 `docs/turn-undo-v1/`。

真实 React 截图：连续五次撤回后停在输入状态，[桌面](turn-undo-v1/undo-desktop.png)、[移动端](turn-undo-v1/undo-mobile.png)。两个截图均来自无模型请求的测试，未以静态设计图替代。

## 剩余边界

- 不回到开局初始化前；旧档此前未保存的回合没有恢复点。
- 浏览器仍可能整体清理站点存储；固定字节预算不能保证系统磁盘始终有空间。建议继续使用原始导出备份。
- 没有反向差分、Redo、分支恢复或云同步；被撤回的正式内容与消费快照从有效存储删除，但无法撤销已经产生的 API 费用或供应商已收到的数据。
- 另一个标签页的已发出请求未必能物理终止，但迟到候选/总结不能跨新时间线保存。另一页面需重新读取最新状态；没有新增实时跨标签同步 UI。
- 玩家最后 250ms 的未发送输入编辑不保证在立即关页时落库；回填原输入和世界恢复由原子事务保障。
- 未使用真实玩家存档或付费模型，不能声称已经验证所有设备、浏览器配额和线上模型质量。

本 PR 不改 V6、领域权限、三阶段协议、模型路由、总结规则和记忆召回。只增加可撤回存储/隔离和必要交互；保持 Draft，不合并、不部署。


## 七代目返修：撤回与未确认的总结请求

审查基线与开工远端 HEAD 均为 `1d6c677ba9d8f01389065e3c28a05c85f3cc331a`。阅读 Review `5824313025` 后沿实际 Queue → MemoryMaintenance → Repository → localStorage 路径复核。此次没有改 `saveRepository.ts`、撤回事务、快照、V6、epoch 或回合生成链。

### 已复现的边界与所选语义

自动请求前写入 `heijin.summary.attempt:<saveId>:<createdAt>:<kind>`，值只有确定性总结 ID；模型成功且保存成功后才清除。撤回令旧结果的 epoch 失效，但并不撤销已发请求的可能费用。旧页面取消/卸载可能留下尝试键，却没有持久化失败键。原队列在撤回暂停期间只得到空返回，没有提示；发送以后才命中 `MEMORY_PREVIOUS`。

这次明确采用 **方案 B：有未确认收费尝试的类型需要手动处理**。评估 A 后没有使用“epoch 变化就清空”方案：现有尝试值没有 epoch、目标 NPC 或请求终态，无法可靠区分真实 HTTP 错误、取消、响应丢失、保存与本地确认之间的中断。仅靠新存档 epoch 不能为这些旧数据追补可靠结论。此返修不发明一套请求回执存储或扩大事务协议。

队列在读取正式状态、复核已有总结之后，检查未确认尝试，**无需进入模型执行器就显示待确认状态**。提示为：

> 此类总结有尚未确认保存的请求，可能已计费。撤回、刷新或发送行动不会自动重试；请手动重新生成或暂停本项自动总结。

真实 HTTP 错误在当前会话仍显示原错误；刷新后延续待确认，不把它假定为旧时间线的无害取消。撤回自身不删除尝试、失败或限流记录。

### 恢复条件与身份处理

- 无未确认请求/失败的类型：主动发送解除 `memoryPaused` 后，仍按自动开关、阈值、完整批次、来源校验、互斥及节流执行。
- 有未确认请求/失败的类型：仅发送不恢复。玩家明确“立即总结/重新生成”并成功保存后，清除该类尝试与失败，之后允许后续符合条件的全新自动批次。手动失败仍保留阻断。
- 暂停只关闭对应类型，不开启其他自动类型，不删除原始记忆。既有“明确重新开启并保存设置”的授权行为保持不变。
- 若本地确认丢失，但当前正式状态仍包含该总结 ID，继续使用原 `recoverCompletedSummary()` 确认已保存结果，不重做已覆盖来源。若撤回后该结果已不在正式状态，不能把旧成功当作新时间线的自动重试许可。
- NPC 失败记录包含真实目标时保留该目标，不允许改为其他人物冒充重试；只有遗留尝试 ID、没有目标时，显示“前往设置选择人物”，由玩家明确选择。程序不会将下一名满足阈值的 NPC 误绑定为旧请求目标。

因此没有把旧尝试重标为新时间线请求：在明确处理前保持同一阻断记录。手动成功后才处理当前来源；旧响应仍必须经原 epoch 校验，不能清理新任务记录或写回旧状态。

### 费用与限流

自动总结仍在发出请求前记入原 `heijin.summary.rate:<saveId>:<createdAt>` 台账，自动上限仍为每分钟 3 次、每小时 12 次。撤回前的失败、取消或丢弃结果已经占用的次数继续计入；撤回、刷新、发送及手动成功均不重置它。

手动请求沿用原产品规则：玩家每次明确点击授权一次，不属于自动调度配额，也不刷新或清空自动配额。它仍可能收费，本轮没有改变此机制。所有实际验证网络均使用 Mock。

### 本轮验证记录（与首轮开发成绩分开）

- 修复前新增 Repository 回归：**6 通过、2 失败**。两项分别是公共/NPC 在飞行中撤回后未显示待确认信息。
- 首次修复定向三文件：**61 通过**；补入已保存/未确认两种状态后，**63 通过**（新增返修文件 10 项）。检查的是 Mock transport 实际调用数及写入状态，不仅是 `memoryPaused`。
- 新浏览器首批：**4 通过、2 失败**。NPC 用例误以为取消必定丢失目标，实际取消在卸载前留下了合法 NPC ID。修正用例以断言该真实目标，另外增加“只有遗留 ID、没有目标”的独立场景；没有修改身份校验来迎合测试。失败 Trace 保留于 `/workspace/undo-review-validation/browser-first/`。
- 本轮完整 Vitest：94 文件，**2668 通过、0 失败、0 跳过**，215.65 秒。
- `npm run prompts:check`：**91 通过**；TypeScript、Lint、生产构建均通过（原有大 chunk 提醒保留）。
- 最终 Chromium 定向五文件：**desktop 34 / mobile 34，共 68 通过、0 失败、0 跳过**，6.5 分钟。新增返修浏览器场景为 8 项；未执行无关全量 E2E。
- `git diff --check` 通过。失败修正包括队列提前识别未确认尝试并提示、更新对应提示断言，以及纠正测试对已保留 NPC 目标的错误假设；没有删除断言、跳过测试或放宽领域规则。

新增覆盖公共及 NPC 迟到结果、取消、真实 HTTP 401/503、刷新与再次发送不重试、手动成功后新自动请求、自动关闭、其他类型独立执行、分钟/小时配额、确认失败后的已保存结果恢复及撤回移除结果后的保守处理。浏览器使用真实 React、Repository、IndexedDB 和三阶段 Mock 请求。

本轮文件：`memoryMaintenance.ts`、`memorySummaryQueue.ts`、`GameScreen.tsx`、新增 `src/tests/undo-summary-recovery.test.ts` 和 `e2e/undo-summary-recovery.spec.ts`、旧 `e2e/memory-maintenance.spec.ts` 的刷新提示断言，以及本报告。

### 剩余边界

方案 B 刻意不承诺“任意取消后点发送即可无条件自动总结”。无法判断收费结果的请求需要玩家一次明确处理；不会以多收费换取自动恢复。这个限制只影响对应总结类型，正常三阶段和其他类型不被关闭。本地存储被用户主动清除或站点整体清理时无法继续依赖这些台账；本轮没有修改原有存储安全边界。真实线上模型和供应商计费结果仍未验证。

本轮执行命令（日志与首轮开发分开）：

```sh
npx vitest run src/tests/undo-summary-recovery.test.ts src/tests/memory-summary-v2.test.ts src/tests/turn-undo.test.ts
npx vitest run
npm run typecheck
npm run lint
npm run build
npm run prompts:check
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/undo-summary-recovery.spec.ts e2e/turn-undo.spec.ts e2e/memory-summary-v2.spec.ts e2e/memory-maintenance.spec.ts e2e/npc-memory.spec.ts --project=desktop --project=mobile
git diff --check
```
