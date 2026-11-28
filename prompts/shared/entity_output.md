接触者名单使用 JSON 字符串数组，无新接触者时用空数组。已有在场者由程序加入名单。名单之后按 thinking、说明、命令顺序输出，只使用本阶段目录。
创建地点：`set locations[clinic] = {"name":"社区诊所","parentId":"chongqing"}`；人物地点引用需真实存在，主角移动时分别处理同行/留守NPC，不自动决定跟随。去向未知可set该NPC的onScene=false、locationId=null。
创建NPC：`set npc[npc_lin] = {"kind":"ordinary","identityKey":"lin-community-worker","name":"林宁","aliases":[],"skills":[],"onScene":true,"locationId":"chongqing","affinity":0,"relationshipText":"初次见面","memories":[],"knownInformation":[]}`。开局和普通回合均可建档；先检索已有稳定ID、身份键、别名与同伴，避免重复。初始同伴已经存在，不能重建。
更新好感唯一写法：`set npc[npc_lin].affinityChange = {"to":35,"reason":"主角替自己挡下加急费，彼此更信任","relationshipText":"愿意继续协作"}`（示例ID、数值和原因必须换成实际剧情）。to是变化后的好感终值[-100,100]，可为负；reason写本回合具体剧情原因，不写空泛套话；relationshipText写当前关系与态度；三项都不可省略。前值由程序读取正式状态，同批连续更新按上一笔结果，不填from。不能借记忆补写伪造好感。好感与个人记忆可在同批分别写入，不是冲突操作。关系不等于恋爱。未确认同伴from=null，不把占位0当确认结果。
记忆用 `push npc[npc_lin].memories = {"text":"工作室交付旧相机时，委托方临时提出加急费用。自己核对清单并请主角保留凭据、暂不承诺；主角出示书面确认后，对方同意暂缓收费、次日核算。费用仍未确定，这次合作让自己愿意继续协助核实，但不会把暂缓当成免除。","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}`。亲历、转述reported、推测suspected由AI区分，后两类由程序保留标记；记忆只属于指定人物，不自动公开或传播。普通和特殊人物均使用memories，不选择长期层，不因重要程度强制增加记忆；特殊人物的activeGoals仍为专属目标。知晓信息用knownInformation路径，值结构同个人记忆。
未确认初始同伴的affinity占位不是已知数值；第一次用affinityChange写出由剧情决定的终值即为确认，程序内部按from=null处理。
## NPC 认知输入与只读存档的区别
push npc[id].memories与push npc[id].knownInformation统一使用四字段JSON对象：text字符串、knowledgeKind（observed/reported/suspected）、knowledgeSource字符串、visibility（npc_private/internal/player_known）。四项都必须提供，由AI选择认知性质；程序不猜测补齐。
SAVE_STATE.npc[id]内knownInformation的source/learnedAt是只读存档字段，不可复制为命令值；不要带id、source、learnedAt、createdAtGameTime、sourceTurnIds或affectedEntityRefs。程序根据指定NPC和本回合生成这些元数据。新增knownInformation时会同时记录个人记忆，不要把同一条再push到memories。
例如（lin须替换为实际稳定NPC ID）：
<命令>
push npc[lin].knownInformation = {"text":"得知值班安排","knowledgeKind":"reported","knowledgeSource":"当面告知","visibility":"npc_private"}
</命令>
## NPC V2 建档与重要性
正式NPC只有ordinary/special。仅当Story或正式设定已经明确姓名，且有合理后续接触、持续关系或事件追踪价值时才建档；不能为一个小混混、茶楼服务员、黑衣保镖、黄毛青年或某个路人编造姓名来建档，也不用角色称呼冒充姓名。一次性服务和无名群众可留在正文，损失、受伤、情报和事件照常记录，不为保存剧情强制建NPC。人物后来获得姓名和持续关系才建档，不猜合先前不同路人。先检索稳定ID、identityKey、姓名/别名、初始同伴与正式引用，改名/职业或重要性变化均复用原身份。
AI判断持续价值，不设次数、好感、职位阈值；新人物可直接ordinary/special，已有ordinary可升级，AI不得降级special。NPC_IMPORTANCE中的playerPreference=ordinary表示玩家取消，禁止AI再升级；special为玩家指定；automatic不代表玩家拒绝。
升级/补齐用set npc[id].specialProfile={detailedBackground,activeGoals,habits,offscreenTaskIds,relationshipNetwork?}，沿用原人并编译为PromoteNpc；任务ID必须真实归属。profilePending=true是待完善，不是空白经历事实，应在本次正常Variables补齐，不单独请求AI。canRestoreProfile=true时先用set npc[id].specialProfile={}恢复原档案，不重新生成已有内容；待完善时只补缺失资料。香闺秘档继续使用原privateProfile路径及原保护，不混入specialProfile。
set npc[id].phoneContact={status:"unknown"|"known"|"invalid",note?}，开局同伴默认有号码。阶段一新建主角原有同学、同事、亲戚或旧识的档案时另写known；新认识的陌生人须在正文实际交换可用电话。对已有档案不凭认识或好感补号码。set npc[id].usualLocations=[{locationId,role:"home"|"work"|"frequent",knownToProtagonist}]，区分常驻与当前位置、世界记录与主角知晓，不虚构地点，不必人人都有。
已有special可set npc[id].detailedBackground、habits、relationshipNetwork；关系数组条目{name,relationship,description,affinity?,npcId?}，好感单向[-100,100]，未知缺省/null；未建档只记姓名不自动建NPC，不猜ID或传播关系。任务另由原正式任务命令处理，不伪造offscreenTaskIds。记忆/总结、基础关系及认知不因身份升级而重置，休眠专属资料不能从其他人物或文本中复造。


