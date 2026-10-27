# M8-P0C-3B：单一文本变量候选与可信来源架构

## 基线与架构决策

基线为最新远端 `main@e4b7a2dd4e7b63c3915b8f36c263b74625595501`（PR #36合并），分支`codex/m8-p0c3b-text-candidate`。

执行新产品决策：最终只有文本模型输入 → 解析 → 来源授权 → DomainCommand → 世界 → 同步重验/正式事务。**不为旧开发测试档或旧JSON输入建立长期兼容。** 本轮新契约仅text-v1，无Legacy/Text联合、迁移、旧JSON转换器或协议开关；旧运行文件短期共存，原链路未接入新候选，也未被删除。

本轮完成低风险四字段的候选准备、独立准备绑定、同步复核和覆盖不足标记。不是完整变量阶段的替代。没有正式候选持久化、模型请求切换、UI或生产功能开关。

## 真实能力矩阵

下表区分领域引擎能力、文本语法能力与正式来源，避免混为“已经可用”。优先级指未来实施建议，不是本轮扩展授权。

| 能力 | 现有负责方/DomainCommand | P0C-2文本映射 | 3A预演 | 本轮正式候选准备/来源缺口 | 后续优先级 |
| --- | --- | --- | --- | --- | --- |
| 主角健康/情绪文本 | Variables；UpdateProtagonist | set两字段 | 允许 | 允许文本提案；权威主角ID与白名单访问资格，不证明描述真实 | 已完成此子集 |
| 职业/技能/社会法律状态 | Variables；UpdateProtagonist有限changes | 不支持 | 不支持 | 拒绝，尚无该文本映射/生产授权；不因普通行为自动加能力 | 按玩法及来源补齐 |
| NPC健康/关系文字 | Variables现场；UpdateNpc | set两字段 | 正式同场允许 | 正式稳定ID、identityKey、已在场及同地点；仅文本提案许可 | 已完成此子集 |
| NPC身份、好感、目标 | 建档CreateNpc；UpdateNpc好感前值及特殊目标；World仅受限目标/状态 | 不支持通用身份或好感 | 不支持 | 不准备，不能把关系文本等同亲密/好感初始化；已有NPC身份不是任意可改字段 | 来源/映射独立设计 |
| 资金支出、转账 | Variables；SpendFunds、TransferFunds、PurchaseItem/Vehicle | add负现金/线上资金，需expense | 不授权 | 拒绝；没有当前回合独立支付凭据。有余额不是付款证明，turnReceipt也不是新支出授权 | 高，切换前补齐 |
| 收入/借款/还款 | Variables；ReceiveIncome完整收入、Borrow、RepayDebt | 不支持正向加钱 | 不支持 | 拒绝；没有可供本模块独立核实的当回合收入/债务操作来源 | 高，不能默默遗漏 |
| 物品新增/消耗/转移 | Variables；AcquireItem/PurchaseItem、UpdateItem、LoseItem、TransferItem | 已有主角物品数量add，严格前值/方向 | 不授权 | 拒绝；已有归属和数量不证明本轮增减。车辆/房产仍不能混入物品 | 高，需真实操作来源 |
| 装备 | Variables；SetEquipment及领域耗尽解除引用 | 不支持装备set | 不支持 | 拒绝，保留类别/所有权/引用约束 | 映射与玩家结构化操作 |
| NPC个人/长期记忆与知识 | Variables现场/World场外；RecordNpcMemory，personal/longTerm、knowledgeKind | 有带可信context的push，本人scene/原始记忆 | 不授权 | 全部拒绝自动准备；在场不等于目击，旧记忆也不自动授权当回合新经历。不得自动公开或传播 | 最高安全优先，先定义事实凭据 |
| 主角/NPC地点 | Variables现场；UpdateProtagonist/UpdateNpc/CreateLocation；World只场外受限地点 | 不支持 | 不支持 | 拒绝，需场景连贯与地点层级、稳定ID及实际参与记录 | 高，切换前补齐 |
| 任务/事件 | Variables现场受限SaveTask/SaveEvent；World场外任务、成果、交接、事件 | 不支持 | 不支持 | 拒绝，不把世界自主推演塞进变量；既有预计时间不是完成证明 | 保留世界职责，单独映射 |
| 世界时间 | 开局Story结构化时间由程序注入；普通回合SetWorldClock及time协议 | 禁止自由时钟写 | 仅复用程序开局 | 存clock来源说明，commands排除程序时钟；普通时间推进未覆盖时标记缺口 | 高，继续原时间协议 |
| NPC创建/联系人/退场 | Variables现场CreateNpc/RegisterContact；World受限RetireNpc；联系人/同伴保护及领域生命周期 | 不支持 | 不支持 | 拒绝，不伪造联系人或删除授权 | 按既有职责接入 |
| 四类组织/其他资产 | Variables已知组织关系及现场建档；World场外CreateOrganization/RecordOrgRelation；四种独立Schema | 不支持 | 不支持 | 拒绝。Domain并没有通用组织经营/财务更新或房产购入命令，不能声称Schema存在就能执行 | 保持边界，逐项实现 |

