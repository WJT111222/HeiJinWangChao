# M8-P0C-2：文本变量执行器与安全映射

## 基线与范围

从最新远端 `main@752f60db419a442740035f66db5db171e6c837b4`（PR #34 合并提交）建立 `codex/m8-p0c2-text-command-executor`。本轮仅新增执行器、固定测试与本报告，没有修改旧业务文件。

数据流程：原文本 → P0C-1 `parseVariableText` → AST → `compileVariableCommands` → DomainCommand执行计划 → `simulateVariablePlan` → `commitCommands`返回完整内存副本。任一步失败都不返回部分成功计划或部分状态。当前游戏仍使用原JSON变量协议；新模块未接入 `parseVariables`、三阶段执行器、UI或存储。

## 既有机制审计

| 原机制 | 职责与本轮处理 |
| --- | --- |
| `DomainCommandSchema` / `variableCommandSchemas` | 严格字段、金额、数量、NPC记忆结构校验；不改Schema，映射后再次验证 |
| `commitCommands` | 解析克隆原状态；同turnId+commandId指纹幂等；正式revision前置条件；整批执行与终态Schema；复用一次整批调用 |
| `applyVariableCommand` | expectedRevision、物品expectedQuantity、装备耗尽清理、记忆回合/人物/知识标记等；继续由原领域实现负责 |
| `variablePermission` | 在场或本回合可信互动NPC、物品归属等权限；使用正式基线和独立互动授权，不从AST伪造权限状态 |
| `validateSceneTransition` / GameStateSchema | 场景、引用、装备、身份唯一性等；保持原规则，新协议不开放地点或在场字段 |
| `openingTimeBase` / `variableCommandsForTurn` | Story结构化开局时间为唯一候选；统一生成程序时钟，新模块调用原函数，不开放文本时间路径 |
| TurnDraft版本/草稿候选 | 本轮读取合法正文与正文版本并冻结到计划上下文摘要；不保存/变更草稿 |
| SaveRepository / CAS / IDB事务 | 真正的持久写入与跨标签保护；原实现完全保留，新模块不引用存储，不宣称内存模拟等于持久CAS |
| 原证据校验 | 变量阶段不再作逐字/文学语义判决；本轮不调用世界的文学事实验证，不添加付款关键词判断 |

## 新增文件

- `src/executors/variableText/model.ts`：可信上下文的严格Schema、执行计划、来源坐标、12类安全错误及确定性摘要。
- `src/executors/variableText/ast.ts`：重新验证AST形状、路径词法、JSON数据与资源边界，防止手工AST绕过解析器。
- `src/executors/variableText/compile.ts`：精确路径注册、来源/权限/旧值验证及领域命令编译。
- `src/executors/variableText/index.ts`：公开接口、计划防篡改、输入快照和整批内存模拟。
- `src/tests/variable-text-executor.test.ts`：真实Schema固定状态、完整文本和Mock回归。
- 本报告。

## 公开函数与类型

```typescript
function compileVariableCommands(
  ast: readonly ParsedVariableCommand[],
  state: GameState,
  context: VariableExecutionContext,
): Promise<ExecutionResult<VariableExecutionPlan>>;

function simulateVariablePlan(
  plan: VariableExecutionPlan,
  state: GameState,
  context: VariableExecutionContext,
): Promise<ExecutionResult<GameState>>;

type ExecutionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExecutionError };

interface VariableExecutionPlan {
  readonly version: 1;
  readonly stateDigest: string;
  readonly contextDigest: string;
  readonly ast: readonly ParsedVariableCommand[];
  readonly commands: readonly DomainCommand[];
  readonly origins: readonly (CommandOrigin | null)[];
}
interface CommandOrigin {
  commandIndex: number; // 从1开始，对应原AST顺序
  source: SourceSpan;   // 保留P0C-1的原文本UTF-16位置、行列
}
interface ExecutionError {
  code: ExecutionErrorCode;
  commandIndex: number | null;
  source: SourceSpan | null;
  message: string;
  relatedCommands: CommandOrigin[];
}
```

两个接口均异步，仅因为使用标准Web Crypto SHA-256计算确定性摘要；不调用网络、AI、数据库、系统时钟或随机数。Node24与现代安全上下文浏览器均支持。不可用/异常时返回transaction_failed，不回退到弱随机ID。

可信上下文严格接受以下结构：

