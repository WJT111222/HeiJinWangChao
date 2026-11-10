# 世界事件 V2 第四批：PC／手机世界事件档案

## 基线与范围

以 main `f71d38cb49eaf98c9efbcc0a7db145bc76a5c333`（已合并 PR #88）为基线，独立分支 `feat/world-events-archive-v2`。本批仅修改 UI、玩家只读投影、合成夹具与测试，没有修改领域命令、V6 Schema、三个阶段、固定调度、Story 入场、Commit/Undo、模型路由或 Prompt。没有新增依赖和付费请求。

## 正式读取规则

`eventArchive(view)` 以 view.events / retiredEvents 生成按稳定 ID 的只读索引。不猜测标题、人物或组织关系，不将旧事件自动分类。正式状态禁止同 ID 共存；显示选择器仍防御性去重，优先完整存续记录，不改原数据。

- 活动目录只含未退役且 eventKind=main、status=active/blocked 的主事件。受阻明确显示「受阻」。
- scheduled、resolved、cancelled 的主事件及退役主事件放在默认收起的「其他事件家族资料」，不挤入活动目录，也不伪装状态。
- 无 eventKind 的存续/退役记录放在「旧版独立事件资料」，保留搜索和完整技术记录。
- 任务在独立收起入口中读取，保留原列表搜索、分页与正式结果。
- 防御性的未归属阶段单独保留只读入口，不猜父事件或隐藏记录；合法 V6 正式状态本身仍必须通过父引用校验。

主事件详情通过 `eventFamily()`，复用领域 `stageResults()` 的存续/退役唯一成果聚合和实际结案排序；实际显示值读取同一个正式记录。没有 UI 摘要持久表，也没有反向写回。

阶段分为三组：实际已开始的 active/blocked、已结束及其成果、默认收起的尚未开始。不同组织和重叠时间照常并列展示；前序只使用 predecessorEventIds，不按显示顺序构造因果。

## PC 阅读路径

右侧原「世界事件」资料坞打开同一个既有 Dialog。桌面超过900px采用左右双栏：左为活动主事件目录，右为详情。目录可搜索、高亮、每页20条，左右各自滚动，低高度窗口所有内容仍可访问。

主事件信息包含状态、正式起点、标为预计的整体估期、背景目标、正式参与者名称、地点、影响描述及真实关联。预计时间不显示进度条、不成为截止或倒计时。阶段区位于技术折叠区之前，少量阶段直接显示，超过20项才启用列表搜索和分页。

选择阶段后右侧读取完整阶段档案，保留主事件阶段目录的页码/搜索与滚动位置，返回时按稳定ID恢复按钮焦点。查看正式前序可进入对应家族或旧事件，不伪造新的关联。

原 PC 主阅读区、左下品牌、七类资料入口、设置与返回首页没有改动；新增 CSS 仅作用于世界事件档案类。

## 手机三级阅读

900px及以下采用同一个组件的三级展示：

1. 主事件列表（含默认收起的辅助入口）。
2. 主事件详情与并行阶段。
3. 小事件完整详情。

小事件有「返回主事件」，主事件有「返回事件列表」，返回后恢复内部列表按钮焦点及滚动位置。阶段详情不打开新 Dialog；仍沿用外层 Dialog 的关闭、Escape、滚动锁与焦点恢复。既有手机资料目录保持原行为，未重做底部导航或软键盘逻辑。

## 结案、退役与历史

阶段档案区分固定终止、实际结案和开始时间。resolved显示「已结案」，outcome分别显示成功、失败、变化或取消；未知结果不推定成功。提前结案展示原固定时间及更早的 resolvedAt。

退役阶段只读取已保留的 detail：标题、参与者、实际经过、outcome、resultKnowledge 与根部正式身份/固定时间/来源。背景和目标已经清理时不编造；不使用 retiredAt 替代实际结案，不把 fixedEndAt冒充实际完成。长结果先预览，可展开全文，技术字段另行折叠。成果分类沿用 facts/reported/suspected，转述和推测不会因查看而升级。

