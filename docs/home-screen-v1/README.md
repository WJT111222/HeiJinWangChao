# 新版开局界面：封面与存档馆

## 基线和范围

从远端 `main@49ea8695c5df17fee07549ed27edd34ab95ea200` 创建独立分支 `feat/home-cover-library`。交付前重新 fetch，main 未变化。没有合并、依赖、修改或关闭 Draft PR #105；游戏内维持该 main 的 UI-1.1。

验收来源为玩家提供的两份附件，均已完整阅读：

| 文件 | SHA-256 |
| --- | --- |
| HOME_SCREEN_HANDOFF.md | `55a97d7891f995c4b31d26303e3bca07c319ee903078c128753398501ea250c9` |
| heijin-home.html | `185226d5274c3c52bfab5ff0e02780a534b5ef92ae921ce68c947ecf9a175e30` |

只改变首页展示与存档卡：没有修改 GameState、IndexedDB 版本、存档 Repository、导出删除逻辑、创角流程、游戏 UI、AI、Prompt 或阶段事务。公告与免责声明使用原组件和原文案。没有迁移、导入或修改玩家真实存档。

## 实现与文件

- `src/ui/home/HomeScreen.tsx`：封面/存档馆双视图，本地组件状态切换，不新增路由。真实创建、继续、设置、公告、免责声明与刷新入口由 App 原回调提供。
- `src/ui/home/skyline.ts`：复用设计稿 SKY、towers、river、clear 几何；固定种子 cq=7、sh=31、hrb=53、gz=97。城市名、英文、纬度、意象、颜色保持设计稿。
- `src/ui/home/home.css`：设计稿的字体栈、深色/金色、按钮、档案、天空、河面、光晕与响应式布局；作用域仅首页。清除老首页样式对新容器的继承干扰，没有改全局 styles.css。
- `src/app/App.tsx`：首页旧双栏替换为 HomeScreen，首页顶栏由新组件呈现；创角和游戏保持原 header。选中存档与设置、原 repository.list/open/delete 处理保留。
- `src/ui/SaveCard.tsx`：档案页签、城市缩略图、选中金色回形针，保留原始导出实现、实际存储主键、错误信息和按钮回调。选中后不显示多余的“选择”按钮。
- `src/tests/homeSkyline.test.ts`：固定几何、严格标题后缀映射、特效与元信息三个测试。
- `e2e/home-cover.spec.ts`、`e2e/helpers/home.ts`：双视图、城市计时、焦点、入口、截图；其余三个 E2E 文件只适配新视图/选择器与转场等待，保留原有业务断言。

## 设计与交互核对

| 设计要求 | 实现与核对 |
| --- | --- |
| 封面与存档馆双视图 | 两个固定容器交叉淡入，封面轻微缩放、存档馆上移；非当前视图 hidden + inert，不可点击/键盘误入。 |
| 四城轮换 | 7 秒循环；手动切换重新计时；1.6 秒天际线淡入，450ms 元信息换字；进入存档馆停止自动轮换，返回恢复。 |
| 城市特效 | 重庆轻轨、哈尔滨雪、各城窗灯与河面反光直接复用设计稿确定性 SVG；切换只改容器状态，不替换 SVG 导致淡入失效。 |
| reduced-motion | 固定重庆、停止轮换，所有首页动画/转场禁用，不显示列车/雪；其他城市按钮禁用。 |
| 继续游戏 | 真实已选存档标题与保存日期；无可继续存档或读取中 disabled；使用原 openSave。 |
| 草稿与创建 | 原创角草稿提示；开始新游戏与首张新人生卡使用原创建入口，不生成模拟存档、不调用 AI。 |
| 存档城市 | 仅识别标题末尾“· 城市名”；无法识别则中性灰、不显示城市名。这是人生起点装饰，不读取/猜测当前位置。 |
| 存档馆状态 | 新人生卡永远首位；加载原文+三骨架，原空态、错误、刷新与状态反馈；坏档保留 ID、说明、导出及确认删除。 |
| 手机布局 | 390×844 单列、全宽按钮；封面内容可滚动，顶部与底部城市导航固定；存档馆主区域独立滚动。 |
| 焦点 | 切换时聚焦目标视图第一个可见且启用的按钮；Esc 回封面，原生 dialog 打开时不抢其 Esc；装饰 SVG aria-hidden。 |
| 演示功能 | 没有设计稿控制、演示 Toast、模拟产品存档或新增外部网络资源。E2E 存档均为本地合成测试数据。 |

