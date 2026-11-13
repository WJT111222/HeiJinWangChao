# 手机端第三批：车票式首页与存档馆

分支：`feat/mobile-redesign-batch3`。基线：`ae342d6008d298eac8b2efb3bb59daf94295040e`（#123 已合并）。2026-11-13 再次 fetch，远端 main 未变化。最终 HEAD 以本次 Draft PR 和交付答复为准。

本批完成 ≤900px 的车票首页、存档选择与进入游戏交互。等待九代目源码审查及玩家视觉确认；未合并、部署、发布或打标签。

## 设计依据与实现

完整保留原始设计包 13 个文件于 [reference](reference/README.md)，六份 HTML 与交接文档同目录，iframe 引用可用。本批主依据是 [HOME 原稿](reference/heijin-mobile-home.html) 与 [HOME 交接](reference/MOBILE_HOME_HANDOFF.md)。上传 ZIP SHA256：`42e5f3eb59dfa2714220622bf75fb4056f92d9607a21fe2c08fbd07848d9cec9`。

[HTML / React 并排对照](comparison.html) 提供四城、空白票、异常票、读取状态、删除和撕票对照，附未修改 main 与本分支的桌面截图。静态 HTML 截图均明确标记为参考，React 截图通过实际 App 与正式 Repository 的隔离测试数据生成。

已完成：

- 封面与存档馆合为手机首页，品牌、`PRODUCT_VERSION`、宣传语、翻牌发车屏、票数、刷新、状态反馈、操作区与原公告入口齐全。
- 当前正式选择的存档排第一，其余沿用 App 的既有时间排序，空白票在最后。横滑、方向键和页码只更新 React 状态。明确点击“选择”才使用原选择保存方法；读取仍沿用 `openSave` 原有最近选择逻辑。
- 82% 宽、340px 高的票面；四城轻轨、搪瓷蓝、冰霜与霓虹票头；15 条固定种子的防伪波纹；经纬度、意象词和圆章。没有把城市天际线移到车票上。
- 中性城市遵守 `saveCity(title)`，票头与 TO 留空，无坐标和城市章，发车屏为“未知”。姓名只从 `title` 的“ · ”读取，不能拆分时完整显示。
- 保存日期和时刻使用原 `dateTime()` 中国标准时间格式。发车屏逐字渲染，仅变化字符重新翻动，延迟递增 60ms；不使用演示时间或设备当前时间冒充存档时间。
- 已检票章、独立纸面票根、虚线和半圆缺口。向下超过 60px 松开才撕票；短拖回弹，pointercancel 不进入游戏。下落淡出约 0.5s、导航延迟 0.7s。金色按钮与票根使用同一 guarded action；读屏和键盘不依赖拖动。reduced-motion 直接执行。
- 撕票本地锁防止重复导航。切票、刷新、打开模态、删除禁用、组件卸载都会取消未执行的动画导航。触觉反馈可选且捕获不支持的错误。
- 空白票恢复已有创角草稿；没有 Repository 时不创建。未改造创角页本身。
- loading 双骨架、空列表、真实 listError、存储不可用、异常存档、原始导出及删除失败均保留。
- 删除仍使用第二批 native Dialog 底部确认操作表，保留原文、记录 ID、不可撤销说明、忙碌保护及焦点恢复。只有 `repository.delete` / `deleteUnreadable` 成功返回后才创建 650ms 的“作废”展示副本，正式列表和数据已经按原逻辑处理；不提前假删除。
- 长姓名、描述和异常 ID 在票面内部可滚动，全文与 aria-label 可达。整页允许纵向滚动，375px 底部入口可达；页码采用键盘 roving tabindex，非当前票内容不进入 Tab 序列。保留浏览器缩放及安全区。

## 沿用的正式操作与保护范围

`App` 原 `openSave`、创角恢复/导航、最近选择、刷新、删除路径继续使用。仅将原来内联的选择、刷新、打开删除确认回调命名后同时传给手机与桌面。

`SaveCard` 的导出代码原样抽为共享 `useRawSaveExport`，继续调用 `repository.exportRaw(storageKey)` 与 `serializeRawSave`，保持原下载文件名、文案、锁、错误处理及 ObjectURL 回收。没有新建存档管理系统。

没有修改 Repository、Schema、IndexedDB、正式存档、撤回、结算、AI Prompt、World 校验、模型路由或收费机制。只读浏览的完整原始存储快照前后相等；原始导出按实际存储键定位，异常内容中的 saveId 不参与误删或关联导出。

