# 桌面档案柜第四批 · 世界事件、历史时间轴与记忆

施工日期：2026-11-12。基线为重新 fetch 的 `origin/main`：`332cac71ae9e4c68774d6372ff9affd14626fb8b`（#112）。独立分支 `codex/desktop-events-history-memory`。本报告与实现同提交；最终完整 SHA 见 Draft PR HEAD 及交付消息。

## 本次结果

仅将 ≥901px 的世界事件、历史时间轴和记忆迁入现有 ArchivePanel。沿用暖纸框架、方印、深色城市主界面、右侧 dock、非模态行为与正文/行动台 `inert`。没有创建第二套档案柜，没有施工地图或设置。

正式 GameState、IndexedDB、Schema、事件 V2 生命周期、结算/撤回、历史与记忆数据、维护业务、AI Prompt、三阶段协议、人物/关系/资金/库存规则、城市身份/星期/天气/时钟及公告均无修改。阅读状态缓存仅存于 GameScreen 的 React ref：事件选择/搜索/页码、历史视图/筛选/同组分页/原节点、记忆层级/搜索/来源选择。不会回写存档，刷新后由正式状态重新投影。

所有新增阅读 E2E 均在浏览前后严格比较 Repository 的完整正式状态和草稿，并拦截外部 HTTPS 请求、断言请求数为零和无 pageerror。业务回归中的模型请求全部使用 Mock。

## 设计依据与逐项对应

- [确认 HTML](../desktop-npc-cabinet/design/heijin-panels.html)、[PANELS_HANDOFF 第四节](../desktop-npc-cabinet/design/PANELS_HANDOFF.md)。包内其他稿件仅作已有风格参考；现行业务以 main 和本轮要求为准。
- 原始截图：[事件](screenshots/s4-ev.png)、[历史](screenshots/s4-hp.png)、[记忆来源](screenshots/s4-mem-src.png)。来源哈希见 [design-source.json](design-source.json) 和原 [manifest](../desktop-npc-cabinet/design/manifest.json)。
- [HTML / React 并列对照页](comparison.html) · [对照长图](screenshots/comparison.png)。两侧均为浏览器实际截图，人物、时间、数量不复制演示数据。

| 设计项 | 实际实现 |
| --- | --- |
| 事/史/忆印章与序号 | 05/07、06/07、07/07；分别显示「进行中的事 / 已发生的事 / 主角的记忆」 |
| 事件名录与卷宗 | 左侧吸顶搜索、正式数量、20 条分页；辅助档案移到名录底部；右侧完整卷宗独立滚动 |
| 事件头部与要素 | 正式状态/成果胶囊、影响程度、主/子类型、装饰案卷印（aria-hidden）、参与者标签、时间/地点/所属主事件 |
| 背景、目标与成果 | 双卡，中等桌面堆叠；超过 500 字仍能展开全文；成果保留 facts / reported / suspected 三类 |
| 并行阶段 | 分为正在进行、已结束和尚未开始；节点颜色来自正式状态/结果，无序号或前后推进箭头；>20 条沿用 RecordList |
| 历史双轨 | 统一正式时间槽位，世界左、主角右，中线时间，蓝/赭红轨道；保留检索、年代、两级分页及关联详情 |
| 历史详情 | 56rem 阅读宽度、正式时间精度、完整叙事、经过序号、事实性质、关联历史及来源页脚 |
| 记忆层级 | 六个现有层级、正式数量、深浅色块及金色选择态；中等桌面 11rem 侧栏 |
| 记忆正文 | 档案卡、完整原文和来源、原文抽屉、多来源选择和分页；长来源在抽屉内滚动并可键盘聚焦 |
| 响应式 | 1920/1440/1280/1100/901 桌面；≤900px 原生 Dialog 和原布局保持 |
| 动画与可访问性 | 事件呼吸点在 reduced-motion 下停止；标题/选择态/展开态语义、关闭按钮、Esc 和回焦保留 |

### 与演示稿不同而必须保留的内容

