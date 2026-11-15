# 正文失败后的行动恢复与跨标签安全返修

审查基线：PR #158，`f9cec9c852ae48d018234c97459bf817995ef7c7`。
main 对照：`9b0893811572a7f0af1b6790b45c60557499af08`。
日期：2026-11-16（北京时间；测试原始日志为 UTC）。

## 根因与边界

`rebindableAfterStoryStop()` 只能识别草稿的数据形态，不能证明模型请求已停止。取消后的草稿可能仍是 `pending`；标记 `failed` 的草稿也可能正由另一个标签页手动重试。仅修改状态判断不能解决并发。

原来的 `withBrowserLock()` 在没有 Web Locks 时直接调用工作函数；同页 `Map` 无法协调其他页面。IDB CAS 能拒绝迟到写入，却不能撤销已经发送的模型请求。上一轮真实 Chromium 验收中，缺锁时 HEAD 接受了并发重绑并通过正式 Coordinator 发出两个并发 Mock POST；main 拒绝重绑。原始证据保存在本报告的 evidence 目录。

另一个必要边界是手动 `StoryStage`：它原本只经过同页 `StageGuard`，没有取得 Coordinator 使用的跨标签锁。若只保护 `bindTurnAction()`，仍无法证明手动重试已取得执行所有权。

## 修复方案

采用 Web Locks 互斥与明确的保守降级，不新增 IDB 租约、存储字段或超时猜测。

- `SaveRepository.bindTurnAction()` 在事务前要求跨标签锁。无法取得锁时，不清除输入、不替换草稿、不修改正式状态。
- `TurnCoordinator.generate()` 在重新读取草稿、阶段写入和任何付费请求前要求同一把 `heijin.turn:<saveId>` 锁，并持有至本轮阶段执行结束。
- 手动 Story、Variables、World 经公共 `StageGuard` 取得同名锁。已 `failed` 的草稿正在手动重试时，其他页同样被挡在请求之前。
- Coordinator 将本次锁的临时作用域传给内部阶段，避免重新抢占自己已经持有的锁。作用域仅在锁回调执行期间有效，通过模块内 WeakMap 验证存档与有效性；伪造或过期作用域不生效。
- 浏览器缺少 Web Locks 或浏览器拒绝使用 API 时，返回固定安全错误 `concurrency_unavailable`，不降级为无锁执行。
- 输入区直接展示缺锁原因与恢复建议，并通过 `aria-describedby` 关联输入框，不要求玩家展开工作流才能知道为什么没有发送。
- `rebindableAfterStoryStop()` 保留取消后回填能力；注释明确其不是并发授权。没有把 `failed` 当作锁，也没有把持久化状态检查当作请求互斥。

这里的保守降级有明确产品代价：不支持 Web Locks 的浏览器不能启动这些游戏阶段请求，包括手动生成和自动流程；已经保存的世界和玩家输入仍保留。请在支持该 API 的浏览器重新读取存档后主动发送。不会自动换浏览器、发起重试或恢复收费请求。

非浏览器的领域/仓库测试继续使用既有执行方式；真实 React 浏览器路径必须取得锁。其他既有仓库操作的 CAS、撤回和导入协议未在本次扩展。

## 取消、刷新与迟到响应

显式取消仍使用现有 AbortSignal、attempt 身份核验及草稿 CAS。锁在该次本地执行退出后释放；页面刷新由浏览器释放页面持有的 Web Lock，无持久化租约需要清理。旧响应不因锁释放而重新取得旧草稿的写入权。

原有“取消后立即生成、旧响应不能覆盖”单测改为先等待本地取消承诺结束，再开始新的生成；旧 transport 此时仍未返回，仍在新结果保存后才释放，原有正式草稿相等断言没有删除。这明确验证取消结束后的恢复，避免在取消尚未完成的同一微任务窗口抢锁。

取消并不保证服务商不对已经发出的旧请求计费；本次没有增加自动重试，新的生成仍由玩家主动授权。已发出请求的服务端费用不能被浏览器撤销。

## 验证范围

所有模型网络均为本地 Mock，合成独立存档，未使用玩家数据。

单元/Repository：

- 无锁 pending/failed 重绑被拒绝，正式状态与草稿不变。
- 手动 Story 与 Coordinator 在写草稿和请求之前拒绝；Mock transport 调用为零。
- 被其他页面占用的锁、浏览器 SecurityError 均安全拒绝。
- 内部阶段复用有效锁且无嵌套冲突；伪造/过期作用域拒绝。
- 过期正式基线、旧草稿和迟到旧 Story 不能覆盖新绑定。
- 真正失败后修改行动、正常生成下一回合与原子结算。

真实 Chromium（项目 React 应用）：

