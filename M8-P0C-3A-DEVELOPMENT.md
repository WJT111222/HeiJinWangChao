# M8-P0C-3A：可信来源边界与文本变量离线桥接

## 基线与范围

从最新远端 `main@284c1e98bc19160f6a6b9a3f8bc70f8f2351fc35`（PR #35已合并）建立 `codex/m8-p0c3a-offline-bridge`。

本轮只新增独立桥接模块、固定样例测试及本报告。旧游戏仍使用JSON变量协议，不修改AI请求、Prompt/Manifest、领域或草稿Schema、存档格式、正式提交、设置和UI。没有真实模型调用，没有影子请求或生产功能开关。

数据流：捕获选定正文的离线基线 → 固定文本及原基线 → 校验正式状态/草稿对应关系 → 原parseVariableText → 四路径预演门禁 → 最小预演审计上下文 → 原compileVariableCommands → 原simulateVariablePlan → 只读投影。任何阶段失败，都没有部分预演状态。

## 现有调用链审计

| 现有文件/接口 | 现状及未来依赖 |
| --- | --- |
| `services/ai/runtime.ts:runStageRequest` | variables分支调用parseVariables解析原模型文本，返回旧结构化result；没有把未经解析的文本作为变量结果返回 |
| `services/validation/aiOutputs.ts:parseVariables` | JSON解析、VariableResultSchema、权限/时间及commitCommands模拟；本轮不调用它处理新文本，也不替换它 |
| `workflows/variableStage.ts:generate` | 读正式状态/草稿、比较完整fingerprint，startStageAttempt、真实Composer/Runtime、VariableResultSchema及coverage、候选CAS保存；future接入需保留全部版本与权限检查 |
| `workflows/turnCoordinator.ts:generate` | 顺序执行与恢复；会用parseVariables重验已保存候选；不能仅替换VariableStage而漏掉恢复验证 |
| `workflows/worldStage.ts:generate` | 重新解析旧变量候选；projectTurn构造投影；绑定basedOnVariableRevision、requestBasis及preview状态 |
| `domain/drafts.ts` | variables.result严格要求VariableResultSchema；候选绑定storyRevision、candidateRevision、requestRevision；重Roll/补算依赖失效规则已存在 |
| `domain/turnProjection.ts` | 正式基线+规范化变量命令+世界命令整批投影；openingTimeBase/variableCommandsForTurn为开局唯一时间处理 |
| `services/validation/turnCommit.ts` | 正式提交前重新parseVariables/parseWorld、时钟/任务/事件/跨阶段ID校验，不信任持久化validated字样 |
| `domain/turnCommit.ts:settleTurn` | completeTurnDraft、同回合未提交、projectTurn、journal/短期记忆与时间线等纯计算 |
| `services/storage/saveRepository.ts:commitTurn/saveDraft` | StageSession、Web Lock、回执、正式revision及草稿fingerprint/CAS、IDB原子写入；不在事务中等待网络 |
| `workflows/stageGuard.ts` | 同页共享执行锁、跨阶段会话所有权、取消/迟到检查与不可中断保存边界；本轮不增加第二套执行锁 |
| P0C-1 / P0C-2 | 已有文本解析、严格路径和领域命令映射、可信context边界、确定性ID和内存整批模拟；本轮直接调用，不重写 |

所有上述旧文件均未修改。真实工作流对新模块没有导入关系。

## 新文件

- `src/bridges/variableText/model.ts`：离线基线、只读结果/进度、错误及输出投影类型。
- `src/bridges/variableText/basis.ts`：既有Schema只读校验、基线捕获、原有确定性fingerprint/SHA-256复用。
- `src/bridges/variableText/index.ts`：离线入口、四条路径门禁、调用原解析器/执行器、成功后输出投影。
- `src/tests/variable-text-bridge.test.ts`：真实结构状态与实际解析/编译/领域模拟测试，异常分支采用Mock。
- 本报告。

## 公开接口与基线契约

```typescript
declare function captureVariableTextPreviewBasis(
  state: GameState, draft: TurnDraft,
): Promise<PreviewBasisResult>;

declare function previewVariableTextReply(
  text: string, state: GameState, draft: TurnDraft,
  expectedBasis: TextVariablePreviewBasis,
): Promise<TextVariablePreviewResult>;
```

