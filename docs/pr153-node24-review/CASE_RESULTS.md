# Chromium 执行及 main 对照

各次执行单列，重复执行不累计为独立覆盖；所有测试 retries=0。初次新增探针的 fixture 修正也保留。

| 执行组 | 文件 | 项目 | 用例 | 状态 |
| --- | --- | --- | --- | --- |
| pr-browser | continuous-turns.spec.ts | desktop | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | expected |
| pr-browser | continuous-turns.spec.ts | desktop | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | expected |
| pr-browser | continuous-turns.spec.ts | desktop | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | expected |
| pr-browser | continuous-turns.spec.ts | desktop | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | expected |
| pr-browser | continuous-turns.spec.ts | desktop | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | expected |
| pr-browser | continuous-turns.spec.ts | desktop | 正式资金与时间显示新版本，结算后刷新不重复扣款 | expected |
| pr-browser | continuous-turns.spec.ts | mobile | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | unexpected |
| pr-browser | continuous-turns.spec.ts | mobile | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | unexpected |
| pr-browser | continuous-turns.spec.ts | mobile | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | unexpected |
| pr-browser | continuous-turns.spec.ts | mobile | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | expected |
| pr-browser | continuous-turns.spec.ts | mobile | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | unexpected |
| pr-browser | continuous-turns.spec.ts | mobile | 正式资金与时间显示新版本，结算后刷新不重复扣款 | unexpected |
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
| pr-browser | history-timeline-v2.spec.ts | desktop | 正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读 | expected |
| pr-browser | history-timeline-v2.spec.ts | desktop | 单轴顺序、同日双视角、冬季、详情与史料；桌面双轨和手机原轴真实截图 | expected |
| pr-browser | history-timeline-v2.spec.ts | desktop | 后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求 | expected |
| pr-browser | history-timeline-v2.spec.ts | desktop | 长纪事完整详情、同刻大组有界分页与键盘访问 | expected |
| pr-browser | history-timeline-v2.spec.ts | mobile | 正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读 | unexpected |
| pr-browser | history-timeline-v2.spec.ts | mobile | 单轴顺序、同日双视角、冬季、详情与史料；桌面双轨和手机原轴真实截图 | unexpected |
| pr-browser | history-timeline-v2.spec.ts | mobile | 后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求 | expected |
| pr-browser | history-timeline-v2.spec.ts | mobile | 长纪事完整详情、同刻大组有界分页与键盘访问 | unexpected |
| pr-browser | npc-final-acceptance.spec.ts | desktop | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | expected |
| pr-browser | npc-final-acceptance.spec.ts | desktop | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | expected |
| pr-browser | npc-final-acceptance.spec.ts | mobile | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | unexpected |
| pr-browser | npc-final-acceptance.spec.ts | mobile | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | unexpected |
| pr-browser | world-npc-creation.spec.ts | desktop | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | expected |
| pr-browser | world-npc-creation.spec.ts | desktop | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | expected |
| pr-browser | world-npc-creation.spec.ts | mobile | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | unexpected |
| pr-browser | world-npc-creation.spec.ts | mobile | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | unexpected |
| pr-browser | world-runtime.spec.ts | desktop | 真实迎检准备文本：无效行动者安全失败，明确恢复后任务及合成事件入候选，正式状态不变 | expected |
| pr-browser | world-runtime.spec.ts | desktop | 世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变 | expected |
| pr-browser | world-runtime.spec.ts | desktop | 双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文 | expected |
| pr-browser | world-runtime.spec.ts | desktop | 错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行 | expected |
| pr-browser | world-runtime.spec.ts | desktop | 非法地点与事件预结案拒绝；NPC双任务和合法预计时间可重试保存 | expected |
| pr-browser | world-runtime.spec.ts | mobile | 真实迎检准备文本：无效行动者安全失败，明确恢复后任务及合成事件入候选，正式状态不变 | unexpected |
| pr-browser | world-runtime.spec.ts | mobile | 世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变 | unexpected |
| pr-browser | world-runtime.spec.ts | mobile | 双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文 | unexpected |
| pr-browser | world-runtime.spec.ts | mobile | 错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行 | unexpected |
| pr-browser | world-runtime.spec.ts | mobile | 非法地点与事件预结案拒绝；NPC双任务和合法预计时间可重试保存 | unexpected |
| main-browser | continuous-turns.spec.ts | mobile | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | unexpected |
| main-browser | continuous-turns.spec.ts | mobile | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | unexpected |
| main-browser | continuous-turns.spec.ts | mobile | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | unexpected |
| main-browser | continuous-turns.spec.ts | mobile | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | expected |
| main-browser | continuous-turns.spec.ts | mobile | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | unexpected |
| main-browser | continuous-turns.spec.ts | mobile | 正式资金与时间显示新版本，结算后刷新不重复扣款 | unexpected |
| main-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | expected |
| main-browser | event-stages-v2.spec.ts | mobile | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | unexpected |
| main-browser | event-stages-v2.spec.ts | mobile | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | expected |
| main-browser | event-stages-v2.spec.ts | mobile | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | expected |
| main-browser | history-timeline-v2.spec.ts | mobile | 正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读 | unexpected |
| main-browser | history-timeline-v2.spec.ts | mobile | 单轴顺序、同日双视角、冬季、详情与史料；桌面双轨和手机原轴真实截图 | unexpected |
| main-browser | history-timeline-v2.spec.ts | mobile | 后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求 | expected |
| main-browser | history-timeline-v2.spec.ts | mobile | 长纪事完整详情、同刻大组有界分页与键盘访问 | unexpected |
| main-browser | npc-final-acceptance.spec.ts | mobile | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | unexpected |
| main-browser | npc-final-acceptance.spec.ts | mobile | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | unexpected |
| main-browser | world-npc-creation.spec.ts | mobile | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | unexpected |
| main-browser | world-npc-creation.spec.ts | mobile | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | unexpected |
| main-browser | world-runtime.spec.ts | mobile | 真实迎检准备文本：无效行动者安全失败，明确恢复后任务及合成事件入候选，正式状态不变 | unexpected |
| main-browser | world-runtime.spec.ts | mobile | 世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变 | unexpected |
| main-browser | world-runtime.spec.ts | mobile | 双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文 | unexpected |
| main-browser | world-runtime.spec.ts | mobile | 错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行 | unexpected |
| main-browser | world-runtime.spec.ts | mobile | 非法地点与事件预结案拒绝；NPC双任务和合法预计时间可重试保存 | unexpected |
| pr-after | catalog-wire-ui.spec.ts | desktop | opening 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |
| pr-after | catalog-wire-ui.spec.ts | desktop | regular 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | unexpected |
| pr-after | continuous-turns.spec.ts | desktop | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | expected |
| pr-after | continuous-turns.spec.ts | desktop | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | expected |
| pr-after | continuous-turns.spec.ts | desktop | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | expected |
| pr-after | continuous-turns.spec.ts | desktop | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | expected |
| pr-after | continuous-turns.spec.ts | desktop | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | expected |
| pr-after | continuous-turns.spec.ts | desktop | 正式资金与时间显示新版本，结算后刷新不重复扣款 | expected |
| pr-after | event-stages-v2.spec.ts | desktop | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | expected |
| pr-after | event-stages-v2.spec.ts | desktop | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | expected |
| pr-after | event-stages-v2.spec.ts | desktop | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | expected |
| pr-after | event-stages-v2.spec.ts | desktop | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | expected |
| pr-after | history-timeline-v2.spec.ts | desktop | 正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读 | expected |
| pr-after | history-timeline-v2.spec.ts | desktop | 单轴顺序、同日双视角、冬季、详情与史料；桌面双轨和手机原轴真实截图 | expected |
| pr-after | history-timeline-v2.spec.ts | desktop | 后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求 | expected |
| pr-after | history-timeline-v2.spec.ts | desktop | 长纪事完整详情、同刻大组有界分页与键盘访问 | expected |
| pr-after | npc-final-acceptance.spec.ts | desktop | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | expected |
| pr-after | npc-final-acceptance.spec.ts | desktop | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | expected |
| pr-after | world-npc-creation.spec.ts | desktop | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | expected |
| pr-after | world-npc-creation.spec.ts | desktop | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | expected |
| pr-after | world-runtime.spec.ts | desktop | 真实迎检准备文本：无效行动者安全失败，明确恢复后任务及合成事件入候选，正式状态不变 | expected |
| pr-after | world-runtime.spec.ts | desktop | 世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变 | expected |
| pr-after | world-runtime.spec.ts | desktop | 双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文 | expected |
| pr-after | world-runtime.spec.ts | desktop | 错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行 | expected |
| pr-after | world-runtime.spec.ts | desktop | 非法地点与事件预结案拒绝；NPC双任务和合法预计时间可重试保存 | expected |
| pr-wire-ui-initial | catalog-wire-ui.spec.ts | desktop | opening 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |
| pr-wire-ui-initial | catalog-wire-ui.spec.ts | desktop | regular 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | unexpected |
| pr-wire-ui-initial | world-npc-creation.spec.ts | desktop | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | expected |
| pr-wire-ui-initial | world-npc-creation.spec.ts | desktop | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | expected |
| pr-wire-ui | catalog-wire-ui.spec.ts | desktop | opening 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |
| pr-wire-ui | catalog-wire-ui.spec.ts | desktop | regular 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |
| pr-wire-ui | catalog-wire-ui.spec.ts | mobile | opening 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |
| pr-wire-ui | catalog-wire-ui.spec.ts | mobile | regular 三阶段真实请求：World压缩目录在React检查器完整可读，其他阶段隔离且不写存档 | expected |