1. **历史时间精度**：真实 `historyTimeLabel()` 会包含「时刻未详 / 日期未详 / 年内日期未详 / 时间待考」及范围说明。中线时间允许自然换行，覆盖设计稿的强制 nowrap，避免丢信息或制造精确时间。继续使用原 historyProjection 的槽位、排序和归属，不按布局重新推断先后，不绘制时间距离比例。
2. **事件时间**：继续使用正式 `dateTime()`；时间元素保留完整 ISO 的 dateTime/title，完整技术记录保留原始值。主事件预计时间仍带「（预计）」，没有倒计时或结案推断；阶段固定终止时间、实际结束时间分别显示。无详细内容的退役记录沿用「未保留/未记录」降级，不补背景或成果。
3. **角色知情边界**：沿用 main 的玩家只读全档案视图。visibility、protagonistKnowledge、成果分类及其完整技术字段保持原样，不把世界客观进展当成角色自动获知。参与者小标签只是正式 actorRefs 的样式，不推断参与程度、身份或知识。
4. **既有跳转范围**：当前 NPC 有正式组织关联入口，组织有 NPC/组织/事件入口；事件有前序事件及全局「前往历史时间轴」。记忆阅读页没有 NPC 跳转或维护按钮，事件参与者也原本不是跳转按钮。本批不从文本或 actor 标签猜 ID、不制造新导航或维护入口。现有 NPC→组织→事件、组织→事件、前序阶段及事件→历史均保留。历史按钮沿用原来的全局打开语义，不伪造特定纪事目标。
5. **维护归属**：手动总结、自动维护配置、目标选择、失败重试/暂停原本位于 NPC/设置/统一控制器，继续在那里，不迁进只读记忆页。没有删除合法维护入口；维护回归使用原流程与 Mock。
6. **多来源原文**：设计示例可直接打开单段原文；真实摘要可能覆盖多个回合，仍先显示来源选择器并保留每页 20 条。原文不会摘要、截断或改写。
7. **大数据与完整字段**：活动/其他家族、旧版独立事件、未归属阶段、任务、技术记录和来源都保留；不只展示 HTML 的示例概要。大量阶段、纪事、记忆继续分页。卡片摘要可作预览，详情全文保持可达。

## 导航、焦点与滚动

- dock 在资料打开时仍可鼠标和键盘操作；同一入口再次点击关闭。正文和输入台 inert，数字行动、Ctrl/Command+Enter 不穿透；新用例还比较操作前后状态及草稿。
- 组织使用真实 event ID 直接打开主事件或对应阶段。桌面文件标题在选择提交到 React DOM 后获得焦点，避免先聚焦旧卷宗。手机保留原来的时序与 Dialog。
- 事件列表和卷宗各自滚动，选择阶段不重置左侧列表；返回主事件恢复阶段按钮及卷宗位置。跨 dock 返回保留原主/子事件选择与返回目标。
- 历史列表→详情→返回恢复原节点及列表位置。桌面额外保留同组分页，避免从第二组页详情返回时随机落到第一页；手机保留既有行为。
- 记忆层级、搜索、来源列表页码与打开的原文在同次游戏界面内切换后保留。来源原文关闭后回到来源选择器或原入口；长原文段落可 Tab 聚焦并用 End 滚动。
- ArchivePanel 关闭后回到对应事件/历史/记忆 dock；若焦点已在其他合法外部入口，沿用框架不抢焦点的规则。原生地图/设置接管其焦点与 Esc。天气浮层先处理自己的 Esc，工作流浮层不抢档案柜 Esc；没有改动它们的业务逻辑。

## 验证成绩

