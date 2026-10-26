# M8-P0A：变量系统最小必要校验与开局可靠性修复

## 基线、范围和失败复现

从远端最新 main `0a931137792ce29747b2fd8995fd37ff7c71225d`（PR #32 合并）建立 `codex/m8-p0a-minimal-validation`。本轮用户指令优先于旧里程碑中必须逐字证据/正向耗时/自然语言年代强制验证的旧规则。本轮仅调整变量候选验收和时间候选应用，不改正式 Schema、迁移、AI 协议/路由、Thinking、NSFW、六套主模板、记忆引擎或自动付费授权。

先新增 `src/tests/minimal-validation.test.ts` 的 14 项测试并在旧代码运行：12 失败、2 通过（`/tmp/heijin-m8-before.log`）。失败确认：

- Story 已给出合法结构化开局日期，仍因未在正文写完整日期/逐字证据而被拒。
- 合法空变量、在场 NPC、普通消费和物品获得的开局，因重复时间证明或文学证据门槛无法完成。
- 概括式经济来源说明被逐字/关键词规则拒绝。
- 正常零耗时完整候选不能正式提交。
- 类型、引用、余额和日期错误被压成同一个 `invalid_output`，不便定位。

JSON 非法和时间倒退原本已经被拒，继续保留。另在后续检查中先运行两项增量复现：来源说明为“现场核实先前听说的消息”的结构化亲历记忆被旧关键词拒绝（1失败/24通过）；已提交中断的概括说明导致同时间节点再次进入预检（定向断言失败）。分别改为认知协议标记和正式journal结构化事件ID/时刻核验，不再依赖说明文本。这些是 Mock 下可重现的客户端失败原因，不能据此断言已经定位玩家所有真实模型响应的问题；没有调用真实付费 API，也没有取得该次试玩的原始失败响应。

## 审查链分类与处置

| 规则/代码路径 | 类别 | 本轮处理 |
| --- | --- | --- |
| 严格 JSON、VariableResultSchema、DomainCommandSchema、白名单命令/字段 | 1 存档安全、2 数据类型 | 保留；未知字段、错误类型、非法命令拒绝 |
| GameStateSchema、稳定实体 ID/别名去重、归属、装备、数量、地点父级/环、引用 | 1、2 | 保留；不另建 Schema |
| 整数人民币分、未知余额、非负余额、债务、收入时间、内部转账 | 1、2 | 保留；不从 evidence 中的“元/分”猜金额 |
| commandId 去重/指纹、expectedRevision、CAS、StageGuard、取消、请求版本、回执 | 1 | 保留；原始命令批次与程序时钟命名空间都检查冲突 |
| evidenceCheck 的正文子串、factEvidence 的角色/引号/否定/计划扫描、completedPayment 的金额/账户/完成词 | 3 文学语义 | 从变量链删除；删除未再使用的经济证据函数 |
| 关系原因必须逐字出现、寒暄加分禁词、技能必须出现培训词、NPC来源说明的听说关键词 | 3 | 删除；AI理解实际经历，范围/前值/关系字段仍严格校验 |
| sceneTransitions 的姓名、同行、留守、否定、目的地句式 | 3 | 删除；保留主角移动时显式处理原在场NPC，以及最终位置/引用一致性，不自动搬人 |
| 开局自然语言年代解析、正文完整日期/季节/星期/钟点互证 | 3、4 重复时间 | 删除；原背景/偏好完整传给同一次Story，提示玩家意图优先；合法结构化日期才进入计算 |
| 开局变量必须恰好重复一条SetWorldClock | 4 | 删除；Story唯一候选统一生成程序时钟命令 |
| 每回合必须正向时间、按玩家目标/小说文本推算精确停止秒数 | 3、4 | 删除；普通回合可零耗时，不合成固定步长 |
| 合法日期、非倒退、结构化中断停止点、事件/任务起止/终态/前置条件 | 2、4必要部分 | 保留；预计到期仍不是完成证明 |
| 场内/场外职责、NPC知识归属、observed/reported/suspected、私有来源、worldEventOnly | 5 权限/知识隔离 | 保留；保留严格知识类型与[转述]/[推测]协议标记；世界阶段原有结构化来源保护不关闭 |
| 现场SaveTask/SaveEvent提交时按说明包含标题/ID和完成词判断 | 3 | 删除；命令本身的稳定ID、执行者、起点、条件、时间和终态检查仍保留 |

`evidence.ts` 中的剩余词法事实工具明确命名为 `worldFactEvidence`，仅供现有世界来源/公开知识边界验证使用，不再处于变量验收链。它不是新的小说裁判。世界的任务/事件自主决策及知识来源协议没有重构。

## 数据与时间状态流

