# M8-P0C-3C-2：文本变量资金与物品完整流转

## 基线与当前状态

基线为远端main `9f883f93fc5332bae2debf87fd80e036bf9d2071`（PR #39合并），分支`codex/m8-p0c3c2-economy-items`。

本轮使用已有解析器和领域引擎补齐文本交易映射，不修改正式JSON变量工作流、World后台、Prompt/Manifest、UI、存档Schema或迁移。没有凭据审批、来源审批、互动授权、覆盖许可、候选封印或新增AI调用。

阶段性状态：实现已完成并通过初步定向回归；先提交、推送防止云环境故障丢失，随后补齐异常及重放测试、运行完整检查。最终测试结果在本报告末尾更新，未执行项不标为通过。

## 新增文本映射

所有金额为整数人民币分。创建记录的id来自稳定路径，值中不重复提供id；交易字段使用原DomainCommandSchema严格校验，不复制第二套经济或物品Schema。

| 文本路径 | 操作及值 | 原领域命令 |
| --- | --- | --- |
| `economy.incomes[income_id]` | set 完整IncomeRecord（去掉id）；必须received、正金额、合法receivedAt | ReceiveIncome |
| `economy.transfers` | push `{from,to,amount}` | TransferFunds |
| `economy.debts[debt_id]` | set `{account,debt:{完整DebtRecord去掉id}}`，active且本金等于未偿本金 | Borrow |
| `economy.debts[debt_id].repayments` | push `{account,amount}` | RepayDebt |
| `items[item_id]` | set 完整ImportantItem（去掉id） | AcquireItem |
| `items[item_id].purchase` | set `{account,price,item:{完整ImportantItem去掉id}}` | PurchaseItem |
| `items[item_id].transfer` | set `{from:ActorRef或null,to:ActorRef}` | TransferItem |
| `items[item_id].loss` | set `{expectedOwner,locationId?,conditionText}` | LoseItem |
| `items[item_id].conditionText` | set 字符串 | UpdateItem |
| `items[item_id].locationId` | set 地点ID或null | UpdateItem |
| `protagonist.currentWear` | set 完整Equipment对象（含accessoryItemIds） | SetEquipment |
| `economy.vehicles[vehicle_id].purchase` | set `{account,price,vehicle:{完整VehicleAsset去掉id}}` | PurchaseVehicle |

原有18种映射保留，包括负数`add economy.cash/onlineBalance`消费、`add items[id].quantity`增减/归零以及时间、地点、人物与记忆。新增12种，共30种。`push economy.transfers`和`push economy.debts[id].repayments`是有限交易入口，不创建影子转账/还款数据库；原appliedCommands保留稳定命令ID。不会把正数add余额当成无记录收入，也不会把set items[id]解释为任意物品覆盖。

## 批次、顺序和重放

所有非时钟命令保持原文本顺序；时钟沿用PR #39的前置机制，不重新改变时间协议。消费余额不再在编译时仅与初始余额比较；统一由原commitCommands执行交易次序并检查余额。因此收入→消费可用前笔余额，消费→收入不能先透支，尚未到达的receivedAt不能入账。

编译器只维护UpdateItem所需的数量前值，来源为正式物品、同批Acquire/Purchase/Update和精确重放的既有指纹；不另写余额、债务、归属或装备状态引擎。所有真实变化仍由既有领域命令一次整批模拟。任何失败不返回部分状态，不修改输入，不写数据库。

新增实体同批重复ID直接失败，包括创建→耗尽→再次使用相同ID创建；其他已存在ID、引用、金额、所有者、债务和装备约束复用原引擎。精确重放仍使用原稳定commandId、expectedRevision及应用指纹，清空物品也不重复扣款或复活。

创建对象的id、命令type/commandId/evidence、路径绑定itemId/debtId及版本由程序确定，输入不得覆盖；这只是命令结构，不是剧情审批。knowledgeSource、收入source和债务source均是原Schema数据，没有新增独立真实性凭据。

## 初步失败复现

先新增9个真实解析/编译/模拟用例，在原main上9项均失败。首次实现后8项通过，1项发现LoseItem需要原命令的expectedRevision；补齐程序版本字段后通过。额外验证先透支后收入仍整体失败。

原测试中关于余额不足的两个断言从“编译即失败”改为通过真实领域模拟检查同一invalid_amount；没有放松余额底线。旧currentWear不支持路径断言改为新字段的错误类型拒绝，旧用例数量不减少。

## 验证与剩余工作

阶段性5文件237项定向测试通过，Lint与类型检查通过；本轮新增测试当前10项。后续完整工程/提示词/Chromium结果待执行后记录。本轮尚不支持房产购买、其他资产交易、无原生命令的资产出售/估值修改、物品任意深层属性编辑或自由经济对象覆盖。未接入真实AI工作流。

所有模型场景仅Mock，不调用真实付费模型；不自动合并，不主动部署生产环境。保持Draft等待审查。
