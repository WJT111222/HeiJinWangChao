# 三阶段上下文 V2 开发报告

基线：`db3157d4ec4d840df26b39c0d5c972b9bf5aba0b`（main，已合并 PR #72）。实现分支：`codex/three-stage-context-v2`。本次只扩大模型读取范围，写入权限和正式事务保持原样。

## 实际装配变化

共享构建器为 [`src/prompts/sharedContext.ts`](../src/prompts/sharedContext.ts)，由 [`context.ts`](../src/prompts/context.ts) 的 Story、Variables、World 分支调用；最终经既有 `composePrompt` → `contextMessage` → Runtime/AiClient 进入真实请求。数据源是经过 `checkedInput` 校验的正式 GameState V6。World继续调用原有 `projectTurn`，只应用合法 Variables候选及既有开局时间规则。新构建器不查询存储、不请求模型、不写入状态。

| 字段/资料 | V1 实际装配 | V2 实际装配 |
| --- | --- | --- |
| Story `SAVE_STATE` | 主角、天气环境、部分经济、主角物品和当前地点祖先 | 完整V6世界快照，除journal全文、appliedCommands |
| Story NPC | `SCENE_NPCS`仅现场，`publicNpc`删除私人档案，仅匹配公开记忆的关系/健康文字 | `SAVE_STATE.npc`包含全部场内外普通/特殊NPC完整字段；`SCENE_NPCS`仍为现场辅助列表，已移除publicNpc |
| 特殊NPC私人资料 | Story缺identity/background/detailedBackground、目标、习惯、privateProfile等 | 三阶段原样保留全部正式字段，初始同伴未确认好感仍由affinityConfirmed和提示说明区分 |
| NPC原始/长期/总结/knownInformation | Story仅公开；Variables、World仅适用现场或可写场外人物，知识区有条数/字符预算、去已总结原文等裁剪 | 三阶段`SAVE_STATE`全量保留，`NPC_KNOWLEDGE`按ownerNpcId提供全部raw（含长期）、summaries、knownInformation，不以可写性/visibility过滤 |
| Variables `SAVE_STATE` | `variableStateSnapshot`移除memories、timeline，裁剪私人NPC记录 | 共享完整快照，memories、timeline和全部NPC记忆恢复；不开启永久journal全文注入 |
| World主角 | `PROTAGONIST_PROFILE`仅id/name/职业/技能 | 完整主角字段，同时可在完整`SAVE_STATE`中读取经济、资产、背包、装备、位置、健康等 |
| World NPC/任务 | `OFFSCREEN_STATE`仅可写场外NPC、组织及相关任务，私人资料部分删除 | 完整`SAVE_STATE`含受保护现场NPC、主角任务、现场任务；OFFSCREEN_STATE保留原场外范围作为专项参考 |
| 组织/地点/经济资产/物品 | Story限制地点与归属；其他阶段各自切片 | 三阶段保留全部正式表和引用，含非主角物品、资产、组织和远处地点 |
| events/retiredEvents/timeline | Story只已知事件；Variables无timeline；World历史和部分带detail退役事件 | 三阶段完整读取，包括隐藏事件、轻量退役身份和保留detail、独立历史记录 |
| 分层memories | Story仅预算内公开优选摘要；Variables完全删除；World未提供完整层级 | `SAVE_STATE.memories`保留short/medium/long/npcSummaries全量及来源、可见性、认知标记 |
| 最近N回合 | Story仅narrative/summary；Variables、World未提供 | 三阶段`MEMORY_CONTEXT.recentTurns`为最近N个已提交journal记录，完整Story字段（含turnKind、variableGuide、actionOptions），另保留回合编号、revision、relatedActorRefs |
| 本回合候选 | Variables完整Story；World只有narrative/summary/eventInteractions | Variables仍完整；World扩展为完整Story并保留eventInteractions辅助视图；均独立于recentTurns |
| 玩家行动 | World仅在生命周期辅助字段内间接出现 | World新增独立`PLAYER_ACTION=draft.userInput`，Variables保持草稿输入，Story使用当前输入；不读取下一轮未选行动 |
| 合法变量候选 | World已有VARIABLE_RESULT和variablePending | 原样保留；未验证候选不进入完整快照，缺变量仍为preview |

`SAVE_STATE`保留V6现有字段，而非复制一份会遗漏后续字段的手写白名单。只排除存储幂等凭据`appliedCommands`和永久`journal`全文；所有正式世界资料均可读。待确认开局Story的worldClock仍为null，Variables/World仍使用原有开局候选时间。

## 读取与角色知情、写入权限分离

Story现在以全局作者视角理解背景，角色不会因模型读到其他人物的秘密而自动知情。公开/私有/内部可见性、observed/reported/suspected、来源和owner归属不修改。`KNOWN_EVENTS`、`EVENT_ENTRIES`、`TIME_PREFLIGHT`继续使用原有受限投影；它们是角色已知信息/可呈现入口参考，不再成为作者读取世界背景的唯一通道。

World的`PROTECTED_SCENE`仍以合法Variables投影和`worldNpcAllowed`计算。受保护现场人物和开局同伴仍不可通过World人物更新、记忆或任务写入；刚合法离场者仍按原规则获得后台行动空间，不能重写Variables已更新字段。World仍没有主角资金、交易、移动和时钟权限。完整背景不参与命令授权。

审计了composer/selection、variableDomains/worldDomains、memory history/publicMemory/npcMemory、turnProjection、services/ai/runtime以及StoryStage/VariableStage/WorldStage/TurnCoordinator。阶段选择、领域覆盖、验证、请求路由、协议和投影算法均未改。Schema V6、迁移、CAS、回合commit、幂等重放、自动请求次数、压缩算法与阈值、预算UI、PR #72结构修复均未改；未新增语义审查。