[protected-files.json](protected-files.json) 记录 16 个重要文件与未修改 main 的 SHA256 一致，包括 GameScreen、DesktopWorkflowPanel、Dialog、手机抽屉、GlobalFeedback、存储服务、公告/Worker/wrangler 等。PR #120 的工作流组件、输入区和三阶段逻辑没有改动。Cloudflare KV 公告接入及原免责声明/今日免打扰流程不变。

桌面 `HomeScreen.tsx` 与 `home.css` 内容完全不变。901×800、1440×900 的封面、存档馆、删除确认共六组截图均与未修改 main **逐像素一致**，未使用阈值、遮罩或放宽断言；见 [桌面像素结果](desktop-pixel-comparison.json)。

## 真实截图

| 场景 | React 截图 |
|---|---|
| 默认已选上海 | [390px](screenshots/selected-sh-390.png) |
| 重庆、上海、哈尔滨、广州 | [重庆](screenshots/ticket-cq-390.png) · [上海](screenshots/ticket-sh-390.png) · [哈尔滨](screenshots/ticket-hrb-390.png) · [广州](screenshots/ticket-gz-390.png) |
| 未知城市、空白与已有草稿 | [中性](screenshots/ticket-neutral-390.png) · [草稿](screenshots/blank-draft-390.png) · [无存档无草稿](screenshots/empty-390.png) |
| 异常与禁用 | [无法读取及长 ID](screenshots/unreadable-390.png) · [loading](screenshots/loading-390.png) · [listError](screenshots/list-error-390.png) · [无 Repository](screenshots/repository-disabled-390.png) |
| 撕票与删除 | [撕票根动画](screenshots/tear-action-390.png) · [删除确认](screenshots/delete-confirm-390.png) · [成功后作废](screenshots/void-390.png) |
| 普通手机尺寸 | [375×667](screenshots/default-cq-375.png) · [390×844](screenshots/selected-sh-390.png) · [430×932](screenshots/default-cq-430.png) |
| 25 个长名存档 | [375](screenshots/stress-375.png) · [390](screenshots/stress-390.png) · [430](screenshots/stress-430.png) · [750](screenshots/stress-750.png) · [900](screenshots/stress-900.png) |
| 桌面 | [901 封面](screenshots/pc-cover-901-react.png) · [901 存档馆](screenshots/pc-library-901-react.png) · [1440 封面](screenshots/pc-cover-1440-react.png) · [1440 存档馆](screenshots/pc-library-1440-react.png) |

设计与正式数据的差异：HTML 的演示人物、票数、版本、保存日期、异常 ID 均由真实投影替换。票面的完整内容可滚动而非按 HTML 演示长短固定裁切；页码/刷新/公告等保留可达的触控和键盘入口，因此小屏纵向长度允许增加。HTML 的 demo hash、假删除、Toast 假导航、模拟刷新不进入生产代码。哈尔滨参考截图仅在设计页中替换示例城市以检查已定义的冰霜票头。

## 工程与定向测试

环境：Node.js `v24.19.0`、npm `11.9.0`、Chromium `154.0.8037.57`，真实 `npm ci` 依赖。所有 AI 请求 Mock；首页测试还拦截并断言 POST 数为零。

| 检查 | 结果与证据 |
|---|---|
| `npm ci --cache /tmp/ui2-npm-cache` | 成功，143 个依赖；未更新 lockfile |
| `npm run typecheck` | 通过，[日志](typecheck-final.log) |
| `npm run lint` | 通过，[日志](lint-final.log) |
| `npm run build` | 通过，[日志](build-final.log)；Vite 保留现有 >500kB chunk 提示，无构建错误 |
| 定向 Vitest 3 文件 | **45 通过**，[日志](unit-final.log) |
| 手机首页定向 Chromium | **19 个独立场景通过**：18 项主场景 + 1 项追加的删除飞行中保护；[主日志](chromium.log)、[删除/键盘复核](delete-busy-chromium.log) |
| 原桌面首页/坏存档业务 | **3 通过**，[日志](desktop-business-final.log) |
| 原 NPC 隐私/重复收费业务，手机与桌面 | **4 通过**，[日志](privacy-billing-final.log) |
| 桌面基线 PNG 比较 | **6 组逐像素一致**，[结果](desktop-pixel-comparison.json) |
| `git diff --check` | 通过 |

合计 **26 个不同 Chromium 场景通过**，另有 6 次针对触摸、键盘、选择和删除的重复验证。没有 expected skip、失败重试或 flaky 掩盖。完整用例名称、报告来源及成绩见 [validation-summary.json](validation-summary.json) 与各 `*-results.json`。

定向 Vitest：

```sh
npm run test -- src/tests/mobile-home.test.ts src/tests/unreadable-saves.test.ts src/tests/storage-environment.test.ts
```

