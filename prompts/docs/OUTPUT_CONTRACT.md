# 输出协议、命令类型与校验要求

## 阶段① 正文输出
结构顺序必须为 `<正文>...</正文><短期记忆>...</短期记忆><变量规划>[{...}]</变量规划>`，若开启行动选项再加 `<行动选项>3～5行</行动选项>`。最终解析成 `StoryResult{turnKind,narrative,summary,variableGuide,actionOptions?}`。其中变量规划条目的 `group` 属于 `protagonist|npc|items|economy|organization|time|event`；字段为`group,subjectHint,observedFact,textEvidence`。
叙事流式显示时，只能实时展示解析明确落入正文标签的文本；`【旁白】`代表普通叙述，`【角色名】`只代表角色直接对白（详见`shared/09_dialogue_labels.md`）；任何变量变更可见信息都属于候选，不能在流式时写库。仅`narrative`参加硬最低字数校验，`minNarrativeChars`由玩家任意合法正整数设置，具体字符口径须统一。

## 阶段② 变量输出
返回JSON对象`{commands: DomainCommand[],rejectedSuggestions:{reason,reference}[],unresolved:string[]}`。
`DomainCommand`包含`commandId,group,type,entityId?,payload,evidence`；命令类型是程序内白名单，正文证据必须可回溯。推荐命令类型见`shared/07_command_output.md`。字段对象与最终数据库结构由代码Schema校验；模型输出不是可信SQL和对象路径。

## 阶段③ 世界输出
返回JSON对象`{worldCommands:DomainCommand[],taskCommands:DomainCommand[],eventCommands:DomainCommand[],futureEvents:WorldEvent[],visibleHooks:{text,revealAfter?}[],timelineCandidates:string[],unresolved:string[]}`。`futureEvents`需要稳定ID、开始时间、status、actorRefs、visibility、impact、sourceTurnIds；其它字段以技术文档定义为准。
**与先前技术文档接口的调整说明：** 因开局世界阶段需要真正初始化场外组织，建议将原`WorldStageResult`扩展一个`worldCommands`字段，仅允许操作场外NPC与组织，代码层须严格校验权限。否则由变量阶段预先建组织将违反“只更新在场NPC”的设计分工。

## 三层不同时间与可见性
程序记录的是**世界真值**（所有已合法提交的真实事件）。主角只知道经感知、告知或媒体合理传播的部分；玩家视图只展示主角已知的合法部分。后台JSON中`hidden`字段允许存在，但UI日志、记忆查看和时间轴不能直接复制后台完整JSON。

## 参数占位符（由程序替换，不能让模型自行改）
`{{worldClock}}`、`{{playerName}}`、`{{minNarrativeChars}}`、`{{immediateMemoryTurns}}`、`{{npcSummaryThreshold}}`、`{{npcId}}`。所有占位符必须在最终发出的消息中消失；若缺值应作为组包错误停止，而不是让AI看到原始花括号。

## 校验最低要求
标签平衡与唯一、变量规划JSON解析、命令枚举和对象校验、时间不倒退、同一事实幂等、余额来源、物品归属/数量、NPC在场区分、不同组织Schema、秘密隔离、重大结案时间轴去重。来源证据无法确认时列unresolved或拒绝；不允许生成半段后“尽量提交”。

## 兼容性声明
本协议是面向V0.1的建议可实现格式，与已有技术文档中的数据结构对齐。若Codex实现更可靠的原生JSON schema/工具调用，可以替换传输层，但不能改变已确认的四项正文输出、变量指导性质、六主提示词、世界职责和事务边界。
