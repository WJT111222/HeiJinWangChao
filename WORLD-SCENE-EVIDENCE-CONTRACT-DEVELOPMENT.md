# World JSON 包装与现场记录证据契约修复

## 基线及证据边界

从最新 `main@a3a7351d11b5ea66c376c1febbe2a94776a1bd2c`（已合并 #56）创建 `codex/world-scene-evidence-contract`。不修改 #56，也不重构事件生命周期。

本轮获得的是故障日志和 World 关键字段摘要，没有供应商原始响应字节、真实 Story、GameState、TurnDraft。因此：

- 可以确定旧 `JSON.parse(text)` 拒绝代码围栏；不能确定用户看到的围栏来自供应商还是粘贴展示。
- 可以复现 established 概括句不在来源全文中时的 `source_knowledge`，以及事实已经通过后描述字段仍不逐字匹配造成的 `actor_permission`。
- 不能据此宣称恢复了用户原始现场，也不能宣称摘要中的镜头暗病属实或原始整批 World 已成功。

`src/tests/fixtures/hanhai-opening.txt` 是独立编写的自然叙事测试前提，绝非用户原文。它先描述各人的实际动作，再描述对白及未付款、未签字、原因未明。响应字段没有反向拼接进 Story。合成状态和响应在 `hanhaiSceneContext.ts`；人物、金额、时间和角色位置只是测试假设。

原 `world-school-original.json` 完全不改，SHA-256 仍为 `53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb`，原有权限反例不删除。

## 修复前实际失败

修改业务代码之前运行 `npx vitest run src/tests/world-scene-contract.test.ts`：6 项，4 失败、2 通过。

- 3 个完整 JSON 的围栏场景被旧代码拒绝为 `invalid_json/json`。
- 新锚点契约尚不被旧凭据 Schema 接受，正向现场记录用例失败。
- 另外两条通过的反例明确断言旧格式：概括句触发 `source_knowledge`；将 fact 换成合法原句、只保留原句对应参与者后，非逐字的描述仍触发 `actor_permission`。后者隔离第二层阻断，而非声称恢复了真实响应。

本地原始日志保存在 `/workspace/world-scene-contract-verification/before.log`，不是历史 PR 测试成绩。

## A：World 专用有限 JSON 预处理

仅 `parseWorld()` 的解析副本剥离一个整段 JSON/无语言 Markdown 围栏；允许合法开头围栏但无闭合围栏，兼容首尾空白及 CRLF。然后仍对全部剩余内容执行 JSON.parse 和完整 Schema/业务校验。

不截取大括号，不补齐截断 JSON，不吞命令、不填空数组。解释前后缀、多个块、多个对象、非法语言、尾随逗号和截断全部失败。JSON 内的普通反引号字符串不会被替换。

Runtime 和 StageResponseStore 不变：完整原始响应连同围栏保存在当前页面临时诊断中，错误也保留原文；不写入正式世界或普通历史，不额外调用模型。Story、Variables、Memory 的协议不变。

## B：可验证的现场记录，不以摘要自证

新增 `WORLD_EVIDENCE_V1.sceneRecord?`（仍在原 evidence JSON 字符串内）：

```json
{"anchors":[{"source":"story:current","quote":"吴杰涛停在柜台前，伸手挡住递来的欠条。","actorRefs":[{"kind":"protagonist","id":"protagonist"}]}]}
```

该字段是严格可选 Schema，不扩展 GameState、TurnDraft 或存档版本。只允许 established、active/blocked SaveEvent；不能用来执行 NPC 更新/记忆、任务、完成、取消或归档。1–12 个不重复锚点，每句不超过 2000 字符、总长不超过 8000，逐项 actorRefs 为 1–12 个有效类型及稳定 ID。

1. source 只能是本次提供且允许引用的 `story:current`。不能指向私人记忆、其他人的事实或外部来源。
2. quote 必须是正文中完整的叙述句，含标点；再执行原来的否定、对白、传闻/计划语境防护。不能剪下引语或否定句内部的肯定片段。
3. 每个事件参与者都需要独立绑定。引用句以该角色的真实姓名、别名或“主角”作为主体开头，并有后续叙述；名字出现在全文或名册中不足以授权。不会从代词猜稳定 ID。主体绑定是有界句法约束，不宣称是完整中文语义理解。
4. fact/rationale 可保留模型概括和记录理由，但它们是非执行说明。该模式在内存校验中使用 quote 的组合替代自由 fact；不改原始响应或已保存 evidence 字符串。每次提交重验重新得到相同事实依据。

### 描述字段契约

不能用“锚点存在”来放行任意新断言。新模式支持完整原句或以下确定性组合（由目录明确提供）：

- title：`<真实地点 name> · 现场记录`
- backgroundText：`现场依据：\n` 加所有 quote，按锚点顺序用换行连接。
- goalText：`待处理：等待现场当事人下一步行动，不代表已经作出决定。`
- protagonist 承接 cue：完整已校验 quote，或 `现场事项仍待回应，请决定下一步行动。`