本批测试的默认配置只匹配本批 `mobile-home.spec.ts`；业务模式的 grep 只选指定旧用例，未扩大到整套游戏：

```sh
MOBILE_RUN_TAG=final npx playwright test --config playwright.mobile-batch3.config.ts
HOME_DESKTOP=1 MOBILE_RUN_TAG=desktop-business-final npx playwright test --config playwright.mobile-batch3.config.ts
MOBILE_BUSINESS=1 MOBILE_RUN_TAG=privacy-billing-final npx playwright test --config playwright.mobile-batch3.config.ts
```

追加删除忙碌用例和键盘复核：

```sh
MOBILE_RUN_TAG=delete-busy npx playwright test --config playwright.mobile-batch3.config.ts --grep '删除飞行中|排序、四城'
```

未运行：完整 700 项 E2E、无文件范围的 Playwright、全量 Vitest、`npm run check` 全量链、Prompt 检查及付费模型。上述未运行项目不宣称通过；本批正式指令要求的是 typecheck/lint/build 与定向测试。

### 失败与修复记录

1. 首次 E2E 数据种子将 `updatedAt` 设在 fixture 的真实 `createdAt` 之前，正式 Schema 拒绝。修正测试种子为已创建后的保存时间，未放宽领域时间校验。
2. 真实 CDP 触摸发现内层票面 `overscroll-behavior: contain` 同时阻止横向链，手指无法翻票。改成只限制纵向；保留原横滑断言，真实触摸通过。[修复前日志](initial-failures/touch-before-fix.log)。
3. 异常存储键与内容 saveId 不同的场景不能用 inline-key 存储强行 put 第二个 key；改为在测试中先建立已有兼容的 out-of-line 存储布局，再通过正式 Repository 读取和导出，没有更改生产数据库结构。
4. 并行验证曾共用 Playwright 输出目录，造成 trace 文件被另一个任务清理。现配置为首页/桌面/业务各自独立目录，后续结果均为隔离重跑，无自动重试。
5. 旧 NPC 场景的导航辅助函数打开了新版手机 native 工作流 sheet 后直接点击后台设置，焦点保护正确拦截。仅在该测试文件的导航封装中显式关闭已打开的 sheet，再进入原设置/资料。存档入口使用真实手机主按钮或桌面存档馆；私密信息、完整来源、请求次数、跨标签锁、429/取消与重试等原业务断言未删改。四次双端执行全部通过，已实际到达业务断言。[修复前日志](initial-failures/mobile-navigation-before-fix.log)。
6. 仅存在异常记录时，没有正式可读 active，初版会默认停在空白票。修正为首次列表读取完成后定位首张实际记录；已移除测试中主动切到首张的掩盖步骤，默认异常票断言、禁撕及导出重新通过。
7. 最初桌面坏存档验证配置错误沿用了 390px 视口，找不到桌面 SaveCard；改成明确 1440×900，原坏记录导出和删除断言不变，三项原桌面用例通过。[初始记录](initial-failures/desktop-viewport-configuration.log)。

已知未完成：第四批须知/公告视觉与创角、后续档案/设置与收尾批次均未施工。本批功能没有已知未完成项。真实设备触觉强度与 Safari 手感仍需玩家视觉及真机确认；自动化验收仅对上述 Chromium 范围负责。

## 修改文件

完整清单见 [FILES.txt](FILES.txt)。生产代码 8 个文件：

- `src/app/App.tsx`：按现有响应式判断接入手机首页，共享原回调，删除成功后的 UI 通知。
- `src/ui/SaveCard.tsx`：使用原样提取的共享导出 Hook，桌面 DOM 不变。
- `src/ui/home/skyline.ts`：追加仅供装饰的经度、圆章与色调元信息，复用原城市名、纬度与意象词。
- `src/ui/home/MobileHomeScreen.tsx`：车票首页、翻牌屏、横滑选择、只在删除成功后展示作废。
- `src/ui/home/mobile-home.css`：完全限制在 ≤900px 的设计样式。
- `src/ui/home/ticketView.ts`：无写入的排序、名字/时间/状态投影和固定防伪纹。
- `src/ui/home/useTicketTear.ts`：可取消的 pointer 撕票、交互锁及 reduced-motion。
- `src/ui/home/useRawSaveExport.ts`：与原 SaveCard 同一导出逻辑。

测试变动：`mobile-home.test.ts`、`mobile-home.spec.ts`、`helpers/mobileHome.ts`、`helpers/home.ts`、`npc-memory.spec.ts` 与本批单独 Playwright 配置；其余为设计参考、截图、对照页、验证 JSON 和报告。