```typescript
interface VariableExecutionContext {
  draft: TurnDraft;
  expectedRevision: number;
  interactions: Array<{
    npcId: string;
    identityKey: string;
    turnId: string;
    storyRevision: number;
  }>;
  proofs: Array<{
    commandIndex: number;
    evidence: string;
    expense?: {
      account: 'cash' | 'onlineBalance';
      amount: number; // 正整数人民币分，必须等于文本负操作数的绝对值
      purpose: string;
    };
    memorySource?:
      | { kind: 'scene'; npcId: string; identityKey: string }
      | { kind: 'npc_memory'; npcId: string; identityKey: string; memoryId: string };
  }>;
}
```

每条AST必须恰有一项proof，序号不得重复或越界；支出/记忆来源不能借给其他类型操作。`evidence`可概括，不需逐字匹配正文。**context是调用方的信任边界，不允许将整份AI JSON直接当作已授权上下文。** 本阶段未建立生产来源授权器；P0C-3必须从已保存的正文、当前版本和合法参与记录构建并验证上下文，不能依据AI自己的onScene/lastInteractionAt更新来授予访问权。

读取前先用原Schema克隆状态、草稿和上下文；首个await前冻结输入快照。模拟时重新提供当前可信上下文，重新编译，比较状态与上下文SHA-256及领域命令/来源，再执行整批。计划可审计但不是授权令牌，不能仅凭计划对象直接执行其中任意命令。摘要只用于检测一致性，不是签名；计划含NPC记忆文本，不可放入普通玩家日志。

## 精确路径及映射

| 真实路径 | 操作 | 领域命令与边界 |
| --- | --- | --- |
| `protagonist.healthText` | set | UpdateProtagonist，仅非空文本 |
| `protagonist.emotionText` | set | UpdateProtagonist，仅非空文本 |
| `npc[稳定ID].relationshipText` | set | UpdateNpc，实体存在且正式在场/可信本回合互动 |
| `npc[稳定ID].healthText` | set | UpdateNpc，同上 |
| `items[稳定ID].quantity` | add | UpdateItem，主角持有、读取顺序旧值、计算新数量、明确gain/consumption |
| `economy.cash` | add负数 | SpendFunds，必须匹配独立可信账户/金额/用途 |
| `economy.onlineBalance` | add负数 | SpendFunds，同上 |
| `npc[稳定ID].memories` | push | RecordNpcMemory，严格简化对象和同人物来源 |

只有上述8个注册项。NPC和物品路径必须恰好root→id→field，不接受数字索引，也不支持嵌套深合并。路径节点还会重新经过P0C-1词法验证，危险属性及手工伪造节点无法绕过。

拒绝根替换、身份/年龄、装备、地点/onScene、好感度、knownInformation、世界时钟、内部版本字段、其他人物资产、公开记忆/私人总结、中文字段别名及虚构精力/经验值属性。合法路径使用错误操作返回unsupported_operation；路径未注册返回unsupported_path。第一版有意不开放额外文本字段。

## 数量、资金及事务

数量add必须是非零安全整数，结果是非负安全整数。数值检查以AST中的IEEE-754数值为准，JSON.parse之前已丢失的超精细小数词法差异无法恢复；后续精确金额文本策略不能假装已在此阶段解决。读取正式物品旧数量作为expectedQuantity，后续同物品命令使用顺序计算的旧值，但不执行任意对象赋值。只允许主角已持有物品；不是取得他人物品的捷径。数量为零交给原UpdateItem执行耗尽和解除装备引用，新模块不删除对象；同批耗尽后禁止复活。

资金单位是人民币分，负数的绝对值才是SpendFunds.amount；不乘100，不猜成元。未知余额、浮点数、零支出、不足余额和安全整数溢出拒绝；多笔消费按整批顺序核算。用途只来自可信expense，金额和账户必须一致。正向收入返回unsupported_operation：本轮没有完整IncomeRecord来源，不能伪造ReceiveIncome或直接改余额。没有收入、债务或资产副作用。

编译只构造计划和局部前值表，不改GameState。模拟最终只调用一次原commitCommands（不逐条commit），保留expectedRevision、实体引用和整体Schema。任何领域错误都不返回中间状态。传入的AST、状态、草稿、来源保持原值，模拟状态的revision仅代表原命令执行产生的内存结果，不代表正式回合已提交；audit updatedAt传入原存档值，不取设备时间。

## 记忆与认知安全

简化push对象严格只接受text、knowledgeKind、knowledgeSource、visibility。没有身份、来源、知识性质就失败，不推断观察/转述/猜测。