与任务中的示意三参数接口相比，增加必需的expectedBasis，并提供独立捕获函数。原因：一份无版本的文本本身不能证明它属于哪份正文，三参数入口若总拿当前草稿给文本自动补基线，会把旧回复重绑给新正文。调用者须在为该正文准备/接收离线回复前捕获基线，并与回复一起传递；不得收到旧回复后重新捕获新正文基线给它“补票”。未提供基线明确revision_conflict。

基线是严格的本地DTO：kind、version=1、saveId、turnId、baseSaveRevision、draftRevision、storyRevision、executionRevision、stageRequestRevisions，以及完整规范化状态/草稿的SHA-256。version是离线工具格式，不是GameState或存档版本。复用P0C-2原有digest与领域fingerprint，不引入新的哈希库或随机ID。

入口验证原GameStateSchema/TurnDraftSchema、正文ready且storyRevision为正、saveId/base revision一致、opening/regular与正式turnNumber匹配、turnId未出现在journal或appliedCommands。读入时用原Schema克隆，兼容旧草稿由原Schema补默认执行字段，但不修改输入对象。两次调用之间的Roll、换档、候选/执行版本变化、同revision的内部资料变化，都会使旧基线不匹配。

函数还会在异步准备、编译及模拟返回后检查传入对象是否被原地改动；改动时丢弃旧结果。纯函数不能窥视另一标签的数据库，也不能证明任意传入对象真的来自最新IDB，更不能从任意自然语言反推它的生成历史。调用者必须提供可信的当前读取快照及原回复基线；基线是防止意外过期使用的一致性标记，不是防恶意调用方的签名、跨标签锁或正式授权。

## 可信来源与预演门禁

| 路径 | 本轮策略 |
| --- | --- |
| `set protagonist.healthText` | 允许低风险文本状态提案的离线预演，类型仍由原编译器校验 |
| `set protagonist.emotionText` | 同上 |
| `set npc[稳定ID].healthText` | NPC真实存在、正式已在场、地点明确且与主角一致 |
| `set npc[稳定ID].relationshipText` | 同上；不改好感度、身份或互动记录 |
| NPC数字索引 | unsupported_path，不将序号当稳定实体ID |
| 修改onScene/地点/身份等未开放路径 | offline_authorization_unsupported，不能先改权限前提 |
| 记忆新增 | missing_provenance；在场、亲历自述、Story/variableGuide都不生成memorySource |
| 资金支出及物品数量变化 | missing_provenance；没有实际交易/数量授权凭据，不凭说明补用途或事实证明 |
| 离场NPC文本状态 | permission_denied；本轮不生成任何interactions授权 |
| 已注册文本字段的add/push | unsupported_operation |

已经违反在场地点一致性的正式状态会先被原GameStateSchema拒绝，返回invalid_state，不为通过测试而放松Schema；旧档在场NPC缺少地点时结构仍可读，但预演权限不充分，返回permission_denied。

预演context仅含已校验draft、正式expectedRevision、空interactions和每条允许指令的审计文字：`preview_only:audit_not_fact:<turnId>:story<revision>:command<序号>`。这些文字只追踪离线提案，**不是AI陈述真实的证明，不构成正式提交许可**。无expense、memorySource或互动证明，也不从variableGuide、叙述关键词或AI解释推断它们。

先检查整批所有命令，再构造context和调用编译器。第一条合法、第二条未授权会在门禁阶段整批失败，根本不调用编译器/模拟器。没有静默跳过、部分接纳、假成功或新语义裁判。

## 返回结果与隐私

每种结果都固定：`mode=preview_only`、`commitAllowed=false`、`contextKind=preview_audit_only`、`audience=internal`。没有authorizedForCommit=true、validation=validated或新提交入口。progress独立表示input、parsing、authorization、compilation、simulation；授权通过的值是sufficient_for_preview。

成功返回basis、文本命令数量commandCount和只读previewState投影：

```typescript
interface TextVariablePreviewState {
  readonly worldClock: string;
  readonly clockKind: 'opening_candidate' | 'unchanged';
  readonly protagonist: {
    readonly healthText: string;
    readonly emotionText: string;
  };
  readonly npc: Readonly<Record<string, {
    readonly healthText?: string;
    readonly relationshipText: string;
  }>>;
}
```

NPC只包含本批允许指令涉及的稳定ID及两项文本字段。不返回完整GameState、journal、经济、未涉及人物、姓名、私有原文/总结、事件、appliedCommands指纹、执行计划、AST或合成proofs；这些都无需为阅读当前预演变化而带出。原执行器仍完整计算并验证新GameState，桥接只在整批成功后选择输出字段，不执行实体赋值或第二套领域模拟。

