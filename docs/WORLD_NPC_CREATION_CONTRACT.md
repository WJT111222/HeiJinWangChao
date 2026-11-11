# World 新建 NPC 连续失败：契约与同批覆盖修复

## 基线与范围

开工与远端 main 核对：`3fe087fa6986649a415932db6c21abefd1a1ae68`（PR #103 已合并）。独立分支 `fix/world-npc-creation-contract`。

本轮修复正式加载的 World 创建契约、示例及一个同批新人物的模块覆盖缺陷。**没有修改 DomainCommandSchema、NpcCreationSchema、GameState V9、领域权限、记忆内容/算法、组织系统、地图实现、Commit、CAS、撤回、请求次数、自动重试或超时。**

## 两份真实日志的离线核对

完整读取用户日志14、17及其 World 原文，仅在本地进行回放。原始人物姓名、身份键、回合ID、金额、家庭叙述与完整原文不提交到Git；永久回归使用独立虚构的脱敏结构样例。

没有原始正式存档、选定Story和Variables候选，因此以最小合成状态隔离校验：为响应所需的正式身份/地点提供合法记录，正式revision取0，来源回合匹配响应，时间窗口包含该次人物记忆。它不是玩家存档，不证明原存档下整批一定可以提交。

| 输入与步骤 | 实际结果 |
| --- | --- |
| 日志14原文 | `permission / actor_permission / worldCommands.1 / CreateNpc`，与提供的错误一致 |
| 只移除第一位新人物的affinityConfirmed | 第二位新人物的相同标记仍失败，定位`worldCommands.2` |
| 两位均省略该标记 | 在上述合成状态下，6条worldCommands、1条SaveTask、2条SaveEvent通过解析投影校验 |
| 日志17原文 | 同样首先在`worldCommands.1`的affinityConfirmed被拒绝 |
| 只移除该标记 | 男性privateProfile继续失败；这一步实际为`data_integrity / domain_state`，不是原先尚未越过的actor_permission |
| 再移除男性privateProfile | 在上述合成状态下，5条worldCommands、1条SaveTask、1条SaveEvent通过解析投影校验 |
| 将合成窗口结束点提前一分钟 | 两份均在RecordNpcMemory报`time_data / event_time`（分别worldCommands.4、worldCommands.2） |

这里的“通过”只表示受控合成上下文中的离线解析/领域投影，不代表原始存档和真实开局验收。原文回放两项测试通过，临时脚本已移出项目，公开仓库不包含原始会话。

### 根因一：模型看到的Schema与World实际权限不一致

`src/services/validation/commandCatalog.ts` 原来为World输出通用NpcCreationSchema：仍可见`affinityConfirmed:true`、一般好感范围、互动时间，以及不区分性别年龄的特殊人物privateProfile。

但`worldOutput.ts`的CreateNpc要求场外、affinity=0、未确认、无互动时间、内联记忆为空；`commands.ts`还在实际创建时要求privateProfile仅属于合资格女性特殊NPC。原文字只有“好感中性0且未确认”，不足以说明亲属关系与数值确认不是一回事，容易让模型为表达亲属关系而额外填true。

两个真实错误的第一阻断都是初始确认标记。男性私密档案是日志17中仍未暴露的下一项独立失败。男性特殊NPC本身是合法类型，不应改成普通身份来规避。

### 根因二：合法新人物记忆会在WorldStage再次被误拒绝

进一步使用真实WorldStage测试发现：`parseWorld()`通过以后，`WorldStage.generate()`调用`assertWorldCoverage(selection.domains, projectTurn(state,draft), worldCommands)`；该投影尚未包含本次World新人物。

`assertWorldCoverage()`原先只查`state.npc[id]?.kind`，新人物的RecordNpcMemory因此形成`npc_undefined`，误报`domain_modules`。三种合法新人物的真实候选保存均复现该问题。日志14/17都包含“CreateNpc之后RecordNpcMemory”，所以只修两个字段仍不足以完成这类候选。

本轮唯一执行链修改是在`src/prompts/worldDomains.ts`建立本批CreateNpc的`id→kind`索引。检查UpdateNpc/RecordNpcMemory时优先读正式/Variables投影中的人物类型，只有缺失时才读取本批合法创建类型；仍必须有对应NPC域。缺失人物、缺失模块、现场权限、来源与时间仍拒绝。该处不写记忆，也不替换其文本或来源；WorldStage此前已经执行正常解析与领域验证。

## 正式契约修复

