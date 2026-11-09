# 世界事件 V2 第三批：Story 事件入场裁定与叙事权

## 基线与边界

开发基线为远端 main `d0285e2201f67103195a42de4312f8c23df1193f`，含已合并 PR #87。独立分支 `feat/story-event-arbitration-v2`。

保留 Story → Variables → World，一轮正常生成仍只有三次请求。没有提前请求 World、逐事件调用、审核模型、付费修复、UI 重构或真实玩家存档操作。

## 原链路审计

- `prompts/planning/regular.md` 原 Step 0–14 没有独立的事件入场裁定步骤。
- `timePreflight.ts` 旧候选受标题模式、visibility、地点和角色关系约束。这些候选仍可提供旧 interrupt 兼容信息，但不够充当全局作者的事件入口。
- `events/interactions.ts` 只接受正式事件已有的 pending/presented `entryId`，不能表示无预先邀请的实际接触。
- `scenePermission.ts` 和 `stages.ts` 原提前结束只识别旧入场回执；纯后台阶段即使 Story 主动介入，也没有对应的有限结构授权。
- `timeOutcome` 接受 `time:pause`，但 `validateTimeCommands` 原先只保护 `time:interrupt:*`，暂停后的变量可以越过停止点。
- 第二批固定到期、唯一退役成果、自然承接及后台人物命令权限已有实现，本批继续复用。

## 新 Story Step

普通回合在 Step 11 后插入 Step 12，原 Step 12–14 原文保留、顺延为 Step 13–15；总体范围相应改为 0–15。没有新增程序化规划质量审查。

新增步骤实际内容见 `prompts/planning/regular.md` 的「世界事件与主角入场裁定」，分三个方向：

1. 判断当前时间、玩家跨度、主子事件正式身份与时间、地点、人物势力、角色知识和传播渠道是否交汇。
2. 自主选择亲自入场、自然获知或无需告知。需要重要决策时在真实交汇处停止，不替玩家接受、认责、付款或选择立场。
3. 尊重已成立事实：Variables 仅落实实际变化；World 继续未确定的后台发展；新后台结果不能倒退当前 Story 时间。

这属于现有 `<thinking>` 的公开创作提纲，不要求供应商隐藏推理，也没有额外 AI 阶段。

### 实际新增规划原文

> Step 12｜世界事件与主角入场裁定
> 
> 1. 判断时间和事件是否与主角交汇。综合正式世界时钟、玩家行动与预计跨度、主事件背景、既有小事件的startAt/fixedEndAt、地点人物势力关系、主角正式知识及可能传播渠道和已有入场安排，形成具体的规划提纲。EVENT_NARRATION_INDEX是只读身份和时间索引，完整档案在SAVE_STATE；TIME_PREFLIGHT只是旧辅助候选，不是入场许可清单。impact不决定是否中断，固定到期不代表通知或成功；不要为了决定入场先请求World。
> 
> 2. 独立决定参与方式。亲自入场：事件确实交汇且需要主角参与或决断，可以在实际交汇时刻中断原行动，将未作出的重要选择交还玩家；在变量规划用eventNarration的enter指向既有eventId及实际at。自然获知：通过真实新闻、通知、交谈或观察接触消息，用mention而非入场授权。无需告知：没有关系或渠道便不提及，也不输出无关记录，由World处理。全局作者可读取后台，人物不因此全知；不为凑齐三种方式制造事件，不替玩家接受、认责、付款或定立场。
> 
> 3. 尊重已成立事实与玩家选择。正文明确呈现的接触、消息与阶段结果是Variables和World的叙事前提；说明记录在该规划项的observedFact/textEvidence，不是数据库命令。已有pending/presented身份仍用eventInteraction，不伪造entryId。跨月跨年长行动若实际提前停止，正文只写到停止时刻，以time:pause及实际ISO时间落实；原fixedEndAt保持不变，合法Variables可以按真实入场时刻提前结束小事件。若只是获知或完全无关，时间可继续，后台由World依固定时刻结算。尚未由本轮World产生的未来结果不能预知，后来的新情况交给下一轮Story，不能倒退已定时钟。



## 最小结构化协议

保留现有五类顶层标签。在 `StorySchema.variableGuide[]` 新增可选字段：

```json
{
  "group": "event",
  "observedFact": "本幕实际成立的接触与结果",
  "textEvidence": "实际渠道与行为的简要说明，不作正文逐字匹配",
  "eventNarration": {
    "eventId": "正式事件ID",
    "mode": "enter",
    "at": "2027-02-10T12:00:00+08:00"
  }
}
```

`enter` 是实际介入；`mention` 是通过渠道获知消息。未涉及事件不输出占位记录。事实说明使用原 observedFact/textEvidence，不维护另一套 Story 真值。

程序只检查 group、唯一 ID、正式事件存在、时间与事件状态。enter 不能指向终态事件；实际接触不早于正式时钟和事件起点，不晚于已验证变量投影的停止时钟。没有标题词、impact 阈值、秘密泄露正则或文学语义评分。

