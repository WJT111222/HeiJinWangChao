变量组：官方机构 / init
开局只建立本幕确有需要的组织。机构遵守法定职权和管辖，不强迫填写黑帮式资金/地盘字段。
创建set organizations[id]使用原government类完整对象去掉id；四类不同字段保持独立。name/description/protagonistRelation及relationHistory、keyNpcIds、currentTaskIds是共通字段；NPC和任务引用须存在，未创建后台任务不虚构ID。
已有组织只支持set organizations[id].protagonistRelation={relation,reason}，关系为开放文字，不是固定分值。经营、资金、资产、任务等未支持的现场修改写说明，World后续处理，不自由覆盖组织对象。
示例：
<命令>
set organizations[org_local] = {"kind":"government","name":"地方官方机构","description":"本幕涉及的组织","protagonistRelation":"初次接触","relationHistory":[],"keyNpcIds":[],"currentTaskIds":[],"lawfulPowers":[],"cases":[],"administrativeAffairs":[]}
set organizations[org_local].protagonistRelation = {"relation":"业务联系","reason":"本幕完成初次沟通"}
</命令>

只用TEXT_COMMAND_CATALOG支持的set/add/push路径，值为JSON；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
