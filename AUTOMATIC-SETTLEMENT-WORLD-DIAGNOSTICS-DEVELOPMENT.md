# 真实游戏修复：World诊断、完整响应与自动正式结算

基线：`main@39b772dbbfd4b85423452ba3d6520684eb209bdf`（PR #50已合并）。分支：`codex/auto-settlement-world-diagnostics`。本轮不重构事件生命周期，不放宽现场/场外、来源、认知、时间、历史事实或事务约束。阶段实现已由`95d8f48`提交并推送，最终补充提交包含回归与验证记录。

## 已确认问题与复现边界

用户只提供了World的通用`invalid_output`日志。原版本请求检查不保存World模型响应，没有取得该次失败的完整输出，因此**只能复现同类错误，不能声称还原了具体历史故障或将责任归于模型**。

审计发现：`parseWorld`会丢弃非AiError的具体原因；`WorldResultSchema.safeParse`、新事件规划检查和许多requireWorld只抛通用错误；上层运行日志没有World规则位置。JSON、Schema、来源、角色、时间和生命周期失败因此难以区分。原变量弹窗主要显示命令名，原文没有保存；原commitTurn还要求非空nextAction，把当前结算与下一次行动绑定。

先写8项失败复现，基线实测**7失败、1通过**：非法JSON无World分类；缺少顶层字段无字段说明；缺预计结束日期无法定位；来源/时间错误没有规则及命令位置；现场越权无定位；事件时间冲突为通用错误；空下一行动被Schema拒绝。合法新场外事件作为通过对照。随后使用真实runStageRequest、TurnCoordinator、fake-indexeddb提交链建立新增自动运行回归。

## World诊断与协议一致性

新增`worldDiagnostics.ts`，安全诊断包含原有错误码、World规则、静态字段路径、原始命令序号和已注册命令类型。Schema路径仅保留固定字段/数组位置，未知名称替换为field；不复制非法值、NPC文本、供应商异常正文、URL、头或凭证。安全日志仍只存在页面内存，完整响应使用独立入口。

已细分JSON、Schema、来源凭据格式/引用/时间/知识类别、场外权限、事件规划/时间/状态、完成条件/结案/取消依据、角色知晓、到期未处理、历史成果、任务占用、投影数据、请求版本、模块和凭证回显等规则。没有足够信息的约束仍明确为constraint，不伪造唯一语义原因。JSON/Schema失败、事件时间和来源引用反例已由实际验证链复现；WorldStage的请求基线、领域覆盖与凭证拒绝也提供安全分类。

保留原requireWorld、WorldEvidence、actor白名单、ownerNpcId/worldEventOnly、主角已知快照、任务唯一占用、时间窗口、due处理、前序依赖、清理、主线保护和历史facts规则。仅给原检查附定位；预计结束早于开始的判断提前报告已有领域时间错误，不改变有效事件集合。

仅最小调整共享World输出资源：澄清futureEvents只允许新scheduled镜像；结构化decision取消与旧outcome凭据是替代关系，不是同时必填；补充合法空数组结果及既有事件自主变化/角色认知区别。COMMAND_CATALOG仍提供真实Schema，不改World JSON协议、Story/Variables主模板、世界书、NSFW、Thinking或模型POST地址。Manifest版本/字符数/hash及sources.lock适配记录同步更新。

## 模型原文与规范化结果

`stageResponses`只在浏览器内存保留最近6次Story/Variables/World请求。运行时在协议解析之前记录供应商返回的模型文本，失败时保留收到的原文；成功时另外记录程序解析/编译/验证后的结果。Story的原文包括供应商实际返回的标签文本，原生思考仍沿原专用入口，不要求或声称读取隐藏思维链。

保留顺序、Unicode、换行及全部可接受长度内容，不摘要、不截断、不将JSON重新格式化成“原文”。规范化JSON另行标注。实际凭证、编码形式和常见认证字段脱敏；React文本节点渲染，不执行响应中的HTML/脚本。既有AiClient单次安全上限仍保留，传输层尚未形成可用文本时不捏造原文。

