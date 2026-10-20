# M4-P4 三阶段自动协调与失败恢复

## 基线与范围

从最新 `main@c12e529`（已合并 PR #13）创建 `codex/m4-p4-turn-coordinator`。保留三套已审查的执行器、三协议 AI Client、真实 Composer、提示词注册与排序约束、领域命令、正式 Schema 和存档接口。

本阶段只把合法当前草稿的 Story → Variables → World 顺序运行到候选保存。不会正式提交 GameState，不创建下一回合，不部署生产环境。原有手动正文、变量/世界补算和取消入口继续可用。

## 架构审查与最小调整

- 原 StageGuard 的同页锁按 saveId 共享，外层再次持同一执行锁会让内部阶段报 busy。因此新增的是**会话所有权**，内部仍逐个获取原阶段执行锁。会话只允许自身创建的 StageGuard 进入；普通手动阶段、第二个协调器以及阶段交接空隙中的请求都会被拒绝。
- 支持 Web Locks 的浏览器用 `heijin.turn:<saveId>` 的 `ifAvailable` 锁排斥其他标签的自动工作流，不等待排队。无 Web Locks 时退回同页会话与既有 IndexedDB CAS；跨标签手动请求也仍受 CAS 保护。Web Locks 不是存档事务替代品。
- 三个执行器只增加可注入的 StageGuard 和可选 `orderPreferences`；其生成、解析、权限、版本与候选保存主体保持不变。
- 协调器的仓库类型只有 `load/loadDraft/saveDraft`，没有正式 `save`。不复制领域命令执行、客户端或模型路由。
- `GameState`、`TurnDraft`、设置 Schema、命令和提示词正文没有改动，无需迁移。

## 自动执行与恢复

1. 同步占有存档会话；冻结设置、模型路由、排序、同伴资料。所有渠道凭证复制到独立内存 CredentialVault，不写入配置、存档或调试输出。运行中修改 UI 设置、路由或凭证只影响下一次执行。
2. 在浏览器工作流锁内重读 GameState/TurnDraft，逐字段 Schema 校验并比较整份草稿指纹、正式 revision、回合类型、已提交 journal。输入过期、存档被删除或已经提交时拒绝。
3. 对复用的变量和世界候选再次调用原解析/模拟验证；不只信任 `validated` 标记。
4. 决定待执行阶段；正文合法完成时跳过正文；正文与变量合法完成时仅执行世界；全部满足时不调用 API，也不要求已完成阶段重新配置密钥。
5. 首次付费前预检查所有待执行阶段的路由/凭证。关闭阶段不检查、不付费。预检查不发送网络请求，不能保证供应商账户额度、服务可用性或凭证远端授权必然成功。
6. 严格顺序 await 原 StoryStage、VariableStage、WorldStage。每阶段及重试前再读版本；使用前一阶段实际返回/保存的最新草稿，不自行推算 revision。世界通过原 Composer 读取最新合法变量投影。
7. 正文错误另外保存安全失败码、次数与 failed 状态，变量/世界继续使用原执行器的失败记录。失败的依赖链停止，已经保存的上游成果保留；刷新后重新加载草稿，再点“继续自动执行”即从失败/待执行处恢复。
8. 所有完成结果仍是 TurnDraft 候选；`TurnOutcome.status=complete` 只表示本次完整三阶段候选完成，**不是已结算、不是提交权限凭据**。

## 模式、开关与排序

| 模式 | 正文 | 变量 | 世界 |
| --- | --- | --- | --- |
| opening | stages.opening.story | stages.opening.variables | stages.opening.world |
| regular | stages.regular.story | stages.regular.variables | stages.regular.world |

模式始终取已持久化草稿，不由 UI 猜测；不创建 regular 草稿，不给 regular 添加灾难开局规则。没有改初始同伴、场内保护、九域选择、七项写作设置、世界书或 NSFW 原文。

排序偏好在启动时复制，经过原 Composer/排序规则应用；不会让执行到一半时修改排序影响下游请求。请求检查快照、模块记录、Token 估算与供应商 usage 继续来自原 Runtime/Client。

- 两阶段都关：只生成/保留正文，显示跳过，不能宣称完整三阶段完成。
- 只开变量：正文 → 变量，世界跳过，不正式结算。
- 只开世界：可以复用已经合法验证的变量；若无合法变量则世界只保存 preview，明确待同步，不宣称完整成功。
- 变量开启但失败：停止世界，不用缺失变量的 preview 冒充恢复成功。
- 显式重新 Roll 仍调用原 StoryStage/rerollStory，使旧变量/世界候选失效；自动继续不会默认 Roll 已选定正文。
- 没有篡改旧执行尝试的开关。原执行器在实际补算时用 startStageAttempt 记录新配置；仅关闭且不请求的阶段通过本次 outcome/UI 标注跳过，保留历史合法候选。

## 重试、取消与并发

每阶段首次加最多一次自动重试（1/2、2/2）。仅对明确的 HTTP 500/502/503/504 服务错误自动重试；网络/CORS/TLS、超时、429（可能额度问题）、鉴权、配置、解析、权限、状态与版本冲突等停止，供手动恢复。不信任持久化 `retryable` 字段作为自动付费依据。界面在启动前提示重试可能增加费用。