环境：Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。使用独立端口 5192 避开旧工作树；main 对照使用 5193；静态设计截图使用 5194。没有调用真实付费模型。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm ci | 通过，143 packages | [ci.log](validation/ci.log) |
| npm run check | 126 文件、3195 测试，lint/typecheck/生产构建通过 | [check.log](validation/check.log) |
| npm run prompts:check | 3 文件、93 通过 | [prompts.log](validation/prompts.log) |
| Chromium 13 组双端回归 | 113 通过、5 个平台条件跳过、0 失败、0 重试（6.6 分钟） | [e2e.log](validation/e2e.log)、[e2e.json](validation/e2e.json) |
| main 三页同夹具手机对照 | 3 通过；三张截图像素和 SHA256 均完全一致 | [main-mobile.log](validation/main-mobile.log)、[pixel-comparison.json](validation/pixel-comparison.json) |
| 未修改 main 的旧记忆测试对照 | 2 失败，停在已删除的首页「读取存档」入口 | [main-stale-entry.log](validation/main-stale-entry.log) |
| main 仅适配初始路由后的后续导航对照 | 1 失败：存档馆没有「设置」按钮 | [main-library-settings.log](validation/main-library-settings.log) |

新增 10 个单元用例覆盖正式并行家族/退役成果投影、缺失内容不补造、历史槽位与所有时间精度、六层记忆、归属和来源、多来源分页及输入对象不变。新增双端 E2E 覆盖三页阅读与一项桌面压力场景。

完整相关套件：archive-step4、world-events-archive-v2、history-timeline-v2、memory、player-memory、memory-summary-v2、archive-step2、desktop-cabinet、archive-step3、workflow-feedback、event-stages-v2、event-entry-feedback、npc-unified-memory。测试使用原断言验证事件结算/退役、选择性入场、历史撤回恢复、记忆维护失败重试及正文请求；本批没有改动这些实现。

构建退出码为 0；Vite 仍有 >500kB chunk 建议，没有在本批额外拆包重构。原始输出保留于日志。

### 压力与边界

- 桌面 1920×1080、1440×900、1280×800、1100×800、901×800；手机 390×844，原事件用例还覆盖 375、320、横屏及矮视口。
- 216 条现存事件记录（含已结束/计划状态，以及 100 个额外主事件和 100 个并行阶段）、102 条中期记忆、70 回合原文和 113 条历史；RecordList/原分页限制单页数量。
- 同时运行的三个独立阶段，成功/失败/变化/取消的结束成果，退役家族仍活动的子事件、结案家族跟进、旧版与轻量退役记录全部可读。
- 长主事件名称及无空格字符串、正式上限内的长纪事标题/2800 余字正文、5000 余字长期记忆、长来源原文均完整可读，五个桌面尺寸和内部滚动区域检查横向溢出。
- 年/月/季/日/范围/未知和带秒毫秒的正式历史时间，继续由同一正式函数格式化，不从设备时间补值。
- [stress.json](validation/stress.json) 记录本次浏览器自动化耗时与数据数量，包含操作、等待和截图，不是独立渲染基准。

### 失败与修复记录

1. 新夹具初版用默认 Chronicle 构造普通史料，导致原认知性质校验拒绝；改为按真实普通条目结构构造。压力夹具最初又超过 120 字标题/3000 字正文的正式上限，改为合法长度。未放宽 Schema。
2. 直接用 Node 导入带仓库扩展名省略的 TS 夹具时模块解析失败；按仓库既有 Vitest/Vite 加载验证，产品模块解析方式未改变。
3. 旧历史桌面几何断言要求世界在上、主角在下，改为本轮确认的左右双轨；排序/槽位/数据断言保留。桌面同组返回改为原第二页节点并新增焦点断言，手机第一页旧断言保留。
4. 辅助事件档案按设计移入左栏后，旧“活动目录不包含取消事件”断言连辅助折叠内容也统计；仅将该断言定位到活动行集合，取消/计划事件仍必须不进入活动列表。
5. 新用例用「年代」精确 label 查找时，原 HTML 的 option 文本参与 label 名称；改为定位唯一 combobox，筛选后的条目断言保留。
6. 组织→阶段首次聚焦可能先落在旧卷宗；将桌面聚焦放在选择更新后的 effect，标题/返回目标回归通过。关闭外部设置后先把焦点放回档案柜再验证其 Esc 回焦，保持框架不抢外部焦点的规则。
7. 两个既有记忆用例的初始首页入口失效，另一个后续路径在存档馆找设置。已在生产源码未改的 main 独立工作树复现；测试只改为进入已安装夹具的正式 hash 路由，以及从存档馆点击「封面」后进入设置。全部原只读、费用、权限和维护禁用断言保留。
8. 旧第二批断言要求事件关闭回组织入口；事件迁成独立档案柜后，改为验证事件 dock 回焦，随后仍验证原组织目标正确恢复。没有删除后续跳转与状态断言。
9. 调试时新增 E2E 有一处 prefer-const，已修正；初次设计截图依赖已停止的测试服务器，改用独立只读 HTTP 服务重拍。
10. 第一次整组回归期间仍有夹具/组件编辑，出现控件 detached 和执行上下文销毁；该轮不作为最终验收。冻结源文件后重新完整执行，保留 [调试回归日志](validation/broad-before-freeze.log) 与最终日志供核对，没有修改工作流业务断言来绕过。

