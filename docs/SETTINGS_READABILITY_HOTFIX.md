# 1.0 Beta 设置界面文字可读性热修复

## 结果与范围

- 开工重新 fetch/ls-remote，main 为 `6fd868b8ee3acf97abd61dd9872712a8d4add08e`，与只读审查基线相同。
- 实现及新增回归的代码提交：`eb785d38c3cb309bdc0e102e14c6c277166769f3`。后续提交只补报告、测量与截图；各代码文件 SHA-256 见 [采集清单](settings-readability-hotfix/capture-manifest.json)。
- 生产变更只有三个 CSS 文件，没有修改 App、AiConnections、Dialog、模型连接回调、Prompt、记忆、GameState、Repository、Commit、Undo、版本号或 Beta 标签。
- 保留米金纸张、SVG 纸纹、字体、字号、标题层次和布局。边框仅调整必要控件的颜色，宽度、位置、圆角不变。
- 新增14项正式 Chromium 定向回归单批 **14通过、0失败、0跳过**；没有运行全量 E2E。正常文字采用4.5:1，大字3:1，必要控件3:1；实际禁用控件独立检查、未改禁用条件。
- 还有原 main 已存在的旧手机测试失败，见下文，不宣称所有历史 E2E 全绿。

## 根因与实际修改

### `src/ui/settings/settings-paper.css`

1. 明确实际设置宿主 `.settings-paper.settings-dialog[data-tone=paper]` 的 token 优先级，避免游戏档案纸的通用 token 把 `--dim` 又覆盖回浅色。
2. 在 `.settings-paper` / `.settings-mobile-paper` 作用域共用 `--settings-detail`、控件边界、开关关闭色及成功/警告/错误/信息文字。字段和 checkbox 标签直接使用现有深棕 `--muted`，不能只期待父容器 `color` 覆盖子 label 的显式浅色。
3. 普通文本输入样式排除 checkbox/radio；必要输入边界、关闭轨道及提示词开关保留独立状态。只改变颜色，不改变状态、尺寸或回调。
4. 为纸页普通按钮、主操作和选中 Token 的 hover 明确浅/深背景配对，避免全局/游戏档案 hover 把浅字放到浅底、或墨字放到暗底。保留资源行自己的透明 hover 和选中处理。
5. 同时处理辅助说明、占位符及各级反馈色；功能色仍分别为绿、金棕、朱砂、蓝色，没有把全站文字统一改黑。
6. 嵌套 `dialog.feedback-dialog` 在自身根节点重设深色确认主题文字及 `--status-bg`，并显式限定自身标题、关闭和危险按钮 hover。确认框仍用原深色表面，外层纸色不能穿透标题。

### `src/ui/mobile-archives.css`

- `--dim` 和反馈文字读取设置私有变量；非设置档案未定义这些变量时，保留原 fallback 值。
- 不修改其他档案布局、通用 Dialog、手机导航、固定行动区或滚动逻辑。

### `src/ui/settings/prompt-manager.css`

- 去掉仍可操作的 `.pm-row.off` 整行淡化，以及分类数量的额外 opacity；“不注入/未选用”状态文字和虚线仍保留。
- “常驻”和资源标题 hover 使用现有更深的金色 `--gold-hi`。
- 原 `:disabled` 的 opacity、业务资格和控件 disabled 属性保留。

## 修复前后实测

以下使用同一个公开合成夹具、真实 React App 和 Chromium。颜色、字号、字重、完整祖先链与透明度来自 computed style；透明背景按 sRGB 合成。原始明细见 [成对数据](settings-readability-hotfix/contrast-comparison.json)。不是从设计稿猜颜色。

|样本|修前|修后|
|---|---:|---:|
|PC首页：叙事人称|1.10|5.21|
|PC游戏内：叙事人称|5.21|5.21|
|手机首页：NoControl（防抢话）|1.23|5.83|
|PC记忆：即时记忆完整回合数|1.23|5.83|
|AI说明：写剧情，最需要好模型|3.41|5.83|
|AI标签：接口格式|3.41|5.83|
|PC提示说明：设置本身不会发起生成请求。|1.38|5.89|
|PC保存成功：本地偏好已保存，将用于下一次正文请求；|1.57|4.85|
|PC错误反馈：请输入有效的正整数：正文最多 100000 字、|2.07|4.87|
|提示词状态：常驻|3.56|5.32|
|手机未注入资源：世界与现实底座|3.85|10.97|
|PC确认标题：删除「隔离审查渠道」？|1.28|15.38|
|PC确认取消：取消|1.28|15.37|
|手机确认标题：删除「隔离审查渠道」？|1.03|14.26|

共记录 4590 次文字观察和 588 次控件观察（含跨页面/状态重复，**不是测试条数或唯一元素数**）。正常文字计算最低 4.77:1，必要控件最低 3.56:1；符合标准的大字、无文本方向图标按3:1。检查包含 enabled/disabled、焦点、hover、开关开/关、保存成功、校验错误、Mock模型列表成功/失败、资源原文及真实离线预览。

