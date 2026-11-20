# 全站 UI 巡检修复与验证

基线为 `main@57ce029e202b84eb391399b6413f5644c4324b53`，与发现问题时一致。表中的修复前图片来自该基线的 Chromium 巡检，修复后图片来自同一仓库的真实 React 应用。所有存档、人物、模型名和渠道均为合成夹具。模型列表使用 Mock GET；检查设置与历史资料的流程对模型 POST 次数断言为零。

## 逐项结果

| 编号 | 修复前 | 修改及真实操作 | 修复后 | 双端证据 |
| --- | --- | --- | --- | --- |
| P2-1 | 游戏内 901px 模型列为 0，点击被刷新按钮截获 | AI 编辑区宽度不足时，用途和来源占首行；渠道与模型均分下一行，刷新独占一格 | 模型按钮宽 131px。901、1024、1440px 均能打开列表；选另一模型、保存并读取持久配置成功 | [前](before/model-and-footer.jpg) / [后](after/desktop-day-model-and-footer.jpg) |
| P2-2 | 手机 360×320 下编辑区只剩 21px，与保存栏重叠 | 按抽屉实际可用高度收起名片；沿用原有内容滚动、底栏和安全区。状态明细仍可从「兼容与预览」访问 | 短视口内实际点选、修改末行、保存并回读成功，编辑区与底栏边界分别测量 | [前](before/preset-edit.jpg) / [后](after/mobile-day-preset-edit.jpg) |
| P2-3 | 280px 纪事列被外壳样式拆成 144／0／280px，卡片重叠 | 给历史预览外壳单独的布局类，包括两处断点；时间轴仍用原有的同刻分组和分页 | 同刻三张卡片前后边界互不重叠；两端真实打开第二张并显示返回时间轴入口 | [前](before/timeline.jpg) / [后](after/desktop-day-timeline.jpg) |
| P2-4 | 901×600 保存栏占编辑区约 52%，反馈逐字换行 | 狭窄桌面编辑区内，反馈独占一行，两个操作留在下一行 | 同入口从 216px 降至 128px，占 418px 编辑区约 31%，保存成功反馈可读 | [前](before/model-and-footer.jpg) / [后](after/desktop-day-model-and-footer.jpg) |
| P2-5 | 风格组外的 fieldset 未跨列，1440px 首页仅用 418/846px | 让真实网格子元素跨列，七个选项和选中说明使用可用宽度 | 首页 1199/1200/1440px 分别使用 888/888、838/838、846/846px；PC 四列按钮、手机单列，选择、说明和保存通过 | [前](before/style.jpg) / [后](after/desktop-day-home-style.jpg) |
| P2-6 | 日间 NPC、组织筛选为深底深字，1.27:1 | 只在日间历史阅读工具栏成对使用历史卡纸和文字变量；控件保留自己的底色 | 两类工具栏均达 12.76:1。夜间沿用原配色 | [前](before/history-npc-filter.jpg) / [NPC](after/mobile-day-history-npc-filter.jpg) / [组织](after/mobile-day-history-org-filter.jpg) |
| P2-7 | 点击历史地图的已建档姓名后仍在地图 | 历史窗口用本地阅读状态传递目标面板与人物 ID，复用同一快照的 NPC 详情；手动切换页签清除旧目标 | 两端点击后选中 NPC 页签，详情标题等于刚点击的姓名；离开地图前后的正式状态与草稿相同 | [前](before/history-map-person.jpg) / [后](after/mobile-day-history-map-person.jpg) |
| P2-8 | 游戏内手机地图占位文字 3.04:1、层级说明 3.38:1 | 在档案纸地图内复用较深的辅助文字色，覆盖搜索占位、层级与地点计数 | 两种主题下搜索可聚焦、填写、筛选和清空；文字对比度见下表 | [前](before/map-archive.jpg) / [日](after/mobile-day-map-archive.jpg) / [夜](after/mobile-night-map-archive.jpg) |
| P3-1 | 历史手机地图中的河流被默认填成黑色楔形 | 将现有 SVG 绘制规则限定在共用的地图示意盒，历史容器定位河流层 | 两端实测绝对定位、无填充、有描边；河流路径和地名沿用原数据 | [前](before/history-map.jpg) / [后](after/mobile-day-history-map.jpg) |
| P3-2 | 手机首页历史标题印章日间约 1.10:1 | 在日间历史抽屉标题内使用既有深金文字变量 | 日间印章可辨，夜间外观保留；见下表 | [前](before/history-home.jpg) / [日](after/mobile-day-history-home.jpg) / [夜](after/mobile-night-history-home.jpg) |
| P3-3 | 游戏内资料印章换成纸底后仍用浅色字，约 1.19:1 | 在游戏日间资料抽屉标题限定印章朱砂前景 | 日间可辨，夜间保留红底浅字；地图抽屉可打开、搜索与关闭 | [前](before/map-archive.jpg) / [日](after/mobile-day-map-archive.jpg) / [夜](after/mobile-night-map-archive.jpg) |

## 对比度与可用空间