已结案或已退役主事件仍有活动子事件的合法边界，通过「其他事件家族资料」继续浏览，父状态保持已结案。轻量退役记录缺详情时显示真实ID及未保留字段，不崩溃。

历史引用仅来自正式 timeline 中 eventId 与当前记录相等的节点，显示标题和正式纪事时间；可以调用原 setPanel('历史时间轴') 进入现有历史面板。没有复制历史真值、改变主事件startAt锚点、range排序或历史重大性规则。

## 只读、安全及更新

组件只持有本地选择、查询、页码和滚动位置。没有导入或调用存储、生成工作流或写命令接口；搜索、展开、返回、前序导航都不发AI请求，不更新主角/NPC知识，不排队入场，不改变时钟。

人物、组织、地点使用正式名称；找不到名称时保留真实ID。React按文本转义，不使用危险HTML。WorldRecord仅按需展开正式事件数据，没有设置/请求头或凭证来源。

每次view更新重新核对选中主事件是否仍属于原目录，失效时直接回到有效默认视图；子事件消失时回到父事件。不需要持久化UI状态，也不保留已失效记录的内容副本。

## 修改文件

- `src/ui/panels/WorldEventsPanel.tsx`：正式双端档案阅读、分层导航与只读操作。
- `src/ui/panels/eventArchive.ts`：纯索引/分类与阶段聚合，稳定ID去重。
- `src/ui/panels/Panels.tsx`：替换原世界事件平铺列表；其他资料面板保留。
- `src/ui/panels/playerView.ts`：只新增已有正式worldClock的只读输出，供阶段「已开始/尚未开始」展示。
- `src/ui/panels/WorldRecord.tsx`：补充主子身份/父ID/固定时间中文字段名。
- `src/ui/game/GameScreen.tsx`：世界事件专属Dialog样式和原历史面板回调。
- `src/app/styles.css`：限定范围的桌面分栏、手机逐层阅读与文字换行。
- `src/tests/fixtures/eventArchive.ts`、`src/tests/event-archive-ui.test.tsx`：合法V6合成状态、纯投影/安全渲染及有界大列表。
- `e2e/world-events-archive-v2.spec.ts`：真实GameScreen双端阅读、全量只读验证、不同尺寸截图；独立React夹具验证资料更新回退。
- `e2e/world-observer.spec.ts`：按新兼容入口定位旧事件，原隐私认知、全量观察、搜索和零请求断言保留。
- 本报告及截图产物。

## 执行记录

全部使用合成数据、浏览器隔离存储及 Mock；没有使用真实玩家存档或付费模型。不同批次独立记录：

- 新投影/SSR首轮：4通过、2失败。第一版合成主事件沿用了旧helper默认scheduled，不能进入活动目录；将夹具明确设为active，不改生产筛选规则，随后6/6通过。
- 初版新浏览器：4/4，desktop2、mobile2。核对真实截图后压缩桌面元数据、将阶段移到技术折叠之前，保留手机逐层路径。
- 补充资料更新回退后：6通过、2失败。失败仅为独立浏览器夹具读取预构建CommonJS模块的createRoot导出错误；改用其正确default/named导出，生产代码未为此改动，专项双端2/2通过。失败Trace保存在 `/workspace/event-archive-verification/initial-failure/`。
- 少量阶段改为直接阅读，大列表保留搜索/20条分页；纯投影/SSR最终7/7通过。包括1000额外主事件、43个并行阶段、冻结输入、不变性、安全转义、名称ID回退、旧记录和退役家族。

