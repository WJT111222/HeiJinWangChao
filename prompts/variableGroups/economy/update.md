变量组：economy / update
普通更新：只记录本回合现场变化，首次出现的重要NPC仍可新建，不重建已有档案。

经济仍分cash/onlineBalance/incomes/debts/properties/vehicles/otherAssets。所有金额为整数人民币分，账户只cash或onlineBalance。已持有资产估值不等于余额，未知余额不能当0。没有SetBalance，不虚构收入/借款替代初始化；缺口写说明，保留旧数据。
负add economy.cash/onlineBalance是消费；set economy.incomes[id]必须为完整received记录（source、amount正整数、status、account、receivedAt合法已发生时间）；正add余额不是收入。push economy.transfers={from,to,amount}内部转账不生成收入。
set economy.debts[id]={account,debt:{creditor,principal,outstanding,status,repaymentTerms,collateralAssetIds,autoPaymentAuthorized,source,...}}，新借款active且本金等于未偿本金。push economy.debts[id].repayments={account,amount}，原引擎扣余额减本金，还清变repaid。
set economy.vehicles[id].purchase={account,price,vehicle:完整VehicleAsset去掉id}，购买扣款登记资产，不再创建普通物品。车辆值含kind=vehicle、name、ownerRef、estimatedValue可null、source、statusText、model及可选合法acquiredAt/locationId。
set economy.properties[id].purchase={account,price,property:完整PropertyAsset去掉id}购房扣款登记。房产值含kind=property、name、ownerRef、estimatedValue可null、source、statusText、locationId（已有或同批新建的地点）、ownershipText产权说明及可选acquiredAt；按揭时mortgageDebtId指向同批set economy.debts新建的房贷，该房贷collateralAssetIds写本房产ID，顺序为先借款到账、再按总价购房。set economy.otherAssets[id].purchase={account,price,asset:完整OtherAsset去掉id}登记股份、收藏品等其他资产，值含kind=other、category、details。
本回合Story明确得到、但没有付款的资产（继承、受赠、过户到主角名下），用set economy.properties[id]、economy.vehicles[id]或economy.otherAssets[id]=完整资产去掉id直接登记，不扣款也不加余额。资产一律归主角，ownerRef填主角；车辆房产不进重要物品表。已登记资产的出售和估值变化暂无命令，写说明。
顺序必须符合本回合交易实际：先到账再消费，不能提前透支后面的收入。时钟用当前SAVE_STATE.worldClock或本批合法普通时间，不照抄示例日期。
示例（hero为主角ID，金额是分，receivedAt须换成本轮合法游戏时间）：
<命令>
set economy.incomes[pay] = {"source":"已到账报酬","amount":5000,"status":"received","account":"cash","receivedAt":"2026-10-18T08:00:00+08:00"}
add economy.cash = -3000
push economy.transfers = {"from":"cash","to":"onlineBalance","amount":500}
set economy.debts[loan] = {"account":"cash","debt":{"creditor":"朋友","principal":1000,"outstanding":1000,"status":"active","repaymentTerms":"协商还款","collateralAssetIds":[],"autoPaymentAuthorized":false,"source":"本轮借款"}}
push economy.debts[loan].repayments = {"account":"cash","amount":500}
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