现存 pending/presented 仍用原 `eventInteraction` 及真实 entryId。新 enter 不代替这条旧身份链，不能与旧回执混写、伪造或消费入场身份；mention 不消费已有邀请。旧回执的呈现、退出、拒绝、中断和失效行为继续保留。

## 只读作者资料与角色知识

Story 实际请求新增 `EVENT_NARRATION_INDEX`，包含正式 eventId、eventKind、parentEventId、status、startAt、fixedEndAt、estimatedEndAt、参与者/地点、visibility、精简入场身份及现有知情快照。不复制背景、目标、阻碍、摘要全文；完整资料仍在原 SAVE_STATE，全部 NPC 和记忆读取范围不裁剪。

索引包含隐藏和场外事件，供作者判断，不是主角已知清单。KNOWN_EVENTS、原 EVENT_ENTRIES/参与身份继续存在。是否披露及通过何种渠道传播由 Story AI 创作；程序不证明自然语言是否足够合理。新裁定本身不写 protagonistKnowledge、NPC memories 或其他认知，角色知识变化仍走原命令边界。

## Variables、World 与正式提交

`events/narration.ts` 从所选 Story 派生短生命周期的授权，只给本批 Variables 的 SaveEvent commandId 对应事件；不持久化授权表。JSON 模型命令无法携带此授权参数。

- 文本 Variables 的真实编译/模拟、旧规范化候选复核、World 的变量投影、最终 Commit 全部重用同一 Story 裁定。
- `scenePermission` 只增加 enter 对指定已有事件 sceneState 的权限，不增加事件规划、背景、参与者、固定时间、NPC、组织或经济写权限。mention 没有这个权限。
- `validateStageWrite` 允许该授权下的提前结案，实际 resolvedAt 必须为声明的 at；fixedEndAt 和其他正式规划仍不可改写。旧合法回执仍保留自己的已有规则。
- World 收到原 STORY_RESULT、VARIABLE_RESULT 及派生 eventNarrations 视图；Variables 已合法结束的小事件不能再被 World SaveEvent 重判。新 Map 只为变量命令授权，World 自己的命令不获得此能力。
- Story 只提及消息或不涉及时，后台仍按第二批固定截止正常结算；主事件整体估期不阻止小事件到期。
- 正式候选重验、CAS、revision、幂等、失败回滚、Undo 存储结构和 epoch 均保留。Roll 清除旧变量及 World 依赖；撤回通过原完整快照恢复新 Story 字段与世界状态，不保留旧分支。

叙事优先权依赖所选 Story 的结构结果与合法 Variables 落账，不通过程序比对小说全文。无法从自然语言自动证明 Variables 遗漏了什么，这仍由模型履行阶段职责。

## 实际停止时间与长跨度

主动接触不在旧候选时使用既有 `time:pause`，observedFact 为实际停止 ISO。`preparedVariableCommands` 稳定生成一个 `story-pause-clock:<storyRevision>` 命令，等值模型时钟合并；不同模型时钟拒绝，不能静默覆盖。没有模型 SetWorldClock 时仍落实暂停，不允许保留旧时钟假称暂停成功。

未验证 Variables 的 World 预览不应用暂停或现场授权；验证通过后 World 的 TIME_WINDOW 只到该实际停止点。旧 interrupt、开局唯一时钟、普通零耗时、无时间意图及纯历史回顾继续沿用；纯历史回顾不能混入新的当前事件接触。

补充有界、只读的自然月/年识别：跳过三个月、一年后再回来、直接过半年等完整表达使用中国本地日历，月末夹到目标月真实最后一天，跨年/闰年按日历计算。结果是目标日期整日的估计窗口，不伪造具体停止时刻，也不以30天替代一个月。复杂、模糊或未识别表达仍交给 Story 结合正式时间决定，未知不阻断合法的结构化暂停。

## 兼容性与成本

当前 V6 可读旧 Story、旧草稿与旧存档；新字段可选，无迁移。未分类旧事件和旧合法入场协议继续保留。旧客户端严格 StorySchema **无法保证**读取带 eventNarration 的新 journal/草稿，因此应统一升级客户端，不能用旧客户端剥离新字段后写回。暂停与时钟不一致的旧候选会安全拒绝，应重新生成 Variables，不应绕过已成立的停止点。

新增 Step、提示词协议、事件索引及裁定记录会增加输入/输出 Token。索引随正式事件数增长，原完整档案没有裁剪；World 的 eventNarrations 也是额外的请求表示。没有新增模型调用，启发式 Token 不是供应商计费 usage。

## 执行记录

全部使用合成状态、fake-indexeddb 与 Mock transport，不调用付费 API。各批次独立记录，不拼接数字：

