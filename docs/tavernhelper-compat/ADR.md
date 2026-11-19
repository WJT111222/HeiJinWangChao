# ADR · 兼容宿主的选择

> 路线已更新。阶段 A 调研留档。第一批按负责人审核的可信脚本路线实施，旧隔离原型和 A–E 审批流程已停止执行。[现行 Issue #199](https://github.com/WJT111222/HeiJinWangChao/issues/199) · [第一批实现与验证](BATCH1.md)

决策状态为待负责人批准。基于样本的两条关键路径：主脚本需要在真实序列化之前按引用改写一次生成对象；控制台需要同步读写原生预设行、保留对象身份，然后分别触发保存和刷新。它们均无法通过只导入 JSON 或提供异步 RPC 同名函数满足。[固定源码与私有定位](AUDIT.md)

| 取舍 | 一：独立兼容宿主 | 二：局部移植助手 | 三：嵌入助手和必要酒馆 |
| --- | --- | --- | --- |
| 原脚本与 UI | 在隔离 realm 内真实执行已授权脚本；提供本地同步配置和有限 UI。必须访问真实主页面、无限制模块或外联的脚本需适配 | 可留用树转换或订阅等经过许可的纯模块；父域注入、宿主模块导入、DOM 和资源仍须替代 | 保留最多原生对象、顺序和 DOM；仍不能承诺非标扩展或全部版本。授权/网络限制仍可能要求改脚本 |
| 工程依赖 | 自写包读取、事件/工具表、请求代理、UI 投影、生命周期；配置/预设投影与动态差分工作量高 | 逐模块剥离 Pinia/Vue、全局注入、酒馆 utils/事件、jQuery、后端端点；需双向跟踪语义变更 | 另维护前端、扩展装载、设置与预设服务、聊天补全后端、用户数据隔离、迁移与恢复；正式王朝仍有独立结算 |
| 请求与状态 | 在私域提供唯一被实际调用的可包装 fetch；同次授权只对应一份宿主传输；读写镜像有版本与回执 | 需证明移植代码的 fetch/对象引用命中真实出站，不能悄悄转到宿主或旧全局 | 酒馆的预设保存及聊天后端与王朝直发不同；需隔离部署，适配两套数据/错误来源及写入所有权 |
| 凭证、失控与退出 | 窄消息桥最易审计。必须证明可从独立执行单元终止脚本；DOM 保真与硬终止可能冲突 | 相同信任边界外加被搬模块的传递依赖与启动路径审计。旧 iframe 本身不能当隔离 | 独立地址、身份、存储、出网代理及可终止进程；同源装载会暴露主应用。完整宿主的崩溃恢复运维成本最高 |
| 上游升级与许可 | 锁行为和差分夹具，独立撰写。每次升级重审事件、选择器、对象及许可 | 冻结文件、依赖、修改记录与再分发许可，每次上游变化重跑差分；许可未确认前不能引入 | 助手和酒馆双版本、服务端与附带资源同时维护。网络服务、修改和分发责任需单独许可评审 |

**推荐一，备选二。** 先验证昂贵的不确定部分（同 realm 对象身份、可终止隔离、一次出站和可读写控制台）。若独立实现无法复现某个非敏感纯模块，而许可与传递依赖允许，按文件切换到二，不拿 bundle 兜底。只有实验证明必须依赖完整酒馆页面/后端、负责人接受独立宿主成本且许可通过时，才重新评估三。任何路线需要真实主窗口、任意出网、假结束或第二次模型请求才能工作，就停止相应兼容声明。评估依据是具体调用与数据所有权，不按代码行数估算工期。

### 许可与依赖

- 助手 LICENSE 是 PolyForm Noncommercial 1.0.0。引入源文件或产物前审查用途、许可文本、通知与转授权条件。免费提供游戏不足以证明满足全部使用/分发条件。宿主别名在构建时作为外部文件解析。[H·LICENSE L1](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/LICENSE#L1) [H·vite.config.ts L67](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/vite.config.ts#L67)
- 酒馆 package 声明 AGPL-3.0，LICENSE 含网络交互相关条款。若选择修改并通过网络向用户提供酒馆或分发组合产物，须逐项确认源代码提供与通知义务及两许可的组合条件；本报告没有取得移植授权。[S·package.json L113](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/package.json#L113) [S·LICENSE L1](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/LICENSE#L1)
- 助手依赖声明/锁来源为 package.json、pnpm-lock.yaml；例如 klona、Pinia/Vue 相关包，另有父域 Lodash/jQuery；Vue/Vue Router 与日志脚本还通过 HTML/URL 加载。酒馆 npm 依赖另有自己的锁。首期不捆绑或联网补这些库。任何复用要有锁定版本、实际文件、许可证/通知与资源来源清单。[H·package.json L62](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/package.json#L62) [H·pnpm-lock.yaml L1](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/pnpm-lock.yaml#L1) [H·third_party_script.html L1](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/src/iframe/third_party_script.html#L1) [H·iframe.ts L5](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/src/panel/script/iframe.ts#L5) [S·package-lock.json L1](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/package-lock.json#L1)
- 王朝已有 THIRD_PARTY_NOTICES 仅覆盖其中列出的来源，不授权上述软件或私有样本。样本仅获私下静态审计；脚本运行、字体/图像、第三方扩展以及再分发需分别许可。[G·THIRD_PARTY_NOTICES.md L1](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/THIRD_PARTY_NOTICES.md#L1)
