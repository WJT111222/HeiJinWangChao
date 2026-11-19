# TavernHelper 兼容运行时 · 阶段 A

**结论（2026-11-19）：建议独立实现一个隔离的兼容宿主，让授权的原脚本在其中执行。** 首个原型只验证一条 OpenAI 兼容的 Story 路径。最难保留的行为是同步对象引用、作用于实际请求的 fetch 包装、控制台对父页面的操作，以及异常脚本的强制终止。以上均未取得动态兼容证据。

| 阅读入口 | 解决的问题 |
| --- | --- |
| [源码、私有样本与依赖图](AUDIT.md) | 上游怎样装配、触发、发送、读取和保存；实际包依赖哪些分支 |
| [接口契约矩阵](CONTRACTS.md) | 签名、引用、顺序、权限差异与可证伪的验证条件 |
| [架构决策](ADR.md) | 三条路线的取舍、备选、许可和退出条件 |
| [隔离、状态与恢复](SAFETY.md) | 权限归属、流真实性、失败回滚、异常后回到原生 |
| [原型计划与审批门禁](PLAN.md) | 首期范围、资源预算、测试和后续改动依赖 |

### 参照与证据

| 对象 | 固定版本与来源 | 对本次审计的意义 |
| --- | --- | --- |
| 王朝 main | [G·runtime.ts L35](https://github.com/WJT111222/HeiJinWangChao/blob/0bdffc9d39b231b9b69a83181d979525e104fca9/src/services/ai/runtime.ts#L35) | 独立分支从此树建立。基线中没有受 Git 跟踪的 AGENTS.md，依据 [工程说明](../../DEVELOPMENT.md)、[架构](../CURRENT_ARCHITECTURE.md) 和 Issue 正文。读取时 #199 为 Open、0 条评论。 |
| #191 | [关闭、未合并，归档开发分支](https://github.com/WJT111222/HeiJinWangChao/pull/191)，`d7759c6c3ec69d9671fb097bedb0276b6e220a17` | 仅将 responseEvents、toolResponseEvents、storyToolAssembler、storyToolTrace 及异常夹具列为将来独立审查的候选。固定单一工具策略不能支配脚本自己的选择。 |
| #192 | [feature/worldbook-2，Open/Draft](https://github.com/WJT111222/HeiJinWangChao/pull/192)，`a03f4b243fce9400822662c0ca29e99a5aa3d685` | A/B 已有实现，B 的 Worker 加固待审。C1 本地书库未接存档流程，C2 仅有 commitTurn 接口准备，C3 尚在设计。D2 Story 注入未开始。 |
| 助手 | 官方 N0VI028/JS-Slash-Runner，4.12.1，[H·manifest.json L1](https://github.com/N0VI028/JS-Slash-Runner/blob/c13105d6e2abd2871a4b77f0e7251869dd840a3f/manifest.json#L1) | 最低客户端 1.13.0。类型、源文件和构建配置一起审。 |
| 宿主 | 官方 SillyTavern/SillyTavern，1.19.0，[S·package.json L113](https://github.com/SillyTavern/SillyTavern/blob/7e8663cd9c184a550b37238218bdd32c6efc68e9/package.json#L113) | 与 #192 共用版本。两仓默认 HEAD 分别已为 `f9c95abbd74c728db0cfbca53f8ba217279e6f0b`、`06bde939fb1e9c4c8d8641d810f0a916b5bce127`，本报告固定旧版本，未对新提交作兼容判断。 |
| 1118 私有参考包 | 负责人本轮提供的原 JSON，按 UTF-8 读取 | JSON 结构计数和两个脚本内的静态行号可私下复核。未执行、未加载资源；公共仓库只保存分析。 |

完整固定 SHA：王朝 `0bdffc9d39b231b9b69a83181d979525e104fca9`；助手 `c13105d6e2abd2871a4b77f0e7251869dd840a3f`；酒馆 `7e8663cd9c184a550b37238218bdd32c6efc68e9`。助手、酒馆通过指定提交检出 detached HEAD。索引中的固定源码链接均指这些版本。

[总 Issue 及分批门禁](https://github.com/WJT111222/HeiJinWangChao/issues/199)。#140 的原生默认行为继续有效。此文档提交只交阶段 A；B 的执行、样本运行及产品分发分别授权。

开工时 main 为 `089723c2e1e0aa608afe9820a87b1f6a36ef385b`（#195）。交付前 #198 合入，独立分支已移到 `0bdffc9d39b231b9b69a83181d979525e104fca9`，重新检查了事件上下文、Story 业务校验及特殊恢复保存路径。当前 main 的变化未引入助手运行时。[#198](https://github.com/WJT111222/HeiJinWangChao/pull/198)
