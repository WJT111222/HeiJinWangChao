# 生成停止后的行动建议与恢复提示

基线：`main@e0e2b446136b9589bf60094d9975a807ab06fbdf`。Node 24.19.0；Chromium 154.0.8037.57。独立工作树/分支施工，没有进入或合并 #165。

## 先调查，后修改

[只读根因记录](ROOT_CAUSE_BEFORE_FIX.txt) 在修改生产代码前完成。真实 React App、真实 SaveRepository/IndexedDB、合成存档，只有模型传输使用 Mock。不读取玩家存档、不调用付费 API。

确认两个问题：

1. `GameScreen.tsx` 原来的建议回退依赖 `awaitingAction`。行动已经绑定、Story 又未成功保存时，该条件为 false。Journal 的旧建议没有丢失，但界面只显示“行动建议将在正文生成后显示”。
2. Story 已成功、Variables/World 未完成时，发送被正确禁用；常驻按钮可以从缺少的阶段继续。发送区缺乏原因和可执行操作，容易让玩家误以为完全无法继续。

**没有复现永久 busy 或不可释放的运行锁。** 401/429/500、断流、静默超时、校验失败及主动取消后，合法重绑定和既有继续入口都能工作。不能把本次展示修复说成已经修好了一个未证实的底层死锁。

## 最小修改

- `actionSuggestions.ts` 只投影当前合法草稿的有效建议，否则读取最后已结算 Journal 的有效建议，不寻找更早历史、不补默认选项、不写库。
- PC/手机均标明“当前正文建议（本回合尚未结算）”或“上一已结算回合建议 · 第N回合”。生成中的临时隐藏保留，停止后恢复可查看的建议。
- 旧建议在原有绑定/结算条件不允许选择时只供参考；按钮和数字快捷键遵循同一规则。允许选择时只回填输入，绝不自动发送。
- 输入区附近说明生成、保存、待补变量/世界、候选已完成、草稿失效及缺少 Web Locks 等状态，引用原有常驻操作名称；不另造恢复回调。
- `send()`、发送禁用条件、常驻按钮回调、Repository、Coordinator、StageGuard、CAS、Undo、Schema、Prompt 全部不改。
- 安全失败码和详细原因继续使用 #164 的摘要/临时日志，不创建新日志持久化机制。

恢复时必须区分：

| 状态 | 合法操作 | 模型调用 |
| --- | --- | --- |
| 正文未产生合法候选 | 允许时修改回填行动后发送，或主动用常驻按钮生成原绑定行动 | 仅玩家主动操作后发起 |
| 正文已有，变量失败/待生成 | 主动继续变量，再世界，再结算 | 不重发 Story |
| 变量已有，世界失败/待生成 | 主动继续世界，再结算 | 不重发 Story/Variables |
| 全部候选已有，正式保存失败 | 主动完成本回合结算 | 重试结算本身零模型请求 |
| 请求仍运行或正在保存 | 等待/按既有规则取消；保存中不能取消 | 不偷偷解锁或并发重发 |
| 缺少 Web Locks/草稿冲突 | 保留输入、明确说明并重新读档/更换支持浏览器 | 互斥不可用时零模型 POST |

未发送的编辑只在本页暂存；刷新恢复已绑定行动，不承诺保存未发送编辑。

## 修复前 UI 与 Repository 对照

| 合成场景 | Repository 实际状态 | 原 UI | Mock 调用数（恢复前） |
| --- | --- | --- | --- |
| 401/429/校验失败/断流/超时 | 原正式世界未改，旧建议3条，Story为空，安全失败已记 | 无旧建议；发送本来可恢复 | 1 |
| HTTP500 | 同上；安全失败2次 | 同上 | 2（已有重试） |
| 主动取消 | 原正式世界未改、Story为空，不记模型失败 | 无旧建议 | 1 |
| Variables失败 | Story及新建议已存，正式世界未改 | 发送禁用，缺少就近解释 | 2 |
| World失败 | Story/Variables已存，正式世界未改 | 同上 | 3 |
| 正式保存失败 | 三候选全在，事务回滚，正式世界未改 | 常驻结算入口本来可用 | 3 |

用户明确确认：保留已有 HTTP500 最多两次尝试策略。本 PR 不改变该策略，也不新增任何恢复自动请求。

## 测试与证据