因此结果既不满足VariableResultSchema，也不满足GameStateSchema，不能被原TurnDraftSchema.variables.result接受。所谓“可预演”只表示在正式访问前提下可以检查一个文本状态提案，不意味着已核准其真实语义，更不能把进度状态拿来替代完整正式结算。

输出只是本地内部工具DTO，没有普通玩家UI/日志入口。正式NPC面板可见性不改变，隐藏人物/私人资料也不会通过成功输出或失败诊断带出。只读是TS契约；调用方即便改动自己持有的DTO，也不会改动正式输入对象。

## 开局与旧候选

桥接不造时钟协议，不读取设备日期。原执行器内部openingTimeBase/variableCommandsForTurn处理合法Story结构化开局时间；缺少时，编译失败missing_provenance。成功输出的开局时间标为opening_candidate，正式输入仍保留openingTimePending及原占位字段。

旧档没有待定标记时保持既有时钟，不重新解释年代。普通回合无自由时钟写入，只投影原正式时钟。commandCount统计文本AST，不把原执行器添加的开局程序时钟算作模型文本指令。

已有旧变量/世界候选仍原样保留，不成为本次新的授权来源，也不叠加执行其消费。本桥接从正式基线单独预演新文本，不保存、清除或替换候选，不改draftRevision/executionRevision/stageRequestRevisions或阶段开关。关闭变量/世界仍可在开发代码中显式做无费用的离线文本预演，但不会启动那些阶段或改变其状态。

## 失败结构与封闭语义

失败保留failedAt及origin（bridge/parser/executor），原解析错误ParseError或执行错误ExecutionError按原结构保留序号、行列/SourceSpan。门禁错误同样保留原AST序号和SourceSpan；全局输入错误无法归因时使用null，不伪造一条失败命令。

| 类型/代码 | 含义 |
| --- | --- |
| invalid_state / invalid_draft | 原Schema或依赖不合法，不回显Zod内部错误 |
| revision_conflict | 状态/草稿对应关系、回复基线或异步过程中版本变化 |
| story_not_ready | 无已选定正文、未ready或零正文版本 |
| entity_not_found / permission_denied | 稳定NPC不存在或正式同场权限不足 |
| unsupported_path / unsupported_operation | 数字实体索引或文本字段操作不匹配 |
| missing_provenance | 高风险操作缺独立事实来源，或由原执行器报告开局时间不足 |
| offline_authorization_unsupported | 未开放的离线预演路径 |
| P0C-1错误码 | 命令标签、JSON、路径及资源限制等解析失败 |
| P0C-2错误码 | 编译和领域模拟失败，包括类型及事务错误 |
| preview_failed | 未预期异常的安全固定消息 |

不返回原始回复、字段值、供应商响应、凭证、私有记忆或异常栈。任何失败均没有previewState，不返回第一条合法命令的部分结果。没有自动重试、网络请求或数据库动作。

## 测试与验证

先新增最小完整文本到预演的用例并运行，在新模块尚不存在时失败（不是声称旧游戏存在新漏洞）。实现后通过。扩展至68项真实链路/边界测试；随后收紧成功结果为只读投影，新增隐私与阶段开关不变测试，现有70项定向全部通过。收紧投影时曾有一项未使用类型import触发Lint/类型检查，已改为明确输出类型注解并导出类型，没有修改任何安全规则或旧测试。

覆盖四路径、NPC缺失/离场/缺地点/地点冲突、数字索引与自授在场、亲历自述拒绝、资金/物品拒绝、混合整批拒绝、AST冻结、基线/版本/Roll/异步变化、开局时间、旧默认字段、结果不可充当正式候选、无IO/AI，以及旧JSON变量/世界验证/settleTurn的实际调用链。领域模拟异常分支使用Mock，正常链路调用真实解析器、编译器和领域执行器，没有用假成功替代它们。

| 实际命令 | 最终结果 |
| --- | --- |
| `npx vitest run src/tests/variable-text-bridge.test.ts` | 70/70通过 |
| `npm run prompts:check` | 3个文件、82/82通过；原Prompt/Manifest未变 |
| `npm run check` | 43个文件、1647/1647通过（原1577+新增70）；ESLint、TypeScript和Vite生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过，桌面145、移动145，17.8分钟；无跳过、无重试 |
| `git diff --check`、暂存区空白检查 | 通过 |