### 纸纹与实际背景

- PC纸页有噪声纹理，不能把背景声明值当作每个实际像素。
- 同坐标区域在原始 PNG 中取背景众数复核：PC字段标签由约 **1.07** 提高到 **5.06**；输入值背景仍为 `#F8F4EA`、比例 **13.49**。
- 手机纸面无该噪声图，开关标签由 **1.23** 提高到 **5.83**。
- [修前像素数据](settings-readability-hotfix/pixels-before.json) / [修后像素数据](settings-readability-hotfix/pixels-after.json) 包含盒坐标、像素计数和RGB。这里是典型样本验证，不声称完成全站逐像素 WCAG 认证；字形抗锯齿边缘不用于替代正文颜色。

## 正式工程结果

Node **v24.19.0**，Chromium **154.0.8037.57**。

|命令/批次|退出码|真实结果|
|---|---:|---|
|`npm ci`|0|按原锁文件安装；未变更依赖或锁文件|
|最终 `npm run check`（`check-release.log`）|0|Lint 0警告；153个Vitest文件、**3841通过、0失败、0跳过**；正式TypeScript、命令目录检查及Vite生产构建通过|
|`npm run prompts:check`|0|3个文件、**93通过、0失败、0跳过**；没有修改提示词或元数据|
|`git diff --check`|0|代码及文档差异检查通过|
|新增 `e2e/settings-readability.spec.ts`|0|desktop/mobile单批 **14通过、0失败、0跳过**|
|干净main同一新增测试的4项反例|1|**0通过、4失败**；缺陷在未改生产源码上可复现，未删除原断言|
|既有PC路由/四开关，明确90秒整例预算，HEAD|0|**2通过、0失败、0跳过**|
|同样PC90秒预算，干净main|0|**2通过、0失败、0跳过**；四开关耗时HEAD42.8s/main42.7s|

构建保留原有大于500kB chunk提示，退出码0，未借机重构打包。Mock只能证明界面、存储与执行边界，不代表真实服务商生成质量。

### 必须保留的失败与对照

1. 最初受限沙盒的 `npm run check`：152个文件通过、1个文件收集失败，**3822条测试通过**。失败是 `announcement-publish.test.ts:101` 的 `spawnSync sh EPERM`，不是断言失败。干净main单文件同环境同样收集失败。保留测试不变，在可执行本地子进程的环境重跑，最终153文件/3841条全部通过；该公告用例使用假wrangler和临时本地Git，不访问真实Cloudflare。
2. 旧4项设置回归的原30秒预算：初批HEAD1通过/3失败；单进程HEAD1通过/3失败，main2通过/2失败。PC路由和长四开关受整例30秒预算影响；同断言、同单进程、显式90秒后，两边各2/2通过，没有修改旧测试或增加 retries。
3. **旧手机四开关用例仍失败**：`e2e/prompt-inspector.spec.ts:491` 从管理页直接找隐藏的“提示词”分类，未先返回手机分类菜单。HEAD与main都复现。此PR不重写旧导航测试，未 skip 或删除它；新增手机场景使用真实“返回设置”交互。
4. **已知PC嵌套 Esc 问题未修复**：只读采集仍重现确认框与外层设置一起关闭；主干和本分支各首页/游戏内两入口均有记录。这不混入CSS整改，新增确认场景通过真实“取消”按钮返回，并核对正式状态。
5. 新测试开发中的失败分别保留：初始标签复现、选择器/动画采样修正、控件边界与 hover 遗漏。没有删除业务断言。模型列表按钮第一次是“获取模型”，获取后是“重新获取模型”；离线预览被拆成独立场景避免挤在AI多页例程末尾超时。最终成绩只指最终单批14项。

6. **旧手机菜单回焦用例也在main复现**：`e2e/mobile-main-batch1.spec.ts:132`，HEAD与main各0通过/1失败。设置可打开、五类入口可见、Esc可关闭，但焦点没有回到菜单按钮。两边同一断言失败，本PR不改焦点代码。该旧用例在焦点断言后面的存档比较没有执行，不能宣称它整例通过；新增14项里的正式状态与草稿比较已实际执行。详情见 `mobile-menu-chromium.log` / `mobile-menu-main-chromium.log` 与 [逐批记录](settings-readability-hotfix/validation-results.json)。

## 截图与布局保护

所有图片来自实际 App，而非静态设计页。PC 1440×900；手机412×839，Pixel7 DPR2.625，因此PNG物理像素大于CSS视口。900/901为900px高，鼠标/触摸两项目均执行边界用例。截图对应代码提交 `eb785d38c3cb309bdc0e102e14c6c277166769f3`；首页背后的城市可能随原有7秒轮换而不同，比较对象是设置内容。