## 与 HTML 的实际比较和截图

同一 Chromium、同一字体环境，对原 HTML 和实际 React 分别截图。为了可重复比较，设置 reduced-motion、空存档、无草稿，隐藏原型的设计控制与演示草稿提示；附件本身未改动。测试样式与产品组件未为对照做特殊开关。

四视口均测量 `.hero`、`.title`、`.actions`、`.skyline`、`.topbar` 的 x/y/width/height；保留 `<2px` 断言，实际全部差值为 **0px**，详见 [comparison.json](comparison.json)。这只证明这些矩形在本环境相同，不声称跨系统逐像素一致。标题/字体栈、按钮、城市色彩、天际线几何另由代码与图片核对，动画行为由 Mock 浏览器时钟核对。

| 视口 | 原 HTML | 实际 React 封面 | 实际存档馆空态 |
| --- | --- | --- | --- |
| 1440×900 | [原型](screenshots/reference-1440.png) | [封面](screenshots/react-1440.png) | [存档馆](screenshots/library-1440.png) |
| 1280×800 | [原型](screenshots/reference-1280.png) | [封面](screenshots/react-1280.png) | [存档馆](screenshots/library-1280.png) |
| 1024×768 | [原型](screenshots/reference-1024.png) | [封面](screenshots/react-1024.png) | [存档馆](screenshots/library-1024.png) |
| 390×844 | [原型](screenshots/reference-390.png) | [封面](screenshots/react-390.png) | [存档馆](screenshots/library-390.png) |

实际存档档案：[桌面五存档](screenshots/library-populated-desktop.png)、[手机五存档](screenshots/library-populated-mobile.png)、[桌面无法读取](screenshots/library-unreadable-desktop.png)、[手机无法读取](screenshots/library-unreadable-mobile.png)。

非 reduced-motion 的四城正式 React 页面：[重庆](screenshots/city-cq.png)、[上海](screenshots/city-sh.png)、[哈尔滨](screenshots/city-hrb.png)、[广州](screenshots/city-gz.png)。截图只显示某个动画帧，不能单凭静态图证明动画性能。

## 实际验证记录

环境 Node.js **24.19.0**、npm **11.9.0**、`CHROMIUM_PATH=/usr/bin/chromium`。标准 `npm ci` 实际成功，安装 143 个依赖，不改 lockfile。所有 AI 测试使用本地 Mock，未调用真实收费服务。

各批次独立列出，**不相加当成一次全绿**。JSON 保留每条测试的项目、结果、耗时和失败原因；结果日志中的路径指测试工作区，不是玩家数据。归档工程日志仅规范行尾空白和末尾空行，不改执行内容与成绩。

