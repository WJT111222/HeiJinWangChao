# 信任边界、状态与恢复

包、脚本、正则替换、显示 HTML、导入文件以及模型响应都可能携带不可信内容。最敏感的资产是渠道凭证、剧情/记忆、一次付费授权和正式回合的写入权。上游 predefine 会取得父窗口对象；王朝凭证与 wire 构造则在原生客户端。由这项差异推导以下设计，用 B 的负例实测后才能承诺隔离。[H·predefine.js L1](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/src/iframe/predefine.js#L1) [G·credentials.ts L1](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/credentials.ts#L1) [G·protocols.ts L27](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/protocols.ts#L27)

### 隔离与终止

1. 导入只解析和保留原始包，不挂载、求值、预加载 URL 或执行正则替换。展示将读取的投影、外部依赖、写作用域、协议和实际可用分支。按内容版本、依赖摘要、权限和使用场景授权。更新包或扩权重新批准；enabled 只说明作者意图。
2. B 比较可终止 Worker/解释器的数据面与无凭证专用隔离 UI。Worker 的同步读写发生在私域镜像；专用父页面即使提供同源 DOM，也只能看到该脚本有权读取的资料。DOM 与同步 parent 强耦合的原脚本若无法同时满足隔离和硬终止，标“需适配/阻断”。浏览器进程分配不可作为强制隔离保证。不要将不可信脚本与审批/主菜单置于同域权限下。
3. 消息桥绑定受控引导、准确来源窗口、可核实的 origin、专用 MessagePort、实例/授权/会话代次和单调序列；opaque origin 的 null 不能单独作为认证。宿主对每次操作重新检查能力和 Schema、大小与深度，拒绝重放、跨实例写及过期回调。禁用、切档、撤权先失效代次和消费权，再取消传输、断开 port、清订阅与工具、销毁执行单元。
4. 外发控制覆盖 fetch、XHR、WebSocket、EventSource、Beacon、图片/字体/样式、表单、链接/重定向、导航、弹窗、Worker 和 import。配置隔离 origin、sandbox 权限及限制资源的策略，配合外层实际断网/网关；普通 iframe、Proxy 或仅覆盖 fetch 无法证明网络封闭。未能约束自导航等通道时不得给它私密数据。资源只从审核后的本地清单装载。主页面以文本/受控组件展示，不采用样本的可执行 HTML 替换。
5. 调度者独立于执行脚本的事件循环；超预算销毁可终止执行单元，正则同样要求硬终止。若可用浏览器架构无法终止卡住的 DOM 脚本并保持主应用响应，即为阻断。预算内出现超时也不能由脚本决定续期。启动失败进入隔离停用，下一次启动先进入原生页面，由用户显式重启；不依赖崩溃脚本执行 pagehide。

### 请求、结束与格式

- 一次尝试冻结实际模型路由、预算、用户动作、权限、草稿版本、预设/脚本版本、宏及已授权的世界/聊天投影。先展开批准的模块、宏与发送正则，再协调王朝 Envelope 约束和选定交付载体，只生成一个无矛盾的尾部要求。按预设 auto/指定/禁止及实际协议能力做冲突检查。必要字段不全、要求冲突或最后脚本改写破坏约定，阻断正式生成。不得为了兼容改写原生关闭路径。[G·formatTail.ts L17](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/prompts/formatTail.ts#L17) [G·runtime.ts L62](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/runtime.ts#L62)
- 私域运行 READY 和获准的 fetch 包装；桥接的基础 fetch 消费宿主授予的单次能力。宿主在最终发送处校验目的地址、协议、允许字段、参数预算与重定向策略（首期禁重定向），丢弃脚本自带凭证/敏感头，才附加宿主凭证。测量实际 Mock transport 次数，拒绝二次消费、二次工具回传或自动补格式。私域不能取得真实 Response headers、接口 URL 或 CredentialVault。
- 宿主独占真实 reader，分送有界、可背压的授权投影；分别保存真实边界/失败和 usage 来源、脚本转换结果、通过校验的候选、仅用于阅读的结果。原始私密内容沿用临时/主动查看原则。未知 usage 保持未知；脚本生成 usage 不计作供应商记录。禁用、失败或取消释放缓冲；不能从观察记录重建付费授权。[G·sse.ts L2](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/sse.ts#L2) [G·stageResponses.ts L9](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/stageResponses.ts#L9)
- 模型返回纯文本时，仅在协商允许纯文本且严格 Envelope 完整时才进入原验证；工具必需但未遵循时失败。合法工具须由宿主核对真实工具身份、参数与终止证据，再按声明映射字段。明确拒答/过滤、半段参数、读异常、取消、客户端主动停读分别记录；正常 EOF 的含义依协议判断。模型或脚本都无权把合成 stop/DONE 提升为真实结束。即使上游正常结束，仍须对照工具字段与映射后的正文，防止脚本添写/替换事实。无法验证的任意响应重写仅用于实验台展示；绝不按最长文本保存。
- 由原 Story 解析与业务校验检查正文、短期记忆、变量规划、配置所需行动选项及时间等规则，成功后仍走 StoryStage/CAS、后续已启用阶段和原子 Commit。失败/合法截断的处理权归原工作流，不能自动补写字段或追加收费请求。Variables、World、Memory 均走原生链。[G·runtime.ts L156](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/runtime.ts#L156) [G·storyStage.ts L193](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/workflows/storyStage.ts#L193) [G·saveRepository.ts L713](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/storage/saveRepository.ts#L713)

### 状态所有权与失败语义

| 状态 | 所有者与生效点 | 失败、并发和历史 |
| --- | --- | --- |
| 原包、版本、授权、启用与 UI 配置 | 包管理器；原始导出与修改后语义导出分开。授权不能随备份或导入自动获得 | 重导同内容不隐式扩权；新版本需重新授权。撤权立即失效，删除包终止实例。普通回合 Undo 不撤销用户授权操作 |
| 玩家显式保存的脚本偏好 | 独立包/脚本命名空间，私域同步读镜像，保存带设置版本和确认回执 | 与生成结果无关，可保留。跨标签冲突拒绝覆盖，落盘失败标未保存；在飞请求用旧版本。备份默认不含；导入偏好另行确认 |
| 单次请求临时状态 | 冻结投影与私域 overlay，按实例、存档会话、请求代次隔离 | 校验失败、取消、切档、卸载均作废；超时/迟到/重复回调不能写回；刷新清空，不把原文放进设置或日志 |
| 会影响以后回合的聊天变量 | B 仅临时模拟。以后须与特定存档实例、基线与正式提交回执绑定；读取不到匹配版本则停止脚本 | 失败/取消丢弃暂存；正式提交前不得推进。Undo、收藏回溯须恢复与目标节点严格匹配的状态，缺失即禁用该有状态能力；不能继承被覆盖时间线的数据 |

独立附属数据库不能与主档跨库原子提交。将来如需支持剧情变量，须另行批准同事务或带持久意向与回执、可重放的恢复设计，并模拟主库成功/附库失败、相反顺序、双标签及进程退出。恢复完成前不能对外呈现“已同步”。复制/导入建立新实例、撤销旧代次；普通备份明确附属状态覆盖范围；删除存档按实例清理关联，旧客户端/缺附属状态回到原生。首期不暴露这项持久能力。#192 独占世界书触发、预算、绑定及提交语义；兼容层未来只消费其返回的只读投影与版本，D2 未定先用自写夹具。

一键关闭位于可信主界面：废止权限与当前尝试，恢复原生入口，保留原包、已有草稿和历史，由用户决定是否重新生成。关闭不触发生成或结算。
