# World 同轮新建地点与事件入场校验修复

## 基线与范围

基于远端 main `fefdae159b86a25df251ab5550670a204fc8bc1b`，新分支 `fix/world-entry-created-location`，没有沿用已关闭 PR #93。

本轮只修复入场地点校验读取的状态，不取消任何地点合法性检查，不改 Schema、Prompt、Story/Variables 协议、事件调度、主子时间、玩家权限、Commit/CAS、模型路由或收费重试。

## 根因与最小改动

`validateWorldOutputChecked()` 从合法 Variables 投影构造 `base`，再克隆为本批逐步执行的 `causal`。每个 CreateLocation 处理后都登记在 causal.locations；任务和事件最终仍由同一正式领域投影验证所有引用。

原调用 `normalizeEventContinuation(event, old, base, draft)` 仅检查 `base.locations[entry.locationId]`，看不到同批已处理的地点。因此模型合法创建茶社后，在后面的子事件入场地点上失败。

现在 helper 接受可选只读地点表，默认仍为 base.locations；World 调用处显式传入 causal.locations。**仅地点存在性读取更新为正确的实体视图**：队列 queuedAt、时钟、旧入场身份和元数据保护依旧使用原 base/old/draft，没有整体切换所有权限依据到可变状态。

causal 中登记不表示整批已获正式批准：最终 projectTurn / commitCommands / GameStateSchema 仍验证父级存在、防环、全局唯一ID、任务/事件引用及状态完整性。任何无效提案整批拒绝，不先写入正式世界。

## 脱敏复现与正反测试

新增 `src/tests/world-entry-location.test.ts`，使用全新虚构「青槐茶社」、合成离场工作人员与合法正式状态，不包含玩家原始输出/存档或真实凭证。

同一 World 输出依次含 CreateLocation、SaveTask、main SaveEvent、sub SaveEvent；任务、事件及 continuation.entry.locationId 共同引用新地点，子事件正式关联主事件和任务，入场状态仍是 pending。

修复前该场景在真实 parseWorld 和真实 WorldStage 均失败，定位为 eventCommands.1 的 SaveEvent；合成批次只有4条命令，所以是第4条（index=3），不能冒称复现了用户原始批次的index=6或全部历史响应。

修复后验证：

- 新地点、已有地点均可正常引用；主子归属、固定时间和待回应地点正确。
- NPC 及主角状态不因入场安排变化；不移动主角、不自动写入主角知情、不自动接受邀请。
- 候选解析不修改原状态或原模型对象。
- 缺地点仍为 event_continuation；非法父地点为 location_reference；缺主事件为现有 domain_state；非法时间为 event_time；伪造入场为 event_entry；ID冲突为 entity_id。测试检查既有安全诊断，防止反例仅因同一个未修复错误而误通过。
- 真实 WorldStage → Mock transport → 候选保存 → 正式原子 Commit → IndexedDB 重载 → 重复 Commit 幂等重放；实际仅1次模型Mock请求，候选阶段正式状态仍不变。

## 修改文件

- `src/services/validation/worldEventContinuation.ts`：可选的只读地点视图，保留默认调用兼容。
- `src/services/validation/worldOutput.ts`：传入本批 causal.locations。
- `src/tests/world-entry-location.test.ts`：9项正反和真实Repository/Runtime集成回归。
- 本报告。

没有其他生产文件变更，也未修改 Prompt Manifest 或来源哈希。

## 本轮执行记录

所有网络模型均使用Mock，存储使用fake-indexeddb或隔离的浏览器测试上下文，零真实付费API，不读写玩家实际存档。批次独立记录：

- 修复前新文件：7通过、2失败、0跳过；两个正常场景在新子事件的入场地点处失败。
- 修复后新增文件及指定三文件合并定向批次：96/96通过，无失败/跳过。
- 进一步明确六类非法提案的原诊断规则后，新文件9/9通过。

- **npm run check完整通过**：Lint、104文件的完整Vitest **2876/2876**（无失败/跳过）、TypeScript及生产构建通过；不是使用此前历史测试成绩。完整测试批次耗时156.3秒，构建仅有既存chunk大于500kB提醒。
- 单独TypeScript检查通过；`npm run prompts:check` **93/93**，Prompt未修改。
- 受影响Chromium两文件：**22/22**，desktop11、mobile11，0失败、0跳过、0 flaky，130.3秒。验证既有入场交接、固定阶段、失败恢复和正式结算行为；本轮没有运行无关全量浏览器。
- 完整Diff自查及 `git diff --check` 通过。

命令：`npx vitest run src/tests/world-entry-location.test.ts src/tests/event-stages-v2.test.ts src/tests/world-event-handoff.test.ts src/tests/world-validation.test.ts`；`npm run check`；`npm run typecheck`；`npm run prompts:check`；`git diff --check`。

浏览器：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/event-stages-v2.spec.ts e2e/world-handoff.spec.ts --project=desktop --project=mobile --reporter=json`。

各批日志保留在 `/workspace/world-entry-location-*.log`，最终Chromium结果为 `/workspace/world-entry-location-browser.json`。本轮已发现的地点视图缺口无剩余阻断。

## 边界

这是按已确认执行路径构造的合成复现，不是用户原始存档重放。最终实体合法性仍依赖整批领域投影；没有将未处理或未创建的地点预先视为存在，没有放宽结构与权限。保留现有结构化依赖执行顺序，本轮不重构一般拓扑排序或World引擎。

真实模型能否稳定生成全部合法字段尚未经收费模型验证；此修复不承诺解决其他独立的World输出或请求超时问题。