| 批次 | 通过 | 失败 | 跳过 | 依据与说明 |
| --- | ---: | ---: | ---: | --- |
| 开发期首轮首页/坏档/公告 E2E | 34 | 12 | 0 | [记录](results/development-1.json)。旧首页定位器、新视图切换、固定假日期跨天导致须知再弹、移动端顶栏被 hero 挡住等。修复定位/时钟与实际层级问题，不改业务断言。 |
| 开发期六条复测 | 3 | 3 | 0 | [记录](results/development-2.json)。继续修正时钟与多视口截图用例超时预算。 |
| 首页/坏档/公告修正后整批 | 46 | 0 | 0 | [记录](results/home-notices.json)。覆盖原公告免打扰、手动查看、存储异常及坏档导出/删除/刷新。 |
| 首页/坏档/游戏窗口回归首轮 | 41 | 2 | 1 | [记录](results/game-selector-before.json)。两项均为旧 `.version` 选择器不覆盖新首页 `.ver`，保留 V1.0 断言，修正选择器。 |
| 首页/坏档/游戏窗口复测 | 43 | 0 | 1 | [记录](results/game-regression.json)。包含游戏内 UI-1.1 的输入、滚动、工作流、恢复回归；未改游戏生产代码。 |
| 最终双视图转场补齐后的首页回归 | 24 | 1 | 1 | [记录](results/transition-before.json)。一项在返回封面的缩放动画中量到 top=-8；添加等待 transform=none 后测量，原几何断言不变。 |
| 最终首页/坏档/视口整批复测 | 25 | 0 | 1 | [记录](results/delivery.json)。13 项桌面通过，12 项手机通过；手机跳过原有仅桌面极矮窗口用例。 |
| 独立四视口设计对照 | 1 | 0 | 0 | [记录](results/design-comparison.json)；一条用例内检查四视口。 |
| 独立四城实际画面 | 1 | 0 | 0 | [记录](results/cities.json)。 |

额外补拍坏档截图时只增加 `scrollIntoViewIfNeeded()`，将原位于手机折叠区域下方的坏卡滚入可视区域；不改变产品和业务断言。该两项桌面/手机用例最终 **2 通过、0 失败、0 跳过**，结果单列在 [截图复测](results/unreadable-screenshot.json)。

最终工程检查：

| 检查 | 实际结果 | 记录 |
| --- | --- | --- |
| npm ci | 成功 | [日志](results/npm-ci.log) |
| npm run check | Lint、118 文件 / **3064 测试通过、0 失败、0 跳过**，TypeScript、生产构建成功 | [日志](results/check.log) |
| npm run prompts:check | **93 通过、0 失败、0 跳过** | [日志](results/prompts.log) |
| 最终 E2E 等待调整后的 lint / typecheck | 均成功 | [Lint](results/lint.log)、[类型](results/typecheck.log) |
| git diff --check | 成功 | 提交前执行 |

此前开发快照也运行过 check（117 文件 /3061 通过），不当作最终成绩。完整 check 在最终产品源码冻结后执行；随后只有 E2E 等待/截图定位、报告和截图文件变化。构建存在 Vite 单 chunk 大于 500 kB 的非阻断提示，未为此扩大范围重构。

运行命令：

```sh
npm ci
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/home-cover.spec.ts e2e/unreadable-saves.spec.ts e2e/home-viewport.spec.ts \
  --project=desktop --project=mobile
# 上表另一独立批次还包含 e2e/game-window.spec.ts；公告批次包含原公告用例。
git diff --check
```

对照复现方法：在相同 Chromium 和本地字体上打开提供的 HTML 与 Vite React；禁用动态效果、将原型设为空且无草稿、去除演示控件，按上表尺寸测量五个选择器并截图。空态库截图使用最终 E2E 输出；图库已填充与坏档截图使用 fixture 直接写入独立测试浏览器 IndexedDB，经真实 App 读取，不是静态设计图。

## 自查与边界

- 对 `src/ui/game/`、`src/domain/`、`src/services/`、`src/prompts/`、`src/workflows/`、`prompts/`、`src/app/styles.css` 的 diff 为空；原有游戏 UI、存储实现、Schema、阶段协议不变。
- 测试生成的原 `docs/screenshots/compact-workflow/after-*` 图片已恢复，不以本次测试覆盖其他 UI 文档截图。
- 没有用 mock 证明真实模型生成质量；本任务没有增加模型请求。
- 字体使用附件字体回退栈，不新增在线字体/CDN；Windows/macOS 字体栅格化可能不同，未实测 Safari/Firefox。
- 存档标题后缀只是允许的过渡映射，不保证追踪真实当前位置；识别失败保持中性。
- 页面动画在 Chromium 做功能/截图验证，未做低端真机帧率或能耗测试。
- 原生设置/删除/公告弹窗沿用现有共享组件与文案，没有重新设计或改变存档操作。
- 独立 Draft PR，等待审查；不合并，不部署，不修改或关闭 #105。
