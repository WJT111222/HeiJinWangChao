变量组：protagonist / update
普通更新：只记录本回合现场变化，首次出现的重要NPC仍可新建，不重建已有档案。

现场主角只更新已有档案，不创建第二个主角。支持set protagonist.healthText、emotionText、locationId、profession、professionDescription、professionLongTermImpact、publicStatus、legalStatus为字符串，skills为字符串数组（整体替换合法技能列表，保留既有能力，不因普通行为自动升级）。不添加力量/智力/经验值。
地点先set locations[id]={name,parentId?}，再set protagonist.locationId。父级必须存在且无环，主角移动需分别处理同行和留守NPC。穿戴用set protagonist.currentWear完整Equipment，仅引用真实归主角的物品/载具。
示例：
<命令>
set protagonist.healthText = "手掌轻微擦伤"
set protagonist.emotionText = "紧张但镇定"
set protagonist.skills = ["教学","基础急救"]
set locations[clinic] = {"name":"社区诊所","parentId":"chongqing"}
set protagonist.locationId = "clinic"
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。

沿源数组语义：push protagonist.skills追加一项，set protagonist.skills[index]修改现有项，delete protagonist.skills[index]移除现有项（多项倒序删除）。也可set protagonist局部白名单对象；不改ID/姓名/年龄或自造数值。

职业档案使用正式 protagonist 的 profession（名称）、professionDescription（介绍）、professionLongTermImpact（经历的长期影响）与 skills。职业是背景而非数值加成或行为限制；不能凭名称自动赋予财富、资产、资质或权限。变更职业时优先用一条 set protagonist = {"profession":"新职业","professionDescription":"新介绍","professionLongTermImpact":"新的经历影响"} 同步维护。只改名称会清除旧职业说明；skills 保持原值，已学能力不因转职自动删除。随后也可分别 set protagonist.professionDescription / protagonist.professionLongTermImpact。