- 修复前新6项测试：6失败。新Schema、暂停上界和自然月候选均复现缺口；其中初版 Step 用例还存在 opening draft 配 regular compose 的夹具错误，后续修正，不能把该配置错误当作 Step 本身的故障证据。
- 第一轮3文件：67通过、1失败，剩余是上述 compose 夹具；类型检查通过。
- 第一轮5文件：141通过、2失败，均为提示词旧来源哈希断言。保留旧 sourceSha256 和历史记录，追加本批记录并明确 adapted treatment；更新最新哈希断言，不跳过来源检查。
- 扩展23项第一次：6通过、17失败，合成已提交状态缺对应 journal；修正夹具以满足正式 V6 约束，不放宽 Schema。
- 第二轮两文件：46通过、4失败，SAVE_STATE 本就不重复包含永久 journal/appliedCommands、Repository.create 不接受伪造已提交世界；改为真实开局 Commit 后运行普通回合。
- 扩展23项第三轮：20通过、3失败，实际业务链已经完成提交及撤回，但断言误把输入回填当成 draft.userInput；按照正式 Undo API 检查独立 result.input，不改撤回逻辑。
- 新增 World 失败仅重试 World，以及旧入场身份/完整步骤顺延后，4文件定向115/115通过。

- 首轮完整 Vitest：2850 项中 2849 通过、1 失败、0 跳过。唯一失败是 thinking.test.ts 仍要求普通规划 15 步/45 要点；按本轮正式设计改为16步/48要点，保留原开局数量、完整资源哈希、唯一模式注入及实际messages断言。
- 实现冻结后的 Chromium 三文件：18/18，desktop 9、mobile 9，0 失败/跳过/flaky，131.2 秒。包含新主动 enter/mention 全流程、第二批固定阶段、旧入场回执。不因仅更新测试数量和文档而重复运行浏览器。
- Prompt 检查93/93；TypeScript、Lint、生产构建通过，构建有既存chunk >500kB提醒。最后计数断言改动后的TypeScript/Lint亦通过。
- **最终完整 Vitest：2850/2850，102文件，0失败、0跳过；新裁定测试26项。** 旧计数修正的定向两文件74/74通过后，重新完成此完整批次；没有把首轮2849与定向数量拼成一次全绿。
- 最终完整Diff自查及git diff --check通过。

命令：`npx vitest run src/tests/story-event-arbitration.test.ts src/tests/prompts.test.ts src/tests/time-preflight.test.ts src/tests/event-stages-v2.test.ts`；`npm test -- --reporter=json --outputFile=/workspace/story-arbitration-full-final.json`；`npm run prompts:check`；`npm run typecheck`；`npm run lint`；`npm run build`；`git diff --check`。

浏览器：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-event-arbitration.spec.ts e2e/event-stages-v2.spec.ts e2e/event-entry-feedback.spec.ts --project=desktop --project=mobile --reporter=json`。

本轮日志为 `/workspace/story-arbitration-*.log`，各完整批次 JSON 保留在 `/workspace/story-arbitration-full.json`、`/workspace/story-arbitration-full-final.json`、`/workspace/story-arbitration-browser.json`。不合并不同批次通过数量。


## 修改文件

- `domain/state.ts`：仅Story变量规划的可选字段；无GameState顶层/数据库版本变更。
- `domain/events/narration.ts`：正式事件裁定引用/时间、短期授权与索引。
- `events/interactions.ts`、`scenePermission.ts`、`stages.ts`、`domain/commands.ts`：复用旧入场链，只为变量命令接入所选Story的有限事件授权。
- `domain/timePreflight.ts`、`turnProjection.ts`：日历窗口、暂停时钟、实际接触时刻校验。
- `executors/variableText/index.ts`、`services/validation/aiOutputs.ts`、`turnCommit.ts`：文本模拟、规范化候选和正式重验一致；`executors/variableText/catalog.ts`同步说明。
- `domain/storyDiagnostics.ts`：有限安全错误子类型与字段白名单。
- `prompts/context.ts`：紧凑事件索引及已有Story结果的派生裁定视图。
- 五个Prompt、manifest、sources.lock：步骤和实际协议同步；原始来源哈希保留，追加本批适配记录。
- `tests/story-event-arbitration.test.ts`、`prompts.test.ts`、`thinking.test.ts`、`e2e/story-event-arbitration.spec.ts`：回归与正式数量断言。
- 本报告。没有修改UI、事件持久化Schema、Undo/Commit存储实现、模型路由或重试策略。

## 静态协议成本测量

相对于基线，以文件Unicode字符精确计数：regular规划4832→5645（+813）、regular Story727→849（+122）、shared03 3613→4042（+429）、shared06 1959→2751（+792）、shared08 8709→9005（+296）。这是资源文件增量，不是三个阶段各自的实际计费Token；不同阶段按实际模块加载，还有事件索引和裁定视图的动态体量。现有最终messages检查器仍可观察真实请求统计，本轮未剪裁任何完整资料或改其执行机制。

## 剩余限制

结构化 at 是实际接触时刻，不是程序从正文推测的时间；模型必须正确填写。Story 在后台上下文中知道秘密，并不代表模型一定始终写对角色知情，Mock 不能证明真实模型文学质量。复杂长跨度自然语言不穷举解析，旧预检仍有自己的辅助筛选；它们不再是主动入场许可。没有实现第三种自动触发请求或让 World 回退当前 Story 的机制。
