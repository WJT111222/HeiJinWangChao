变量组：economy / update
普通更新：只记录本回合现场变化，首次出现的重要NPC仍可新建，不重建已有档案。

经济仍分cash/onlineBalance/incomes/debts/properties/vehicles/otherAssets。所有金额为整数人民币分，账户只cash或onlineBalance。已持有资产估值不等于余额，未知余额不能当0。没有SetBalance、旧资产无交易登记或房产购买命令，不虚构收入/借款替代初始化；缺口写说明，保留旧数据。
负add economy.cash/onlineBalance是消费；set economy.incomes[id]必须为完整received记录（source、amount正整数、status、account、receivedAt合法已发生时间）；正add余额不是收入。push economy.transfers={from,to,amount}内部转账不生成收入。
set economy.debts[id]={account,debt:{creditor,principal,outstanding,status,repaymentTerms,collateralAssetIds,autoPaymentAuthorized,source,...}}，新借款active且本金等于未偿本金。push economy.debts[id].repayments={account,amount}，原引擎扣余额减本金，还清变repaid。
set economy.vehicles[id].purchase={account,price,vehicle:完整VehicleAsset去掉id}，购买扣款登记资产，不再创建普通物品。车辆值含kind=vehicle、name、ownerRef、estimatedValue可null、source、statusText、model及可选合法acquiredAt/locationId。
顺序必须符合本回合交易实际：先到账再消费，不能提前透支后面的收入。时钟用当前SAVE_STATE.worldClock或本批合法普通时间，不照抄示例日期。
示例（hero为主角ID，金额是分，receivedAt须换成本轮合法游戏时间）：
<命令>
set economy.incomes[pay] = {"source":"已到账报酬","amount":5000,"status":"received","account":"cash","receivedAt":"2026-10-18T08:00:00+08:00"}
add economy.cash = -3000
push economy.transfers = {"from":"cash","to":"onlineBalance","amount":500}
set economy.debts[loan] = {"account":"cash","debt":{"creditor":"朋友","principal":1000,"outstanding":1000,"status":"active","repaymentTerms":"协商还款","collateralAssetIds":[],"autoPaymentAuthorized":false,"source":"本轮借款"}}
push economy.debts[loan].repayments = {"account":"cash","amount":500}
</命令>

只用TEXT_COMMAND_CATALOG支持的set/add/push路径，值为JSON；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
