变量组：npc_ordinary / init
初始化：只在开局所选现场建立必要记录，保留创角已有数据和同伴，Story时钟由程序注入，不重复计时。

新人物可在开局或普通回合首次出现时建档，先检索已有稳定ID、identityKey、别名及初始同伴；不重复建同一个人。set npc[id]使用完整原NpcSchema去掉id，普通人物必需kind=ordinary、identityKey、name、aliases/skills数组、onScene布尔、affinity[-100,100]、relationshipText、空memories/knownInformation；locationId若提供须真实存在。初始记忆先留空，再用push记录。
已有字段：set npc[id].healthText/relationshipText为字符串，locationId为地点ID或null，onScene为布尔，lastInteractionAt为合法ISO游戏时间。没有在场审批；离场人物也可记录Story已经发生的变化，不能替World编造后台新行动。
好感：唯一写法 set npc[id].affinityChange = {"to":变化后终值,"reason":"本回合具体剧情原因","relationshipText":"当前关系与态度"}，三项都不可省略，to在[-100,100]；前值由程序读取正式状态（同批连续更新按上一笔结果），不要填from，也不用set/add npc[id].affinity。关系不是恋爱等级，寒暄不自动涨分。交换可用电话：set npc[id].phoneContact={"status":"known"}。
统一人物记忆遵守共享输出协议的“人物原始记忆内容质量”；普通和特殊人物标准相同，仅写本人的实际经历、获知或判断。push npc[id].memories与knownInformation使用{text,knowledgeKind,knowledgeSource,visibility}；前者为统一原始记忆，后者同时建立唯一原始记忆，勿为同一事实重复写两次，不填程序ID/回合/时间元数据。
示例：
<命令>
set npc[lin].healthText = "擦伤已包扎"
set npc[lin].affinityChange = {"to":35,"reason":"主角帮忙核对清单、替自己挡下加急费","relationshipText":"愿意协作"}
set npc[lin].phoneContact = {"status":"known"}
push npc[lin].memories = {"text":"工作室交付旧相机时，委托方临时提出加急费用。自己核对清单并请主角保留凭据、暂不承诺；主角出示书面确认后，对方同意暂缓收费、次日核算。费用仍未确定，这次合作让自己愿意继续协助核实，但不会把暂缓当成免除。","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。

好感只用set npc[id].affinityChange={to,reason,relationshipText}：reason写清本回合具体是什么剧情让好感变化，relationshipText写当前关系与态度；程序读取真实前值生成关系命令，AI不填版本或前值。整个人物与原始记忆不允许delete。

未确认初始同伴的affinity占位不是已知数值；第一次用affinityChange写出由剧情决定的终值即为确认，程序内部按from=null处理。

建档前遵守共享NPC V2规则：明确姓名与持续追踪价值同时成立才创建；无名或一次性路人不强制建档。已有ID/identityKey/别名与初始同伴优先复用。AI只可升级，不降级，不覆盖玩家取消意图；新电话、常驻地点和关系网使用共享正式路径，不从既有认识或好感推断。

后宫专属事实仅由 Variables 按所选正文与存档判断。有实质变化时，整轮只写一条 set harem.changes = [...]，按 TEXT_COMMAND_CATALOG 填各项 op 和 reason。正式加入须为已确认成年的女性、双向关系已成立；长期事实可确认，不把好感、恋爱、亲密、单方愿望或世界书设定自动当成加入。现役非空恰一人 100，其余 0～99；更替、退出与继任一起写，score/leave 的 from 为真实前值。地位与组织权力独立，不设固定加分或自动衰减。和谐度未知可为 null；仅记录重要行动与目的及发生过的联络。Variables 只写剧情中发生或主角在场得知的变化；离场成员的计划、离场成员之间的关系和家庭总体局势在场外的推进由 World 负责。没有变化可不写。
妊娠猜测与确认分开，到期不自动出生。确认已有独立子女 NPC 才登记亲子；同轮新生先用 set npc[id] 建档，再在同一事务登记 child；不确定的亲子不计数。生物、收养及继亲分别记录，未成年人无成人私密档案。计划、关系对、妊娠及子女事实按知情范围标记 visibility，不把内部事实传播给其他人物。