| 最终渲染部位 | 日间 | 夜间 | 取样方法 |
| --- | ---: | ---: | --- |
| 历史 NPC／组织普通筛选标签 | 12.76:1 | 14.68:1 | 标签实际前景与工具栏底色 |
| 游戏内手机地图搜索占位 | 6.47:1 | 6.47:1 | `::placeholder` 实际文字对输入底色 |
| 游戏内手机地图层级说明、地点计数 | 5.77:1 | 5.77:1 | 深色辅助文字对纸底；计数所在的半透明浅色卡片用更深的底纸作保守对照 |
| 手机首页历史印章 | 约 5.17:1 | 约 10.11:1 | 实际前景与印章截图中文字两侧的代表底色 |
| 游戏内手机资料印章 | 约 5.87:1 | 约 5.38:1 | 同上 |

[印章取样 RGB 与比值](seal-measurements.json)。装饰印章使用无损局部截图，在距左右边缘 6px 的两列取样，排除上下边框后取亮度中位值。渐变背景的测值随采样点略有变化。

在 360×320 的模拟键盘视口，实际可滚动编辑区为 y=147.66～233.61，高 85.95px；保存栏自 y=233.61 开始。PC 游戏内风格组选项在 1199、1200、1440px 分别使用 647/647、577/577、804/804px。手机在 360px 可用宽度为 332/332px。

## 源码改动

- `src/ui/settings/ai-connections.css` 为 AI 编辑区添加容器查询，限定窄桌面的路由与反馈换行。
- `src/ui/settings/peinture-settings.css` 在手机预设抽屉的极矮内容容器中收起名片。
- `src/ui/settings/SettingsPanel.tsx`、`settings-paper.css` 为承载剧情风格的 fieldset 指定跨列规则。
- `src/ui/history/HistorySaves.tsx`、`history-saves.css` 明确三栏外壳、纸面工具栏、历史印章和地图河流承载层。历史地图复用现有档案链接接口，在预览中定位目标记录，只读取当前快照。
- `src/ui/mobile-archives.css`、`src/ui/game/day-appearance.css` 限定地图辅助文字、示意河流与资料印章的样式。
- `e2e/ui-compatibility.spec.ts` 覆盖真实点击、保存、只读导航、同刻三张卡片、双主题和断点。既有 `e2e/history-visual.spec.ts`、`e2e/history-saves.spec.ts` 的外壳定位改用已有的「只读历史世界」语义区域。

## 工程与浏览器验证

Node 24.19.0，Chromium 154.0.8037.57，Playwright 桌面和 Pixel 7 项目。依赖使用本分支的 package.json 与相同锁文件，在独立可写卷执行 `npm ci --no-audit --no-fund`，退出码 0。完整检查采用 `VITEST_MAX_WORKERS=1 npm run check`，退出码 0；197 个文件、4,738 项 Vitest 通过，0 失败、0 跳过；文件名、ESLint、显示目录、TypeScript 和生产构建均通过。Vite 报告大于 500kB 的构建分块提示。`npm run prompts:check` 退出码 0，3 个文件、93 项通过，0 失败、0 跳过；这是专项复测，单独计数。新增首页断点场景后再次运行 ESLint，退出码 0。

1. `CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/ui-compatibility.spec.ts --workers=1 --timeout=60000` 验证日夜×双端的十二个主场景。桌面 6/6，手机 6/6，退出码 0。模型选择完成后读取持久化路由；键盘缩高后真实点击、输入并读回保存的自定义文本；历史导航前后比较正式状态和草稿。
2. 首页断点及既有回归使用 `npx playwright test e2e/ui-compatibility.spec.ts e2e/history-saves.spec.ts e2e/ai-model-selection.spec.ts e2e/history-visual.spec.ts --grep '首页独立设置|自动五节点只读预览|主题浮层的搜索|历史档案视觉 day short=false' --workers=1`。此组桌面 4/4、手机 4/4，退出码 0。两组共 20 个不同的 Chromium 用例执行，桌面 10、手机 10，0 失败、0 跳过。
3. `git diff --check` 以及暂存差异检查均用于核对提交。

[依赖安装](npm-ci.txt) · [完整工程日志](engineering.txt) · [提示词专项](prompt-results.txt) · [十二个主场景](chromium.txt) · [首页与既有回归](chromium-related.txt)

首次安装遇到工作盘空间不足，改用独立卷完成锁文件安装。首次并发巡检期间 Vite 被系统终止，浏览器后续导航失败；改为单浏览器 worker。早期预设场景用全页按钮定位，内容区和设置窗口都有同名入口，改为在设置对话框内定位。沙箱初次阻止公告单测启动本地 sh，完整检查在允许该子进程的环境重跑。原有断言和超时业务规则均保留。

## 范围与后续复验

手机验证使用 Linux Chromium 的 Pixel 7 触控模拟与视口缩高，未覆盖 Android／iOS 真机键盘、Safari 或非零物理安全区。桌面和手机历史预览、覆盖确认取消与资料阅读已实测。另在历史地图的日间截图观察到地点详情沿用深色底纹，后续可独立测量该详情区域；本次调整限于地图导航、河流和已列出的低对比度文字。
