变量组：黑帮势力 / init
开局只建立本幕确有需要的组织。黑帮有自己的产业、活动范围和组织现实，不预设固定帮派名单或合并为同一种模式。
创建set organizations[id]使用原gang类完整对象去掉id；四类不同字段保持独立。name/description/protagonistRelation及relationHistory、keyNpcIds、currentTaskIds是共通字段；NPC和任务引用须存在，未创建后台任务不虚构ID。
已有组织只支持set organizations[id].protagonistRelation={relation,reason}，关系为开放文字，不是固定分值。经营、资金、资产、任务等未支持的现场修改写说明，World后续处理，不自由覆盖组织对象。
示例：
<命令>
set organizations[org_local] = {"kind":"gang","name":"地方黑帮势力","description":"本幕涉及的组织","protagonistRelation":"初次接触","relationHistory":[],"keyNpcIds":[],"currentTaskIds":[],"industries":[]}
set organizations[org_local].protagonistRelation = {"relation":"业务联系","reason":"本幕完成初次沟通"}
</命令>

只用TEXT_COMMAND_CATALOG支持的set/add/push路径，值为JSON；不输出DomainCommand对象。未支持的变化写<说明>，不创造自由字段、来源审批或覆盖许可。AI理解已选定Story，程序执行原领域约束；本阶段不推演World任务/事件。