- PC 与手机均验证正常请求期间其他页不能重绑。
- 请求已在执行时两页 API 均不可用，也不能重绑或增加第二个 POST。
- 两页从开始均无锁时，pending 与 failed 草稿都不会重绑或发送；编辑文字、正式世界与草稿保持不变，刷新不自动请求。
- 对 persisted failed 草稿启动真实手动 Story 重试，其他页面在有锁与缺锁两种条件均被拦截；取消、刷新后可主动重发并完成下一回合。
- 普通请求真实点击取消，刷新后原行动回填，不自动请求；修改后经过 Story → Variables → World → Commit，turnNumber/revision/journal 只增加一次。
- 原有 PC/手机失败输入恢复与主动清空不再回填断言继续执行。

## 工程结果与原始记录

Node **v24.19.0**，Chromium **154.0.8037.57**。PC 为 1440×1000；手机为项目 Pixel 7 的 412×839 视口。正式安装使用项目锁文件 `npm ci`，退出码 0。不同批次不相加冒充一次全绿。

| 批次 | 退出码 | 实际结果 |
| --- | --- | --- |
| 原 HEAD 新增安全红例 | 1 | 7 失败、0 通过 |
| 初次中间单元批次 | 1 | 115 通过、3 失败（5 文件） |
| 第二中间单元批次 | 1 | 120 通过、3 失败（6 文件） |
| 取消时序复测 | 1 | 122 通过、1 失败 |
| 修正后的单元批次 | 0 | 123 通过、0 失败、0 跳过 |
| 最终最小实现定向 Vitest | 0 | 6 文件、123 通过、0 失败、0 跳过 |
| 初次完整 `npm run check` | 0 | 157 文件、3872 通过、0 失败、0 跳过；Lint/类型/构建通过 |
| **最终稳定代码 `npm run check`** | **0** | **157 文件、3872 通过、0 失败、0 跳过；Lint、目录校验、TypeScript 与生产构建通过** |
| 最终 `npm run prompts:check` | 0 | 3 文件、93 通过、0 失败、0 跳过 |
| 最终修改文件 ESLint / `git diff --check` | 0 | 通过 |
| 初次桌面 Chromium | 1 | 3 通过、2 失败 |
| 中间双端 Chromium | 1 | 9 通过、3 失败 |
| **最终双端 Chromium（两个相关文件）** | **0** | **12 通过、0 失败、0 跳过** |
| 关闭诊断后输入与提示可见性补充 | 0 | PC/手机 pending/failed，共 4 通过、0 失败、0 跳过 |
| main 同环境原取消用例对照 | 0 | 1 通过、59 因 `-t` 筛选未执行，不是完整 main 单测验收 |

最终完整 Vitest 耗时 167.94s；构建仅有既有大 chunk 提醒，没有作为失败隐藏。没有运行全量浏览器套件。

中间单元失败分别暴露了 Coordinator 外层锁调用要求的遗漏、虚拟 browser 测试缺少 `orderPreferences` 造成的配置错误，以及取消未完成即抢锁的测试时序。修复调用/测试环境并等待本地取消完成后复测，旧 transport 迟到、CAS 与正式数据相等断言仍完整。

初次桌面缺锁提示只存在于隐藏工作流中；改选可见元素后仍失败，确认是实际可见性缺陷，因此增加输入区专用安全提示。中间双端另有手机用例查找桌面取消按钮，改用既有 `openStageSwitches` 与真实「取消自动执行」入口。没有删除断言、添加 skip、额外重试或放宽请求次数/存档相等断言。

原始日志及每批 `.exit` 完整打包在 [logs/raw-logs.zip](story-rebind-safety/logs/raw-logs.zip)，保留原始字节和中间失败。完整失败 trace 留在独立验收目录 `/workspace/pr158-safety-fix-20261116/`，未把大体积 trace 当作生产资源。

最终截图（真实 React、Mock、同一返修代码）：

| 内容 | PC | 手机 |
| --- | --- | --- |
| 缺锁拒绝，输入与明确提示可见 | [截图](story-rebind-safety/screenshots/no-lock-desktop.png) | [截图](story-rebind-safety/screenshots/no-lock-mobile.png) |
| 失败重发，完成下一回合 | [截图](story-rebind-safety/screenshots/next-turn-desktop.png) | [截图](story-rebind-safety/screenshots/next-turn-mobile.png) |

[evidence](story-rebind-safety/evidence/) 提供前后结构化对照：修复前是两个并发 Story POST、草稿被替换；修复后，对已经运行的请求保留唯一一个 POST，拒绝重绑；两页从开始都无锁时，pending/failed 均为零 POST，正式状态及草稿不变。

## 安全范围与剩余限制

没有修改 GameState、IndexedDB Schema、正式 Commit/Undo、AI 路由、Prompt、收费配置或自动重试。未修改 #159，未合并、部署或修改真实玩家存档。

本方案依赖浏览器提供真实 Web Locks；缺锁时有意拒绝操作，没有使用 localStorage 读写或广播消息伪装原子互斥。升级前已经打开的旧版本页面不受新代码控制，更新后应关闭或刷新旧游戏标签页。任何旧服务请求已产生的费用不因升级而消失。

Mock 证明的是请求边界、状态与事务回归，不证明真实模型输出质量或真实供应商取消计费行为。
