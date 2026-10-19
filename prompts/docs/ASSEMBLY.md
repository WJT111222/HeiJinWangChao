# 运行时组包指南（给Codex）

## 1. 注册契约与实现状态

M3-P1 仅提供静态注册契约。M3-P2 已在 `src/prompts/loader.ts`、`context.ts`、`composer.ts` 与 `src/services/ai/` 实现原文加载、消息组装及独立请求，详见根目录 `M3-P2-DEVELOPMENT.md`。下列顺序继续作为固定约束；原文组装与 Mock 请求通过不代表真实模型一定遵循。

- 主模板每次仅选一个 `stages/{opening|regular}/{story|variables|world}`；开局和普通模式互斥。
- `activation=always` 表示在所属 stage/mode 内常驻；setting 仅由原七项设置控制；relevant-domain 按相关实体域；memory-task 只选当前维护任务；protocol-compatibility 须显式协议兼容；never 永不注入。
- 变量组并非九次模型调用：opening.variables 选相关 init，regular.variables 选 update；world 选相关 offscreen，opening.world 可以加原已允许的 init。
- documentation/example/reference 以及 shared.00_world 都为 never。历史汇编、审核说明、sources.lock 不能作为正文整体输入。
- 后续每次请求应记录实际模块 ID、内容 hash/版本、角色、顺序和长度；普通 UI 与调试权限须区分，不暴露密钥。完整文本从资源路径读取，不截断。

## 2. 默认逻辑顺序（非实际 API 消息）

正文的固定顺序：

| defaultOrder | 资源 | 边界 |
| --- | --- | --- |
| 0 | identity.fusheng | 固定第一，替换当前正式主角姓名 |
| 10 | worldbooks.heijin.worldview | 紧随身份，不混入其它世界 |
| 20 | worldbooks.heijin.modern_underworld | 核心叙事规则开头 |
| 30–70 | shared.01_agency 至 shared.05_context_protocol | 通用权限、知识、游戏时间、真值和容器 |
| 80–82 | conflict_pacing / emotion_guard / action_feasibility | 仅这三项可在此组内调整顺序 |
| 210–227 | min_length、一个人称、style_general、四个既有写作开关 | 四个可选增强仅在各自可移动槽位内排序，不能跨固定锚点 |
| 250–251 | writing.nsfw / writing.intimacy_boundaries | NSFW 为用户手动适配正文，边界为独立审阅版；两项各登记一次、无设置条件，原版逐字移植不声明完成 |
| 300 | opening.story 或 regular.story | 恰好一个 |
| 406 / 409 | story_output / dialogue_labels | 保持既有输出协议 |
| 此后 | 当前资料、已确认背景、历史和玩家输入等数据容器 | P2 实现，不能反向覆盖系统规则 |
| 900 | compatibility.cot_format_ack | 仅兼容时，以独立 assistant 消息处于正确尾部位置；当前不发送 |

变量/世界使用相同两本世界书作为背景事实，以及 shared.01–05；不加入浮生正文身份、小说写作、成人题材或 COT 模板。随后加载各自唯一主模板（300）、command_output（407）或 world_output（408）、相关变量组（500–582）和数据容器。不能误加载 story_output。

记忆的五个模板是独立按需任务（600–604），不混进常规三阶段。原始数据、正式快照、已选正文与候选之间的边界继续按现有协议实现。

注册表提供 title/category/messageRole/defaultOrder/orderGroup/reorderable/version/contentSha256/characters/placeholders 等展示信息。角色是逻辑默认值，实际 system/user/assistant 传输映射在 P2；排序调整只能在相同角色/阶段/模式与同组既有可移动槽位内置换，不得移动固定身份、世界书、阶段、输出、NSFW 边界。尚未实现排序保存或编辑 UI。

字符数采用 Unicode code point；**不是 Token 数量**。Token 需后续选择实际模型 tokenizer 估算；真实 usage 只能来自 API 响应，未请求时不能伪造数字。

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

## 7. 星期与占位符接入（P2）

`worldClock` 仍是正式存档唯一时间真值。`{{worldWeekday}}` 是新增的只读上下文占位符，当前仅登记，P2 根据 worldClock 在 Asia/Shanghai 的游戏日期计算星期一至星期日，禁止使用系统日期、无时区 getDay 或 AI 可写星期。测试应覆盖跨日、跨月、跨年、闰年及 UTC 与中国日期边界。工作日/休息日影响日程，但不是所有职业双休。P1 不改 Schema、UI 或 SetWorldClock 命令。

P2 须从当前正式存档替换 playerName、worldClock、派生 worldWeekday、minNarrativeChars、immediateMemoryTurns 及按任务需要的 npcId/npcSummaryThreshold；缺值或残留花括号应阻止发送，切档不得沿用旧缓存。已开始的游戏只读取正式主角背景，不注入任何出身/天赋候选池。

## 8. COT 来源与模型兼容（P2 待实现）

已核对 MoRanJiangHu@70df74835b969a049c6512a81716eaa0f5591c5a 的 defaults.ts、promptRuntime.ts、mainStoryRequest.ts、openingStoryWorkflow.ts（详见来源锁）。上游用构建COT伪装提示词提取身份名和行动选项，再在特定模式尾部追加 assistant 内容；不代表读取模型内部推理。原模板的 thinking/剧情规划不兼容本库四段协议，所以原文只放 reference.cot_legacy、activation=never。运行资源为明确标记的协议适配版，不要求输出思维链。

| 上游情况 | 核对到的行为 | 黑金王朝 P2 接入要求 |
| --- | --- | --- |
| 普通模式 | COT 开启时追加独立 assistant 历史消息 | 实测支持后才显式选择模板；只一次，不能修改七项写作设置 |
| DeepSeek / GLM 标准及锁格式 | 显式禁用通用伪装；另走专用协议 | 不能按模型名称盲目套用；检查具体协议、接口能力 |
| GPT 标记 | 改变触发消息分支，不单独关闭 COT；上游最新玩家输入也可能使用 assistant 角色 | 不照搬上游输入角色，须按目标 API 的可信边界正确映射玩家输入 |
| DeepSeek/GLM 锁格式 | 有条件附加 assistant Prefix，重试要保持 Prefix 在尾部 | Prefix 与通用模板互斥；不得复制旧 thinking/HTML 注释推理输出策略 |
| 酒馆预设 | 有独立外部预设消息链与专用分支 | 本阶段不移植，也不能声明兼容 |
| 变量/世界严格 JSON | 与正文叙事规则不同 | 禁止加入正文 COT、NSFW、正文标签协议 |

不兼容时跳过该兼容模板并给出诊断，而不是损坏 JSON 或泄露内部推理。P1 没有配置 COT 用户开关、模型路由或请求发送器；未来属于模型协议配置，不是第八项写作设置。

## 9. 扩展与内容缺口

manifest.futureExtensions 仅列出 npc_private_archive 与 special_nsfw_traits 的设计入口，不是运行模块、提示词占位文件或 NPC 空字段。没有移植名器概率表、图片规则、武侠战斗/数值判定或任何 `<judge>` 输出体系。

用户已在 690d01d 补充成人题材提示词，本轮完整保留该正文，仅同步元数据与来源。当前资源是用户手动整理的适配版，不是旧版未经修改的全文逐字移植；该项在 manifest.contentGaps 中仍为 not-completed。NSFW 与独立亲密边界只按各自唯一 ID 登记一次，不额外拼接边界正文；两者常驻正文，无开关。P1 只有静态配置验证，实际请求注入/去重由 P2 实现与验证，不声称已获模型验证。模型服务权限和内容规则不能被身份声明改变。