最终成绩及各批次失败记录见下方验收记录；原始日志、合成 UI/Repository 快照和截图在 [evidence](evidence)。不把不同批次加总成一次全绿。

### 可复现命令

```sh
node --version
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/action-suggestions.test.ts src/tests/story-generation-policy.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/action-recovery.spec.ts
# 既有行为回归按报告中 grep 定向执行，不运行全量浏览器测试。
git diff --check
```

新增 Chromium 用例验证 SSE 部分正文断网、无数据超时、请求超时、取消、不完整正文、校验失败、401/429/500、缺少结束标记、变量/世界继续、真实 IndexedDB 写入失败和单次结算、双标签、缺少锁、迟到响应、两次失败、刷新/设置/切档、只读旧建议、快捷键和响应式输入区。

Mock 包装真实 `AiClient` 的 `window.fetch` 边界，计数的是模型 POST 的传输调用；SSE 使用真实 ReadableStream。除 Mock 目标外的 React/Vite/API 请求正常运行。Commit 用例实际让 `saves.put` 持续抛出 QuotaExceededError，包含原有去除撤回点后的第二次事务尝试，两次均须原子失败，恢复写入后再由玩家主动重试。

### 已知限制

- 不能据合成 Mock 证明真实网络、所有供应商或社区全部“卡住”情形均已复现。真实请求仍活动时不应伪装停止。
- 没有修改超时、重试、锁或阶段恢复业务；正式终态未变前仍不能开始下一回合。
- 不承诺浏览器崩溃时保留未发送的输入编辑。
- Chromium 手机视口是模拟，不是 iPhone/Android 实机验收。
- #165 日间外观未合并也未在此任务验收；没有改任何 CSS。

## 原始失败记录与修正

| 独立批次 | 通过 / 失败 / 中断 / 未运行 | 结果及处理 |
| --- | --- | --- |
| 修复前28项调查 | 27 / 1 / 0 / 0 | 桌面生命周期脚本过早观察到请求前的continue，读取pending草稿；改为等待真实failed，不改生产代码 |
| 修复前生命周期复核 | 2 / 0 / 0 / 0 | PC/手机都通过，原始文本日志与退出码保留 |
| 修复前补充C与RED | 2 / 4 / 0 / 0 | C通过；4个预期失败分别证明旧建议与阶段说明缺失 |
| 新测试移入仓库的首批（主动中断） | 0 / 8 / 2 / 24 | 新证据目录未创建、snapshot未导入；修正测试设施，不把它算产品缺陷 |
| 新测试第二批（主动中断） | 14 / 8 / 2 / 10 | 5秒断言与被测5秒超时相撞；夹具未创建合法Story版本；恢复World前仍保留401模式；手机标题含页码导致exact文本匹配失败。逐项修正夹具/选择器，保留原状态与次数断言，无生产校验放宽 |
| 上述夹具/响应式定向复核 | 5 / 1 / 0 / 0 | 仅剩固定392×420视口诊断点击失败；以下用干净main同环境对照 |
| 干净main短视口对照 | 0 / 1 / 0 / 0 | 同一导航节点被工作流region/banner遮挡，同样30秒超时；确认本轮之外的既有短视口问题 |

没有添加 Playwright retries 或 skip；中断/未运行单列。Playwright JSON 的skipped计数可能包含主动中断后的未执行项，以上按实际终端结果拆开，不称作“预期跳过”。

短视口补充：392×420模拟软键盘期间，输入、提示、底部导航的几何断言全部保留。结束键盘模拟并恢复390×844后，再检查诊断导航与主动继续。不是对固定420高度的诊断导航宣称通过；该限制的main原始失败日志、trace路径及截图保留，未改工作流抽屉。

## 正式验收结果

| 命令/批次 | 实际结果 | 退出码 |
| --- | --- | --- |
| `node --version` | v24.19.0 | 0 |
| `npm ci` | 使用锁文件正式安装成功 | 0 |
| 完整 `npm run check` | 163文件、3981项Vitest通过，0失败/跳过；文件名、ESLint、TypeScript、命令目录及生产构建通过 | 0 |
| `npm run prompts:check` | 93通过，0失败/跳过 | 0 |
| 定向Vitest（建议投影/既有正文策略） | 7通过，0失败/跳过 | 0 |
| 新增恢复Chromium完整批（后续加强了切档断言） | PC17 + 手机17，共34通过，0失败/跳过，retries=0 | 0 |
| 最终 `npm run lint` | 通过 | 0 |
| 最终 `npm run build` | 含TypeScript、文件名/命令目录检查，均通过；存在主包大于500kB的非阻断警告 | 0 |