### 复现命令

```sh
npm ci --cache /tmp/ui2-npm-cache
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/archive-step4.spec.ts e2e/world-events-archive-v2.spec.ts e2e/history-timeline-v2.spec.ts e2e/memory.spec.ts e2e/player-memory.spec.ts e2e/memory-summary-v2.spec.ts e2e/archive-step2.spec.ts e2e/desktop-cabinet.spec.ts e2e/archive-step3.spec.ts e2e/workflow-feedback.spec.ts e2e/event-stages-v2.spec.ts e2e/event-entry-feedback.spec.ts e2e/npc-unified-memory.spec.ts
```

本机实际使用 [隔离端口配置](validation/playwright.config.txt)，其余项目、workers、重试条件沿用仓库。main 对照工作树的生产源码 tracked diff 为空；新增的对照夹具与用例均为未跟踪文件，不改主分支实现。

## 截图交付

均为真实 Chromium 页面。完整文件清单见 [FILES.txt](FILES.txt)，截图校验见 [screenshots-sha256.json](validation/screenshots-sha256.json)。

- 世界事件总览/主事件：[1920](screenshots/events-1920.png)、[1440](screenshots/events-1440.png)、[1280](screenshots/events-1280.png)、[1100](screenshots/events-1100.png)、[901](screenshots/events-901.png)。
- [并行阶段](screenshots/events-parallel-1440.png)、[退役完整经过](screenshots/events-retired-901.png)、[大量阶段](screenshots/events-many-1100.png)、[异常长主事件](screenshots/events-long-1100.png)。
- 历史：[完整双轨](screenshots/history-paired-1440.png)、[1440](screenshots/history-1440.png)、[1100](screenshots/history-1100.png)、[901](screenshots/history-901.png)、[纪事详情](screenshots/history-detail-901.png)、[大量历史](screenshots/history-many-1100.png)、[长纪事全文](screenshots/history-long-1100.png)。
- 记忆层级：[即时](screenshots/memory-即时记忆-desktop.png)、[短期](screenshots/memory-短期记忆-desktop.png)、[中期](screenshots/memory-中期记忆-desktop.png)、[长期全文](screenshots/memory-长期记忆-desktop.png)、[人物记忆](screenshots/memory-人物记忆-desktop.png)、[永久正文](screenshots/memory-永久正文档案-desktop.png)。
- [来源原文](screenshots/memory-source-1440.png)、[来源窄桌面](screenshots/memory-source-1100.png)、[大量记忆](screenshots/memory-many-1100.png)、[长记忆](screenshots/memory-long-1100.png)、[长来源键盘滚动](screenshots/memory-original-long-1100.png)。
- 手机：[事件](screenshots/events-mobile.png)、[历史](screenshots/history-mobile.png)、[记忆来源](screenshots/memory-source-mobile.png)；未修改 main：[事件](screenshots/main-events-mobile.png)、[历史](screenshots/main-history-mobile.png)、[记忆来源](screenshots/main-memory-source-mobile.png)。

未新增任何持久化字段，不需要存档迁移；沿用 main 现有读取兼容性。Draft PR 等待九代目复审及玩家视觉确认，不自行合并、部署或发布。