|页面|修前|修后|
|---|---|---|
|PC 首页／提示词|[修前](settings-readability-hotfix/before-pc-home-prompts.png)|[修后](settings-readability-hotfix/after-pc-home-prompts.png)|
|PC 游戏内／提示词|[修前](settings-readability-hotfix/before-pc-game-prompts.png)|[修后](settings-readability-hotfix/after-pc-game-prompts.png)|
|手机／提示词与开关|[修前](settings-readability-hotfix/before-mobile-home-prompts.png)|[修后](settings-readability-hotfix/after-mobile-home-prompts.png)|
|PC／记忆|[修前](settings-readability-hotfix/before-pc-home-memory.png)|[修后](settings-readability-hotfix/after-pc-home-memory.png)|
|手机／记忆|[修前](settings-readability-hotfix/before-mobile-home-memory.png)|[修后](settings-readability-hotfix/after-mobile-home-memory.png)|
|PC／AI 高级|[修前](settings-readability-hotfix/before-pc-home-ai-advanced.png)|[修后](settings-readability-hotfix/after-pc-home-ai-advanced.png)|
|PC／提示词管理|[修前](settings-readability-hotfix/before-pc-home-manager.png)|[修后](settings-readability-hotfix/after-pc-home-manager.png)|
|手机／提示词管理|[修前](settings-readability-hotfix/before-mobile-home-manager.png)|[修后](settings-readability-hotfix/after-mobile-home-manager.png)|
|PC／删除确认|[修前](settings-readability-hotfix/before-pc-home-nested-delete-confirm.png)|[修后](settings-readability-hotfix/after-pc-home-nested-delete-confirm.png)|
|手机／删除确认|[修前](settings-readability-hotfix/before-mobile-home-nested-delete-confirm.png)|[修后](settings-readability-hotfix/after-mobile-home-nested-delete-confirm.png)|
|900px 边界|[修前](settings-readability-hotfix/before-boundary-900.png)|[修后](settings-readability-hotfix/after-boundary-900.png)|
|901px 边界|[修前](settings-readability-hotfix/before-boundary-901.png)|[修后](settings-readability-hotfix/after-boundary-901.png)|

正式测试真实点击输入、选择、保存、取消和模型列表按钮；校验无横向溢出、键盘 focus-visible 存在，必需按钮可点击。样式未增加高度、定位、overflow或外层滚动容器。保存前后全部正式状态/草稿严格比较一致。除隔离测试的本地设置外，不写玩家数据；新增场景模型POST为0，模型列表GET全部Mock。嵌套确认取消未删除渠道。

其他页面：全局 `label`、普通游戏暗色主题、首页、创角和其他原生弹窗均未修改；新变量只定义在设置根节点，普通档案继续使用原fallback。PromptInspector实际只由SettingsPanel加载。没有改任何JS/TS生产逻辑。

## 逐批 Chromium 原始记录

不把不同批次的通过数相加成一次全绿。完整日志见本目录证据包 `settings-readability-hotfix/validation-logs.tar.gz`，完整计数见JSON。中断或未运行也保留：

|日志|退出码|通过|失败|跳过|中断|未运行|
|---|---:|---:|---:|---:|---:|---:|
|`acceptance-chromium.log`|130|4|2|0|2|4|
|`existing-chromium.log`|1|1|3|0|0|0|
|`existing-desktop-budget.log`|0|2|0|0|0|0|
|`existing-main-chromium.log`|1|2|2|0|0|0|
|`existing-main-desktop-budget.log`|0|2|0|0|0|0|
|`existing-stable-chromium.log`|1|1|3|0|0|0|
|`final-chromium.log`|1|4|8|0|0|0|
|`hover-chromium.log`|1|2|2|0|0|0|
|`initial-chromium.log`|1|5|7|0|0|0|
|`main-chromium-control.log`|130|0|2|0|0|2|
|`main-verified-chromium.log`|1|0|4|0|0|0|
|`mobile-menu-chromium.log`|1|0|1|0|0|0|
|`mobile-menu-main-chromium.log`|1|0|1|0|0|0|
|`preview-chromium.log`|1|1|1|0|0|0|
|`red.log`|1|0|1|0|0|0|
|`release-chromium.log`|0|14|0|0|0|0|
|`second-chromium.log`|1|8|4|0|0|0|
|`verified-chromium.log`|1|9|3|0|0|0|

## 交付与剩余边界

- 独立分支 `fix/settings-paper-readability`，Draft PR，等待十一代目和Codex复审。
- 本地构建通过。Cloudflare Workers Build 以交付时GitHub最新HEAD检查为准，具体结果在PR说明与交付回复中记录；不以本地build冒充远端Workers结果。
- 不合并、不手动部署、不发布版本、不改Beta标签；没有额外收费请求。
- 未做真实手机硬件/Safari全平台认证；保留已有Esc和旧测试兼容问题，均有main对照，不宣称消灭全部历史交互缺陷。
