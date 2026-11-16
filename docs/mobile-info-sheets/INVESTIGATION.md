# 第一阶段：只读调查结论（修改源码前）

基线 main：8ab4cf0e44829275b7e0bdacd03eb429ae2b0dad。此阶段源码及测试未修改，使用仓库外 Playwright 探针与合成存档。

390×844、375×667 Chromium 触屏模拟均确认：底部“人物”与“世界资料”能打开；长人物状态原生上滑后 scrollTop 分别达到 235 / 229，底部正式资料入口可达；人物档案、经济资产、NPC 及全部七个世界分类可进入。未复现“点不开”或通用 CSS 把正文完全锁死。

已复现的交互缺口：

- 世界目录初始高度约347px，上拉横条后完全不变，没有可点击展开入口。
- 长人物状态一打开已触顶（390×844下高826px、顶部18px），仍无可控的展开/收起状态。
- 内容在顶部时向下滑150px，会直接关闭。属于阅读触摸与关闭手势共享同一内容区域的冲突。

源码对应：GameScreen 只为两入口传 mobileVariant="sheet"，没有可变高度状态；Dialog 的 sheetFull 是静态档位；useSheetGesture 把 pointer 位移限制为 Math.max(0,dy)，只处理下拉>110关闭，并在 modal-body 上绑定顶部下拉关闭。横条 aria-hidden 且没有键盘/点击展开操作。现有 CSS 的 modal-body flex/min-height/overflow 与 VisualViewport 合同已具备原生滚动，并非必须推翻。

最小方案：只给这两个入口启用可展开选项；复用原生 Dialog 的模态、Esc、遮罩、焦点与滚动锁。横条上拉展开；展开时下拉横条收起，已收起时下拉横条关闭；增加可点击且有 aria-expanded 的展开/收起按钮。该选项下内容区域只保留原生滚动，不再用正文下拉关闭。其他 sheet 手势保持原规则。保留同一正文 DOM，尺寸变化保存滚动位置/底部位置。

Viewport 和安全区沿用现有计算，仅为选中的两个弹层设置收起/展开高度。不能把浏览器工具栏问题认定为所有设备上的真实根因。

证据：before-results.json、before-人物-390.png、before-世界资料-390.png、before-toolbar-390.png，以及 before-390-trace.zip / before-375-trace.zip。完整探针在 before-probe.mjs。

WebKit 已按正常 Playwright 安装路径尝试，各下载入口均返回403 Domain forbidden，无可用 WebKit 可执行文件；没有iPhone真机。本轮不能宣称实际iOS Safari或WebKit通过。最初视频采集因缺ffmpeg未启动，后改为截图和trace，没有拿不存在的视频作证。

补记：最终保存的 before-results.json 中两种尺寸的 scrollTop 均为229；早期235是惯性滚动的较早采样，最终复核以 JSON 为准。
