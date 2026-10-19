只输出一个可解析的JSON对象，不包含Markdown、自然语言前言、代码围栏或隐藏思考。顶层字段固定为：commands（数组）、rejectedSuggestions（数组）、unresolved（数组）。可全部为空数组。
每个 commands 对象包含 commandId（稳定字符串）、type（真实目录中的命令类型）、evidence（所提供正文的原文事实片段），以及该 type 专属的同级字段。严格使用 COMMAND_CATALOG 中的 JSON Schema，不得使用旧的 group/entityId/payload 通用包装、未知字段、任意对象路径、JS、SQL 或直接数据库写入。
COMMAND_CATALOG 由程序从实际 DomainCommandSchema 提供。当前仅支持 PurchaseItem、PurchaseVehicle、TransferFunds、ReceiveIncome、Borrow、RepayDebt、CreateNpc、SetEquipment、TransferItem、SetWorldClock、SaveEvent、SaveTask、CreateOrganization、RecordOrgRelation。没有目录时不得回退旧推荐命令；不支持的 NPC/主角/组织补丁、记忆追加、物品数量状态变更等建议列入 unresolved，不能将创建命令冒充更新。
金额单位为整数人民币分，账户仅 cash/onlineBalance；各 type 的 price/amount、income、debt 等字段以目录为准，不输出任意 oldValue/newValue 余额调整。购买、内部转账、收入、借款与还款分别使用真实领域命令，不能拆成语义不等价的通用扣款/创建。程序校验金额、归属、引用、ID、时间、幂等及整批事务。
对被建议却不符合正文事实的变化，在rejectedSuggestions中以 {reason,reference} 说明；未定内容在unresolved中以短文本列出。每个建议必须可以被程序独立接受或拒绝；不允许靠一条含多个互不相干副作用的自由文本指令蒙混通过。
输出只代表候选变更，必须经过程序验收和原子提交后才能被称作已生效。