提示词82项是工程测试子集，不重复计入总数。全部旧测试保留；本轮没有UI或运行时接入，浏览器套件用于原有功能不退化，离线桥接由上述真实函数调用链覆盖。构建保留原有大于500kB分块警告，没有扩大范围处理。所有AI场景使用Mock，没有真实付费调用；不能把Mock通过描述为真实模型已经验证。

## 下一阶段接口契约与八项结论

1. **为什么不能直接提交**：3A审计不是事实证明，只允许低风险提案；返回投影没有命令、生产proof、完整GameState或候选validation，不满足原提交结构。P0C-3B不能把3A审计前缀当生产evidence，也不能从预演进度抄出validated。
2. **GameState可确认什么**：实体稳定ID/类型、正式在场及地点、当前正式revision/时钟、既有资产归属及已保存知识元数据。存在某NPC或余额不证明本回合发生了观察、互动、支付或物品数量变化。
3. **目前不存在什么**：没有可供本桥接使用的本回合NPC观察凭据、场外通讯接收授权、明确完成的支出/数量操作收据。Story/variableGuide是AI陈述，不能据此给自己制造这些凭据。3A拒绝全部这些操作。
4. **不增加AI调用怎样建来源**：未来可由真正存在的程序操作回执、明确参数及版本绑定的玩家结构化操作、验证过的程序事件/结果建立专用来源类型。自然语言玩家输入、任务完成字样、事件自由resolutionText或NPC在场本身仍不是支付/目击许可；事件客观发生和人物知情必须分别建模。若当前项目没有该记录，就继续unresolved/拒绝，不能为过测试发明凭据。本轮没有实现这些新来源。
5. **P0C-3B候选兼容设计（未实现）**：优先保留variables.result作为统一的经生产校验DomainCommand输出，新增受限、版本化的来源格式旁路元数据区分旧JSON与文本。旧缺省仍解释为legacy JSON；新文本可保留必要的命令块/AST及来源绑定，不能把thinking/内部上下文混入普通历史。只有完成真实来源验证的文本才生成正式可校验的标准命令；3A输出不能适配成validated。具体TurnDraftSchema扩展及旧档测试须在3B独立审查，不在本轮加入字段或迁移。
6. **WorldStage读取及投影（未实现）**：未来通过一个受控的候选读取/重验适配器取得统一命令，旧JSON走原验证，新文本走生产来源/权限验证。继续绑定storyRevision/candidateRevision/requestRevision、世界basedOnVariableRevision，从同一正式revision用原projectTurn/variableCommandsForTurn构建投影，不将变量模拟后的revision再当基线。WorldStage、Runtime、Coordinator恢复及正式validateTurnCandidates都要一致处理格式，不能只改生成入口。
7. **旧存档/草稿兼容**：当前完全不改Schema或存储，旧JSON仍经原加载迁移和默认字段读取。桥接接受已被原存储层解析为当前GameState的只读快照，不承担V1/V2/V3原始文件迁移。未来3B新增格式须严格默认旧格式、旧候选可重验/继续，不能读档时自动请求模型或重写历史。
8. **P0C-3C显式接入与恢复（设计，未实现）**：必须单独批准显式协议选择/启用，不因刷新或配置变化发请求，默认保留旧路径。Mock先替换同一次变量阶段请求的格式，禁止双跑和影子收费；沿用StageGuard、取消/保存边界、冻结配置、requestBasis及CAS。测试开局/普通、部分失败、取消迟到、切档、跨标签、Roll依赖失效、世界preview及提交失败，不自动以收费重发掩盖协议失败。正式提交仍在原同步事务校验中重读并核验来源；SHA/异步编译在事务外准备，不能在IDB事务内等待它们。

## 已知限制与纪律

这是独立本地开发入口，未放进UI、正式Runtime、变量阶段、世界阶段或提交路径。没有证明自由文字真实的能力，没有独立NPC互动/观察/支付授权器，没有新协议模型请求或候选持久化。全状态摘要可能在同revision合法记忆维护后保守拒绝旧基线，调用方需重新读取并对新的离线样本捕获基线，不能给旧回复补票。

不做文本语义裁判、字段别名、正式格式切换或未来工作流开关。没有真实付费API调用；Mock全绿不代表真实模型兼容已验证。不自动合并，不主动部署生产环境；Draft PR预览可由既有Cloudflare流程自动部署。完成后等待审查，不开始3B/3C。
