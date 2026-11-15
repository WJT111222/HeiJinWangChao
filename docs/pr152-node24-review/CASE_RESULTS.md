# Chromium 逐项结果

所有用例 retries=0；expected=通过，unexpected=失败。初次新增测试的定位修正记录单列，不计为额外独立覆盖。

| 执行组 | 文件 | 项目 | 用例 | 结果 |
| --- | --- | --- | --- | --- |
| pr-browser | event-stages-v2.spec.ts | desktop | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | expected |
| pr-browser | event-stages-v2.spec.ts | desktop | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | expected |
| pr-browser | event-stages-v2.spec.ts | desktop | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | expected |
| pr-browser | event-stages-v2.spec.ts | desktop | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | expected |
| pr-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | expected |
| pr-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | unexpected |
| pr-browser | event-stages-v2.spec.ts | mobile | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | expected |
| pr-browser | event-stages-v2.spec.ts | mobile | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | expected |
| pr-browser | format-tail-wire.spec.ts | desktop | 三阶段真实出站提醒可在正式React检查器读取，原生请求体与独立上下文完整且不写存档 | expected |
| pr-browser | format-tail-wire.spec.ts | mobile | 三阶段真实出站提醒可在正式React检查器读取，原生请求体与独立上下文完整且不写存档 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 统一名录搜索筛选、详情、联系与单向关系、来源无技术ID；双端真实截图 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 初始同伴取消及恢复金星，七字段完整、普通记忆不丢、刷新及回填输入保留，零请求 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 首次加星只保存待完善；保存中重复点击无效，正式CAS只递增一次 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 跨标签过期星标准确失败并同步正式状态，完整候选不丢，无自动重试 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 真实Story请求中本页与其他标签管理均拒绝，不取消请求；随后正常三阶段结算 | expected |
| pr-browser | npc-directory.spec.ts | desktop | IndexedDB中途写入失败原子回滚，星标不假成功，候选完整保留 | expected |
| pr-browser | npc-directory.spec.ts | desktop | 名录只读空状态，以及正式人物消失后的安全返回 | expected |
| pr-browser | npc-directory.spec.ts | mobile | 统一名录搜索筛选、详情、联系与单向关系、来源无技术ID；双端真实截图 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | 初始同伴取消及恢复金星，七字段完整、普通记忆不丢、刷新及回填输入保留，零请求 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | 首次加星只保存待完善；保存中重复点击无效，正式CAS只递增一次 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | 跨标签过期星标准确失败并同步正式状态，完整候选不丢，无自动重试 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | 真实Story请求中本页与其他标签管理均拒绝，不取消请求；随后正常三阶段结算 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | IndexedDB中途写入失败原子回滚，星标不假成功，候选完整保留 | unexpected |
| pr-browser | npc-directory.spec.ts | mobile | 名录只读空状态，以及正式人物消失后的安全返回 | unexpected |
| pr-browser | npc-final-acceptance.spec.ts | desktop | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | expected |
| pr-browser | npc-final-acceptance.spec.ts | desktop | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | expected |
| pr-browser | npc-final-acceptance.spec.ts | mobile | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | unexpected |
| pr-browser | npc-final-acceptance.spec.ts | mobile | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | unexpected |
| pr-browser | npc-unified-memory.spec.ts | desktop | V10实际浏览器身份往返：记忆和总结可读，香闺七字段完整，零模型请求 | expected |
| pr-browser | npc-unified-memory.spec.ts | desktop | 关闭Chromium进程后重开：统一原文、旧总结来源与休眠七字段保持持久化 | expected |
| pr-browser | npc-unified-memory.spec.ts | mobile | V10实际浏览器身份往返：记忆和总结可读，香闺七字段完整，零模型请求 | expected |
| pr-browser | npc-unified-memory.spec.ts | mobile | 关闭Chromium进程后重开：统一原文、旧总结来源与休眠七字段保持持久化 | expected |
| pr-browser | npc-v2-foundation.spec.ts | desktop | NPC新字段与休眠档案真实持久化、刷新及原子撤回；零模型请求 | expected |
| pr-browser | npc-v2-foundation.spec.ts | desktop | V6旧档不可读且原样保留；V10档上旧RetireNpc拒绝，刷新不删档案 | expected |
| pr-browser | npc-v2-foundation.spec.ts | desktop | 完整关闭浏览器再打开，持久人物与休眠专属档案仍一致 | expected |
| pr-browser | npc-v2-foundation.spec.ts | mobile | NPC新字段与休眠档案真实持久化、刷新及原子撤回；零模型请求 | expected |
| pr-browser | npc-v2-foundation.spec.ts | mobile | V6旧档不可读且原样保留；V10档上旧RetireNpc拒绝，刷新不删档案 | expected |
| pr-browser | npc-v2-foundation.spec.ts | mobile | 完整关闭浏览器再打开，持久人物与休眠专属档案仍一致 | expected |
| pr-browser | save-backup-upgrade.spec.ts | desktop | 真实双标签：V3 连接关闭，旧删除与重开拒绝；同 ID 同 revision 导入及草稿保留，新版刷新后正常操作 | expected |
| pr-browser | save-backup-upgrade.spec.ts | desktop | 真实双标签：不释放的旧连接阻止升级与导入，原记录不变，关闭后重试成功 | expected |
| pr-browser | save-backup-upgrade.spec.ts | mobile | 真实双标签：V3 连接关闭，旧删除与重开拒绝；同 ID 同 revision 导入及草稿保留，新版刷新后正常操作 | expected |
| pr-browser | save-backup-upgrade.spec.ts | mobile | 真实双标签：不释放的旧连接阻止升级与导入，原记录不变，关闭后重试成功 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 连续五次撤回、刷新恢复、回填覆盖和无Redo，全程零模型请求 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 撤回后编辑发送才开始三阶段，失败可恢复且只保存新分支 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 取消撤回不修改任何数据；部分草稿需明确确认，旧候选退出 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 跨标签页旧确认不能多退一层；刷新后重新核对剩余恢复点 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 开局不撤回，生成期间按钮禁用；取消后可以撤回且没有额外请求 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 后台总结在撤回时取消，刷新后不自动收费或复活旧总结 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 快照写满时正式回合可保存，明确提示不可撤回，刷新不重复扣款 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 另一个标签仍在生成时撤回明确拒绝，取消后重新读取才可撤回 | expected |
| pr-browser | turn-undo.spec.ts | desktop | 无 Web Locks 时双标签同时撤回仍由 IndexedDB CAS 保证仅一次成功 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 连续五次撤回、刷新恢复、回填覆盖和无Redo，全程零模型请求 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 撤回后编辑发送才开始三阶段，失败可恢复且只保存新分支 | unexpected |
| pr-browser | turn-undo.spec.ts | mobile | 取消撤回不修改任何数据；部分草稿需明确确认，旧候选退出 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 跨标签页旧确认不能多退一层；刷新后重新核对剩余恢复点 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 开局不撤回，生成期间按钮禁用；取消后可以撤回且没有额外请求 | unexpected |
| pr-browser | turn-undo.spec.ts | mobile | 后台总结在撤回时取消，刷新后不自动收费或复活旧总结 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 快照写满时正式回合可保存，明确提示不可撤回，刷新不重复扣款 | expected |
| pr-browser | turn-undo.spec.ts | mobile | 另一个标签仍在生成时撤回明确拒绝，取消后重新读取才可撤回 | unexpected |
| pr-browser | turn-undo.spec.ts | mobile | 无 Web Locks 时双标签同时撤回仍由 IndexedDB CAS 保证仅一次成功 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 混合存档列表独立展示，坏记录不触发全局错误，正常存档都能进入且刷新保持 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 下载 JSON 完整保留坏记录、草稿和回执，读取下载不改库 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 二次确认取消不删数据，确认后只删选中的三类记录，刷新不再出现 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 只有坏记录时不显示空档状态、不能继续游戏，正常删除流程仍可用 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 存储整体不可用明确报错，关闭提示不会重复弹回或伪装成没有存档 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 列表请求失败明确提示，手动刷新恢复而不是把数据库错误当作坏记录 | expected |
| pr-browser | unreadable-saves.spec.ts | desktop | 导出和删除失败分别可定位且保留全部记录；重试删除成功后清除错误 | expected |
| pr-browser | unreadable-saves.spec.ts | mobile | 混合存档列表独立展示，坏记录不触发全局错误，正常存档都能进入且刷新保持 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 下载 JSON 完整保留坏记录、草稿和回执，读取下载不改库 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 二次确认取消不删数据，确认后只删选中的三类记录，刷新不再出现 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 只有坏记录时不显示空档状态、不能继续游戏，正常删除流程仍可用 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 存储整体不可用明确报错，关闭提示不会重复弹回或伪装成没有存档 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 列表请求失败明确提示，手动刷新恢复而不是把数据库错误当作坏记录 | unexpected |
| pr-browser | unreadable-saves.spec.ts | mobile | 导出和删除失败分别可定位且保留全部记录；重试删除成功后清除错误 | unexpected |
| pr-browser | world-handoff.spec.ts | desktop | 真实浏览器：世界成果/交接只是候选，正式原子提交后生效且完整人物永久保留 | expected |
| pr-browser | world-handoff.spec.ts | desktop | 第三轮审查event-report：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | expected |
| pr-browser | world-handoff.spec.ts | desktop | 第三轮审查refused-confirmation：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | expected |
| pr-browser | world-handoff.spec.ts | desktop | 第二轮审查mixed-result：越权候选拒绝，正式状态不变，可安全重试 | expected |
| pr-browser | world-handoff.spec.ts | desktop | 第二轮审查unindexed-history：越权候选拒绝，正式状态不变，可安全重试 | expected |
| pr-browser | world-handoff.spec.ts | desktop | 旧联系人登记保留但不冒充已知电话，刷新后档案仍保留 | expected |
| pr-browser | world-handoff.spec.ts | desktop | V10 之前的旧档不可读也不迁移，原始数据原样保留 | expected |
| pr-browser | world-handoff.spec.ts | mobile | 真实浏览器：世界成果/交接只是候选，正式原子提交后生效且完整人物永久保留 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | 第三轮审查event-report：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | 第三轮审查refused-confirmation：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | 第二轮审查mixed-result：越权候选拒绝，正式状态不变，可安全重试 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | 第二轮审查unindexed-history：越权候选拒绝，正式状态不变，可安全重试 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | 旧联系人登记保留但不冒充已知电话，刷新后档案仍保留 | unexpected |
| pr-browser | world-handoff.spec.ts | mobile | V10 之前的旧档不可读也不迁移，原始数据原样保留 | unexpected |
| v10-browser | v10-save-reset.spec.ts | desktop | V6旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | desktop | V7旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | desktop | V8旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | desktop | V9旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | mobile | V6旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | mobile | V7旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | mobile | V8旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| v10-browser | v10-save-reset.spec.ts | mobile | V9旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | expected |
| main-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | expected |
| main-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | unexpected |
| main-browser | event-stages-v2.spec.ts | mobile | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | expected |
| main-browser | event-stages-v2.spec.ts | mobile | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | expected |
| main-browser | npc-directory.spec.ts | mobile | 统一名录搜索筛选、详情、联系与单向关系、来源无技术ID；双端真实截图 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | 初始同伴取消及恢复金星，七字段完整、普通记忆不丢、刷新及回填输入保留，零请求 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | 首次加星只保存待完善；保存中重复点击无效，正式CAS只递增一次 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | 跨标签过期星标准确失败并同步正式状态，完整候选不丢，无自动重试 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | 真实Story请求中本页与其他标签管理均拒绝，不取消请求；随后正常三阶段结算 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | IndexedDB中途写入失败原子回滚，星标不假成功，候选完整保留 | unexpected |
| main-browser | npc-directory.spec.ts | mobile | 名录只读空状态，以及正式人物消失后的安全返回 | unexpected |
| main-more | npc-final-acceptance.spec.ts | mobile | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | unexpected |
| main-more | npc-final-acceptance.spec.ts | mobile | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | unexpected |
| main-more | turn-undo.spec.ts | mobile | 连续五次撤回、刷新恢复、回填覆盖和无Redo，全程零模型请求 | expected |
| main-more | turn-undo.spec.ts | mobile | 撤回后编辑发送才开始三阶段，失败可恢复且只保存新分支 | unexpected |
| main-more | turn-undo.spec.ts | mobile | 取消撤回不修改任何数据；部分草稿需明确确认，旧候选退出 | expected |
| main-more | turn-undo.spec.ts | mobile | 跨标签页旧确认不能多退一层；刷新后重新核对剩余恢复点 | expected |
| main-more | turn-undo.spec.ts | mobile | 开局不撤回，生成期间按钮禁用；取消后可以撤回且没有额外请求 | unexpected |
| main-more | turn-undo.spec.ts | mobile | 后台总结在撤回时取消，刷新后不自动收费或复活旧总结 | expected |
| main-more | turn-undo.spec.ts | mobile | 快照写满时正式回合可保存，明确提示不可撤回，刷新不重复扣款 | expected |
| main-more | turn-undo.spec.ts | mobile | 另一个标签仍在生成时撤回明确拒绝，取消后重新读取才可撤回 | unexpected |
| main-more | turn-undo.spec.ts | mobile | 无 Web Locks 时双标签同时撤回仍由 IndexedDB CAS 保证仅一次成功 | expected |
| main-more | unreadable-saves.spec.ts | mobile | 混合存档列表独立展示，坏记录不触发全局错误，正常存档都能进入且刷新保持 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 下载 JSON 完整保留坏记录、草稿和回执，读取下载不改库 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 二次确认取消不删数据，确认后只删选中的三类记录，刷新不再出现 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 只有坏记录时不显示空档状态、不能继续游戏，正常删除流程仍可用 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 存储整体不可用明确报错，关闭提示不会重复弹回或伪装成没有存档 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 列表请求失败明确提示，手动刷新恢复而不是把数据库错误当作坏记录 | unexpected |
| main-more | unreadable-saves.spec.ts | mobile | 导出和删除失败分别可定位且保留全部记录；重试删除成功后清除错误 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 真实浏览器：世界成果/交接只是候选，正式原子提交后生效且完整人物永久保留 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 第三轮审查event-report：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 第三轮审查refused-confirmation：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 第二轮审查mixed-result：越权候选拒绝，正式状态不变，可安全重试 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 第二轮审查unindexed-history：越权候选拒绝，正式状态不变，可安全重试 | unexpected |
| main-more | world-handoff.spec.ts | mobile | 旧联系人登记保留但不冒充已知电话，刷新后档案仍保留 | unexpected |
| main-more | world-handoff.spec.ts | mobile | V6待复核NPC显示待确认身份，不冒充联系人且不自动删除 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | desktop | V6旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | desktop | V7旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | desktop | V8旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | desktop | V9旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | mobile | V6旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | mobile | V7旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | mobile | V8旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |
| v10-browser-initial | v10-save-reset.spec.ts | mobile | V9旧档重置：列表拒绝、下载原文保留、旧备份不能覆盖V10，五仓库不变 | unexpected |

