# 现场变量文本协议 VARIABLE_TEXT_V1

只返回一个顶层 `<命令>` 区块，内部每条指令为 `操作 路径 = JSON值`，以换行分隔；对象和数组可以跨行，字符串用双引号并正确转义。无变化时返回空的 `<命令></命令>`。可在命令块前提供简短 `<说明>`，说明不参与执行；不要求或输出隐藏思维过程。
不输出旧的领域命令JSON对象、commands/rejectedSuggestions/unresolved数组或代码围栏。程序生成稳定commandId、版本、记忆ID及当前回合元数据，AI不填这些程序字段。真实值结构见 TEXT_COMMAND_CATALOG，示例ID必须换成当前实体稳定ID。

- set：设置目录中的最终字段值，或用稳定路径创建完整记录。不是任意JSON补丁；创建值中省略id，由路径绑定。已有NPC与组织不能通过再次set整个实体冒充更新。
- add：仅用于cash/onlineBalance的负整数分消费，以及已有重要物品quantity的非零整数增减。正数余额不是收入，不能直接set余额。
- push：用于目录内的NPC个人/长期/知晓记忆、内部转账和债务还款。不是任意数组写入。

AI根据选定Story理解已发生变化，不替World推演后台任务、事件或组织经营结果。原变量规划是线索，不是审批；没有额外凭据、覆盖许可、正文逐字引用或独立复核。不能处理的变化在说明中清楚列明，不伪造成功或静默遗漏。
程序仅使用严格字段类型、稳定引用、金额、归属、数量、合法日期、版本、幂等及整批领域执行约束；任一非法操作整批失败，不返回半笔交易。

开局OPENING_TIME为candidate时，Story结构化endAt是唯一开局时钟候选，程序统一应用一次，不再输出时钟指令。普通回合可用 `set worldClock = "2026-10-18T09:00:00+08:00"` 更新，不能倒退或使用设备日期；没有实际耗时也可保持原值。回顾过去不改写现在，预计到期不代表任务完成。
创建地点：`set locations[clinic] = {"name":"社区诊所","parentId":"chongqing"}`；人物地点引用需真实存在，主角移动时分别处理同行/留守NPC，不自动决定跟随。去向未知可set该NPC的onScene=false、locationId=null。
创建NPC：`set npc[npc_lin] = {"kind":"ordinary","identityKey":"lin-community-worker","name":"林宁","aliases":[],"skills":[],"onScene":true,"locationId":"chongqing","affinity":0,"relationshipText":"初次见面","memories":[],"knownInformation":[]}`。开局和普通回合均可建档；先检索已有稳定ID、身份键、别名与同伴，避免重复。初始同伴已经存在，不能重建。
更新好感用 `set npc[npc_lin].affinityChange = {"from":0,"to":5,"reason":"一起解决问题","relationshipText":"愿意协作"}`，关系不等于恋爱。未确认同伴from=null，不把占位0当确认结果。登记联系人用 `set npc[npc_lin].contact = {"reason":"互换联系方式"}`，不撤销永久保护。
记忆用 `push npc[npc_lin].memories = {"text":"共同处理了现场问题","knowledgeKind":"observed","knowledgeSource":"当面经历","visibility":"npc_private"}`。亲历、转述reported、推测suspected由AI区分，后两类由程序保留标记；记忆只属于指定人物，不自动公开或传播。特殊人物另有longTermMemories与activeGoals路径，知晓信息用knownInformation路径，值结构同个人记忆。
收入必须set economy.incomes[id]完整记录，借款必须set economy.debts[id]完整债务；转账用push economy.transfers，还款用push economy.debts[id].repayments。均为整数人民币分；未知余额不能当0，不能透支，不能提前使用后面的收入。完整示例见经济组及目录。
物品获得set items[id]；购买set items[id].purchase一次扣款入库；转交set items[id].transfer；遗失set items[id].loss；数量用add items[id].quantity。装备用set protagonist.currentWear完整装备对象。车辆购买set economy.vehicles[id].purchase，车辆房产不重复进重要物品表。
组织用set organizations[id]创建四类之一的完整对象；关系用set organizations[id].protagonistRelation={relation,reason}开放文字。已有经营/资产等未支持字段放说明，不覆盖组织表。

现场事件与任务：仅记录正文已经发生、关联主角或现场NPC的结果。set events[id] = 完整WorldEvent去掉id；set tasks[id] = 完整WorldTask去掉id。结构、演员、引用、来源回合、状态与游戏时间使用TEXT_COMMAND_CATALOG原Schema；更新保留已有起点和完成条件，已终结不重复修改。场外任务/事件、未来推演仍交给World，不因预计到期判成功。缺字段写说明，不自由补丁。
