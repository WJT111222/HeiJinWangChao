变量组：protagonist / init
初始化：根据玩家与Story建立必要的生活基础和现场记录，保留创角已有数据和同伴，Story时钟由程序注入，不重复计时。

现场主角只更新已有档案，不创建第二个主角。支持set protagonist.healthText、emotionText、locationId、profession、publicStatus、legalStatus为字符串，skills为字符串数组（整体替换合法技能列表，保留既有能力，不因普通行为自动升级）。不添加力量/智力/经验值。
地点先set locations[id]={name,parentId?}，再set protagonist.locationId。父级必须存在且无环，主角移动需分别处理同行和留守NPC。穿戴用set protagonist.currentWear完整Equipment，仅引用真实归主角的物品/载具。
结合年龄、职业和实际处境补足健康、情绪、居住与当前位置；无伤病不必制造受伤，无冲突不必强写紧张。weatherText/environmentText通过一条opening.initialState与经济初始化一起填写，不是protagonist字段。
示例：
<命令>
set protagonist.healthText = "身体健康，睡眠充足"
set protagonist.emotionText = "平静，期待新的一天"
set protagonist.skills = ["教学","基础急救"]
set locations[clinic] = {"name":"社区诊所","parentId":"chongqing"}
set protagonist.locationId = "clinic"
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。

沿源数组语义：push protagonist.skills追加一项，set protagonist.skills[index]修改现有项，delete protagonist.skills[index]移除现有项（多项倒序删除）。也可set protagonist局部白名单对象；不改ID/姓名/年龄或自造数值。
