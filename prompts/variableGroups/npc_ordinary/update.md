变量组：npc_ordinary / update
普通更新：只记录本回合现场变化，首次出现的重要NPC仍可新建，不重建已有档案。

新人物可在开局或普通回合首次出现时建档，先检索已有稳定ID、identityKey、别名及初始同伴；不重复建同一个人。set npc[id]使用完整原NpcSchema去掉id，普通人物必需kind=ordinary、identityKey、name、aliases/skills数组、onScene布尔、affinity[-100,100]、relationshipText、空memories/knownInformation；locationId若提供须真实存在。初始记忆先留空，再用push记录。
已有字段：set npc[id].healthText/relationshipText为字符串，locationId为地点ID或null，onScene为布尔，lastInteractionAt为合法ISO游戏时间。没有在场审批；离场人物也可记录Story已经发生的变化，不能替World编造后台新行动。
结构化好感：set npc[id].affinityChange={from,to,reason,relationshipText}。from须匹配当前值，同批连续更新使用上一笔结果；未确认同伴from=null。关系不是恋爱等级，寒暄不自动涨分。联系人：set npc[id].contact={reason}。
统一人物记忆遵守共享输出协议的“人物原始记忆内容质量”；普通和特殊人物标准相同，仅写本人的实际经历、获知或判断。push npc[id].memories与knownInformation使用{text,knowledgeKind,knowledgeSource,visibility}；前者为统一原始记忆，后者同时建立唯一原始记忆，勿为同一事实重复写两次，不填程序ID/回合/时间元数据。
示例：
<命令>
set npc[lin].healthText = "擦伤已包扎"
set npc[lin].affinityChange = {"from":0,"to":5,"reason":"共同处理现场问题","relationshipText":"愿意协作"}
set npc[lin].contact = {"reason":"交换电话号码"}
push npc[lin].memories = {"text":"工作室交付旧相机时，委托方临时提出加急费用。自己核对清单并请主角保留凭据、暂不承诺；主角出示书面确认后，对方同意暂缓收费、次日核算。费用仍未确定，这次合作让自己愿意继续协助核实，但不会把暂缓当成免除。","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。

可set/add npc[id].affinity，程序读取真实前值生成原关系命令，不需要AI填写版本或前值；需更改关系描述时先set relationshipText。整个人物与原始记忆不允许delete。

未确认初始同伴的affinity占位不是已知数值，不能直接add。由模型决定最终绝对好感后用set（原显式affinityChange.from=null也仍可用），再做后续相对增减。

建档前遵守共享NPC V2规则：明确姓名与持续追踪价值同时成立才创建；无名或一次性路人不强制建档。已有ID/identityKey/别名与初始同伴优先复用。AI只可升级，不降级，不覆盖玩家取消意图；新电话、常驻地点和关系网使用共享正式路径，不从旧联系人推断。