## 27 个失败的 main 对照

26 个用例名称完全一致；world-handoff 的一个用例因 V10 重置政策改名，两端均在相同公共读档前置步骤被旧手机定位阻塞，尚未到达各自政策断言。

| 文件 | PR 用例 | PR / main 状态 | 同条件证据 |
| --- | --- | --- | --- |
| event-stages-v2.spec.ts | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | failed / failed | 同名、同入口失败 |
| npc-directory.spec.ts | 统一名录搜索筛选、详情、联系与单向关系、来源无技术ID；双端真实截图 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | 初始同伴取消及恢复金星，七字段完整、普通记忆不丢、刷新及回填输入保留，零请求 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | 首次加星只保存待完善；保存中重复点击无效，正式CAS只递增一次 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | 跨标签过期星标准确失败并同步正式状态，完整候选不丢，无自动重试 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | 真实Story请求中本页与其他标签管理均拒绝，不取消请求；随后正常三阶段结算 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | IndexedDB中途写入失败原子回滚，星标不假成功，候选完整保留 | timedOut / timedOut | 同名、同入口失败 |
| npc-directory.spec.ts | 名录只读空状态，以及正式人物消失后的安全返回 | timedOut / timedOut | 同名、同入口失败 |
| npc-final-acceptance.spec.ts | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | timedOut / timedOut | 同名、同入口失败 |
| npc-final-acceptance.spec.ts | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | timedOut / timedOut | 同名、同入口失败 |
| turn-undo.spec.ts | 撤回后编辑发送才开始三阶段，失败可恢复且只保存新分支 | timedOut / timedOut | 同名、同入口失败 |
| turn-undo.spec.ts | 开局不撤回，生成期间按钮禁用；取消后可以撤回且没有额外请求 | failed / failed | 同名、同入口失败 |
| turn-undo.spec.ts | 另一个标签仍在生成时撤回明确拒绝，取消后重新读取才可撤回 | timedOut / timedOut | 同名、同入口失败 |
| unreadable-saves.spec.ts | 混合存档列表独立展示，坏记录不触发全局错误，正常存档都能进入且刷新保持 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 下载 JSON 完整保留坏记录、草稿和回执，读取下载不改库 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 二次确认取消不删数据，确认后只删选中的三类记录，刷新不再出现 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 只有坏记录时不显示空档状态、不能继续游戏，正常删除流程仍可用 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 存储整体不可用明确报错，关闭提示不会重复弹回或伪装成没有存档 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 列表请求失败明确提示，手动刷新恢复而不是把数据库错误当作坏记录 | failed / failed | 同名、同入口失败 |
| unreadable-saves.spec.ts | 导出和删除失败分别可定位且保留全部记录；重试删除成功后清除错误 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 真实浏览器：世界成果/交接只是候选，正式原子提交后生效且完整人物永久保留 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 第三轮审查event-report：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 第三轮审查refused-confirmation：拒绝无效人物引用或否定授权，合法重试及正式提交保持隔离 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 第二轮审查mixed-result：越权候选拒绝，正式状态不变，可安全重试 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 第二轮审查unindexed-history：越权候选拒绝，正式状态不变，可安全重试 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | 旧联系人登记保留但不冒充已知电话，刷新后档案仍保留 | failed / failed | 同名、同入口失败 |
| world-handoff.spec.ts | V10 之前的旧档不可读也不迁移，原始数据原样保留 | failed / failed | 相同前置入口；政策标题不同 |
