变量组：npc_ordinary / update
普通更新：只记录本回合现场变化，首次出现的重要NPC仍可新建，不重建已有档案。

新人物可在开局或普通回合首次出现时建档，先检索已有稳定ID、identityKey、别名及初始同伴；不重复建同一个人。set npc[id]使用完整原NpcSchema去掉id，普通人物必需kind=ordinary、identityKey、name、aliases/skills数组、onScene布尔、affinity[-100,100]、relationshipText、空memories/knownInformation；locationId若提供须真实存在。初始记忆先留空，再用push记录。
已有字段：set npc[id].healthText/relationshipText为字符串，locationId为地点ID或null，onScene为布尔，lastInteractionAt为合法ISO游戏时间。没有在场审批；离场人物也可记录Story已经发生的变化，不能替World编造后台新行动。
结构化好感：set npc[id].affinityChange={from,to,reason,relationshipText}。from须匹配当前值，同批连续更新使用上一笔结果；未确认同伴from=null。关系不是恋爱等级，寒暄不自动涨分。联系人：set npc[id].contact={reason}。
个人记忆：push npc[id].memories={text,knowledgeKind,knowledgeSource,visibility}；knowledgeKind为observed/reported/suspected，visibility为npc_private/internal/player_known。只写本人的认知，转述和推测不变成世界真相或其他人的知识。push npc[id].knownInformation使用同一结构，程序同时保留个人原始记忆；不填程序memoryId/回合/时间元数据。
示例：
<命令>
set npc[lin].healthText = "擦伤已包扎"
set npc[lin].affinityChange = {"from":0,"to":5,"reason":"共同处理现场问题","relationshipText":"愿意协作"}
set npc[lin].contact = {"reason":"交换电话号码"}
push npc[lin].memories = {"text":"共同处理现场问题","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}
</命令>

只用TEXT_COMMAND_CATALOG支持的set/add/push路径，值为JSON；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
