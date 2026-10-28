# M8-P0C-3C-1：文本变量现场更新能力

## 云环境故障后的补丁重建

**本次为“云环境故障后依据会话补丁重建”，不是原工作区恢复。** 环境重新可用时仅有干净的work分支，位于`768546e`；原开发分支、未提交代码、报告和测试日志未保留，本地搜索及Git不可达对象检查也未找到副本。

本次根据会话中保存的6个既有文件修改记录、新测试文件完整文本和报告草稿，重新应用相同范围的8个文件。67项新增测试已全部重建，未发现需要另行开发的缺失功能或测试部分。原文件的校验和未留存，因此不宣称与丢失磁盘文件做过逐字节比对。没有重新设计或扩充功能。

原会话的67项新增测试、1660项工程测试、82项提示词检查结果仅作历史记录，旧Chromium结果未确认。本报告“本次验证”只采用本次环境重新运行的结果。

## 基线和边界

基线：`main@768546eadb51a9b717c768c072ccaedfe3e5e5bd`（PR #38 合并）。原开发分支为`codex/m8-p0c3c1-scene-variables`，本次新恢复分支为`codex/m8-p0c3c1-scene-variables-rebuild`。

本轮扩展现有文本执行器，继续复用 P0C-1 解析器、DomainCommand 和 commitCommands。没有新协议、候选结构、事实审批、独立凭据、覆盖许可或付费阶段；未接入正式模型请求或三阶段工作流。原解析器已支持所需路径和多行JSON，因此不修改其语法实现。

## 路径和领域命令

新增10个精确路径，原8个路径保留，共18种映射。所有实体路径使用稳定ID，不支持可变数字索引、任意深层赋值或整个表覆盖。

| 文本路径 | 操作/值 | 既有领域命令 | 本轮 |
| --- | --- | --- | --- |
| `worldClock` | set，带时区偏移的合法ISO时间 | SetWorldClock；待定开局由程序命令统一处理 | 新增 |
| `locations[location_id]` | set，`{"name":"名称","parentId":"可选父级ID"}`，不含id | CreateLocation，id由路径决定 | 新增 |
| `protagonist.locationId` | set，地点ID | UpdateProtagonist.changes.locationId | 新增 |
| `protagonist.profession` | set，非空职业文字 | UpdateProtagonist.changes.profession | 新增 |
| `protagonist.publicStatus` | set，公开身份/社会状态字符串 | UpdateProtagonist.changes.publicStatus | 新增 |
| `protagonist.legalStatus` | set，法律状态字符串 | UpdateProtagonist.changes.legalStatus | 新增 |
| `protagonist.skills` | set，完整字符串数组，可为空数组 | UpdateProtagonist.changes.skills | 新增 |
| `npc[npc_id].locationId` | set，地点ID或null（未知去向，最终须离场） | UpdateNpc.changes.locationId | 新增 |
| `npc[npc_id].onScene` | set，boolean | UpdateNpc.changes.onScene | 新增 |
| `npc[npc_id].lastInteractionAt` | set，合法ISO时间 | UpdateNpc.changes.lastInteractionAt | 新增 |
| `protagonist.healthText` | set，非空健康文字 | UpdateProtagonist | 保留 |
| `protagonist.emotionText` | set，非空情绪文字 | UpdateProtagonist | 保留 |
| `npc[npc_id].healthText` | set，非空健康文字 | UpdateNpc | 保留 |
| `npc[npc_id].relationshipText` | set，非空关系描述 | UpdateNpc | 保留 |
| `npc[npc_id].memories` | push，text/knowledgeKind/knowledgeSource/visibility对象 | RecordNpcMemory，personal层 | 保留 |
| `items[item_id].quantity` | add，非零安全整数 | UpdateItem | 保留 |
| `economy.cash` | add，负整数分 | SpendFunds | 保留 |
| `economy.onlineBalance` | add，负整数分 | SpendFunds | 保留 |

主角/NPC字段值直接复用已有 variableCommandSchemas 中的 changes Schema，不复制一套任意字段模型。技能以明确的 `set protagonist.skills = ["驾驶","教学"]` 整体替换，保留自然语言技能，不引入经验、力量或任意技能对象。当前不实现skills的add/push增量或按索引编辑。

地点创建只接受LocationSchema已定义的名称和可选parentId；不能改现有地点、提供另一个id或覆盖地点表。重复/跨表ID、缺失父级、自引用和层级环仍由原领域引擎整批拒绝。允许同批创建多层新地点及合法前向父级引用。

## 时间和批次执行

普通回合通过 `set worldClock = "2026-10-18T08:05:00+08:00"` 生成SetWorldClock，不从设备日期、正文关键词或凭据决定时间。日期必须符合现有GameTimeSchema，不接受无偏移本地时间或旧的冒号日期格式。

