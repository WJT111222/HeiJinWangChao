变量组：items / init
初始化：只在开局所选现场建立必要记录，保留创角已有数据和同伴，Story时钟由程序注入，不重复计时。

重要物品完整值采用原ImportantItem：name、category、quantity正整数、conditionText；可选description描述外观/特性/功能/背景，referenceValue是单件参考价值（人民币非负整数分），未知省略或null；ownerRef/位置及按类附加字段以目录为准；id来自路径，车辆房产不在此表复制。
获得set items[id]=完整物品，购买set items[id].purchase={account,price,item:完整物品}，一次扣款入库。赠送set items[id].transfer={from,to}，from=null仅当前无主物品；遗失set items[id].loss={expectedOwner,conditionText,locationId?}。
add items[id].quantity为非零整数增减，归零由原引擎删除并卸装备；set items[id].conditionText为字符串、locationId为合法ID或null。装备set protagonist.currentWear为完整Equipment（必有accessoryItemIds数组），不是任意深层槽位赋值。部分堆叠拆分转送不支持，写说明。set items[id].description/referenceValue/category/questItem分别更新单个字段；set items[id].itemDetails替换字符串属性记录，保留仍有效的旧属性，不支持items[id].itemDetails.xxx任意深层赋值。
示例：
<命令>
set items[phone] = {"name":"旧手机","category":"device","quantity":1,"conditionText":"可用","description":"黑色旧手机，日常联络用","referenceValue":80000,"itemDetails":{"brandModel":"旧款智能手机","functions":"通话与支付"},"ownerRef":{"kind":"protagonist","id":"hero"}}
set items[phone].conditionText = "屏幕有划痕"
set items[phone].transfer = {"from":{"kind":"protagonist","id":"hero"},"to":{"kind":"npc","id":"lin"}}
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。

set items[id].quantity为最终非负整数数量；delete items[id]代表彻底消耗移除，复用归零及卸装备行为。遗失用loss路径保留状态，不用delete冒充。装备槽支持set/delete，饰品ID数组支持push及按索引delete。

分类保持原细类：top/bottom/shoes/accessory为衣物穿戴；device为电子设备；document为证件文件；tool/weapon为工具与武器；other为生活用品与杂物。不要根据名称批量改旧类别。questItem是可选布尔任务标记，仅确有任务用途才填true，不从名称猜。
专属资料复用itemDetails字符串记录，按TEXT_COMMAND_CATALOG.itemDetailsGuide选择适用字段：衣物材质/尺码/保暖/防护/穿着特点；设备品牌型号/功能/电量/运行情况；文件内容/签发方/签署状态/有效期限/用途；工具主要用途/功能状况/耐用情况及适用的余量；生活用品用途/保质期/剩余用量/效果。未知省略，不强制填写数值。
referenceValue仅为参考价，与购买命令price分开；估值变化不代表成交，不额外收付款，不每回合强制重估；身份证等不可合法交易物品不编造普通市价，保持null或省略。description通常稳定，磨损/故障更新conditionText，适用的动态信息更新itemDetails。