现有DomainCommand共24类。`commandCatalog`允许Variables除RetireNpc外的既有类型，但实际variablePermission和提交校验继续限制现场、任务成果及生命周期。World白名单只包含受限NPC/地点/组织/退场与专属taskCommands/eventCommands，不允许主角资金、物品、装备或SetWorldClock。本轮没有改这些职责和领域实现。

## 来源审计：有什么、没有什么

GameState可独立确认ID、NPC身份和正式同场、归属、余额、旧原始记忆的所属与认知性质。这些是**访问资格**。

已有`appliedCommands`是已执行领域命令的幂等指纹；`turnReceipts`是整回合提交回执，不是当前新交易、收入、消耗或目击的独立授权。玩家输入仍是自由文字，没有本模块可消费的结构化完成操作凭证。世界事件/任务有来源及结果性质约束，但其自由叙述不自动成为付款凭据；客观事件和NPC知情仍分离，不能借隐藏事件洗白知识。当前没有独立的当回合NPC目击流水或新支出/物品变动回执。

因此新授权仅有`protagonist_text_access`与`npc_scene_text_access`，每次从正式状态重新推导。含义是程序允许提出四个字段的文本变化，不是认证文学描述为真。审计evidence由程序固定为`text-v1:state-access:<turnId>:story<revision>:request<revision>:command<序号>`。不是3A的preview审计，也不是交易/目击证明；没有expense、memorySource或interaction伪造。

高风险指令即使Story、variableGuide、说明、knowledgeSource或玩家文字明确“已完成”，也一律missing_provenance。先检查整批，再编译，不跳过失败命令。将来必须先建设真实的结构化操作/事件来源，再扩权限；不额外调用AI裁判，也不扫描小说来造凭据。

## 新模块与依赖

- `src/candidates/variableText/model.ts`：唯一候选、请求基线、规范化指令、访问来源、时钟/覆盖元数据、安全结果。
- `basis.ts`：正式输入与请求版本绑定；区分生成快照和合法后续保存版本。
- `policy.ts`：四字段来源规范化/权限推导、有限的命令重建；无状态赋值。
- `coverage.ts`：保守覆盖报告；复用selectVariableDomains/assertVariableCoverage但不将规则加载视为事实完整性。
- `hash.ts`：同步SHA-256一致性摘要。
- `verify.ts`：同步重验来源、内容、顺序、时钟及领域模拟。
- `index.ts`：复用解析器、P0C-2编译器和模拟器的异步准备入口。
- `src/tests/text-variable-candidate.test.ts`与本报告。
- `package.json` / lock：只增加固定版本`@noble/hashes@2.0.1`，无运行依赖或安装脚本运行；只导入sha256及编码工具。原因是Web Crypto没有同步摘要API，Node crypto不能用于浏览器IDB；选择成熟小库而非自写密码算法/大型框架。当前应用未导入候选模块，不改游戏接口/请求。

## 单一候选与公开接口

```typescript
captureTextVariableRequestBasis(state, draft)
  => CandidateResult<TextVariableRequestBasis> // 同步、请求开始前捕获

prepareTextVariableCandidate(text, state, draft, capturedRequest)
  => Promise<PreparationResult>

verifyTextVariableCandidateSync(candidate, currentState, currentDraft, trustedPreparationSeal)
  => CandidateResult<VerifiedTextVariableCommands> // 完全同步
```

唯一候选严格使用：