### 发送给模型的Schema

只在`commandCatalog('world')`生成后的JSON Schema上描述既有权限：

- 从创建对象的模型字段中移除`affinityConfirmed`和`lastInteractionAt`，严格additionalProperties边界继续存在。
- `onScene.const=false`、`affinity.const=0`，`memories/knownInformation.maxItems=0`。
- 保留特殊人物的privateProfile七字段；使用draft-7条件，仅female且年龄缺省或>=18时允许该对象。已知未成年、男性、未知性别不允许。
- 年龄缺省兼容来自现有领域规则，没有为了本轮新增年龄推断或收紧旧口径。
- 不改变Variables命令说明中的既有字段能力，更不改变保存/解析Schema。

这不是输出清洗：真实模型若仍返回非法true/false、男性privateProfile等，原程序仍整批拒绝，不偷偷删除字段或制造成功。

### 实际加载的提示词

`prompts/shared/08_world_output.md`新增“World新建NPC初值”，普通/特殊场外模块引用此规则，COMMAND_CATALOG的权限说明同步更新。正式开局和普通回合均经过真实composePrompt验证，最终messages里的COMMAND_CATALOG也核验了相同约束。

要求：affinityConfirmed必须省略，不填true、false或null；0是技术占位，不代表不存在亲情或感情。亲属、认识多年、婚姻关系用relationshipText/identity/background表达，不能据此确认数值。普通、特殊男性、合资格女性各有完整npc字段对象示例；特殊类型正常建档，不强制增加记忆或转换身份。

私密档案保留全部原字段：bodyDescription、chestDescription、pussyDescription、isVirgin、firstExperienceTarget、firstExperienceTime、firstExperienceText。男性体态可写普通appearance/healthText，不能塞入privateProfile，包括空对象。未知内容可省略，示例占位句不能当真实经历。

记忆分开RecordNpcMemory；同批任务、人物、地点和组织必须使用真实或本批合法创建的稳定ID，offscreenTaskIds归属本人；active任务开始不晚于已确认停止点，记忆时间在正式World窗口内。

Manifest刷新三个资源的字数/hash。sources.lock追加worldNpcCreationContract，保留旧来源与此前适配；两个原verbatim场外资源明确标记本轮适配并记录previousTreatment，没有伪称修改后仍是原文。

## 新地点、引用和时间的检查结论

- 两份响应均把海外城市放在china下。当前LocationSchema只有ID/名称/可选parentId，程序保证父级存在、无环，**不具备“苏黎世属于哪个国家”的语义审查**。在china确实存在时，该错误父级能够通过原结构校验。
- 本轮仅在World提示词与命令说明强调parentId是真实地理从属，不是默认根/角色国籍；复用正确国家，或先创建国家再创建城市，未知上级可省略。没有改地图、地点Schema、层级算法，也没有城市关键词白名单。
- 同批新地点供NPC、任务、主子事件和入场安排引用，继续使用现有校验链。缺父地点、错误任务行动者、缺主事件、未来active/记忆、非法固定时间继续拒绝。
- 日志的特殊NPC.offscreenTaskIds与SaveTask、组织keyNpcIds与新人物、事件linkedTaskIds等，在控制状态中具备一致的结构；缺失的任务反向关联仍由既有确定性补全处理，未改组织/任务/事件规则。
- 未获得原始存档，不能确认相关身份/地点是否早已存在、别名是否撞档、companion和住宅引用是否与正式记录一致；也不能确认原Story的开局开始/结束时间、Variables投影、revision。两个响应的年龄/履历文字有差异，无法只凭输出判断哪一份符合原背景，不新增内容审查。
- World的历史/记忆叙述没有直接执行主角转账。本轮不凭叙述宣称玩家余额正确，也不代替Variables处理财务。

## 回归与验证

`src/tests/world-npc-creation-contract.test.ts`与`fixtures/worldNpcCreation.ts`使用虚构人物/组织和独立ID：

- 普通、特殊男性、成年女性（原七字段）、现行女性年龄未知兼容；亲属关系不导致affinityConfirmed。
- 非法true/false、男性/普通/未成年/未知性别私密档案、内联记忆、在场、非零好感、互动时间均继续拒绝。
- 下游任务、组织、主子事件、新地点与待回应入场；原状态不变、主角不移动或接受邀请，不重做付款。
- 实际WorldStage→候选保存→Commit→重载→幂等重放，三类各单次Mock请求；不存在的类型/域不绕过。
- 错误地理父级不伪称被程序修复，缺失父级仍拒绝；时间窗口边界仍约束记忆、任务与事件。