编译器把已有程序时钟及文本产生的普通时钟统一排列在批次前部；多个普通时钟保持它们之间的原顺序。其他命令保持文本顺序。原始行列位置、commandIndex和稳定commandId不因执行排序而改变。记忆使用本批最终时钟生成createdAtGameTime，互动时间由AI显式设置。这样“先写互动/记忆、后写本回合时钟”的合法文本也能执行，无须再要求模型通过文字证明耗时。

所有命令仍只调用一次commitCommands，只有一个模拟revision；没有逐条提交或写入数据库。时间倒退（包括同批先到9点又退到8点半）、未来互动或过期互动仍由原命令/数据规则拒绝。允许合法零耗时，不增加固定步长。

待定开局继续调用 openingTimeBase / openingTimeSelection / variableCommandsForTurn：程序 `opening-clock:<storyRevision>` 唯一应用Story endAt。文本没有时钟可以成功；文本等值时钟被规范化为同一程序命令，不重复加时；不同值整批失败。等价UTC输入也使用程序时钟的规范表示记录记忆。没有待定标记的旧存档沿用原有正式时钟，不重解释年代。

## 场景更新的最小领域调整

原来applyVariableCommand在单条UpdateNpc执行时就要求：入场必须已有地点、清除地点时必须已离场。因此“先onScene=true再locationId”及“先locationId=null再onScene=false”的最终合法批次会被中间状态阻断。

本轮只把这两项约束移到validateSceneTransition，按整批最终状态检查。新入场或显式清地点之后仍在场的NPC必须有合法地点，GameStateSchema继续保证其与主角地点一致。保留旧档NPC原本缺少地点、仅更新健康等非空间字段的兼容性。同批合法RetireNpc已经由原生命周期规则处理，不因最终人物移出活跃表而误拒。

主角移动时，原在场NPC仍须显式给出locationId或onScene更新；不自动决定谁跟随、留守或消失。现在仅提供同行NPC的新locationId也已足够，不强迫重复声明它原本就为true的onScene。未处理的原在场NPC、错误地点引用、同场却位于不同地点、在场且清空地点仍然拒绝。没有NPC同行证据扫描、人物在场审批或中文关键词判断。

## 完整成功示例

前提：普通回合，正式时间为2026-10-18 08:00（中国标准时间），`chongqing`已存在；follow/stay原在场，remote已存在但不在场。

```text
<thinking>本回合现场变量分析。</thinking>
<说明>主角与follow前往车站，stay留在原地，remote通过电话获知会面安排。</说明>
<命令>
set locations[station] = {"name":"车站","parentId":"chongqing"}
set protagonist.locationId = "station"
set npc[follow].locationId = "station"
set npc[stay].onScene = false
set protagonist.profession = "司机"
set protagonist.skills = ["驾驶"]
set npc[remote].lastInteractionAt = "2026-10-18T08:05:00+08:00"
push npc[remote].memories = {
  "text":"电话约好见面",
  "knowledgeKind":"reported",
  "knowledgeSource":"通话",
  "visibility":"npc_private"
}
set worldClock = "2026-10-18T08:05:00+08:00"
</命令>
```

真实解析→领域编译→内存模拟结果：时钟08:05，新增station；主角及follow位于station，stay离场但仍在chongqing；remote仍不在场，只增加自己的互动时间和私人转述记忆。其他人物记忆不变。整个批次只增加一次模拟revision，精确重放不重复新增地点或记忆；输入的正式状态不变。

## 完整失败示例

同一前提下：

```text
<说明>第二条命令引用不存在的地点。</说明>
<命令>
set protagonist.emotionText = "轻松"
set npc[remote].locationId = "missing_location"
</命令>
```

解析和字段编译可以成功，但真实commitCommands内存模拟因无效地点引用失败；不返回部分执行状态，主角原情绪及正式存档均未改变。类似地，`set locations[clinic] = {"name":"覆盖旧地点"}` 会因为重复ID失败；没有逐条吞掉错误或继续部分结算。

## 请求、权限与正式工作流边界

- 仍使用现有state/context快照、原AST、commandId和appliedCommands机制。Story重Roll、执行尝试或正式revision变化，旧计划不能覆盖新状态；同ID改内容、删改已执行批次也不能重放。
- 没有恢复proofs、expense凭据、memorySource、互动授权、候选封印或coverage许可。AI决定NPC记忆的observed/reported/suspected及显式visibility，执行器只写指定档案，不自动传播给其他人或公共记忆。
- 没有新增World的后台调度、任务/事件/组织推演。离场NPC的显式状态更新属于当前选定Story的Variables输入，不是自主场外行动生成器。
- 正式JSON变量请求、Story/World/TurnCoordinator、SaveRepository、StageGuard、CAS、回合提交和模型路由未接入新文本执行器。共享领域层只做上述小范围最终场景检查调整。
- 3A只读桥接仍返回原精简摘要；新增普通时钟变化时clockKind=updated，避免误报unchanged。没有把它升级为正式候选或完整存档返回值。

