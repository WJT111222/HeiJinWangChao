变量组：官方机构 / update
普通回合可以创建首次遇到的重要组织，已有组织按稳定ID更新关系，不重建。机构遵守法定职权和管辖，不强迫填写黑帮式资金/地盘字段。
创建set organizations[id]使用原government类完整对象去掉id；四类不同字段保持独立。name/description/protagonistRelation及relationHistory、keyNpcIds、currentTaskIds是共通字段；NPC和任务引用须存在，未创建后台任务不虚构ID。
遵守共享“势力组织当前状态”：已有组织用set organizations[id].state局部更新jurisdictionText/lawfulPowers/cases/administrativeAffairs/enforcementCapacityText/publicTrustText/internalStatus及共通字段；不重新set整个已有实体。只有实际变化才更新；无变化不输出命令。管理层、稀疏关系、明确NPC关联与金额依据遵守共享协议。与主角关系仍用set organizations[id].protagonistRelation={relation,reason}，未接触可为闻所未闻。
示例：
<命令>
set organizations[org_local] = {"kind":"government","name":"地方官方机构","description":"本幕涉及的组织","protagonistRelation":"闻所未闻","relationHistory":[],"keyNpcIds":[],"currentTaskIds":[],"lawfulPowers":[],"cases":[],"administrativeAffairs":[]}
set organizations[org_local].protagonistRelation = {"relation":"业务联系","reason":"本幕完成初次沟通"}
set organizations[org_local].state = {"internalStatus":"部门已完成合法交接，案件继续按程序办理"}
</命令>

只用TEXT_COMMAND_CATALOG列明的set/add/push/delete路径；前三者值为JSON，delete不带值；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