## 原有 18 项失败逐项对照

| 文件 | 用例 | PR 错误位置 | main 错误位置 |
| --- | --- | --- | --- |
| continuous-turns.spec.ts | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | 193:67 | 193:67 |
| continuous-turns.spec.ts | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | 251:51 | 251:51 |
| continuous-turns.spec.ts | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | 300:63 | 300:63 |
| continuous-turns.spec.ts | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | 352:78 | 352:78 |
| continuous-turns.spec.ts | 正式资金与时间显示新版本，结算后刷新不重复扣款 | 178:77 | 178:77 |
| event-stages-v2.spec.ts | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | 32:51 | 32:51 |
| history-timeline-v2.spec.ts | 正式scope显示四类世界事件与主角标签，双端仍共用时间槽位且只读 | 54:37 | 54:37 |
| history-timeline-v2.spec.ts | 单轴顺序、同日双视角、冬季、详情与史料；桌面双轨和手机原轴真实截图 | 74:67 | 74:67 |
| history-timeline-v2.spec.ts | 长纪事完整详情、同刻大组有界分页与键盘访问 | 129:161 | 129:161 |
| npc-final-acceptance.spec.ts | 千人轻量名录与300回合：多视口实际布局、分页、关系跳转、焦点与长文滚动，只读零请求 | 35:120 | 35:120 |
| npc-final-acceptance.spec.ts | 真实React连续四轮：首次建档、改名升级、离场结案、重逢记忆、七字段休眠恢复，严格12次Mock | 35:120 | 35:120 |
| world-npc-creation.spec.ts | 真实三阶段创建普通/特殊男性/成年女性，组织任务主子引用、七字段、重载与原人物原样 | 35:120 | 35:120 |
| world-npc-creation.spec.ts | 非法确认仍整批拒绝、保留Story、不自动请求；玩家明确继续才单独重试World并结算 | 35:120 | 35:120 |
| world-runtime.spec.ts | 真实迎检准备文本：无效行动者安全失败，明确恢复后任务及合成事件入候选，正式状态不变 | 88:72 | 88:72 |
| world-runtime.spec.ts | 世界生成、补算、只读查看与刷新恢复，真实路由和快照；正式世界不变 | 88:72 | 88:72 |
| world-runtime.spec.ts | 双开关关闭后只补算世界，无变量时明确预览；不 Roll 正文 | 88:72 | 88:72 |
| world-runtime.spec.ts | 错误输出可重试；取消后新请求不受旧回包影响；世界生成中其他阶段禁止执行 | 88:72 | 88:72 |
| world-runtime.spec.ts | 非法地点与事件预结案拒绝；NPC双任务和合法预计时间可重试保存 | 88:72 | 88:72 |

## 最终子集复测

- pr-mobile-after / mobile / 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿：expected
- pr-mobile-after / mobile / 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求：expected
- pr-mobile-after / mobile / 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用：expected
- pr-mobile-after / mobile / 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应：expected
- pr-mobile-after / mobile / 三阶段真实出站提醒可在正式React检查器读取，原生请求体与独立上下文完整且不写存档：expected
- pr-mobile-after / mobile / 后补历史统一插入、分页搜索和完整撤回重载，无额外AI请求：expected
- pr-tail-after / desktop / 三阶段真实出站提醒可在正式React检查器读取，原生请求体与独立上下文完整且不写存档：expected
