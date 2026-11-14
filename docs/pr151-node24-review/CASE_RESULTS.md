# 指定四文件：初轮76项逐项对照

初轮结果原样保留，timedOut同样是失败，不算通过。手机300 NPC成对复核另见报告，不替换该初轮行。

| 文件/项目 | 用例 | main | PR | 分类 |
| --- | --- | --- | --- | --- |
| action-workflow.spec.ts · desktop | variables失败保留上游，仅明确恢复缺少阶段，折叠无额外请求 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | world失败保留上游，仅明确恢复缺少阶段，折叠无额外请求 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 一次创角确认自动执行开局三阶段，StrictMode和重复点击不重复请求 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 下一条行动绑定冲突显示发送失败，不误报等待行动且不请求模型 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 关闭变量时世界只能预览，不因自动开局而强行启用或允许发送 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 关闭阶段时variables：不显示无效继续，引导启用后只补必要候选并正常发送 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 关闭阶段时world：不显示无效继续，引导启用后只补必要候选并正常发送 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 单行状态跟随三个实际请求，展开收起不重发且自动结算后等待行动 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 发送行动只结算一次并自动串联下一轮，刷新及再次读档不补发 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 取消中的迟到响应不启动下游，刷新保留待生成草稿且明确恢复 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 开局network不隐式重试，刷新不重发，草稿和正式状态安全 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 开局timeout不隐式重试，刷新不重发，草稿和正式状态安全 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 开局组件加载前刷新销毁授权，未生成草稿保留且仅主动开始才请求 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 快速离开并重读同一存档或新标签不能延续开局收费授权 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 最新阶段失败覆盖旧变量错误，状态栏准确指出World失败 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 正文摘要不合法时不保存、不运行下游、不结算 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 缺少AI配置零请求，设置后不自动补发，只在明确开始时运行 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 自动开局HTTP 401停止、不无限重试，刷新不重新授权 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 自动开局HTTP 403停止、不无限重试，刷新不重新授权 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · desktop | 自动开局HTTP 429停止、不无限重试，刷新不重新授权 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · mobile | variables失败保留上游，仅明确恢复缺少阶段，折叠无额外请求 | timedOut | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | world失败保留上游，仅明确恢复缺少阶段，折叠无额外请求 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 一次创角确认自动执行开局三阶段，StrictMode和重复点击不重复请求 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 下一条行动绑定冲突显示发送失败，不误报等待行动且不请求模型 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 关闭变量时世界只能预览，不因自动开局而强行启用或允许发送 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · mobile | 关闭阶段时variables：不显示无效继续，引导启用后只补必要候选并正常发送 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 关闭阶段时world：不显示无效继续，引导启用后只补必要候选并正常发送 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 单行状态跟随三个实际请求，展开收起不重发且自动结算后等待行动 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 发送行动只结算一次并自动串联下一轮，刷新及再次读档不补发 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · mobile | 取消中的迟到响应不启动下游，刷新保留待生成草稿且明确恢复 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 开局network不隐式重试，刷新不重发，草稿和正式状态安全 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 开局timeout不隐式重试，刷新不重发，草稿和正式状态安全 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 开局组件加载前刷新销毁授权，未生成草稿保留且仅主动开始才请求 | passed | passed | 两侧通过 |
| action-workflow.spec.ts · mobile | 快速离开并重读同一存档或新标签不能延续开局收费授权 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 最新阶段失败覆盖旧变量错误，状态栏准确指出World失败 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 正文摘要不合法时不保存、不运行下游、不结算 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 缺少AI配置零请求，设置后不自动补发，只在明确开始时运行 | timedOut | timedOut | 两侧失败 |
| action-workflow.spec.ts · mobile | 自动开局HTTP 401停止、不无限重试，刷新不重新授权 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 自动开局HTTP 403停止、不无限重试，刷新不重新授权 | failed | failed | 两侧失败 |
| action-workflow.spec.ts · mobile | 自动开局HTTP 429停止、不无限重试，刷新不重新授权 | failed | failed | 两侧失败 |
| continuous-turns.spec.ts · desktop | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · desktop | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · desktop | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · desktop | 正式资金与时间显示新版本，结算后刷新不重复扣款 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · desktop | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · desktop | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · mobile | 下一轮生成失败不回滚上轮结算；刷新后只恢复尚未完成的新回合 | failed | failed | 两侧失败 |
| continuous-turns.spec.ts · mobile | 快速双击与另一标签发送最多结算一次；成功后数据库保留唯一下一草稿 | passed | passed | 两侧通过 |
| continuous-turns.spec.ts · mobile | 提交事务中途失败 UI 不虚报成功；重试后只结算一次 | timedOut | timedOut | 两侧失败 |
| continuous-turns.spec.ts · mobile | 正式资金与时间显示新版本，结算后刷新不重复扣款 | timedOut | timedOut | 两侧失败 |
| continuous-turns.spec.ts · mobile | 真实创角后连续正式游玩十回合；输入、资料、正文历史与刷新一致 | failed | failed | 两侧失败 |
| continuous-turns.spec.ts · mobile | 阶段未完成或主动关闭时，即使填写行动也不能部分结算 | timedOut | timedOut | 两侧失败 |
| event-stages-v2.spec.ts · desktop | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · desktop | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · desktop | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · desktop | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · mobile | 固定阶段积压结算保留原时刻并退役，失败仅重试World后刷新不重复请求 | failed | failed | 两侧失败 |
| event-stages-v2.spec.ts · mobile | 固定阶段积压结算保留原时刻并退役，直接自动提交后刷新不重复请求 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · mobile | 真实新阶段入场→下一轮Story回执→Variables提前结案，World不覆盖，不增加阶段调用 | passed | passed | 两侧通过 |
| event-stages-v2.spec.ts · mobile | 阶段成功自然结束且不需后继时，未呈现邀请可原子失效，不强造取消结果或玩家回应 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · desktop | 1000 NPC 真实快照按需 Worker 分析、动画帧继续、结果与原算法一致且复用缓存 | failed | passed | 仅main失败 |
| prompt-inspector.spec.ts · desktop | 300 NPC 真实快照按需 Worker 分析、动画帧继续、结果与原算法一致且复用缓存 | failed | failed | 两侧失败 |
| prompt-inspector.spec.ts · desktop | 四开关取消旧组装：列表与原文修改立即失效，迟到成功不覆盖新任务，重新组装才有效 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · desktop | 四开关显式保存：双页联动、未保存刷新丢弃、保存刷新持久化与再次编辑提示 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · desktop | 已发送阶段快照保留原请求数据与真实 usage，默认隐藏秘密且始终去密钥，刷新不持久化 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · desktop | 无存档浏览真实模块、过滤与全文，缺少阶段请求时不伪造使用量 | timedOut | passed | 仅main失败 |
| prompt-inspector.spec.ts · desktop | 无正文草稿的阶段预览诚实失败，七项写作偏好不因管理中心改变 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · desktop | 真实存档六种模式预览、内部内容主动揭示、合法排序保存恢复及状态隔离 | timedOut | passed | 仅main失败 |
| prompt-inspector.spec.ts · mobile | 1000 NPC 真实快照按需 Worker 分析、动画帧继续、结果与原算法一致且复用缓存 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · mobile | 300 NPC 真实快照按需 Worker 分析、动画帧继续、结果与原算法一致且复用缓存 | passed | failed | 仅PR失败：帧计数，见成对复核 |
| prompt-inspector.spec.ts · mobile | 四开关取消旧组装：列表与原文修改立即失效，迟到成功不覆盖新任务，重新组装才有效 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · mobile | 四开关显式保存：双页联动、未保存刷新丢弃、保存刷新持久化与再次编辑提示 | timedOut | timedOut | 两侧失败 |
| prompt-inspector.spec.ts · mobile | 已发送阶段快照保留原请求数据与真实 usage，默认隐藏秘密且始终去密钥，刷新不持久化 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · mobile | 无存档浏览真实模块、过滤与全文，缺少阶段请求时不伪造使用量 | passed | passed | 两侧通过 |
| prompt-inspector.spec.ts · mobile | 无正文草稿的阶段预览诚实失败，七项写作偏好不因管理中心改变 | timedOut | timedOut | 两侧失败 |
| prompt-inspector.spec.ts · mobile | 真实存档六种模式预览、内部内容主动揭示、合法排序保存恢复及状态隔离 | timedOut | timedOut | 两侧失败 |