```text
protocol: text-v1
status: prepared
candidateRevision
request: saveId/turnId/baseSaveRevision/storyRevision/executionRevision/
         requestRevision/requestDraftRevision + state/story/context摘要
instructions: set + 枚举target/field + 规范化value + 原行列位置
accesses: 从正式状态推导的protagonist_text_access或npc_scene_text_access
commands: 唯一规范化DomainCommand执行表示
clock: established或opening_story来源说明（不是额外执行命令）
coverage: 明确不完整的覆盖状态及规则域/表示域/未支持指导索引
```

不存整个AI回复/Thinking，不复制GameState、NPC记忆库或ExecutionContext。instructions只为重建和比对commands，不是另一个赋值器；真正改变内存对象的实现仍只有原commitCommands/applyVariableCommand。

候选只有prepared状态，不能伪造committed或validated。准备结果单独报告parsed/accessAuthorized/domainSimulated/syncReviewable及committed=false；同步返回state=sync_verified，仍不等于实际提交。正式提交事实属于原持久回执，不由候选自称。

准备同时返回**最小准备封印**（kind、requestDigest、payloadDigest、candidateRevision）。它不含命令、状态或事实授权，不是第二种候选格式；用途是把准备完成时的输出绑定交给可信调用方独立持有，避免只改候选自身字段后重算摘要就伪装原输出。sync必须显式收到该原记录；缺少时missing_trusted_seal，禁止读入待验数据后现场“重封印”。本轮不持久化它；3C必须在受控请求结果元数据/CAS边界保存和读取这条绑定，不能来自AI字段。

## 异步准备与同步安全

准备：校验正式状态/已选Story和原请求 → 原parseVariableText → 精确四路径授权/类型 → 程序context → 原compileVariableCommands → 对照有限命令重建结果 → 原simulateVariablePlan → 构造严格候选及封印 → 同步复核后返回。模拟结果不落库，也不复制进候选。任何阶段失败无部分候选。

同步：重新解析候选Schema和可信正式输入，核对请求及原封印，**再从规范化指令和当前正式状态重建访问来源及每条DomainCommand**，逐项核对数量/顺序/ID/字段/值/evidence/expectedRevision。即使恶意数据自算了新摘要，源类型和命令越权仍会被重建规则拒绝。重验时钟及覆盖报告，最后用commitCommands从原基线做同步整批模拟；没有await、Web Crypto、异步编译或网络。

有限重建只支持四字段，不复制资金、物品、记忆等通用执行语义，也不赋值对象。P0C-2仍是准备时编译器，异步输出必须与重建结果完全一致。原DomainCommandSchema、variablePermission、纯历史视角只读规则、实体/场景/时间及幂等校验均继续复用。

**信任边界**：摘要不是签名或“AI确实说过”的密码学证据。可信调用方要独立保存原封印，不能把候选携带/现算的封印当可信输入。如果调用方能同时恶意改写全部候选、请求记录和所谓可信封印，本地校验无法证明它仍是原模型回复；即便如此，重建依然不会授权四字段以外的命令，且本阶段coverage从不授予整回合结算。本PR不把程序有权限提出文本状态等同语义真实性或外部身份认证。

## 版本关系与开局时钟

- 新请求只允许变量阶段启用且pending，并属于当前变量尝试（初始零执行号为初始pending请求）；world专属尝试或failed/ready状态不能捕获新变量请求。同步只接受当前变量pending/ready，failed/skipped/preview拒绝。
- 生成时请求基线完整绑定save/turn/base revision、Story及输入摘要、execution、变量request、出生draftRevision。准备要求精确匹配，不能拿新请求给旧文本补票；异步过程中原对象改变也拒绝。
- 同步时正式revision及状态摘要、Story/输入、变量request仍须一致；请求出生draftRevision不改变，当前draftRevision允许合法增长。
- candidateRevision固定为变量requestRevision+1；安全整数上界拒绝溢出。变量补算升级请求号，旧候选失效，不依赖旧JSON候选计数。
- **现有WorldStage.startStageAttempt会提升全局executionRevision**。仅在requestedStages恰为world、world请求号等于当前execution、变量请求号保持原值时，允许这种世界专属衔接；否则execution变化拒绝。变量重算/混合补算或Story Roll仍失效。这是符合实际旧生命周期的必要区分，不是忽略执行版本。
- 原GameState/TurnDraft只有只读校验，不修改draftRevision/executionRevision/requestRevision或候选。

