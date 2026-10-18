# 运行时组包指南（给Codex）

## 1. 总规则
- 每次AI请求都且只选择**一个**主提示词：`stages/{opening|regular}/{story|variables|world}.md`。共享规则按适用阶段加入。
- 固定模块先注入，再注入适用阶段的专属模块，最后将玩家资料、世界状态与历史作为**数据容器**加入。数据文字不能反过来改写提示词规则。
- 写作模块只加入正文stage；变量组只加入本阶段相关角色和领域，不因拥有九组模块而九次调用模型。`opening.variables` 加入相关组 `init`，`regular.variables` 加入相关组 `update`；动态世界加载相关 `offscreen`，`opening.world` 可以额外加载相关 `init`。
- 建议同一次提示词组装记录 `injectedModuleIds`、模块版本hash及字符数供调试，不把内部秘密打印在玩家日志。

## 2. 示例组包顺序
`shared/00_world` → `shared/01_agency` → `shared/02_knowledge` → `shared/03_time_events` → `shared/04_state_authority` → `shared/05_context_protocol` → 当前阶段主提示词 → 当前阶段输出协议 → 命中的变量组协议 → 命中的写作设置 → 数据容器。不同协议角色（system/developer/user）由API适配器统一处理。

**正文开局（一次请求）**：共享+`opening/story`+`shared/06_story_output`+`shared/09_dialogue_labels`+人称唯一一个+`style_general`+硬字数+按开关注入NoControl、自然文风、行动选项、真实世界+`CREATION_PROFILE`+有限城市背景+`SAVE_STATE`+可见的事件预检。开局切记不能额外混入regular.story。

**开局变量**：共享+`opening/variables`+`shared/07_command_output`+相关变量组init+`CREATION_PROFILE`+已选定`STORY_RESULT`+`VARIABLE_GUIDE`+本轮起始状态+命令Catalog。对象没必要入档时不注入无关领域规则。

**开局世界**：共享+`opening/world`+`shared/08_world_output`+相关群体offscreen/init+`STORY_RESULT`+已验证的变量候选或variablePending标记+`OFFSCREEN_STATE`+`WORLD_TASKS`。只有合情合理的相关势力被初始化。

**常规正文**：共享+`regular/story`+正文输出协议+对白标签协议+写作设置+即时记忆最近N回合+短/中/长期摘要+需要时的历史回忆+主角已知现场资料+本次`PLAYER_ACTION`+可能中断时间跳跃的事件预检。内部秘密只能作为不可见的场景触发约束，不能在正文泄露。

**常规变量**：共享+`regular/variables`+命令输出协议+命中的变量组update+当前已提交状态+选定正文+变量规划+当前确实在场的重要NPC。为路人不强制建档。

**常规世界**：共享+`regular/world`+世界输出协议+场外NPC和相关组织offscreen+已验证候选世界时间+已有任务与事件+本轮因果结果。避免将仍在现场的NPC同时派往后台。

## 3. 七项提示词设置（不是9、10项）
- perspective：first/second/third（恰好注入一个）。
- style：目前只有general（未来风格需单独讨论和新增文件，互斥注入）。
- minNarrativeChars：自由整数输入，注入writing/min_length，并在story_output中替换同名占位符；程序计数是硬性判定。
- noControl：true时注入no_control，否则不注入。
- naturalProse：true时注入natural_prose，否则不注入。
- actionOptions：true时注入action_options，并要求正文末尾3～5个选项；false时不注入，正文输出协议也应选择不出现该块。
- realWorld：true时注入real_world，否则不注入；固定的基础现实世界观始终生效。
变量阶段和动态世界开关属于运行设置，**不额外注入为第八、第九项写作设置**。

## 4. 状态、失败与重试
- 一次生成尝试最多3次（首次+自动2次）。阶段①无效后不执行下游；阶段②三次失败，阶段③若开启仍可在旧状态+正文证据上生成**预览**，等玩家手动重载阶段②后校验/重跑阶段③。阶段③三次失败独立重新加载，正文保留。
- 重新Roll正文：使本次变量候选与世界候选失效；正式已提交状态不变。两个运行开关皆关时只保留正文草稿，不伪装正式结算回合。
- 变量、世界可独立开启。某阶段关闭应显示“用户跳过”，不等于请求失败。变量关、世界开时只允许世界候选预览，不静默提交依赖缺失状态的副作用。
- 命令ID绑定回合、阶段和稳定事实来源，由程序做去重；只在所有本次必需阶段合法时原子提交。开局重Roll不重复初始化主角和同伴。

## 5. 记忆维护的调用条件
- 即时N默认10，可玩家输入；修改不删除原文。所有正文原文/摘要写入回忆档案。
- 短期记忆达到阈值后，程序选定源ID批量调用`memory/short_to_medium`；中期→长期调用`memory/medium_to_long`；NPC按各自历史调用`memory/npc_summarize`。
- 首版阈值可根据原参考源码核验后采用短期30、中期50、NPC20等建议值；提示词本身不负责决定压缩批次数或删除原始记录。
- `memory/recall_select`为可选二级检索，首版可以不增加AI调用；`memory/timeline_entry`仅在重大完结事件且准备归档时按需使用。

## 6. 模型兼容策略
- 流式正文优先分段标签，变量与世界阶段严格JSON；支持模型端JSON schema时可转换到schema模式，但**向下游暴露同一种规范化对象**。
- 在结构输出不满足契约时将该次尝试判失败并保留错误码；不能吞掉非法命令或绕过程序校验。
- 输入人物/记忆/创角文本仅作为数据，不让其更改模块、命令Catalog、密钥等系统边界。