- scene来源：必须绑定当前人物identityKey，正式在场且位置与主角一致，仅支持observed。本轮没有可靠的简化通讯授权记录，因此现场转述/猜测需要补充合法的原始本人记忆来源，不能仅凭“亲历”等文字放行。
- npc_memory来源：只读取目标NPC本人原始memories或特殊NPC的longTermMemories中唯一ID；验证本人引用、非未来时间、认知性质一致。不能引用另一个NPC的记忆，不把internal世界记录变成NPC知识，不将旧未知性质补成observed。
- 本轮不授权player_known写入，返回permission_denied；npc_private/internal保持限制，不自动公开。NPC现有player_known原始记忆也只允许降低为私人/内部新记录，不创建公开记忆。
- 根据显式knowledgeKind确定性保留`[转述]`/`[推测]`协议前缀；若已有相反标记则拒绝，不剥除不确定性。这是原Schema元数据协议，不是对小说作关键词审判。
- sourceTurnIds固定当前turnId，affectedEntityRefs仅记录目标NPC，createdAtGameTime使用合法本轮时钟；不从自由文本猜测其他人物引用。
- knowledgeSource由程序前缀绑定`scene:<npcId>:<turnId>:s<storyRevision>`或`npc-memory:<npcId>:<memoryId>`，同时保留AI明确给出的来源说明。
- 固定layer=personal、addToKnownInformation=false，不写NPC私有总结、不修改普通公开记忆、不改变世界客观事实。

程序不能证明一段自由文本是否真的描述现场观察，也不能理解其是否暗含别人的秘密；可信上下文构建者必须提供真实合法的来源，本轮不声称字符串存在就是认知授权。没有建立跨NPC信息传递新协议；无法可靠提供来源时明确拒绝。

## 确定性身份与精确重放

DomainCommand ID为`text-v1:s<storyRevision>:c<1-based序号>`，实际幂等键仍为原机制的turnId+commandId。记忆ID为`text-memory:`加SHA-256(JSON.stringify([saveId,turnId,storyRevision,命令序号,npcId]))。不使用当前时间/随机数；人物、回合和正文版本共同参与，序号不是单独身份；128字符turnId也不会使记忆ID超过原上限。

同基线、同上下文、同AST生成等价计划。同一turnId+commandId改内容、删减或追加已经执行批次的命令时返回duplicate_or_conflicting_command。物品add在精确重放时从既有指纹恢复原expectedQuantity，资金不重新计算扣款，记忆沿用同一ID；原commitCommands跳过已执行命令，不再增加revision。耗尽对象可以在完整精确重放中仍保持不存在，不能用此路径创建对象。

同一批次相同来源/内容/知识性质的重复push拒绝，即使序号不同；不同来源的真实独立经历不作文学去重。正文重Roll生成新的命令/记忆身份，旧计划在新上下文下拒绝。若把新正文计划应用在已执行旧正文的同回合副本之上，也拒绝；应从唯一正式基线分别投影，不能叠加候选。

本轮不会把重Roll时的旧候选永久保存，实际迟到响应/StageGuard/持久CAS仍由未改动的旧工作流负责；P0C-3接入时必须继续使用它们。

## 开局时间边界

新档仍须有合法Story `time:opening`结构化候选。调用openingTimeBase得到startAt计算基线，variableCommandsForTurn生成唯一`opening-clock:<storyRevision>`，固定前置，随后记忆使用同一endAt。不接受set worldClock或环境.时间，不要求文本重复输出时钟。没有候选明确missing_provenance，不能拿0001占位时间凑数。

开局内存模拟只在返回副本中清除待定标记；原存档和草稿完全不变。对已经模拟过的同回合副本精确重放，用原Story和原程序函数核对已存在的开局时钟指纹，但不把startAt再次应用到副本，也不重新推进时间。旧无待定标记的开局按旧时钟处理；已有journal的普通回合沿用正式时钟，文本协议没有自由推时权限。

## 错误与安全预算

| 错误码 | 场景 |
| --- | --- |
| unsupported_path | 未注册字段、数字实体索引、危险/畸形路径 |
| unsupported_operation | 已注册路径操作不匹配、缺完整收入结构的正向加钱 |
| entity_not_found | NPC/物品不存在，或同批耗尽后试图再次操作 |
| permission_denied | NPC访问、资产归属、身份、知识性质或公开权限不足 |
| type_mismatch | 非文本、非法简化记忆、伪造AST、非JSON数据 |
| missing_provenance | 无合法正文、缺/多来源、用途不匹配、开局时间缺失 |
| invalid_amount | 非整数分、未知/不足余额、金额溢出 |
| invalid_quantity | 零/浮点变化、负结果或安全整数溢出 |
| revision_conflict | 正式版本、保存草稿、上下文或计划快照不一致 |
| duplicate_or_conflicting_command | 重复来源序号、相同ID内容冲突、重复push、领域记忆ID冲突 |
| domain_validation_failed | 原Schema、场景、引用或整批终态一致性错误 |
| transaction_failed | 未预期运行时/摘要服务异常，不返回任何部分数据 |