准备比较P0C-2完整计划与原variableCommandsForTurn输出，随后候选commands**只保存文本产生的四字段变量命令**。程序`opening-clock:<storyRevision>`不进commands，clock只记Story结构化来源。同步同样用openingTimeBase/variableCommandsForTurn唯一注入时钟一次；篡改clock或向commands追加/重复SetWorldClock均拒绝。普通时钟写未开放，现有纯历史视角规则仍可拒绝当前状态修改。

## 覆盖策略与能力缺口

`selectVariableDomains`确定规则模块范围，部分依据文字线索；它不是世界事实授权。`assertVariableCoverage`当前仅检查组织命令的类属规则是否加载，并不证明AI没有漏掉消费/物品/NPC动作。

因此本模块只把这些输出记录为ruleDomains，不从关键词宣布任何事件或财务变化成立。coverage始终complete=false：

- `unsupported_hints`：指导列出了economy/items/organization/event，或未由开局程序处理的time；记录0起始guide索引，不存其自由叙述。
- `scope_unconfirmed`：有合法四字段命令，但没有可靠方式证明整篇Story仅包含这些变化。protagonist/npc提示也可能包含未支持的技能、身份或知识变化，不能据此全覆盖。
- `empty_unconfirmed`：空命令可做空提案模拟，但没有独立“本轮无修改”凭据，不能证明业务无变化。

同步结果返回当前支持范围内的安全commands供未来受控投影使用，同时commitAllowed固定false。未支持的**实际输入指令**使整批准备失败；仅提示存在缺口时，候选保留明确覆盖阻塞，不能标为完整变量阶段。即使提示完全为空，也不默认无遗漏。本轮没有权威全覆盖/无修改回执，明确列为未实现。

因此**3C不能直接把prepared或sync_verified映射为完整ready并结算**。要实现真实单一文本玩法，须先补齐必要能力/可信来源与可验证覆盖机制，或显式向玩家报告未支持并阻断；不能丢掉经济/物品后假装游戏正常完成。本模块不是可立即取代整个旧变量阶段的功能承诺。

## 准备/复核错误与测试

错误区分输入、解析、授权、编译、模拟、同步复核；沿用解析器/执行器安全错误，补充invalid_candidate、revision_conflict、missing_trusted_seal、candidate_tampered等。每条可定位错误保留原1起始commandIndex与SourceSpan；全局错误不捏造行号。不回显完整回复、私有库、字段非法值、凭证或原生异常。

先运行最小测试，因新模块尚不存在而失败。实现首批55项时49通过、6失败：4项测试把明确committed=false误期望undefined，1项把公开规则域枚举economy误当存储了经济库，均改成正确的具体结构断言；另1项暴露未注册布尔路径被先分类为类型错误，调整路径白名单先行以给出准确unsupported_path，没有放宽安全。之后扩展到88项通过，再补冻结原AST、坏JSON来源与模拟失败测试至91项。最后主动复核生命周期边界，先加5项反例并运行：96项中原91通过、新5失败，实际复现world尝试可误捕获变量请求、failed阶段可捕获以及failed/skipped仍可复核的缺口。新增active-variable-request门禁与同步状态门禁后96/96通过；合法world复用正例仍通过，没有修改旧业务规则。

测试走真实解析/编译/领域模拟/同步重建；只有异常返回分支采用Mock。包含：严格单候选、preview/旧JSON拒绝、高风险自述拒绝、混合整批失败、改source/命令/ID/金额/顺序/权限/时钟、恶意重算摘要、请求/Roll/世界专属尝试、合法draft增长、同步不调用Web Crypto及async引擎、真正fake-indexeddb事务读出状态后同步复核继续写入、覆盖不足、空提案、无IO/付费调用、原commitCommands幂等。

最终验证（全部使用本地样例/Mock，无真实付费调用）：