## 仍不支持的现场能力与提示词差异

未增加：新NPC建档、好感度结构、特殊NPC目标/长期记忆、联系人登记、装备变更、获得/转移新物品、完整收入/借还款文本映射、现有地点重命名/重新挂接父级、技能增量/对象式编辑、clear/delete任意字段。这些既有领域能力中有的仍可通过现有JSON流程执行，本轮没有删除它们；文本映射只按本任务扩充。

正式模块化Prompt/Manifest全部保持原样。当前shared/07_command_output及阶段提示词仍要求旧JSON领域命令；没有要求正式模型立即输出本报告的路径语法。已有时间协议、命令目录与变量组规则仍用于正式链路，后续专门的协议改造需统一说明新路径、ISO时间、location创建值格式和技能数组语义；本PR不增加JSON/Text兼容层或额外请求。

## 本次重建验证

本次先重建完整67项测试，在未应用补丁的768546e基线上重新执行：36项通过、31项失败，0项跳过；失败覆盖缺失的时间/地点/状态映射及原领域入场/离场顺序缺口。再应用会话补丁，定向4文件246项全部通过（67+105+41+33）。这两次均是本次环境实际执行，不引用旧日志作为证据。

原报告草稿记载过首次fixture缺少journal、修正后9项能力和2项分步场景反例失败的调试过程，仅保留为历史背景；本次使用已经修正的fixture。新测试共67项，真实调用解析、编译和commitCommands模拟。旧执行器测试仍105项：针对新能力更新4个“不支持路径”预期为错误类型拒绝，并将1项onScene未映射断言改为合法入场执行，没有删除或跳过安全测试。

本次已实际执行：

| 命令 | 本次结果 |
| --- | --- |
| `npm --cache /tmp/heijin-rebuild-npm-cache ci` | 成功安装143个包，无依赖配置修改 |
| `npx --cache /tmp/heijin-rebuild-npm-cache vitest run src/tests/scene-text-variables.test.ts --reporter=json --outputFile=/tmp/heijin-rebuild-baseline.json`（补丁前） | 67项：36通过、31失败、0跳过，用作缺口复现 |
| `npx --cache /tmp/heijin-rebuild-npm-cache vitest run src/tests/scene-text-variables.test.ts src/tests/variable-text-executor.test.ts src/tests/variable-text-bridge.test.ts src/tests/variable-commands.test.ts --reporter=json --outputFile=/tmp/heijin-rebuild-target.json` | 4文件、246/246通过，0失败/跳过；包含完整67项新增测试 |
| `npm run prompts:check` | 3文件、82/82通过，2.07秒；为工程测试子集，不重复计数 |
| `npm run check` | 45文件、1660/1660通过，测试86.83秒；ESLint零警告、TypeScript、Vite生产构建通过（构建1.82秒） |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 本次290/290通过，桌面145、移动145，19.6分钟；0失败/跳过/重试，未引用旧运行结果 |
| `git diff --check` / `git diff --cached --check` | 通过 |

现有1593项工程测试完整保留，新增67项，共1660项；无删除或跳过。保留既有大于500kB分块提示，不扩大范围处理。保护范围与基线diff为空：解析器、正式工作流、存储、AI Runtime、UI/app、Prompts/Manifest、现有E2E、package配置和正式存档Schema。

## 修改文件

- `src/executors/variableText/compile.ts`：新路径、复用字段Schema、程序时钟单次应用、时间前置和来源位置保留。
- `src/domain/variableCommands.ts`：移除两个中间场景状态检查，交由整批终态处理。
- `src/domain/sceneTransitions.ts`：终态场景约束、允许显式地点更新表达同行、兼容合法退场。
- `src/bridges/variableText/model.ts` / `index.ts`：普通时钟预演updated标识。
- `src/tests/scene-text-variables.test.ts`：重建原67项。
- `src/tests/variable-text-executor.test.ts`：原有用例与新增字段能力对齐。
- 本报告：依据原草稿重建，并增加本次环境故障、基线和新验证记录。

没有新增依赖，没有正式存档Schema或迁移变更，没有修改模块化Prompt、UI或凭证/设置。本轮全部使用固定样例/Mock，不调用真实付费模型，也不声称Mock等于真实模型验证。不自动合并、不主动部署生产环境；Draft PR预览可由现有Cloudflare自动流程处理。本次验证已通过，随即提交、推送新恢复分支并创建Draft PR，等待审查，不自动开始下一项协议接入。
