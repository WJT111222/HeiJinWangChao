# 差异字段、权限与导航

| 分类 | 实际正式来源 | 展示与目标 |
|---|---|---|
| 时间与地点 | worldClock、protagonist.locationId、weatherText、environmentText | 中国标准时间旧→新及经过时长；完整地点层级名称；人物档案／真实地点地图 |
| 主角 | economy.cash、onlineBalance；healthText、emotionText、publicStatus、legalStatus；currentWear 七槽 | 整数分精确差额、完整旧→新；人物档案／经济资产 |
| 人物 | playerView.npc 的新增、已确认 affinity、relationshipText、onScene、locationId、knownInformation、memories | 同名实体仍按正式 ID 比较；记忆按可见性和认知性质分组；定位 NPC |
| 物品 | protagonistInventory 的正式主角物品与装备集合 | 获得、失去、数量旧→新、状态和装备；当前物品精确定位，失去项仅打开物品栏 |
| 世界 | playerView.organizations、eventArchive、tasks、locations | 组织及正式关系；主／子事件状态、并行新阶段、退役、固定结束时刻、正式结果及知识分类；任务状态、新地点 |
| 记忆与历史 | playerView.memories 的 stored 记录、timeline 正式记录 | 按层级／权限／性质汇总新记忆，纪事与普通史料分别汇总；层级入口／真实纪事／普通史料入口 |

时长仅作展示，按整数毫秒拆分再格式化秒，保留正式时钟的实际精度，避免 61.1 秒被浮点减法显示为长尾小数。无任何时钟回写。

金额边界测试采用 `Number.MAX_SAFE_INTEGER` 分（90,071,992,547,409.91 元）至零；正常金额同时覆盖现金减少与线上资金增加。差值先转 BigInt 后相减，避免中间运算引入浮点误差。null 始终显示「未确认」，不推算差额。数量同样先 BigInt 再相减。

新增已知信息采用多重集合差，保留重复但正式独立保存的无 ID 条目。人物记忆按正式 ID 比较，通用记忆按既有 recordKey 比较。既有 journal 派生即时别名不当作新增独立记忆重复计数。每组数量表示变化行数；合并的新增记忆／史料行另列其正式新增记录数量。第一条原文作为摘要，完整多条记录从原资料面板可达。

NPC 初始未确认关系数值继续隐藏；不比较 privateProfile、dormant profiles、importance 或 knownToProtagonist。既有玩家观察档案可查看已保存人物私有／内部记忆，不等于角色获得这些知识；清单明确保留此区分。事件使用既有客观档案投影，不使用 Story 专用知情投影，也不按叙述猜测事实。resultKnowledge 的 facts、reported、suspected 分开；完整结果叙述附带未必逐句核实提示。正式历史继续使用 established、reported、suspected 的真实分类。

资产、债务、组织管理层身份、秘密档案等未列入交接文档的字段未扩大比较范围。未新增资产合计、利息、推断关系或知识解锁。ID 仅用于 React key 与合法导航，不显示在变化文案中；目标面板保留原有正式字段显示规则。

## 导航降级

- NPC／组织／事件：既有 ArchivePanel 的 initialId；事件退役后仍使用档案 ID。
- 物品：当前主角物品的真实 ID；已移除或转移项不能在主角列表定位，打开完整物品栏。
- 地点：真实地点 ID、正式祖先链、既有树分段限额；不猜测隶属、不移动主角。
- 历史：正式 Chronicle 支持选中条目；普通史料只支持原资料入口，重置搜索到可浏览状态。
- 记忆：原面板只支持层级选择，定位短／中／长／人物层级，不伪造单条定位能力。
- 任务：只有真实 linkedEventId 存在于事件档案时定位该事件，否则打开事件名录。

浏览、搜索、选择、展开、关联跳转不写任何正式 store 或草稿。原有 NPC 明确点击星标等管理入口不受本轮影响。