- **最终完整Vitest：2867/2867，103文件，0失败/0跳过。** 新增只读档案测试7项，没有把此前定向成绩相加。
- **最终指定六文件Chromium：44通过、2跳过、0失败/0 flaky，244.7秒。** desktop23/23；mobile21通过、2跳过。两项跳过为既有 `pc-reading-layout.spec.ts` 的PC专属截图和长状态测试在mobile项目中的原有skip，本轮没有新增skip、删除用例或降低断言。
- Prompt检查93/93；TypeScript、Lint、生产构建、完整Diff检查通过。构建仅保留既有chunk大于500kB提醒。没有改Prompt、Manifest或来源哈希。
- 独立测量/verbose批次7/7通过；1000额外主事件的完整测试用时58ms（含构造夹具、断言和SSR，不是纯选择器耗时或浏览器帧率保证）。

最终工程命令：`npm test -- --reporter=json --outputFile=/workspace/event-archive-full.json`；`npm run prompts:check`；`npm run typecheck`；`npm run lint`；`npm run build`；`git diff --check`。

最终浏览器命令：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/world-events-archive-v2.spec.ts e2e/world-observer.spec.ts e2e/pc-reading-layout.spec.ts e2e/game-window.spec.ts e2e/history-timeline-v2.spec.ts e2e/event-stages-v2.spec.ts --project=desktop --project=mobile --reporter=json`。

报告与各批日志位于 `/workspace/event-archive-*.log`、`/workspace/event-archive-*.json`。本轮原有布局回归自动更新的其他截图已另存验证目录并还原，不混入功能Diff。

## 真实浏览器截图

最终冻结运行代码的真实GameScreen截图已人工查看：桌面有独立目录和详情，阶段位于技术折叠前；手机采用逐层阅读，短视口通过外层body滚动、桌面短窗口采用独立栏内滚动，关闭和返回不被内容遮挡。PC阅读、资料坞/左下品牌及手机导航的原断言均在上述批次通过。

仓库内关键截图：[目录](world-event-archive/screenshots/)。覆盖1650×927、1440×900、1280×800、1024×520桌面，以及390×844、375×812、320×640、844×390横屏、390×500短屏。12张关键图来自自动测试，未经静态设计替换或裁剪：

- [桌面主事件](world-event-archive/screenshots/desktop-events-main-1650x927.png)
- [桌面退役阶段](world-event-archive/screenshots/desktop-events-stage-1650x927.png)
- [窄短桌面](world-event-archive/screenshots/desktop-events-stage-1024x520.png)
- [手机目录](world-event-archive/screenshots/mobile-events-list-390x844.png)
- [手机主事件](world-event-archive/screenshots/mobile-events-main-390x844.png)
- [手机阶段](world-event-archive/screenshots/mobile-events-stage-390x844.png)
- [320小屏](world-event-archive/screenshots/mobile-events-main-320x640.png)
- [手机横屏](world-event-archive/screenshots/mobile-events-stage-844x390.png)

全部阶段/目录截图、原布局回归截图及最终测试产物另存 `/workspace/event-archive-verification/final-browser-results/`，原布局截图副本在同验证目录的docs路径下。阶段详情及低高度截图只显示初始可视部分，完整长结果仍可滚动/展开；不是把截图当作全文输出。


## 体量、性能与剩余限制

主目录和大阶段列表每页最多20条；小列表直接阅读。长结果预览后可展开，完整技术记录只在当前对象中提供，不将整个事件世界渲染成全字段卡片。索引为本地只读计算，没有削减正式世界资料或AI上下文。

目前采用本地数组扫描/搜索与原RecordList，不是虚拟化数据库。大量辅助旧记录打开时仍需进行本地搜索；在极端超长文本及数万记录下可能有明显开销，不能把1000条合成测试视为任意规模性能保证。关闭的完整技术记录仍保留当前对象的渲染数据，不承诺零内存成本。没有改变正式存档、撤回快照或AI请求成本。

真实状态更新测试使用独立受控React/Dialog夹具模拟新view；主阅读/只读/双端截图均来自真实GameScreen。浏览器Mock通过只证明UI和数据边界，不证明真实模型叙事质量。
