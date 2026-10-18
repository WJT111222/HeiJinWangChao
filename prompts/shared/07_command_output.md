只输出一个可解析的JSON对象，不包含Markdown、自然语言前言、代码围栏或隐藏思考。顶层字段固定为：commands（数组）、rejectedSuggestions（数组）、unresolved（数组）。可全部为空数组。
每个commands对象必须包含 commandId（稳定字符串）、group（protagonist / npc / items / economy / organization / time / event）、type（已批准的领域命令类型）、entityId（如适用）、payload（对象）、evidence（正文中已成立事实的精炼引用或定位）。禁止发明新的数据库路径、使用任意JS表达式、直接输出SQL或直接写入数据库。
可用命令类型及payload应遵守程序传入的 <COMMAND_CATALOG>；若该目录未提供，以下为V0.1推荐集合：ProtagonistInitialized、ProtagonistPatched、LocationSet、EquipmentSet、EnvironmentSet、NpcCreated、NpcPatched、NpcMemoryAppended、NpcOnSceneSet、ItemCreated、ItemTransferred、ItemQuantityChanged、ItemConditionChanged、BalanceChanged、IncomeRecordUpserted、DebtRecordUpserted、PropertyAssetUpserted、VehicleAssetUpserted、OtherAssetUpserted、OrgCreated、OrgPatched、OrgRelationRecorded、WorldClockSet、EventPatched、TaskPatched。
每个增量金额在payload中写清 account、oldValue、newValue、reason，注明支付途径并避免账户间转账重复记收入。实体创建需提供稳定的entityId与可重复校验身份的信息。更新对象的前值应与输入状态一致；未知值不擅填0。
对被建议却不符合正文事实的变化，在rejectedSuggestions中以 {reason,reference} 说明；未定内容在unresolved中以短文本列出。每个建议必须可以被程序独立接受或拒绝；不允许靠一条含多个互不相干副作用的自由文本指令蒙混通过。
输出只代表候选变更，必须经过程序验收和原子提交后才能被称作已生效。