1. 创角继续持久化已有 `openingTimePending` 标记和内部占位日期，普通界面/Story不将其当作剧情日期。现实系统时间只用于审计记录。
2. 同一次开局Story在原变量规划给出 `time:opening` 的严格 `{startAt,endAt}`。程序检查唯一性、合法日历、`+08:00`、结束不早于起点；不检查文学日期词。允许合理零耗时。
3. `openingTimeBase`只在内存形成 `startAt` 基线；正式标记不提前清除。
4. `variableCommandsForTurn` 根据本版Story生成唯一程序命令，ID为 `opening-clock:<storyRevision>`，`worldClock=endAt`。排在变量命令前，便于本幕NPC记忆/收入等引用合法时间。命令ID还在turnId命名空间内，Roll改版后不会混用。
5. 变量 `SAVE_STATE.worldClock` 是候选 `endAt`；`OPENING_TIME`同时给出起止，明确是候选。变量结果可为空，也无需重复时钟。原始结果不被暗中丢弃/部分接纳。
6. 旧草稿的等值 `SetWorldClock=endAt` 兼容规范为同一程序时钟；不等值明确报时间冲突。原始命令重复ID仍先拒绝，不能经规范化绕过。程序ID与其他命令碰撞也拒绝。
7. 变量模拟、世界输入/验证、`projectTurn`、正式`settleTurn`全部复用同一基线和同一命令。世界窗口是 `startAt→endAt`；无合法变量的世界仍只是preview，即使能使用Story时间也不能完整结算。
8. 首次正式发送通过现有IDB事务，同时写入时钟、变量、世界、journal、短期摘要、回执和下一草稿。回执重复提交不重算。网络不在IDB事务里等待。
9. 普通/旧档从已正式时钟出发；允许空命令和零耗时，合法时钟只能保持或前进。结构化中断不能越过停止点；纯历史视角保留只读当前世界/知识隔离约束，不再是唯一可零耗时场景。

未引入任何存档字段、版本或迁移。无待定标记的旧档不重新选择开局年份；V1/V2/V3/V4旧档读取、旧候选和旧回执保持可用。新的自然语言偏好优先级由Story提示负责，程序不保证模型一定遵从季节/年代语义；这符合本次“程序不审判小说”的产品调整。

## 失败诊断与安全

变量失败分为：`invalid_json`、`schema_fields`、`data_integrity`、`amount_balance`、`time_data`、`candidate_conflict`，以及原有 `permission`。Schema错误可显示白名单字段路径、命令类型和序号。未知字段名、值、动态人物ID、Zod原始异常、供应商响应、密钥与私人上下文不出现在诊断中。草稿仍仅记录安全失败码，不持久化响应副本。

单条数据错误仍整批失败，不静默吞命令、部分扣款或伪装成功；已保存的合法Story保留。版本检查、重试策略、最大输出Token、请求次数与费用授权不变。没有增加AI分类/裁判、时间解析或修复请求；原有明确授权的三阶段、手动补算和有界瞬时服务错误重试仍可能产生第三方费用。

## 测试调整说明

保留所有原测试用例，不删除/跳过。以下断言按新规则更新：

- `opening-time-review.test.ts`：原有六种年代表达、履历、相对/否定/矛盾日期等全部保留，改为验证背景/偏好完整进入Prompt以及结构化候选独立验收，不再测试已删除的中文日历解析器。
- `opening-time.test.ts`：保留非法日历、时区、倒退、重复/缺失时间结构、旧档、取消、CAS、Roll、原子回滚；文学锚点/季节/零耗时和重复时间证明断言按新规则更新。变量上下文以endAt为准，preview也使用同一Story时钟且仍不可正式提交。
- `variable-review.test.ts`、`variable-commands.test.ts`：旧对白、否定、计划、同行、留守、技能/好感用例继续运行，但验证词法不再是拒绝依据。测试不声称这些叙事中的变化语义正确；语义判断属于模型。范围、前值、权限、账户、归属和原子失败断言不减弱。
- `time-preflight/time-runtime/turn-time-policy`：取消“缺少正文时间规划即失败”“必须正向耗时”断言；合法日期、非倒退、明确中断与纯历史视角防护继续保留。
- `turn-commit`：对象由命令稳定ID关联，不再要求来源文本逐字出现标题/完成关键词；终态、条件、演员及未来时间边界继续测试。
- `thinking`：保留原生/规划不进入实际下游和存档的断言；不再将普通来源字符串是否与正文重合当作Thinking隔离机制。
- `world-validation`：validated标志仍不可信；反例改成真正非法ID，而不是证据文字包含“准备”。
- 浏览器旧反例改用不一致场景引用或超额余额验证安全拒绝；不依赖中文否定词判断。`action-workflow`和`continuous-turns`的旧开局Mock原先从候选endAt又加一分钟，与Story冲突而失败；改为开局复用OPENING_TIME.endAt，普通回合保留测试指定耗时。原有单次授权、恢复、开关、计费次数断言完整保留。

