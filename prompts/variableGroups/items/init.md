变量组：items / init
初始化：只在开局所选现场建立必要记录，保留创角已有数据和同伴，Story时钟由程序注入，不重复计时。

重要物品完整值采用原ImportantItem：name、category、quantity正整数、conditionText，ownerRef/位置及按类附加字段以目录为准；id来自路径，车辆房产不在此表复制。
获得set items[id]=完整物品，购买set items[id].purchase={account,price,item:完整物品}，一次扣款入库。赠送set items[id].transfer={from,to}，from=null仅当前无主物品；遗失set items[id].loss={expectedOwner,conditionText,locationId?}。
add items[id].quantity为非零整数增减，归零由原引擎删除并卸装备；set items[id].conditionText为字符串、locationId为合法ID或null。装备set protagonist.currentWear为完整Equipment（必有accessoryItemIds数组），不是任意深层槽位赋值。部分堆叠拆分转送、任意itemDetails修改不支持，写说明。
示例：
<命令>
set items[phone] = {"name":"旧手机","category":"device","quantity":1,"conditionText":"可用","ownerRef":{"kind":"protagonist","id":"hero"}}
set items[phone].conditionText = "屏幕有划痕"
set items[phone].transfer = {"from":{"kind":"protagonist","id":"hero"},"to":{"kind":"npc","id":"lin"}}
</命令>

只用TEXT_COMMAND_CATALOG支持的set/add/push路径，值为JSON；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
