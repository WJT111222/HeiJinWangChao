# 三阶段共享记忆召回 V2（PR B）

开发基线：`main@e1cabb65a8f0ce3ccfcc3e008b1ec522b84b94e5`，PR #73 已合并。开工已通过远端 `ls-remote` 与 fetch 核实。独立分支：`codex/shared-memory-recall-v2`。

本次只改本地召回和上下文装配。Story、Variables、World 共同调用 [`recallJournal`](../src/domain/memories/recall.ts)，补充近期窗口外的永久 journal 原文。模型仍读取 PR #73 的完整正式世界资料；没有新增模型请求、外部检索或存储字段。

## 一、原实现与真实数据边界

旧 `history.ts/recallHistory` 使用 `Intl.Segmenter` 分词，以输入关键词在正文/摘要中是否出现评分。底层 `searchHistory` 虽支持显式 ID 和 ActorRef，但旧三阶段调用只传玩家原始输入，没有传结构化实体。默认最多三条旧史、6000文本字符、每条摘要400/正文1500字符。Variables、World 不分析本轮正文、variableGuide 或已验证变量结果，改名、离场人物、后台任务的历史来源因此容易遗漏。旧摘录只有截断布尔标记，没有原始提取范围。

核对 V6 后，没有补造不存在的关联：

| 已有资料 | 可用的可靠关系 | 不能假设的内容 |
| --- | --- | --- |
| journal | turnId、revision、relatedActorRefs、完整 Story | 没有独立世界时间、任务/地点/物品引用；ActorRef仅主角、NPC、组织 |
| 分层/NPC原始、长期、个人总结 | affectedEntityRefs、sourceTurnIds、NPC所属ID | 压缩摘要的联合引用不证明每个角色参与每个来源回合 |
| 事件及退役事件 | actorRefs、sourceTurnIds、linkedTaskIds、predecessorEventIds | 不把visibility或是否在场变成读取禁令 |
| 任务 | actorRef、linkedEventId、handoff.fromTaskId、resolution.sourceTurnId、目标与阻碍 | **没有任务创建sourceTurnId**；缺失时用真实文本线索，不虚构创建来源 |
| timeline | sourceTurnId、actorRefs、sourceRef、eventId、relatedEntryIds、locationId | 转述/推测不升级为客观事实 |
| 人物、组织、物品、地点 | 稳定ID、姓名别名、组织成员/当前任务、物品ownerRef、地点父级 | 同名、文本提及或当前归属不证明历史身份和参与关系 |

旧 `searchHistory`、`recallHistory`、`storyMemoryContext` 仍保留给既有历史/UI及独立公开记忆逻辑。**三阶段生产请求统一走新引擎**，不存在三套检索器。压缩和NPC总结调用链未改变。

## 二、算法与评分

1. 只读建立本轮实体和来源索引。文本用 NFKC、大小写归一和中文 `Intl.Segmenter` 分词，不依赖空格，不使用剧情词表模拟语义。稳定ID独立保持大小写、按完整ID匹配。少量通用停用词与纯数字词不构成文本检索信号，避免变量时钟里的“10”“08”命中第108回合等无关正文。超过40%回合共同出现的词不再独立贡献文本分，实体/来源证据仍保留。
2. 解析当前输入和阶段线索中的稳定ID、唯一姓名别名。重叠名称按最长文本占位：找“张三丰”不会把“张三”提升成实体身份；重复姓名不自动选择任一身份。短名字仍可能是普通文本命中，输出会如实标记无实体证据。
3. 加入现场NPC、相关活动任务/事件、World后台计划和到期工作。通过**两跳显式有向关系**扩展，逐跳减15分；不沿主角这个全局枢纽扩展所有历史，也不反向遍历一个人物参与过的所有事件。当前地点只佐证已命中的历史，不能单独把全城旧事塞进请求。
4. 聚焦人物的姓名/别名、当前关系背景，以及选中任务/事件的目标、阻碍、交接等文本补充词线索。这里不生成实体边，不把任务描述解释成不存在的来源。每个派生资料最多2000字符、合计8000字符。
5. 汇合真实 journal ActorRef、记忆/事件/timeline来源和文本命中，按一个turnId产生一项候选。来源重复采用最大证据分，**不按摘要重复次数叠加事实或分数**。