最终源码及测试的逐文件校验值：[TESTED_SOURCE_SHA256.txt](evidence/TESTED_SOURCE_SHA256.txt)。后续提交只归档相同被测代码和证据。完整Vitest与Prompt各为独立批次，不相加冒充一次测试。

### 真实 React 页面截图

| 场景 | 修复前（main） | 修复后 |
| --- | --- | --- |
| PC正文失败，1440×1000 | [截图](evidence/before-desktop-invalid.png) | [截图](evidence/after-desktop-invalid.png) |
| 手机正文失败，412×839 | [截图](evidence/before-mobile-invalid.png) | [截图](evidence/after-mobile-invalid.png) |
| PC变量失败，1440×1000 | [截图](evidence/before-desktop-variables.png) | [截图](evidence/after-desktop-variables.png) |
| 手机变量失败，412×839 | [截图](evidence/before-mobile-variables.png) | [截图](evidence/after-mobile-variables.png) |

输入与提示布局：[PC1440×900](evidence/desktop-1440x900.png)、[PC901×768](evidence/desktop-901x768.png)、[手机390×844](evidence/mobile-390x844.png)、[手机392×640](evidence/mobile-392x640.png)、[短视口392×420](evidence/mobile-392x420.png)。

[干净main的392×420对照](evidence/main-392x420.png) 与同环境失败日志共同记录既有极短视口诊断导航限制；不宣称该限制已修复。正式浏览器是Chromium154，手机截图来自Pixel7设备模拟，按截图标注的CSS视口核对，设备像素比可能使PNG尺寸更大。

[修复前UI/Repository快照](evidence/before-ui-repository.json)、[修复后快照](evidence/after-ui-repository.json) 均只含合成数据的计数、阶段、绑定输入及安全失败码。浏览/选择建议、查看诊断前后，测试对整个正式state和draft作深度相等检查，同时核对Mock模型POST调用数。

[修复前复现脚本](evidence/baseline-reproduction.tar.gz) 保留当时独立工作区路径；日常复现请使用仓库中的正式E2E与上述命令。所有原始批次日志归档为 `evidence/raw-logs.tar.gz`，失败与中断记录保留，不只保存最终绿灯。


### 既有回归与切档补证

- `action-workflow`、`persistent-workflow-acceptance`、`stage-failure-summary`、`turn-undo` 用上述报告范围的grep选择：**20通过，0失败/跳过，退出0**。包含发送/结算一次、保存不可取消、失败改字、无锁零模型请求、自动/手动摘要与复制/清空/刷新、过期草稿、撤回后重发及无锁Undo CAS。
- 自查后加强新C场景：等待另一存档自身的页面状态，再确认无旧失败摘要和无模型请求。补证首批 **2通过、2失败，退出1**；失败来自夹具B只有正式状态、没有草稿，原先新加的“等待开始”断言与真实数据不符。保留无旧摘要/请求次数/状态不变断言，正确核对其“草稿不可用”状态，复核 **PC/手机2通过，退出0**。
- 首批补证中的两个既有取消/迟到/切档用例已通过，不在修正C夹具时重复执行。没有变动任何生产逻辑来适配夹具。
- 最后TypeScript复核通过，退出0。完整3981项、Prompt93项、新增Chromium34项、既有Chromium20项及切档补证各自独立列账；不拼成一次套件总成绩。
- 既有诊断E2E重新生成的旧报告图片已另存调查工作区，恢复仓库原图；本PR只提交本报告自己的前后截图，避免混入旧PR证据变动。

本次生产修改文件仅 `src/ui/game/GameScreen.tsx`、`src/ui/game/MobileActions.tsx` 与新增的 `src/ui/game/actionSuggestions.ts`。新增测试：`src/tests/action-suggestions.test.ts`、`e2e/action-recovery.spec.ts`、`e2e/helpers/actionRecovery.ts`。其余为本报告和证据，没有修改#165、CSS、领域、Repository、存档或请求协议。

最终diff自查：发送函数/禁用表达式、生成与继续回调均未改变；建议选择只有本页setInput；JSON快照与页面说明只读。`git diff --check`与暂存区差异检查均须为0。保持Draft，不合并、不部署、不发布。