游戏工具区新增轻量折叠入口，三阶段及失败响应均可查看；候选弹窗首先显示模型原文，再提供规范化候选。原文区在现有滚动容器内，避免窄屏展开后覆盖恢复操作。默认关闭时不将响应挂入普通正文；主动查看不改变人物知识、正式状态、日志或journal，不触发请求。

刷新或淘汰后明确显示原文不可恢复，不能将保存的命令重新当作模型原文。没有新增正式存档字段、第二套候选协议、数据库或迁移。

## 自动正式结算状态流

```text
创角的单次授权 / 玩家明确开始或恢复
  → 原TurnCoordinator按Story→Variables→World运行并保存候选
  → 协调器释放会话/Web Lock
  → 检查本次页面授权仍有效、outcome完整、completeTurnDraft成立
  → 原SaveRepository.commitTurn(nextAction="")
  → 事务内重读并重验所有候选、revision、草稿指纹及回执
  → 原子写入世界状态、journal、记忆、回执和空的regular草稿
  → 等待玩家输入，不发起下一回合请求

玩家发送行动
  → bindTurnAction只允许空待输入草稿，检查整份指纹与正式revision
  → CAS绑定该行动，不提升正式revision
  → 原协调器生成三阶段并自动提交
  → 再次等待输入
```

新增的`generateAndSettleTurn`只连接原协调器和commitTurn；不重写三个执行器。提交放在协调器退出后，避免嵌套同存档StageGuard/Web Lock。锁衔接期间若其他标签先更新，原提交重新重验、CAS拒绝；不移除任何乐观锁。

TurnSubmission接受精确空字符串作为“结算后等待输入”；纯空白仍非法。GameState、TurnDraft形状、Schema版本、IDB结构版本和旧迁移均不变。新增bindTurnAction仅能绑定未生成的空regular草稿，保留稳定turnId，以事务保证快速双击及多标签只有一次成功。已绑定行动仍不能通过saveDraft改写。

兼容旧版本已完成、尚未结算的草稿：主动“完成本回合结算”不重复请求已完成阶段；若此时直接发送行动，沿旧原子提交绑定该输入一次，再生成并自动结算新回合。刷新/读档不自动调用模型或重新授予创角授权。

World失败不提交；已保存Story/Variables保留，明确恢复只补缺少阶段。完整候选遇存储失败可重验后只重试提交，不能再付费生成上游。关闭阶段/preview不自动提交，不强制开启阶段。取消和卸载在提交前检查授权，迟到请求不写入；进入不可中断的提交事务后不承诺取消成功。正式回合结算后历史不可重新Roll，未结算草稿仍保留原高级单阶段与Roll失效语义。

## 费用与兼容性

正常每回合仍为原三次阶段请求（尊重开关），没有额外模型、逐事件请求、AI修复或审批。沿用已有最多一次瞬时5xx重试；鉴权、429、网络、校验失败不新增隐式重试。自动结算本身不调用API，空待输入草稿不会自动生成，用户输入只绑定一次。

公开记忆自动维护仍依原设置授权、默认关闭及每次正式提交限制；自动结算使其触发时点随正式提交提前，并未扩大授权或自动整理NPC私人记忆。手动维护、凭证、模型路由均不变。

V1–V5读取、旧时钟/开局同伴/联系人、正文journal和分层记忆沿用原结构。旧回执使用相同提交数据时仍幂等；空下一行动只是新的合法调用参数，不重写旧回执。未操作正式玩家存档，所有数据为本地隔离Mock夹具。

## 验证记录

本轮日志目录：`/workspace/auto-settlement-verification/`。没有真实付费API调用。

| 检查 | 实际结果 |
| --- | --- |
| 基线失败复现8项 | 7失败、1通过，记录在before.log |
| 新增自动运行/诊断测试 | 18项；连同TurnCommit定向59/59通过 |
| World/Variables/Commit定向 | 最终12文件301/301通过，含NPC来源、生命周期、日志、CAS及回执；开发期6文件159/159通过 |
| npm run check | 57文件、2027/2027；Lint、TypeScript、Vite生产构建通过 |
| npm run prompts:check | 82/82通过 |
| Chromium桌面/移动相关13文件 | 实际执行200项：194通过、6条旧弹窗遮蔽断言失败 |
| 上述6项涉及的3文件完整复跑 | 桌面/移动42/42通过；与200项有重叠，不累加为242个不同场景 |
| 最终Lint、类型检查、diff检查 | 全部通过 |