对应Prompt只修正读取范围与权限说明：shared knowledge、两份实际被选择的context_protocol、普通Story的一句资料清单、World output的一句只读说明。`legacy/variables_json/shared/05_context_protocol.md`虽在legacy目录，仍实际用于Story/World，故需同步。Manifest刷新字符数/hash；sources.lock保留原始与既有适配hash，另记contextV2 hash并新增当前字节校验，没有将变更伪装成原文或取消保护。

## 历史与预算

近期N由当前设置`settings.memory.immediateWindowSize`决定，不使用存档内旧窗口值。当前草稿Story和未提交World结果不会冒充已提交历史。永久journal继续使用原有`recallHistory`，最多3条、合计6000字符、摘要400/正文摘录1500；opening仍不做额外旧史检索。没有PR B召回算法升级。

`storyMemoryContext`的公开优选摘要继续保留最多12条、6000文本字符和20000序列化字符预算。该预算只限制额外导航摘要，**不裁剪`SAVE_STATE.memories`**。原始记录与总结可同时出现，提示说明重叠来源不是新事实。NPC维护模型仍只接收授权批次，其压缩/总结门槛和来源校验完全未变；变化仅为三阶段读上下文不再套用旧NPC知识精选预算。

## 验证

- 新增 `context-v2.test.ts`：真实composePrompt最终messages反解析，开局/普通三阶段完整快照深比较；5名场内外普通/特殊NPC、私人档案、24条原始记忆/人、长期和总结、knownInformation、完整经济资产物品、4种组织、主角/现场/场外任务、隐藏/退役事件、timeline、每层15条记忆、8回合历史及当前候选。覆盖N=1/3/10、旧召回等值、pending不投影、合法离场/现场权限、数据伪标签转义。
- 新增 `context-v2-runtime.test.ts`：真实TurnCoordinator → Runtime → AiClient → Mock fetch请求体检查；每阶段一次请求，候选生成不修改存档；Commit后重载、跨连接幂等重放、下一回合历史纳入；缺Variables的实际World仍preview且不能提交。
- 直接相关定向批次45文件1146用例；初跑1138通过、8条旧读取断言失败。修正这些断言为“完整背景可读，但角色线索投影与状态不变”后，相关5文件171用例通过。另加prompts静态检查27用例通过。合计46个不同文件、1173个不同用例已通过，未把重跑重复计数。
- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run prompts:check`通过。构建保留原有大chunk提示。未跑无关Chromium全量，未调用付费API。

覆盖范围包含PR #72 structural-workflow/structural-reliability、场景contract、开局时间、自动工作流、Variables/World校验、历史知情、记忆维护、检查器等现有回归。

## 可复现体量对比

使用同一个确定性合成夹具 `src/tests/fixtures/contextV2.ts`，当前窗口N=3、同一设置和领域选择；由 `context-volume.test.ts`调用真实composePrompt。基线取PR #72合并main，测量的是最终messages所有内容（含系统Prompt和数据）。

| 阶段 | messages数 V1→V2 | Unicode字符 V1→V2 | 启发式估算token V1→V2 | 序列化messages UTF-8字节 V1→V2 |
| --- | --- | --- | --- | --- |
| Story | 25→25 | 35,839→164,436 | 40,457→113,403 | 88,245→296,090 |
| Variables | 19→19 | 102,208→199,473 | 52,226→116,264 | 156,373→326,744 |
| World | 19→19 | 92,376→214,517 | 49,656→122,248 | 145,771→348,250 |

估算算法沿用`unicode-heuristic-v1`（ASCII/4+其他字符×1.5），不是供应商tokenizer/真实usage/费用；字节为`JSON.stringify(messages)`，不包括供应商请求的其余字段。夹具刻意包含超过旧摘要预算的完整记忆，因此不能当作所有存档的平均规模。

当前分支测量：

```sh
CONTEXT_METRICS=1 npx vitest run src/tests/context-volume.test.ts --reporter=verbose --silent=false
```

从本分支仓库根目录复现基线（独立临时目录，不修改其他工作区）：

```sh
measurement_dir=$(mktemp -d /tmp/heijin-context-v1.XXXXXX)
git archive db3157d4ec4d840df26b39c0d5c972b9bf5aba0b | tar -x -C "$measurement_dir"
cp src/tests/context-volume.test.ts "$measurement_dir/src/tests/context-volume.test.ts"
cp src/tests/fixtures/contextV2.ts "$measurement_dir/src/tests/fixtures/contextV2.ts"
ln -s "$(realpath node_modules)" "$measurement_dir/node_modules"
cd "$measurement_dir"
CONTEXT_METRICS=1 npx vitest run src/tests/context-volume.test.ts --reporter=verbose --silent=false
```

## 风险与交付边界

完整资料显著增加上下文体积，长期档案越大，延迟、费用和模型窗口压力越高；本次按需求保留全部正式世界资料，没有暗中裁剪或改预算UI。NPC档案、知识分区和专项场景视图会有重复资料，当前以完整性及现有容器兼容为先。

测试证明字段到达最终请求、候选边界和事务行为；Mock不证明真实模型能正确利用全部背景、稳定区分角色知情，或提高文学/世界推演质量。未用真实付费模型验证，也未重做已经压缩丢失的历史细节：恢复的是正式V6里仍然保存、此前在装配层被裁剪的数据。

本分支只创建独立Draft PR，未合并、未部署。