取消调用当前原执行器的 cancel 并标记整个会话取消；每个 await 后和下游启动前核验会话身份，迟到响应不能复活流程。完整保存的上游可以保留。进入原执行器不可中断保存阶段，取消返回 false；界面禁用取消，不声称已取消。安全正文失败元数据保存也使用 CAS 与原子事务；页面卸载通过 dispose 中止请求/事务并使会话身份失效。失败、取消和版本冲突均不调用正式 save。

同页会话锁、浏览器工作流锁和仓库乐观锁分工不同：没有嵌套执行锁，没有网络等待 IndexedDB 事务，没有删除原 CAS/请求版本校验。阶段候选保存继续由原执行器维护 draftRevision/storyRevision/candidateRevision/requestRevision/executionRevision/stageRequestRevisions。

## 界面

保留三栏、正文流式阅读及七个资料面板。在输入框上方原工作流面板增加“自动生成开局/本回合”“继续自动执行”和完整取消；显示当前阶段、次数、失败、安全失败记录、跳过/preview 和“候选完成，等待 M4-P5”。已有候选查看只读、完整内部世界内容仍须主动打开；不会把 visibleHooks 放入普通正文或日志。发送和继续推演仍禁用。

## 文件清单

新增：

- `src/workflows/turnCoordinator.ts`：会话、预检查、配置冻结、串联、恢复、有限重试、整体取消。
- `src/ui/game/useTurnGeneration.ts`：UI 生命周期、流式更新节流、状态/错误及候选通知。
- `src/tests/turn-coordinator.test.ts`：真实 Runtime/Composer + Mock 网络 + fake IndexedDB 集成回归。
- `e2e/turn-coordinator.spec.ts`：桌面/移动真实浏览器交互及网络拦截。
- `M4-P4-DEVELOPMENT.md`：本报告。

修改：

- `src/workflows/stageGuard.ts`：会话所有权校验及作用域 guard。
- `src/workflows/storyStage.ts`、`variableStage.ts`、`worldStage.ts`：guard 注入与冻结排序传递。
- `src/ui/game/GameScreen.tsx`：自动入口、恢复/取消、进度及安全错误；保留手动入口。
- `src/app/App.tsx`：开发版本标记 M4-P4。
- `e2e/game.spec.ts`：新旧按钮同时存在后，把原模糊查询改为精确查询，并额外验证自动入口。
- `DEVELOPMENT.md`、`src/workflows/README.md`：当前阶段与入口说明。

## 验证

全部测试使用 Mock/浏览器网络拦截，未使用真实付费 API Key，没有真实付费模型调用。

- `npm run prompts:check`：82 项通过。
- `npm run check`：17 个测试文件、582 项通过（原有 545 + 新增 37）；ESLint 零警告、TypeScript 和 Vite 生产构建通过。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：完整 82 项通过，桌面/移动各 41 项（保留原有 58 + 新增 24）。使用仓库既有 Chromium 配置。
- `git diff --check`：通过。

开发中修正了旧创角用例的模糊按钮查询，并把新增并发/取消用例的固定等待改成显式请求闩锁；最终完整 E2E 零失败。没有删除原有用例或绕过安全校验。

新增集成用例覆盖 opening/regular、六主提示词、不重复请求上游、最新世界投影、三阶段分别失败/取消与迟到、保存阶段拒绝取消、有限服务重试及非瞬时错误、下游配置/凭证预检查、三种独立开关组合、变量关闭时复用、跨标签正式/草稿/重 Roll 冲突、重试前冲突、阶段交接互斥与冻结配置。

浏览器新增 12 个场景，分别在桌面和移动运行；保留此前全部 58 项。包括一键完整流程、请求快照、正式整对象不变、错误恢复与刷新、正文失败持久化、瞬时重试、取消和双击、开关切换、世界 preview 补算、离开页面、Web Locks 跨标签互斥、长内容和无横向溢出。

## 文档冲突、限制与 M4-P5

- 原 V0.1 文档约定首次 + 两次重试、变量失败可继续世界 preview。本轮明确授权覆盖为**最多一次自动重试、变量失败停止下游**；未修改正式设计文档。
- DEVELOPMENT 中早期把任务接力/退场等安排到 M4-P4；本轮明确只做协调，不扩展任务生命周期、NPC 删除或调度。M4-P3 已有权限/任务/事件校验继续复用。
- 无 Web Locks 的浏览器无法在发出网络前保证跨标签自动工作流互斥，仍由既有 CAS 拒绝过期候选，可能已有请求费用；支持该 API 的桌面/移动 Chromium 已测试。
- 客户端瞬时错误判定是有限的安全分类，不声称可以识别所有供应商故障。预检查只验证本地配置，不能预知额度和服务状态。非阻断性供应商兼容问题未扩展。
- 本阶段不提交正式 GameState，所以尚不能连续正式游玩；不把草稿完成描述为已进入下一回合。
- M4-P5 应从仓库重新读取正式状态及当前候选，检查正文/候选/请求/执行版本和开关策略，重新运行 parseVariables/parseWorld、权限与同一正式基线的整批 commitCommands 模拟，再用正式原子事务同时提交正文历史及全部副作用。不能仅信任本次 complete/validated 标记。
- 下一回合创建、提交幂等、失败回滚与历史关联由 M4-P5 负责；现有 SaveRepository.save 还没有完整回合正文/历史和下一草稿的一体事务，本轮没有提前补上。M5 记忆压缩、V0.2 功能均未实现。