保留原2009项工程测试，新增18项，总2027。保留原310项浏览器场景，新增4项，总314；本轮按任务执行相关200项，没有将未执行的114项标为通过。旧自动流程E2E按新产品要求改为完成即正式结算、空待输入、下一行动CAS绑定；继续保留请求次数、连续十回合、金钱、时间、人物/记忆、刷新、取消、失败恢复、并发和事务回滚断言。

开发期曾因两组Playwright共用服务器和产物目录并行运行，产生ENOENT/连接拒绝及竞争超时；已改为单批验证，不将该轮视为通过。新原文区的窄屏遮挡问题由真实点击复现后移到原滚动容器修复。单批200项最终剩余6条失败均为原弹窗要求不含模型文字，与本次完整响应要求冲突；仅改为原文区域应可见，并增加Story阅读区不含内部结果、正式状态不变断言，凭证和规范化结果隔离断言保留。没有删除或跳过测试，也没有放松数据规则。

## 剩余限制

- 用户历史失败的完整World原文未取得，不能断言具体是哪一条命令。后续可用本轮安全规则与临时原文定位真实供应商结果；Mock不等于真实模型已验证。
- 程序不证明所有自然语言事实；本轮只改善定位和一致性，原事实/来源/权限约束不取消。
- 原文只在内存，刷新/淘汰即清除；尚未形成合法模型文本的传输失败可能没有可显示原文。不增加持久诊断数据库。
- 关闭必要阶段的回合仍无法正式结算，需要玩家明确启用并恢复，不擅自收费补跑。
- 不新增正式回合回退、已提交正文Roll或终态事件披露机制。旧已知快照和事件生命周期边界保持PR #50的规则。
- 构建保留已有大于500KB的bundle提示，未顺手重构或新增框架。

未合并、未主动部署生产环境。PR预览若发生，由既有Cloudflare自动流程处理。

## 实际文件清单

本轮相对基线共修改/新增以下34个文件（包含本报告）。

- `AUTOMATIC-SETTLEMENT-WORLD-DIAGNOSTICS-DEVELOPMENT.md`
- `e2e/action-workflow.spec.ts`
- `e2e/automatic-settlement.spec.ts`
- `e2e/continuous-turns.spec.ts`
- `e2e/opening-time.spec.ts`
- `e2e/time-preflight.spec.ts`
- `e2e/turn-coordinator.spec.ts`
- `e2e/variable-runtime.spec.ts`
- `e2e/world-handoff.spec.ts`
- `e2e/world-runtime.spec.ts`
- `prompts/manifest.json`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `src/domain/turnCommit.ts`
- `src/services/ai/errors.ts`
- `src/services/ai/runtime.ts`
- `src/services/ai/stageResponses.ts`
- `src/services/storage/saveRepository.ts`
- `src/services/validation/aiOutputs.ts`
- `src/services/validation/worldDiagnostics.ts`
- `src/services/validation/worldEvidence.ts`
- `src/services/validation/worldOutput.ts`
- `src/tests/automatic-settlement-diagnostics.test.ts`
- `src/tests/automatic-turn.test.ts`
- `src/ui/game/GameScreen.tsx`
- `src/ui/game/RuntimeLogPanel.tsx`
- `src/ui/game/StageResponsesPanel.tsx`
- `src/ui/game/VariableCandidates.tsx`
- `src/ui/game/WorldCandidates.tsx`
- `src/ui/game/runtimeLog.ts`
- `src/ui/game/useTurnGeneration.ts`
- `src/workflows/automaticTurn.ts`
- `src/workflows/turnCoordinator.ts`
- `src/workflows/worldStage.ts`