这些标题/组合背景/待处理目标无需作为完整字段逐字出现在小说里；背景保留完整命题，不能拼接词片段、调换主语。非终态仍不允许 resolutionText/resolvedAt/resultKnowledge。

这是**保守的摘录记录契约，不是任意自由摘要验证器**。模型仍能在 fact/rationale 和原文查看器给出摘要，但要落成正式事件描述，必须采用有依据的组合。自由改写的标题、背景、目标仍可能被拒；不静默删掉不合格描述或谎报执行成功。它以较中性的记录标题换取可证明的事实边界，避免再构造复杂的中文动作词判官。

没有 sceneRecord 的旧响应继续使用原来的 fact 与描述验证路径，不自动把无锚点概括当事实。已保存旧命令/存档无需迁移。原终态和场外 derived 自主推演流程不受影响。

### 权限、认知与执行流

`原始响应（保留） → World围栏解析副本 → 严格WorldResultSchema → 依赖排序 → 来源/时间 → 完整正文锚点 → 逐参与者及描述权限 → 原事件生命周期/知情/投影校验 → TurnDraft候选 → Commit再次parseWorld → 原子存储`

只是记录索赔单和现场争执，不判定镜头真的有暗病，不修改主角余额/欠条/位置/NPC认知。候选仍不提前修改正式状态。visibleHooks、主角知情、NPC私有来源、终态证据和历史成果原约束保留；不能拿 sceneRecord 给其他命令授权。

依赖排序中凭据格式错误原来落成 constraint，现在报告 source_format，携带安全的命令类型、序号和 evidence 字段。无效锚点报告 source_knowledge 及 `evidence.sceneRecord.anchors.<序号>.quote`；参与者或描述违规仍为 actor_permission，缺实际通知仍为 player_knowledge。不在错误日志打印凭据、正文或私人数据。

## Prompt 同步

更新共享 World 输出协议和开局 World 模板；普通回合自动复用共享协议。COMMAND_CATALOG 直接输出实际严格 WorldEvidenceSchema 和 sceneRecordFormat。更新这两项 Manifest 版本/哈希与来源锁补充记录，不改其他主模板、Variables/Thinking 或世界书。

## 测试与最终验收记录

新增 `world-scene-contract.test.ts` 48 项：包装成功/失败、自然叙事、多角色、两层旧失败、描述伪造、否定/对白/传闻/未来、稳定ID、锚点来源/预算/严格字段、权限、实际Runtime/WorldStage候选保存、原文保存、Commit重验、回滚/重载/幂等及明确手动恢复。另新增 2 个 Playwright 场景，在 desktop/mobile 共 4 项。

本报告提交前已实际通过：新增48项；较早7文件World/Commit定向220项；工程初跑2311项（当时新增41项，后来追加7项安全反例）；提示词82项；新增浏览器4项。工程初跑含Lint、TypeScript和生产构建。以上是阶段性记录，不代替最终HEAD完整验收。

在冻结提交后再次执行如下命令，**绑定最终 SHA 的精确通过/失败/跳过数、Workers Builds 状态在本 PR 最终验收评论和 PR 描述列出**，避免将尚未完成的测试写成通过：

```sh
npx vitest run src/tests/world-scene-contract.test.ts src/tests/world-scene-record.test.ts src/tests/world-school-original.test.ts src/tests/world-fact-tense.test.ts src/tests/event-handoff-composition.test.ts src/tests/world-event-handoff.test.ts src/tests/live-text-turn.test.ts
npm run check
npm run prompts:check
git diff --check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile
```

不删除、跳过或放宽旧测试。所有网络模型使用 Mock，用户实机供应商与原存档验证仍未执行。命令数/请求数/自动重试与授权不变；锚点可能增加同一次输出的文本量，没有扩大请求 Token 上限，也不承诺供应商费用数额不变。

## 修改文件

- `src/services/validation/aiOutputs.ts`：World 专用围栏解析。
- `src/services/validation/worldEvidence.ts`：严格可选锚点、来源及知情依据。
- `src/services/validation/worldSceneRecord.ts`：参与者与描述组合边界。
- `src/services/validation/worldOutput.ts`：整批验证接入，旧路径保留。
- `src/services/validation/worldDependencies.ts`：安全凭据格式诊断。
- `src/services/validation/commandCatalog.ts`：实际模板及 Schema 暴露。
- `prompts/shared/08_world_output.md`、`prompts/stages/opening/world.md`、`prompts/manifest.json`、`prompts/sources.lock.json`。
- `src/tests/world-scene-contract.test.ts`、`src/tests/fixtures/hanhai-opening.txt`、`src/tests/fixtures/hanhaiSceneContext.ts`。
- `e2e/world-scene-contract.spec.ts`、本报告。

未主动部署生产环境；PR 预览环境由现有 Cloudflare 自动流程处理。不合并、不修改正式玩家存档。