`e2e/world-npc-creation.spec.ts`在真实React界面中验证：

1. 同批创建三类人物并自动Commit；稳定引用、七字段、重载、原人物记忆/总结/经济原样；恰好Story/Variables/World三次Mock。
2. 故意返回非法确认，仍保存失败、正式档不变、Story与合法Variables保留；不自动付费重试。玩家明确点击继续后只重试World，总计四次Mock；世界时间只推进一次。

### 最终代码验证（各批次独立统计）

| 批次 | 通过 | 失败 | 跳过 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 五文件定向Vitest | 111 | 0 | 0 | 新契约、World、入场地点、统一人物记忆、组织运行时 |
| `npm run check`完整Vitest | 3061 | 0 | 0 | 117个文件；89.46秒；同一命令的Lint、TypeScript、生产构建也通过 |
| `npm run prompts:check` | 93 | 0 | 0 | 3个文件，含实际composePrompt验证 |
| Chromium desktop最终批次 | 19 | 0 | 0 | 无重试、无flaky |
| Chromium mobile最终批次 | 19 | 0 | 0 | 无重试、无flaky |
| Chromium完整选定批次 | 38 | 0 | 0 | 上述两个项目的一次完整运行；155.29秒 |

最终浏览器命令：

```bash
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/world-npc-creation.spec.ts e2e/world-runtime.spec.ts \
  e2e/automatic-settlement.spec.ts e2e/npc-unified-memory.spec.ts \
  e2e/xianggui-private-profile.spec.ts \
  --project=desktop --project=mobile --reporter=list,json
```

`git diff --check`通过。构建仅有既有的大于500 kB分包提示，无工程错误。测试后重新fetch核对远端main仍为上述基线，没有集成差异。上述验证针对提交中的最终代码；随后只补充本文执行记录。没有运行无关Chromium全量集合。所有模型网络均Mock，未发真实付费请求。


### 开发失败与复测记录

- 原文私有离线回放：2/2通过，表示正确复现上述失败顺序，并非原文原样可接受。
- 新用例初跑17通过/8失败，其中三个断言误把旧fixture自带消费算作World副作用；已在合成fixture只保留其时钟指令，未改生产财务规则。
- 修正夹具后的旧实现20通过/6失败：两个实际提示/Schema断言、三个真实WorldStage和一个模块覆盖回归失败，复现缺陷。
- 初次修复后26/26通过；补充非法false与年龄未知兼容后，五个定向文件111/111，提示词93/93；新增桌面/手机初跑4/4。
- 所有结果按独立批次记录，不相加冒充完整回归。

## 修改文件与不变边界

- `docs/WORLD_NPC_CREATION_CONTRACT.md`
- `e2e/world-npc-creation.spec.ts`
- `prompts/manifest.json`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `prompts/variableGroups/npc_ordinary/offscreen.md`
- `prompts/variableGroups/npc_special/offscreen.md`
- `src/prompts/worldDomains.ts`
- `src/services/validation/commandCatalog.ts`
- `src/tests/fixtures/worldNpcCreation.ts`
- `src/tests/prompts.test.ts`
- `src/tests/world-npc-creation-contract.test.ts`

组织系统代码、地图/LocationSchema、NPC与GameState Schema、记忆执行器与来源、事务/撤回/epoch、请求路由和重试实现均未修改。对组织/地点的操作仅存在于合成回归数据中，用于验证原有引用。原始学校JSON夹具与固定hash不变。

## 剩余风险与验收边界

1. Mock及离线重放证明契约已进入实际请求、既有规则未放宽、合法候选能保存和提交，不能保证真实模型首次就输出正确字段、地理或人物背景。需要后续单独授权的真实模型/实机验收，本轮零真实付费请求。
2. 没有原始GameState/Story/Variables，不能宣布玩家整批原响应在真实档案里一定通过；时间、引用冲突仍可能存在。地理事实由AI负责，程序不会自动修正错误国家归属。
3. World输出增加了约束说明和三类示例：共享World输出模块增加2713字符，普通/特殊场外模块各增加174字符（模块源文计数，并非最终请求Token）；命令目录也增加相应限制。没有裁剪资料或增加模型调用来抵消成本。真实模型若违约，仍明确失败，不自动重Roll。

保持Draft，不合并、不主动部署、不修改玩家存档，等待审查。