| 命令 | 实际结果 |
| --- | --- |
| `npx --cache /tmp/heijin-npm-cache vitest run src/tests/text-variable-candidate.test.ts` | 96/96通过，2.85秒 |
| `npm run prompts:check` | 3文件、82/82通过，6.38秒；属于全量测试的子集，不重复计数 |
| `npm run check` | ESLint零警告；44文件、1743/1743通过（原1647项完整保留，新增96项），测试80.63秒；TypeScript及Vite生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过，桌面145、移动145，17.8分钟；未增删原E2E |
| `git diff --check` / `git diff --cached --check` | 通过 |

原有构建大于500kB的分块提示仍存在，不是构建失败。本轮新增模块未接入浏览器业务入口，E2E验证原有运行链路保持正常；新候选接口由真实解析/编译/模拟及IDB事务单元/集成测试验证，不声称已完成正式浏览器运行接入。E2E运行期间补充的五项生命周期修复仅涉及这些未接入模块，最终96项定向与1743项完整工程检查均在修复后重新运行通过。

## 3C / 3D 明确衔接和永久保留部分

1. **3C唯一候选接入**：直接替换TurnDraft.variables契约为本候选，不加Legacy/Text联合。`VariableStage`捕获受控请求基线、发同一次文本请求、prepare后在原CAS保存候选及独立准备绑定；不接受AI提供proof/封印。当前没有这套持久记录，刷新后的可信封印读取也是3C必须完成的依赖。
2. **Runtime/恢复/世界**：替换runStageRequest变量输出解析入口；TurnCoordinator恢复分支、WorldStage生成前读取、prompts context及投影统一调用新同步验证器并检查覆盖阻塞。保持模型路由/单次请求、取消迟到、StageGuard、候选版本和世界basedOnVariableRevision，不用旧JSON兜底或影子双跑。
3. **投影/提交**：domain.turnProjection、turnCommit及services.validation.turnCommit读取同一验证后的commands；继续唯一variableCommandsForTurn时钟与整批模拟。SaveRepository.commitTurn事务骨架不改；在原IDB同步校验点读取当前可信请求/准备绑定并verify，不在事务里await SHA/模型/编译。回执、状态/journal/记忆/下一草稿原子性保留。费用/取消测试覆盖新请求路径后才能正式切换。还须保留原VariableStage基于CredentialVault已知密钥值的输出检测；本模块没有凭证上下文，不能声称能识别任意文本是否偶然含有凭证。
4. **3D删除**：删除旧模型JSON输入解析和其Prompt输出协议、旧变量格式测试输入适配、过时测试档迁移/转换代码；不保留新兼容开关。删除范围需集中审计，不自动清浏览器数据，不删凭证/模型配置。
5. **永久保留**：DomainCommandSchema、applyVariableCommand/commitCommands、NPC知识与生命周期权限、时间规则、实体引用、CAS、StageGuard、IDB事务/回执及内部规范化命令校验。VariableResult中有用的纯领域结果可简化保留；删除旧AI输入不等于删除领域安全。
6. **3A归宿**：当前3A只为历史开发预演保留，本候选模块不调用/转换其DTO或审计proof。3D退役其独立公开桥接和专属预演授权；以后若需预览，走同一新来源/候选验证后做只读投影。不得同时维护两套生产授权策略；不在本PR加3A→正式候选适配器。
7. **功能完整性门槛**：经济/物品/地点/NPC创建、记忆、新来源和普通时间推进仍未覆盖；事件/组织自主世界职责不归并到变量。不能因新协议准备器已可用就宣布玩法切换完成。所有缺口按矩阵建设来源与映射后再允许全覆盖结算。

## 已知限制与纪律

本轮不写正式存档、不改正在运行的Draft/Runtime/Variables/World/Coordinator/commitTurn，不改Prompt/模型协议/设置/UI，不清除开发存档或用户凭证。没有长期双协议兼容。独立封印保管及请求基线真正来自当前可信存储，均为未来受控调用方的契约，不能由载荷自己认证；没有签名/新的秘密存储。

请求使用完整正式状态摘要，合法同revision记忆维护也可能使旧请求保守失效，调用方必须重新读取处理，不能为旧回复补新基线。本轮不证明任意文字为真，不用语义关键词给高风险指令补事实。

没有真实付费API调用。测试全绿不代表真实模型已经验证，也不代表当前有限候选具备整回合结算能力。保持Draft等待审查，不自动合并、不主动部署生产环境；PR预览可由既有Cloudflare自动流程部署。不开始3C/3D。