实体选择权重为：显式ID100、唯一姓名别名90、现场NPC80、直接相关活动计划70、World其他活动计划65、到期任务/事件95。已终结的无关重大事件不会仅因存在于完整世界状态而成为查询；World的活动后台任务本身是合法推演工作，仍能查其起因。

最终分数为：

```text
真实journal ActorRef命中：90（有则一次）
+ 最大来源证据：选中事件/实体的权重；记忆引用为min(85,关联实体权重)
  或仅记忆文本来源命中 min(65,35+6×命中词数)
+ 文本分 min(40,6×摘要命中词数+3×正文或摘要命中词数)
+ 来源事件重要性：major 10 / significant 5
+ 当前地点对已有相关来源的佐证：4
+ 顺序新近度：0～4
```

没有实体、来源或文本命中就没有候选，新近度和重要性不能自行填满预算。第8回合有强实体/来源证据时，可以稳定排在第190回合的弱文本命中之前。排序为分数降序、回合序号降序、turnId稳定比较；相同输入重复检索可重现。不同运行环境的 ICU 中文分词版本仍可能影响词线索，不声称跨所有浏览器分词结果完全一致。

## 三、三个阶段的线索与正式基线

| 阶段 | 输入线索 | 状态与候选边界 |
| --- | --- | --- |
| Story | 当前玩家输入、地点、现场NPC、人物别名/关系/背景、相关任务事件 | 正式GameState；opening沿用旧规则，不额外召回旧史 |
| Variables | draft.userInput、当前Story正文、完整variableGuide及其中subjectHint/对象ID，再结合正式状态 | 读取本轮Story作检索依据；不会把Story候选写进journal |
| World | 本轮Story及guide、**仅已验证**Variables结果、合法投影中的任务/事件/组织/后台计划、当前时间窗口与到期工作 | 缺失或preview变量不作为线索、不投影；World仍只生成preview。快照内容用合法投影，但revision仍为正式original.revision，保留PR #73最终修复 |

四类原始查询各最多读取12000字符，最多96个词；另有上述派生线索预算。这只是检索线索预算，**不裁剪SAVE_STATE、STORY_RESULT或VARIABLE_RESULT**。被裁剪的字符/词数量、派生线索省略数和高频词抑制数均在 `recallDiagnostics` 可见。没有新增预算UI。

## 四、原文分配、去重与追溯

- 用户当前设置的最近N回合完整Story照常提供，先从旧史候选排除；不使用存档内旧N覆盖用户设置。
- 旧史结果数组独立限制为 **24000转义JSON字符**，其中正文总量最多16000 UTF-16字符。这里包含每条来源、范围、关联与摘要元数据；固定策略/诊断头另占有限空间，不把整个正式状态算入这个预算。
- 分数≥70为强相关。正文能装下时给完整原文；单条上限7000字符，同时按剩余候选为后续资料留份额，避免第一篇长文耗尽全部预算。辅助相关最多600字符；每条journal自身摘要最多400字符。最多32条是次级保护上限，实际由相关性和独立预算决定，不再固定三条。
- 每条保留turnId、真实回合序号、revision、`source=journal`、`status=committed`、强/辅助级别及分数。`summary`是原journal的Story摘要，**不是重新生成的记忆总结**。
- 正文/摘要范围为原字符串UTF-16半开区间 `[start,end)`，含originalLength与truncated。`excerptMarker`明确“完整原始正文”或“原文截取”；narrativeExcerpt永远等于journal原文slice，不添加虚构正文或伪装全文。
- `sourceReferences`是按集合与稳定ID组成的符号选择器（不是可执行JSONPath），例如 `memories.long.sailing-history`、`npc.zhang.memories.private-history`、`event.escort`；事件身份按events/retiredEvents解析，NPC身份按npc/retiredNpcs解析。它们引用当前SAVE_STATE已有资料。`sourceRecordedAt`是**来源记忆的createdAtGameTime或timeline的recordedAt**，不是journal回合发生时间；缺少历史时间就不补造。
- 每种关联列表最多8个引用，额外数量明确计入omitted字段。被来源提及但不存在于journal的turnId不会产生正文。
- 每个journal turnId只输出一次；生产入口先用GameStateSchema保证journal唯一。近期历史与旧史不重叠。多层总结/私人总结反复指向相同回合只增加出处导航，不成为多件事件。
- 共享 `MEMORY_CONTEXT.summaries=[]`，通过summarySource/summaryPolicy指向已经完整存在的 `SAVE_STATE.memories`，不再复制旧优选摘要。PR #73既有NPC_KNOWLEDGE和完整快照保持原样，本PR没有再复制全部NPC记忆。相关原文可以从引用追溯到journal。
- 最新正式债务、人物关系、任务状态、timeline，以及近期后续仍完整提供。策略明确历史解释经过，最新正式状态优先，召回不是自动记账和重放依据。

