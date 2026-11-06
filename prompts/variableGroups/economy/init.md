变量组：economy / init
建立与玩家人生背景相符的经济起点，并区分原有资金、预期收入和本幕实际交易。

经济沿用cash/onlineBalance/incomes/debts/properties/vehicles/otherAssets，金额均为整数人民币分，账户仅cash或onlineBalance。SAVE_STATE.openingInitializationPending=true的新开局允许一条set opening.initialState，填写未知余额与初始预期收入，已有明确值包括0不得覆盖。根据年龄、职业、工龄、家庭与城市合理补足，不要求小说逐字报数；资产估值不能当余额。
expectedIncomes是既有IncomeRecord数组，每条带稳定id、source、amount、status="expected"、account和scheduleText支付安排；可选expectedAt必须不早于开局候选endAt。不填receivedAt/sourceTurnId，不产生到账、借款或交易，不把预期工资再加进存款。稳定职业可以设工资；学生可设家庭生活费/奖学金/兼职，失业者不凭空设工资，可只有存款或已有支持；富裕家庭不必强行从零起步。暂无预期收入用空数组，不编造零薪雇佣关系。
将天气、环境和经济初始化合在同一条命令，先初始化再实际交易。示例仅展示结构，数字、周期、ID和天气需按当前人物重算：
<命令>
set opening.initialState = {"weatherText":"夏日多云","environmentText":"住宅楼下早餐铺刚开门，楼道传来邻居的脚步声。","cash":30000,"onlineBalance":3200000,"expectedIncomes":[{"id":"salary_teaching","source":"教师工资","amount":580000,"status":"expected","account":"onlineBalance","scheduleText":"每月15日发薪"}]}
</命令>
初始化不是任意经济对象覆盖；仅新开局一次，普通回合或无标记旧档不能调用。历史债务无到账登记、旧资产无交易登记、房产购买仍未支持，写明缺口，不虚构收入/借款/购买。

本幕实际交易继续按现有规则：负add economy.cash/onlineBalance为消费；set economy.incomes[id]只接受完整received记录，含source、正整数分amount、status、account、合法receivedAt。它与initialState.expectedIncomes不同，必须确有实际到账，正add余额不是收入。
push economy.transfers={from,to,amount}只在账户间转账。set economy.debts[id]={account,debt:{creditor,principal,outstanding,status,repaymentTerms,collateralAssetIds,autoPaymentAuthorized,source,...}}为本幕新借款，active且本金等于未偿本金。push economy.debts[id].repayments={account,amount}扣余额、减本金，还清变repaid。
set economy.vehicles[id].purchase={account,price,vehicle:完整VehicleAsset去掉id}购买扣款登记，不再创建普通物品；不能借此补录早已持有的车。
按交易原顺序执行，不提前透支尚未到账的未来收入。时钟使用开局Story候选，不照抄示例日期。
只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径，不输出DomainCommand对象；未支持事项写说明，不伪造成功或另建审批。后台任务与事件交给World。
