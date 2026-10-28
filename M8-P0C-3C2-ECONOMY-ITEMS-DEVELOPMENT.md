# M8-P0C-3C-2：文本变量资金与物品完整流转

## 基线与当前状态

基线为远端main `9f883f93fc5332bae2debf87fd80e036bf9d2071`（PR #39合并），分支`codex/m8-p0c3c2-economy-items`。

本轮使用已有解析器和领域引擎补齐文本交易映射，不修改正式JSON变量工作流、World后台、Prompt/Manifest、UI、存档Schema或迁移。没有凭据审批、来源审批、互动授权、覆盖许可、候选封印或新增AI调用。

阶段性实现已在定向237项、Lint和类型检查通过后，以`341f28f`提前提交并推送。此后补齐至本轮101项测试，当前5文件328项全部通过。完整检查已完成，结果在本报告末尾记录。

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

## 完整成功样例

前提：cash=10000、onlineBalance=20000；old_phone归主角hero，NPC b存在且可不在场；已有loan债务为active、未偿本金2000；游戏时间为2026-10-18 08:00（中国标准时间）。以下一次批次表示报酬→购买→赠送→还款：

```text
<说明>记录本回合已发生的交易。</说明>
<命令>
set economy.incomes[pay] = {"source":"工作报酬","amount":5000,"status":"received","account":"cash","receivedAt":"2026-10-18T08:00:00+08:00"}
set items[phone].purchase = {"account":"cash","price":8000,"item":{"name":"新手机","category":"device","quantity":1,"ownerRef":{"kind":"protagonist","id":"hero"},"conditionText":"全新"}}
set items[old_phone].transfer = {"from":{"kind":"protagonist","id":"hero"},"to":{"kind":"npc","id":"b"}}
push economy.debts[loan].repayments = {"account":"cash","amount":1000}
</命令>
```

结果：cash=6000、onlineBalance不变，收入表新增pay，phone入库归hero，old_phone归b，loan未偿本金变1000且仍active。真实执行只发生在内存模拟的副本；正式GameState不变。购买用单个PurchaseItem完成扣款和入库，不拆成两个独立事务。

借款和车辆的完整创建值例如：

```text
<命令>
set economy.debts[new_loan] = {"account":"cash","debt":{"creditor":"朋友","principal":3000,"outstanding":3000,"status":"active","repaymentTerms":"协商还款","collateralAssetIds":[],"autoPaymentAuthorized":false,"source":"本轮借款"}}
set economy.vehicles[car].purchase = {"account":"onlineBalance","price":2000,"vehicle":{"kind":"vehicle","name":"轿车","ownerRef":{"kind":"protagonist","id":"hero"},"estimatedValue":2000,"acquiredAt":"2026-10-18T08:00:00+08:00","source":"本轮购买","statusText":"完好","model":"普通车型","locationId":"chongqing"}}
set protagonist.currentWear = {"currentVehicleAssetId":"car","accessoryItemIds":[]}
</命令>
```

装备设置替换完整Equipment对象，不能按任意深层属性写入。autoPaymentAuthorized仅按原债务Schema保存，不启动任何自动扣款或维护任务。

## 完整失败样例

前提cash=10000：

```text
<命令>
set protagonist.emotionText = "轻松"
add economy.cash = -15000
set economy.incomes[late_pay] = {"source":"后面的报酬","amount":20000,"status":"received","account":"cash","receivedAt":"2026-10-18T08:00:00+08:00"}
</命令>
```

消费位置即触发原领域INSUFFICIENT_FUNDS，不能预支后面的收入；没有返回部分状态，情绪、余额和收入表均保持原输入。receivedAt晚于本轮投影时钟也不能入账。格式错误在编译时拒绝；余额、归属和引用等合法执行约束由真实领域模拟拒绝。两者都不是剧情事实审批。编译错误绑定原命令序号和SourceSpan；原领域整批失败继续保留relatedCommands整组来源，无法唯一归因时不伪造单条错误行。

## 文件与既有流程边界

- `src/executors/variableText/transactions.ts`：有限交易路径到原DomainCommandSchema的映射，不复制领域定义。
- `src/executors/variableText/compile.ts`：接入新映射，支持数量前值；移除只看初始余额的重复检查，由原领域引擎处理完整交易顺序。
- `src/tests/economy-item-text.test.ts`：101项新增，使用真实解析器/编译器/内存模拟；只有无IO检查使用spy。
- `src/tests/variable-text-executor.test.ts`：保持105项；currentWear错误类型归类以及余额失败验证位置与新执行逻辑对齐。
- `src/tests/variable-execution-without-review.test.ts`：保持14项；真正非法数据仍必须经过领域模拟整批拒绝。
- 本报告。

未修改DomainCommandSchema、领域命令执行实现、GameStateSchema、存储/CAS/事务、Story/Variables/World协调、Prompt/Manifest、UI、凭证或设置。没有新增依赖，也没有JSON/Text双协议兼容层。正式模型仍使用现有JSON协议，新文本映射没有接入正式请求；浏览器回归不应被描述为新文本协议已在玩家流程中生效。

## 验证与剩余工作

| 本次命令 | 实际结果 |
| --- | --- |
| 定向5文件Vitest | 328/328通过，新增101项；原67+105+41+14保留 |
| `npm run prompts:check` | 3文件、82/82通过，1.81秒（工程测试子集） |
| `npm run check` | 46文件、1761/1761通过，测试84.87秒；Lint零警告、TypeScript与Vite构建通过（1.04秒） |
| `npm run lint` / `npm run typecheck` | 另外执行也通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过，桌面145、移动145，19.8分钟，无失败/跳过/重试 |
| `git diff --check` / `git diff --cached --check` | 通过 |

原1660项工程测试保留，新增101项，共1761；未删除或跳过原测试。阶段性提交前的237项定向、Lint、类型检查也通过。既有大于500kB构建分块提示仍在，不扩大范围处理。本轮尚不支持房产购买、其他资产交易、无原生命令的资产出售/估值修改、物品任意深层属性编辑或自由经济对象覆盖。未接入真实AI工作流。未新增部分堆叠物品拆分赠送、资产出售、任意itemDetails修改等无现成对应映射的能力；现有车辆/房产分类约束按原领域规则执行，不开发新的文学名称识别器。未知余额仍不当作0，收入或借款不能自行推算初始余额；本轮没有直接余额初始化/SetBalance命令。

所有模型场景仅Mock，不调用真实付费模型；不自动合并，不主动部署生产环境。PR预览可由既有Cloudflare自动流程处理。阶段性提交`341f28f`与测试提交`6dd302b`已提前推送；本次完整验证通过后补录本报告，创建Draft等待审查。