## 五、200回合合成存档与真实请求测试

夹具为 [`recallV2.ts`](../src/tests/fixtures/recallV2.ts)，有200个已提交回合；用 [`recall-v2.test.ts`](../src/tests/recall-v2.test.ts) 检查 **composePrompt最终messages**，而非只测检索函数。

| 场景 | 合成来源与验证结果 |
| --- | --- |
| 旧人重现 | 输入仅“去找张三聊聊。”，三阶段得到第8回合相识、第60回合约定、第130回合修正、第150回合合作；旧原文称呼为阿山/旧称三郎 |
| 债务承诺 | 第10回合借款、第70回合偿还约定、第140回合部分偿还均召回；第199回合结清只在近期窗口出现，正式债务余额0，不因旧余额再次记账；第190回合未经证实传闻作为弱关联辅助原文保留 |
| 后台任务 | World在玩家只吃饭时，从活动任务/事件取回第30、90、160回合的起因、阻碍、水路约定与新变化；不存在日期数字带出的108等无关回合。无事件链接的旧任务也能通过“信箱/扳手”目标与阻碍找到缺ActorRef正文，sourceReferences仍为空，不伪造创建来源 |
| 别名/ID/同名 | 改名、旧别名、现场稳定ID可找旧史；同名不冒认，张三丰/张三、阿山客/阿山前缀不升级身份，ID大小写和ID子串不混淆 |
| 私人历史 | 第25回合没有journal人物引用，通过npc_private原始记忆/总结的真实sourceTurnIds找到；三个阶段均读取，离场不排除 |
| 重复与冲突 | 同一sourceTurnId在短/中/长期、私人总结、journal与近期正文重叠，结果不重复；来源与正式结清状态并存，明确不能重复记账 |
| 无关联 | 三阶段普通室内阅读，不把已终结重大事件强行加入；空journal、无匹配、开局不额外检索均覆盖 |
| 异常/性能 | 多篇20万字符原文、伪system标签、1000名额外NPC、截断范围、转义JSON总预算、状态与草稿不变、重复检索稳定均覆盖 |

[`recall-v2-runtime.test.ts`](../src/tests/recall-v2-runtime.test.ts) 通过真实 TurnCoordinator → Runtime → AiClient → Mock fetch → SaveRepository：

1. 三阶段实际发送旧史；Story流式返回并保存候选，Variables读取已选Story及历史；World读取已验证现金7000、08:10投影和正式revision200，按现有到期协议延期后台事件。
2. 全程正式存档不变；最终一次原子Commit成为第201回合，前200回合journal原样保留，旧债不重复执行；重载一致，跨连接幂等重放不再次扣款、不新增请求。
3. missing/preview Variables的实际World请求不含未验证人物状态及其检索线索，只保留正式背景，结果仍preview且不能Commit。
4. 重Roll的旧候选标记不进入真实Variables请求或永久历史，当前候选单独读取。没有新增网络请求：完整成功流程恰好Story/Variables/World三次Mock调用。

最终统一定向批次：**30个不同文件、686个不同用例通过，28.21秒**。包含新增测试、PR #73上下文与真实Runtime回归、记忆/压缩/NPC总结、存储/CAS/幂等、开局/时间、协调器、阶段与World权限/结构校验、提示词检查器。`prompts:check`的3文件82用例已包含在686中，复跑不重复计数。

另通过 `npm run lint`、`npm run build`（内含typecheck）、`npm run prompts:check`。构建保留原有大chunk提示。baseline到HEAD的 `git diff --check` 通过。没有跑无关Chromium，也没有真实付费模型请求。