单条编译错误带原命令序号和原始SourceSpan。只有在整批领域终态校验无法可靠确定单条归因时才使用null，relatedCommands保留所有文本来源，不能虚构一个失败序号；程序时钟没有原文本来源，用null记录。错误仅固定消息/安全代码/数字坐标，不包含路径、人物ID、值、原始回复或原生异常。未写console日志。

继承P0C-1的128命令、32路径节点、1024路径长度、65536单值长度、32JSON深度预算；AST入口额外拒绝非普通对象、函数、访问器、循环或共享对象图、非有限数。文本值及每条来源说明最多8192 UTF-16单元，proof/interaction各最多128。只处理已解析JSON及少量精确字段，不执行脚本或任意深赋值。

## 固定样例与失败复现

完整三区块样例使用虚构人物普通旅行，不涉及敏感属性推断。3条命令映射为UpdateProtagonist、UpdateNpc、RecordNpcMemory，模拟后情绪/关系/本人私人记忆正确，原存档完全相等。

成功：`add items[item_001].quantity = -1`（主角持有且原数量3）映射expectedQuantity=3、quantity=2、consumption；`add economy.cash = -300`需可信expense金额300分、账户cash及非空用途。

失败：数字NPC索引、worldClock、角色.当前精力、资金不足、跨NPC私人来源或缺知识性质都明确拒绝。第一条更新合法、第二条非法时不返回第一条状态。预置记忆ID碰撞的领域执行失败也不保留之前的情绪变化。

先写并运行最小全链路测试，因新执行器不存在而失败（不是旧游戏漏洞）；实现后通过。初次117条回归中115通过，发现同批重复push未被拦住，新增确定性去重后通过；另一条并发冻结测试误建了具有不同现实审计时间的第二份fixture，触发了正确的状态快照冲突，已改用原fixture的克隆以真实验证await冻结，不降低断言。补充更多来源、开局重放、旧流程和隔离用例后，定向131/131通过。

## 最终验证

| 实际命令 | 结果 |
| --- | --- |
| `npx vitest run src/tests/variable-text-executor.test.ts` | 131/131通过 |
| `npm run prompts:check` | 3个文件、82/82通过；Prompt/Manifest未修改 |
| `npm run check` | 42个文件、1564/1564通过；包含原1433项与新增131项 |
| `npm run check`内ESLint / TypeScript / Vite构建 | 全部通过；保留原有超过500kB分块警告，不扩大范围处理 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过：桌面145、移动145，17.2分钟；没有跳过或重试 |
| `git diff --check`、`git diff --cached --check` | 通过 |

提示词82项是工程测试子集，不重复计入总数。原有测试没有删除、跳过或降低断言；本轮没有UI/工作流接入，完整浏览器测试用于验证原游戏不退化，执行器本身通过真实DomainCommand/commitCommands调用链验证。所有AI场景使用Mock，无真实付费调用。新增6个文件，原有受保护的领域、存储、工作流、解析器、Prompt、UI、依赖和E2E文件均无修改。

## P0C-3接入依赖与未实现项

1. 生产环境的可信context/proof构建与授权：现场观察、互动、消费用途及合法通讯信息必须来自本回合已验证来源，不能照抄AI自称；本轮无新AI审判阶段。
2. 文本协议Prompt与旧JSON协议的明确切换、变量领域展示名映射、更多有证据的实体能力；本轮未修改Prompt、Manifest或模型消息。
3. 将计划存入合法候选时继续使用draftRevision/storyRevision/requestRevision/executionRevision、CAS与StageGuard；状态摘要不是跨标签锁，也不是正式结算回执。异步SHA-256/编译应在IDB事务外完成，真正写入时仍须在原事务中重读并执行CAS，不能在事务中等待这些异步准备。
4. 开局投影必须与原projectTurn统一；普通回合时间仍由既有合法协议处理，本执行器不开放时钟自由写。
5. 仍需原正式回合事务才能写journal、记忆和状态；本轮没有任何落库、下一回合创建、UI或收费入口。
6. 正向收入、创建/转移物品、公共记忆、跨NPC合法信息传递、私有总结引用、中文路径别名均未实现；本轮严格拒绝，不伪造完整业务结构。
7. 整批失败是唯一语义，不支持部分接纳或独立事务组。全状态摘要可能在同revision的合法记忆维护后保守拒绝旧计划，调用方应重读并重新编译，不应绕过快照检查。

未调用真实付费模型。没有新增API或收费场景，Mock通过不代表真实模型效果已验证。未主动部署生产环境；后续Draft PR预览可由现有Cloudflare自动流程部署。不自动合并、不开始P0C-3。
