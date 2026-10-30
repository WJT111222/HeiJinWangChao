# PR #50：玩家全量观察、独立认知与事件权限最终修订

本节对应 [最终确认产品设计](https://github.com/WJT111222/HeiJinWangChao/pull/50#issuecomment-6506784194)，在 `75b7f5c` 上继续实现。**本节与 `docs/WORLD_EVENT_LIFECYCLE.md` 优先于本文下方历史记录中“玩家资料遮蔽/仅主角知晓才归档/重要事件先清理再公开”的描述。** 历史测试数字不作为本轮验证结果。

## 差异审计与方案

| 原差异 | 本次实现与文件范围 |
| --- | --- |
| playerView以knownActors及visibility过滤人物、组织、地点、物品、事件和记忆 | 独立玩家观察投影返回全部正式记录，Panels与MemoryPanel只读展示；不供Story复用 |
| NPC详情缺个人原始/长期记忆、knownInformation与人物总结 | 复用现有MemoryEntry/NpcSummary与覆盖凭据，人物详情及记忆页均能按人物/内容/来源搜索、每页20条；完整来源按需展开 |
| internal与npc_private展示遮蔽混同于角色认知 | 保留存量标记、owner/source/knowledgeKind不变，internal明确标注“不代表任何角色已知”，转述/推测/未知不会显示为事实 |
| DeleteEvent允许重要或有必要引用的终态丢弃完整对象 | 只允许minor独立终态；主角参与/前序主线、任务、记忆、组织、后继与历史引用均保守保护；ArchiveEvent保留重要完整对象 |
| 历史归档依赖主角先知道 | 移除玩家展示/归档的知晓资格；可信fact可归档，timelineCandidates只写明确facts，不复制完整混合结果叙述 |
| 规范化Variables可借SaveEvent改sceneState外字段 | 共用validateSceneEventUpdate，比较除五个sceneState字段及程序来源之外的全部字段；sourceTurnIds精确保留旧来源并追加本回合 |

本轮无需拆出新PR：前端消费现有正式状态，领域调整限定事件保留/历史与Variables权限；不需要新增存档字段、Schema版本、玩家开关、模型协议或AI阶段。没有把全部NPC私有资料加入Story。共享VisibilitySchema不删除、不重写，以保留角色认知语义和旧档兼容。

## 实际失败复现

先增加7项玩家观察/保留/归档测试，以及12项非sceneState字段权限回归，在修改业务代码前运行两文件：**40项中17失败、23通过**。失败实际复现了隐藏/部分知晓事件和场外档案无法查看、重要/主角/必要任务引用事件被普通清理、可信场外成果归档被知晓资格阻挡，以及部分规划/影响/背景等字段被规范化候选错误接受。已有引用和环检测本来就拒绝的反例继续作为对照，不宣称全部都是新漏洞。

字段测试走 `parseVariables` 和真实 fake-indexeddb `SaveRepository.commitTurn`，伪造validated标记不能绕过，失败整份正式状态与草稿保持原样。此前纯组织/空参与者/混合离场NPC拒绝、合法入离场与World正常组织推演的21项回归全部保留。

## 玩家观察与角色认知

- 玩家能查看所有正式NPC、当前身份/关系/位置/状态、创角原始设定（另列，不覆盖当前资料）、组织分类资料、地图、全部重要物品及正式经济资产。
- 世界事件列出hidden/partially_known/known的全部正式记录、开始/预计/实际时间、背景目标、状态、参与者和引用。任务进展、旧清理成果和退场人物保留资料可独立展开。
- 原即时/短/中/长与永久journal继续使用现有来源；新增“人物记忆”阅读分组，不新增存储层或复制数据。NPC原始记忆、特殊NPC长期记忆、npcSummaries都保留所有者、游戏时间、认知性质、知识来源、sourceTurnIds和sourceMemoryIds。无可靠来源的旧总结显示未知，不补造亲历。全量实际short记录另行补充显示，不作为新的压缩产物，publicShortMemories与Story检索/压缩算法不改。
- 原人物记忆不会因为被总结而从只读UI消失。搜索/分页/展开来源只读，无AI调用。完整内部世界记录不冒充该NPC已经记住。永久正文搜索仍只检索journal，不把NPC秘密混入历史正文或主角回忆。
- `contextFor`、publicNpc、storyMemoryContext、npcKnowledgeContext、worldSources、ownerNpcId和worldEventOnly不因UI开放而放宽。打开面板前后正式state及真实Story上下文相等；B不会仅凭A的event ID获得A的秘密。API凭证/设置/认证头不传入世界记录组件。
- 记忆维护Hook、阈值、模型预算、原始来源覆盖、授权与取消机制不变；公开自动维护不获得NPC额外付费授权。

## 事件规则与旧数据

所有非终态保留。significant/major终态保留；没有独立主线标记，程序保守保护主角参与及其前序承接链、有任务/事件/知识/组织/历史引用的事件，不用中文关键词猜测脱离主线。只有minor独立终态能清理，保留最小retired身份避免ID复活。确有承接时保留被引用的原记录，不强制造后继。

重要事件通过ArchiveEvent归档后仍保存完整原对象，可信事件facts可独立支持归档；timelineCandidates的标题、摘要和结果只采用resultKnowledge.facts。resolutionText、reported和suspected仍可只读查看，但不能被自动写成历史客观结论。旧无分类成果仍可读取，不补造facts；若有独立已核实来源，可沿ArchiveEvent归档。

不新增迁移或重写正式玩家存档：V1–V4按既有链迁移到V5，V5原样读取；新增测试覆盖各版本的时钟、revision、原事件和时间线不变，以及旧retiredEvents.detail/publication继续读取和归档。旧已清理且没有保留的背景无法恢复，不调用AI捏造。旧候选可以读取，但越权非sceneState修改、重要事件清理或缺客观成果的自动时间线在正式重验时会拒绝，需用户主动补算，不隐式重发请求。

## 提示词与费用

只改World共享输出契约、开局/普通World职责的相关段落，以及命令目录和权威技术文档。Manifest刷新字符数/版本/hash；sources.lock新增本轮适配记录，保留原来源历史。世界书、NSFW、Thinking、Story/Variables主模板、三阶段引擎与API协议不改。不新增AI请求、自动维护、逐事件调用、隐式重试或收费开关。

## 回归调整说明

保留全部旧用例，不删除或跳过。旧玩家投影“必须看不到”断言按本次产品决策改为“完整可读且不改认知/状态”；原Story、历史检索、NPC跨人物来源拒绝、金额、CAS、回执、取消/迟到、Schema和事务断言保留。生命周期用例改为重要/必要引用事件清理应拒绝且原记录保留，归档不删除；同时增加facts、传闻拒绝、主线承接和V1–V5/旧retired兼容正反测试。十四类原命令夹具的SaveEvent追加程序当前回合来源，与实际sceneState编译契约一致，不放松领域规则。

浏览器开发期曾暴露过时的隐藏断言、旧档夹具误调用新游戏create、公开短期投影排序差异；已按正式旧档夹具、原公开排序和新只读规则修正。一次开发期HMR导致移动浏览器导航上下文销毁，最终验证需使用停止代码编辑后的完整运行结果。

## 本轮验证

| 命令 | 本轮实际结果 |
| --- | --- |
| `npx vitest run src/tests/world-observer.test.ts src/tests/scene-event-permission.test.ts` | 49/49通过（本轮新增28项，原权限21项保留） |
| `npm run check` | 54文件、1982/1982通过；Lint、TypeScript、Vite生产构建通过 |
| `npm run prompts:check` | 82/82通过 |
| 相关桌面/移动Chromium阅读与事件回归 | 24/24通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 完整304项正在执行，尚未计入通过 |
| `git diff --check` | 通过 |

相较75b7f5c保留1954项旧工程用例，新增28项；浏览器保留原302项并新增全量只读观察桌面/移动2项。模型与网络均Mock，没有真实付费API调用。构建仍有既存大于500KB bundle的非阻断提示，不掩盖或删除。


## 本轮修改文件（47个）

- `EVENT-LIFECYCLE-DEVELOPMENT.md`
- `docs/WORLD_EVENT_LIFECYCLE.md`
- `e2e/event-lifecycle.spec.ts`
- `e2e/game.spec.ts`
- `e2e/npc-memory.spec.ts`
- `e2e/player-memory.spec.ts`
- `e2e/world-observer.spec.ts`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `prompts/stages/opening/world.md`
- `prompts/stages/regular/world.md`
- `src/app/styles.css`
- `src/domain/events/lifecycle.ts`
- `src/domain/events/scenePermission.ts`
- `src/domain/state.ts`
- `src/domain/turnCommit.ts`
- `src/executors/variableText/index.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/turnCommit.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/domain.test.ts`
- `src/tests/event-lifecycle-runtime.test.ts`
- `src/tests/fixtures/npcMemory.ts`
- `src/tests/m2.test.ts`
- `src/tests/memory.test.ts`
- `src/tests/npc-memory-review.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/player-memory.test.ts`
- `src/tests/prompt-inspector.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/scene-event-permission.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/variable-commands.test.ts`
- `src/tests/world-handoff-review.test.ts`
- `src/tests/world-handoff-review2.test.ts`
- `src/tests/world-handoff-review3.test.ts`
- `src/tests/world-handoff.test.ts`
- `src/tests/world-observer.test.ts`
- `src/tests/world-validation.test.ts`
- `src/ui/panels/MemoryPanel.tsx`
- `src/ui/panels/MemoryRecord.tsx`
- `src/ui/panels/Panels.tsx`
- `src/ui/panels/WorldRecord.tsx`
- `src/ui/panels/playerView.ts`

## 已知限制

- 主线/必要引用保护偏保守，可能多保留记录；没有新增主线状态字段、引用重构、NPC恢复或高级清理器。
- 程序不能证明任意自然语言facts完全真实，仍依赖同一次World模型正确区分已核实事实、转述和推测；Mock不是实机模型验证。
- UI展示全量保存记录不等于角色内全知，玩家行为仍经原Story与角色知识约束；面板不自动写入主角或NPC记忆。
- 普通世界记录/资产完整详情是轻量只读展开；人物与记忆采用20条分页。本轮不引入大型虚拟列表或整体UI重做。
- 原始journal和幂等账本保留；最小retired身份仍会增长。旧版本已经丢弃的原始资料不能凭空恢复。
- 未主动部署生产环境；PR预览环境由现有Cloudflare自动流程处理。保持Draft，不合并。

---

以下为此前实现与审查的历史记录；与上文冲突的产品描述已被本轮确认覆盖，数字不作本轮验证。

# 动态世界事件生命周期

## PR #50 五代目审查：Variables / World 事件权限修补

本节为审查基线 `e36919e` 之后的实际新修补与本次重新执行结果；下方原实现的测试记录仅为历史，不作为本轮验证。
审查：[issuecomment-6496830870](https://github.com/WJT111222/HeiJinWangChao/pull/50#issuecomment-6496830870)。

### 实际复现

先新增6项测试，在未修改业务代码时运行：4失败、2通过。四条失败分别证明纯组织事件被文本Variables解析、独立计划模拟、规范化候选解析和真实IndexedDB `commitTurn` 错误接受；最后一条确实形成了正式提交，不是仅测试helper。合法主角现场与原World组织事件对照均通过。另以失败测试确认不能把新ID伪装为已有事件绕过文本入口。

### 最小修补

新增 `validateSceneEventUpdate()`，从正式状态按ID查找原事件，使用原始参与者判断权限。必须正向关联主角或本幕在场NPC，且其中所有NPC都属于本幕现场集合。纯组织、空参与者和混合离场NPC被拒绝；相同地点、组织拥有现场成员等间接线索不能单独授权。

本幕现场集合采用正式快照在场NPC与整批合法投影在场NPC的并集，避免合法入场和离场被误伤。不从正文关键词、名字或关系说明猜测在场，不要求新增事实凭据。参与者不能借候选改写，继续受既有领域不可变约束保护。

同一函数用于：

1. 文本解析后的合法模拟结果检查。
2. 独立 `simulateVariablePlan()`：重新编译并调用原 `commitCommands` 得到副本，权限检查通过后才返回；失败无部分value。
3. 已保存/直接提供的规范化Variables候选 `parseVariables()`，也覆盖World启动前的变量复核。
4. 正式 `validateTurnCandidates()` 重验，不信任validated标记。

编译器仍只做结构映射，中间计划不代表执行许可。没有在全局 `commitCommands` 加Variables限制，World仍按其原来源协议处理纯组织场外事件。Task权限保持原规则。

### 本次文件

- 新增 `src/domain/events/scenePermission.ts`：共享正向权限判定。
- 修改 `src/executors/variableText/index.ts`：独立模拟完成后检查权限，返回安全permission_denied。
- 修改 `src/services/validation/aiOutputs.ts`：文本及规范化变量结果共用判定。
- 修改 `src/services/validation/turnCommit.ts`：正式提交同边界重验。
- 新增 `src/tests/scene-event-permission.test.ts`：21项安全及合法场景回归。
- 修改 `src/tests/prompt-runtime.test.ts`：保留十四类整批和经济断言，将SaveEvent夹具改为已有事件scheduled→active，另验证实际状态更新；不再把创建新事件混为变量现场更新。
- 修改 `e2e/event-lifecycle.spec.ts`：新增一项桌面/移动浏览器场景（共2项），验证纯组织被Variables拒绝、合法现场恢复、组织变化仅经World候选正式提交。
- 更新本报告。

未改GameState/DomainCommand Schema、迁移、World来源校验、三阶段执行器、Prompt/Manifest、UI、模型协议、重试或费用规则。

### 本次重新执行的验证

- 修复前最小复现：4失败、2对照通过；另一个新ID绕过反例修复前失败。日志为本环境临时文件，不含真实模型数据。
- `npx vitest run src/tests/scene-event-permission.test.ts src/tests/event-lifecycle-runtime.test.ts src/tests/live-text-turn.test.ts`：69项通过，其中新增21项。
- `npm run prompts:check`：82项通过。
- `npm run check`：53个文件、1954项通过，包含本次全部新增用例；ESLint、TypeScript及Vite生产构建通过。仅有既有包体积建议。
- `CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/event-lifecycle.spec.ts e2e/variable-runtime.spec.ts e2e/world-runtime.spec.ts`：36/36通过（桌面18、移动18；新增场景各执行一次，共2项；2.2分钟）。
- `git diff --check`：通过。旧断言未删除、未跳过；本轮只运行上述相关E2E，不以先前300项结果代替本次执行。

新增回归覆盖组织-only（包括同地点）、空参与者、现场/离场混合、伪造validated、新ID、伪加主角、合法主角/现场NPC/组织+现场NPC、入/离场、批次失败无部分修改、正式回执幂等与World原组织权限。浏览器网络为Mock，未调用真实付费模型。

### 边界

结构化onScene状态是当前现场依据，不声称程序能独立证明小说语义，不新增审判或审批机制。旧越权或非既有事件的Variables候选会在复核时拒绝；原文和正式状态保留，需玩家显式恢复，不自动追加模型请求。资金、NPC知识隔离、CAS、版本、幂等和事务机制保持原样。

---

以下为首次生命周期实现记录（`e36919e`），保留追溯。

## 基线与审计

从 main@9d930cf6b2e5197149f6dc89634f478089228c27 创建 codex/world-event-lifecycle。
PR #49 当前 open/Draft、未合并；其“预计时间或完成条件满足其一”方案不采用，不 cherry-pick。

已审计总文档、V0.1 设计/技术计划、World/Variables/Story、领域命令、存档迁移、来源和时间线投影。
冲突：事件 estimatedEndAt 可选；全局 OR 校验使无关旧记录阻断 Variables；没有到期批次输入/处置检查；没有事件清理；时间线强依赖完整事件；resolved 默认成功，失败结案受旧成功分支阻挡；blocked 更新可能被自身未满足条件阻挡。
历史文档“预计结束时间或条件”由本次产品指令覆盖，Task 不同于 Event，不改变 Task 新写入的 dueAt 或 completionCondition 规则。

## 最小实施方案

- 明确新事件规划 Schema 与旧记录读取 Schema；新事件需要预计结束时间、背景、目标及参与者，条件不能替代时间。
- V5 增加轻量 retiredEvents。迁移只增加空表，不补日期/事实、不改 revision、journal 或 worldClock。
- 旧缺预计时间的事件仍可读取，单列待规划；新/重新规划写入需合理估计。新写入规则放领域命令边界，不以无关旧资料缺失拒绝现场更新。
- 基于正式→变量投影窗口创建内部到期队列，包含恢复后的积压，按时间及依赖处理，同一 World 请求。到期不是完成证明。合法结果可结束、失败、取消、延期/受阻或自然承接；未处理者不能被称为完成。
- DeleteEvent 清理终态完整记录，保留最小身份/终态/清理时间与必要引用；重要或有来源职责者保留紧凑成果材料。ArchiveEvent 只把已结束重大事件的合法公开内容归入时间线；内部秘密不会因归档自动变为他人知识。
- 后续事件可通过 predecessorEventIds 明确承接，不能成环或提前承接未发生结果，不强迫后继。
- 全部变化仍经候选、CAS、整批模拟及原子回合提交，关闭 World 不请求、不写入，失败/重 Roll 保留正式状态。

测试计划覆盖用户14类验收及旧档、知识隔离、经济、NPC、任务、失败回滚、跨标签、真实 Mock Runtime/Coordinator 和桌面/移动 Chromium。

以下记录实际实现、验证结果及仍存在的边界。

## 实际数据流与决策

1. Variables照常解析文本、编译领域命令、从同一正式revision内存投影。事件文本根创建入口改为有限的`set events[id].sceneState = {status,resolvedAt?,resolutionText?,outcome?,resultKnowledge?}`，只合并到已存在的现场事件；排程和参与者不允许覆盖，来源回合由程序追加。其他39个文本入口保留；不新增凭据、文学审查、coverage或候选封印。
2. World的真实Composer在原上下文中加入`EVENT_SCHEDULE{from,to,due,scenePending,unplannedLegacy,policy}`。due按预计时间排序，包括关闭/旧时钟造成的积压；真实命令处理再结合来源拓扑排序。同一次原有World模型请求处理，不增加分类、逐事件调用、重试或收费任务。
3. 已验证变量投影供World读取；World通过SaveEvent进行自主正常结束、失败/变化结束、取消或有因延期/受阻。到期处理不能只返回空结果宣称成功：每个可处理到期对象必须已经终结，或下一预计时间晚于本轮窗口。未满足条件可失败或继续阻碍，不能将到期当成功。futureEvents仅作新计划SaveEvent的相同镜像，不是第二个写入入口。
4. DeleteEvent和ArchiveEvent属于World的eventCommands；不向Variables授权。SaveEvent与清理具有不同依赖键，先验证结果再清理。原commandId幂等、StageGuard、请求版本、草稿CAS、取消和迟到响应机制原样复用。
5. projectTurn仍从同一正式基线模拟全部变量+世界命令。正式提交再次解析与验证世界候选，然后在原SaveRepository事务中原子保存状态、清理、时间线、journal、短期记忆、回执与下一草稿；没有新增第二个存储事务或IDB事务内网络等待。

### 为什么增加Schema V5

原timeline、linkedEventId、前序/知识来源均依赖完整events对象。直接删除会悬空；永久保留完整对象违背新设计。V5只增加retiredEvents（实体身份/终态/清理时间/必要来源和关系），有职责或重大结果才带紧凑detail；公开时另存publication。不同NPC仍不会因事件ID自动获得知识，event-result保持statement，隐藏事件继续worldEventOnly。重大隐藏成果清理后仍可在未来有独立公开依据的回合归档。

V1–V4迁移仅添加空表并升版本，不补日期、事实、条件或结果，不修改worldClock、revision、journal、NPC或经济。读取旧缺排程记录不报无关全局规划错误；新事件创建必需完整规划。旧缺项事件真实终结/取消可保留缺项，不为清理编造过去预计日期；继续/延期时由World合理重新规划。已保存旧World候选如含不完整新事件，仍可读取，但正式重验可能要求重新生成该World候选；不绕过新写入要求。

### 公开、历史和长时间行动

- 普通结束不强制归档、后继或永久完整记录；重大且已知才可时间线。取消若没有真实终止时间，不伪造时间线日期。
- 已知重大可继续timelineCandidates；ArchiveEvent允许为过去已清理的重大隐藏结果单独发布合法公开标题/摘要，不把原内部详情整体公开。
- 普通无引用清理后不再进入World完整事件上下文。任务、后继、时间线或记忆/知识来源仍需要的成果保留引用；最小身份防止复用ID。
- 时间预检可提示已开始公开事件的预计节点，但仍为conditional；实际可感知中断才停止长行动，不因预计完成而自动打断。隐藏/受阻/已终结记录不进入公开中断候选；已实际使用的同一节点在重载后不重复触发。后台到期队列只给World，长跨度窗口不静默跳过场外到期事项。
- 现场参与者由Variables实际事实处理，World不代主角/现场NPC行动。没有可感知依据的隐藏场外事件不会倒灌进已经生成的Story。

## 失败复现及测试调整依据

修复前先运行两个最小反例：新事件只有completionCondition没有estimatedEndAt被接受；旧无关事件/任务缺规划使合法emotionText更新模拟失败。两项均真实失败，记录在本次执行日志`/tmp/event-lifecycle-before.log`（环境临时文件，不含真实模型数据）。

保留全部1901项原工程用例，新增32项，共1933项：新规划、Task独立OR、延期/受阻/失败/取消、积压、多事件依赖、承接环、清理引用、隐藏重大未来公开、时间线与取消实际日期、V1–4读取、时间预检节点去重，以及真实Runtime→TurnCoordinator→World候选→原子Commit→重载→下一轮。

原用例更新仅适配明确产品变化：领域命令数量24→26；旧版本夹具显式去除V5新字段；需继续的事件提供未来预计时间/背景/目标；隐藏重大事件不再凭timelineCandidates提前发布；文本事件测试使用已有sceneState入口。没有删除经济、NPC认知、事务、取消、CAS或幂等断言。World运行时浏览器的计划事件夹具补足backgroundText/goalText。

## 本次验证记录

- 解析/Runtime/事件生命周期定向：48/48通过。
- `npm run prompts:check`：82/82通过；100项资源路径/正文/hash等静态约束保留。
- `npm run check`：52个文件、1933/1933通过；包含ESLint、TypeScript和Vite生产构建。Vite仅有既有大包体积建议，无构建错误。
- 完整Chromium初轮：300项中296通过、4失败；两项World夹具缺新字段，补齐后定向通过；两项记忆保存屏障用例在重启Vite后通过，记忆业务/用例均未修改。开发期间Vite HMR会使测试原型屏障不再对应原实例，不以该次结果冒充全绿。
- 失败用例桌面+移动定向重跑：4/4通过。
- 最终冻结代码后执行 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：300/300通过（桌面150、移动150，20.3分钟）；保留原294项，新增6项。本次最终运行退出码0，无失败、跳过或中断。开发期为补充边界回归曾主动中断运行，未计入通过结果。
- `git diff --check`：通过。
- 所有模型请求均为Mock；未调用真实付费模型，未操作正式玩家存档，未修改main、合并或主动部署。

## 已知限制与费用边界

- AI负责预计耗时、现实因果与结果分类。确定性校验不声称证明自然语言真实，也不增加AI裁判。真实模型遵循效果尚未经付费实测。
- 旧缺预计时间的活跃事件不会被程序自动补造为到期；World可合理重新规划，不能静默将历史计划认定成功。
- World单次输出仍受现有Token预算限制，大量积压可能需要玩家显式重试；本轮不增加逐事件收费或自动连环请求。由于候选整批验证，不能保存半批清理。
- 最小retiredEvents身份、永久journal与原有appliedCommands凭据继续增长；凭据内可能包含旧命令快照。本轮不重构幂等账本，普通事件不会继续堆积于完整活跃events表。
- 无独立公开依据的重大秘密保持内部；不实现角色迷雾、额外披露AI、后台财务操作或NPC任务成果重构。自由文本中的任意非规范引用不可能由程序完整识别，正式结构引用和已采用来源格式保持可追溯。
- PR #49仍是未合并Draft；本实现以独立分支替代其错误Event OR方向，没有关闭、合并或挪用该PR。

## 文件清单

- `EVENT-LIFECYCLE-DEVELOPMENT.md`
- `docs/CURRENT_ARCHITECTURE.md`
- `docs/README.md`
- `docs/WORLD_EVENT_LIFECYCLE.md`
- `e2e/event-lifecycle.spec.ts`
- `e2e/world-handoff.spec.ts`
- `e2e/world-runtime.spec.ts`
- `prompts/docs/ASSEMBLY.md`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/03_time_events.md`
- `prompts/shared/07_command_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `prompts/stages/opening/world.md`
- `prompts/stages/regular/world.md`
- `src/domain/commands.ts`
- `src/domain/drafts.ts`
- `src/domain/events/lifecycle.ts`
- `src/domain/events/schedule.ts`
- `src/domain/events/schema.ts`
- `src/domain/npc/lifecycle.ts`
- `src/domain/state.ts`
- `src/domain/timePreflight.ts`
- `src/domain/turnCommit.ts`
- `src/executors/variableText/aggregateDiagnostics.ts`
- `src/executors/variableText/catalog.ts`
- `src/executors/variableText/compile.ts`
- `src/executors/variableText/diagnostics.ts`
- `src/executors/variableText/entities.ts`
- `src/prompts/context.ts`
- `src/services/storage/migrations.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/turnCommit.ts`
- `src/services/validation/worldDependencies.ts`
- `src/services/validation/worldEvidence.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/domain.test.ts`
- `src/tests/event-lifecycle-runtime.test.ts`
- `src/tests/fixtures/game.ts`
- `src/tests/fixtures/variableReply.ts`
- `src/tests/live-text-turn.test.ts`
- `src/tests/npc-memory-review.test.ts`
- `src/tests/npc-memory.test.ts`
- `src/tests/opening-time.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/saveRepository.test.ts`
- `src/tests/turn-commit.test.ts`
- `src/tests/variable-commands.test.ts`
- `src/tests/world-handoff-review.test.ts`
- `src/tests/world-handoff-review2.test.ts`
- `src/tests/world-handoff-review3.test.ts`
- `src/tests/world-handoff.test.ts`
- `src/tests/world-validation.test.ts`
- `src/ui/panels/playerView.ts`

### 最后边界复核

新到期队列曾使纯过去视角（已有严格限定的只读模式）被迫处理当前积压事件。先新增真实parseWorld失败测试复现，再仅在此既有只读模式跳过到期消费，并给World明确readOnly上下文。积压原记录不删除，下一正常回合仍调度；不是普通World跳过到期的开关。新增一项回归，未新增Schema或请求。完整最终测试结果见以上验证记录。

另一项到期队列权限一致性回归确认：开局同伴即使离场仍受原World保护，不能因新队列而被强制场外结算。该节点单列scenePending，不扩大World权限；普通后续回合仍按原在场/场外规则判断。两次最后复核均先新增失败测试，再最小修补。

取消时间边界也先通过真实World+Archive回归复现：旧通用startAt≤resolvedAt会拒绝未来安排的提前取消。现仅cancelled允许实际终止早于原计划开始，但仍不得晚于正式候选时钟；resolved正常结束维持原顺序。清理后的紧凑记录使用同一规则，公开重大取消可按真实时刻归档，不伪造未来日期。

## 最终交付状态

基于main@9d930cf的独立分支codex/world-event-lifecycle；所有业务代码在最后完整浏览器验证期间保持不变，后续提交仅补录本报告。32项新增工程回归、6项新增E2E全部通过；未删除原有测试。`git diff --check origin/main...HEAD`与工作区diff检查均通过。

正式GameState在任何World候选、取消、失败、刷新或预览阶段均保持不变；仅现有正式回合事务能应用结果。没有真实付费API测试、合并或生产部署操作；PR预览由现有Cloudflare自动流程处理，不等同于生产发布。