### 人物原始记忆内容质量
普通和特殊NPC使用相同标准。记忆是该人物自身经历和认知的记录，不是事件标题；对有长期意义的经历，依据已选定Story与正式背景，尽可能保留事件背景（为什么发生、当时处境）、具体经过（参与者及重要行动交流）、本人表现（自己做了什么、如何应对）、个人认知（亲见、被告知或形成的判断）、最终结果（已发生结果及未决问题）、持续影响（对关系、承诺或后续处境的理解）。按实际剧情取舍，不机械凑六项，不补造正文没有的行动、态度、日期或结果。
信息完整性高于字数。普通且值得记录的互动约40～100字，重要人物互动约100～200字，重大人生或关系转折约150～300字、必要时更长；这只是弹性写作参考，不是硬性字数门槛。简单事实可以简短，复杂经历不要压缩成“共同处理现场问题”“记住双方约定”“关系有所改善”这样的标签，不为凑字补事实。
以所属NPC的认知为中心，不复制全知视角给所有相关人物；分别保留自己观察、获知及判断的内容。亲历observed、转述reported、推测suspected以及knowledgeSource/visibility保持原语义；不在场者只有实际收到消息才记录转述，不把猜测或转述写成已证实的客观事实，也不自动传播给其他人。来源回合与人物引用继续使用各阶段原有协议，不为丰富内容伪造来源。
同一连续事件可写一条内容充分的记忆；同回合相互独立的重要经历可分别记录，不机械拆成大量重复短句。不强迫每回合写记忆，不为寒暄或无意义动作建记录，不因特殊身份增加数量。核对已有记忆与知晓索引，已记录的同一经历不重复追加；knownInformation不是第二份原始记忆。只指导未来新记忆，不补写或改写旧原文，不改变既有总结与原始记忆永久保留机制。

人物资料与经历配合：当NPC经历重大变化或长期离场后重新出现，同时核对姓名/别名/身份与职业、健康/位置/在场状态、与主角关系及好感，特殊人物再核对目标与必要专属资料；只有选定Story或正式背景提供变化依据时才使用目录内已有路径更新，否则保持原值。记忆记录过去经历，档案记录当前有效状态，二者不相互替代；不要借补记忆擅自改变好感、关系、身份，不重复建档，也不推演World后台新行动。

正文手机：用 push npc[id].phoneMessages 记录已发生的短信或通话，使用稳定 messageId、sender（npc/protagonist）、medium（text/call）、text 原话。可附 at，省略使用有效结束时钟。主角发出的消息可附 status（delivered/read/read_unanswered）。正文仅提及已有场外人物时，可单独 set npc[id].appearedInStory = true，不因此推断号码或联系人关系。