新增测试覆盖空开局/在场NPC/消费/物品、概括证据、唯一程序时钟/旧命令兼容/冲突、零耗时、类型/金额/引用/日期分类、事务回滚和安全诊断；真实浏览器增加从创角到自动三阶段、首次发送结算、下一回合、连续十回合、刷新无重复请求。

## 实际文件清单

新增：

- `M8-P0A-DEVELOPMENT.md`
- `src/services/validation/variableDiagnostics.ts`
- `src/tests/minimal-validation.test.ts`

修改：

- `e2e/action-workflow.spec.ts`
- `e2e/continuous-turns.spec.ts`
- `e2e/opening-time.spec.ts`
- `e2e/time-preflight.spec.ts`
- `e2e/variable-runtime.spec.ts`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/03_time_events.md`
- `prompts/shared/07_command_output.md`
- `prompts/sources.lock.json`
- `src/domain/openingTime.ts`
- `src/domain/sceneTransitions.ts`
- `src/domain/timePreflight.ts`
- `src/domain/turnCommit.ts`
- `src/domain/turnProjection.ts`
- `src/domain/variableCommands.ts`
- `src/prompts/composer.ts`
- `src/prompts/context.ts`
- `src/services/ai/errors.ts`
- `src/services/ai/runtime.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/evidence.ts`
- `src/services/validation/turnCommit.ts`
- `src/services/validation/worldEvidence.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/opening-time-review.test.ts`
- `src/tests/opening-time.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/thinking.test.ts`
- `src/tests/time-preflight.test.ts`
- `src/tests/time-runtime.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/turn-time-policy.test.ts`
- `src/tests/variable-commands.test.ts`
- `src/tests/variable-review.test.ts`
- `src/tests/world-validation.test.ts`
- `src/ui/creation/model.ts`
- `src/workflows/variableStage.ts`

## 验证结果

最终在冻结后的代码上顺序运行：

| 命令 | 最终实际结果 |
| --- | --- |
| `npm run prompts:check` | 3文件，82/82通过（工程测试的子集，不重复计数） |
| `npm run check` | Lint零警告；40文件、1289/1289测试通过；TypeScript与Vite生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过；桌面145、移动145；17.1分钟；retries=0，无跳过 |
| `git diff --check` | 通过 |

原有1264项工程测试用例保留，25项新测试；原有284项E2E保留，新增3场景×桌面/移动=6项。旧文学门槛断言按本轮明确规则调整，未删除安全断言。最终`.last-run.json`为passed、failedTests为空。

定向验证另外通过：25项最小校验测试；与时间预检组合61项；知识相关三文件94项；开局/变量/时间浏览器58项；授权/恢复浏览器34项；连续回合浏览器12项。这些均属于最终全量集合，不另加总。

中间全量尝试曾发现旧Mock将已是endAt的开局时钟再次加一分钟：先定位并修复action-workflow，再定位并修复continuous-turns，仅同步Mock时间契约，保留请求次数、原子回滚和十回合断言。中间失败运行未被计为通过；上述290/290来自修复后的完整重跑。

旧V1/V2/V3/V4读取、旧未提交开局/回执、取消/迟到、跨标签CAS、余额/归属、worldEventOnly、任务/事件来源、私有NPC和事务回滚均包含在最终回归中。构建保留原有大于500KB的分块提示，不为本任务重构打包或增加依赖。

全部模型请求使用Mock。没有进行真实付费API调用，没有修改模型输出Token上限，没有新增隐式请求、阶段或收费授权。未主动部署生产环境。

## 已知限制

- Mock测试证明确定性代码路径，不代表真实模型/中转站已经验证。未新增支持供应商或输出格式。
- 严格JSON及真实命令Schema仍可能拒绝模型格式错误；诊断现在能区分这些情况。未知余额不能通过消费命令被凭空初始化。
- AI可能提出语义错误但结构合法的关系/交易；程序不再声称用关键词能证明真假。仍通过提示词要求只提交实际事实，无法确定的放入rejectedSuggestions/unresolved。
- 玩家年代/季节文本不再由程序NLP强制解释，需由同次Story遵守；非法结构化日期和时间倒退仍程序拒绝。
- 世界来源与NPC私有知识约束保留原机制；本次未扩大世界任务、记忆或UI功能。
- 未主动部署生产环境；PR预览环境可由现有Cloudflare自动流程部署。等待审查，不自动合并。