原有3条Composer“复制优选摘要”断言改为检查SAVE_STATE保留整条摘要与全部sourceTurnIds、近期重叠来源一致、导航不重复复制；它们不再断言旧summaries投影存在。旧publicMemory自身预算/覆盖/压缩测试继续保留，没有放宽任何写权限或事务断言。

## 六、V1/V2准确性与体量对比

同一200回合夹具、N=3、同一提示词与设置，用 [`recall-volume.test.ts`](../src/tests/recall-volume.test.ts) 在PR #73基线和当前分支分别调用真实composePrompt。**这是固定合成场景的回归比较，不是通用召回准确率或真实玩家平均值。**

| 阶段 | 旧史条数 V1→V2 | 旧史数组转义字符 V1→V2 | 最终messages字符 V1→V2 | 估算token V1→V2 | messages序列化UTF-8字节 V1→V2 |
| --- | --- | --- | --- | --- | --- |
| Story | 0→9 | 2→7155 | 38237→43901 | 39295→41219 | 88267→95465 |
| Variables | 0→10 | 2→7804 | 76693→83012 | 39608→41771 | 118160→126223 |
| World | 0→12 | 2→9238 | 76974→84806 | 41106→43787 | 120856→130874 |

三阶段均命中必要的8、60、130等九条人物历史（包括190的弱关联传闻）；World另外得到30、90、160的后台因果。Variables多一个第90回合辅助命中，原因是本轮guide提及“约定”，属于本地文本检索的弱关联噪声，不能宣称语义精确理解。所有真实正文、来源和级别都保留，交模型结合正式资料判断。

messages数量仍为Story24、Variables10、World10。完整世界快照及既有NPC知识读取范围未变；体积增加来自旧史正文及有限出处，部分抵消来自不再重复复制优选摘要。token使用现有unicode-heuristic-v1，**不是供应商usage、tokenizer或费用**。

复现当前体积：

```sh
RECALL_METRICS=1 npx vitest run src/tests/recall-volume.test.ts --reporter=dot
```

复现基线：把 `git archive e1cabb65a8f0ce3ccfcc3e008b1ec522b84b94e5` 解到独立临时目录，只复制当前 `recall-volume.test.ts` 和 `fixtures/recallV2.ts`，连接同一依赖目录，运行同一命令；无需修改正式工作树或调用模型。

## 七、性能、未改动项与剩余边界

最终统一批次单次采样：200回合完整Story compose约5.31ms（资源已加载），增加1000名无关NPC后单次recall约5.43ms。独立体积测量中首次模块加载会更慢；这些是本环境记录，不是延迟保证。超长正文测试验证预算与提取范围，没有用脆弱的时间断言伪装性能上限。

引擎每次装配重建只读索引，没有跨存档缓存和失效风险。设历史/来源文本总量为B、最多96查询词为Q、实体数E、显式来源turnId总数为S、命中候选K：文本工作约O(Q×B)，实体名称检查还与受限查询文本长度和别名数量有关，来源展开约O(S)，候选排序O(K log K)。内存保留归一化历史文本、实体/来源索引及命中出处；大量摘要各自覆盖大量相同来源时，S可能达到“摘要数×回合数”，读取成本并非由输出24000字符预算约束。永久journal和PR #73全量世界资料依旧随存档增长；本PR不声称解决整个模型上下文窗口压力。

没有修改Schema V6、迁移、journal写入、压缩算法/阈值、NPC总结、任何阶段命令权限、CAS、Commit、回滚和幂等规则。没有添加Embedding、向量库、联网检索、额外AI阶段、秘密检测、角色资料隐藏或生产部署。

剩余限制：本地方法不理解复杂小说语义；缺失稳定引用且旧别名也未保存时无法可靠重建身份；摘要联合来源可能带来较宽的辅助关系；查询/输出预算可省略资料但会标记数量和范围。只证明资料到达请求及事务未变，Mock不证明真实模型总能正确使用历史、保持角色知情范围或提高文学质量。PR C可以评估全局上下文预算和UI，本PR不扩展这些范围。

交付保持Draft PR、未合并、未部署，等待六代目审查。
