# 验证记录

环境：Node.js 24.19.0、npm 11.9.0、Chromium 154；[实际版本输出](validation/runtime.txt)。所有模型请求使用既有 Mock 或本批 `.mock.invalid` 路由，未调用真实付费模型。

## 必需工程检查

| 命令 | 实际成绩 | 日志 |
| --- | --- | --- |
| `npm ci --cache /tmp/ui2-npm-cache` | 通过，143 packages | [npm-ci.log](validation/npm-ci.log) |
| `npm run check` | lint、127 测试文件／3202 单元测试、TypeScript 与生产构建全部通过 | [check.log](validation/check.log) |
| `npm run prompts:check` | 3 文件／93 测试通过 | [prompts-check.log](validation/prompts-check.log) |
| `npm run lint`（补充 E2E 断言后） | 通过，零警告 | [lint-final.log](validation/lint-final.log) |

生产构建保留 Vite 的 `>500 kB` chunk 建议警告，构建成功。未以更改拆包策略扩大本批范围。

## Chromium

完整回归 15 套、216 个桌面／手机用例：**210 通过、6 个桌面专用手机平台跳过、0 失败**；最终统计及按文件成绩见 [chromium-summary.json](validation/chromium-summary.json)，完整 [日志](validation/chromium-final.log)／[JSON](validation/chromium-final.json)。未启用自动重试，没有删除、放宽或新增跳过业务断言。手机平台跳过的是桌面布局／压力用例，保留仓库原条件；本批新增桌面地点压力用例同样明确限定桌面。

最终测试集：

```
e2e/archive-final.spec.ts
e2e/archive-step2.spec.ts
e2e/archive-step3.spec.ts
e2e/archive-step4.spec.ts
e2e/desktop-cabinet.spec.ts
e2e/startup-notices.spec.ts
e2e/ai-settings.spec.ts
e2e/ai-route-persistence.spec.ts
e2e/ai-model-selection.spec.ts
e2e/model-list-compat.spec.ts
e2e/model-list-hardening.spec.ts
e2e/memory-summary-v2.spec.ts
e2e/prompt-inspector.spec.ts
e2e/game-window.spec.ts
e2e/workflow-feedback.spec.ts
```

实际启动配置见 [playwright-run-config.txt](validation/playwright-run-config.txt)。在干净环境可使用仓库默认配置复现：

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- <上述文件列表> --reporter=list,json
```

本次为避开其他工作树旧服务，使用 5195 严格端口；main 对照使用 5196。最终执行期间 src／e2e 哈希冻结验证见 [source-freeze.json](validation/source-freeze.json)。

完整回归后仅将新增本地脏状态提示限定在提示词／运行，避免在 AI／记忆分类叠出第二条底栏；原本地编辑值、导航脏状态点和显式保存语义不变。追加三套相关双端回归 **43 通过、1 个桌面专用手机跳过、0 失败**，覆盖该显示条件、未保存输入与所有保存按钮，成绩见 [guard-summary.json](validation/guard-summary.json)，[日志](validation/chromium-guard.log)／[JSON](validation/chromium-guard.json)。两轮逐阶段哈希记录见 source-freeze，未用追加执行重复计算独立用例数量。

### 覆盖重点

- 地图：多个正式根、海外／跨城旧地点、五级链、空根、当前位置、真实详情、树／示意／面包屑／子级同步；关联 NPC 和事件精确定位；返回恢复选择；50／20 初始分段、250 新地点及超长名称；reduced-motion。
- 设置：五类和既有入口、四条模型路由及跟随恢复、三协议模型列表、Token 档位与自定义、兼容开关、保存／错误／取消／删除、旧配置、会话与持久凭证、Mock 测试连接；记忆维护与失败恢复；提示词原文、排序、离线预览及诊断。
- 容器：游戏非模态／首页与手机原生模态；dock 与人物入口切换；AI／记忆未保存确认；原生确认先处理 Esc；关闭回焦；模型选择器键盘行为；正文 inert 与数字／Ctrl／Command+Enter 隔离；长表单滚动。
- 移动：390×844 和 game-window 的 375×667、320×568、667×375；真实保存操作、重新加载、校验及模型 Mock 流程，非外观单测。
- 数据：本批纯阅读前后完整 Repository 状态与草稿相等；浏览设置前后 localStorage／sessionStorage SHA-256 一致；没有未知网络请求。明确设置保存不要求零配置写入，但仍要求游戏 Repository 不变。
- 视口：1920×1080、1440×900、1280×800、1100×800、901×800；文档、树、详情及设置滚动容器无横向溢出。

## main 对照

- 桌面原生地图和设置亦使用相同夹具拍摄了 1440／1100／901px 对照，独立 baseline 用例通过，未修改正式源码。[日志](validation/main-desktop.log)、[JSON](validation/main-desktop.json)、[截图脚本](validation/main-desktop-harness.txt)；1440×900 与新版同尺寸。

- 从同一 `73ad326…` 的未修改正式源码启动 baseline 工作树，仅添加本批测试 fixture／测试文件以注入相同合成数据。手机地图与五类设置的 2 个完整用例通过（包括明确保存、错误校验与重新加载）。[日志](validation/main-mobile.log)、[JSON](validation/main-mobile.json)。
- 七张手机截图与本分支像素相同；完整 SHA-256 和像素结论见 [mobile-comparison.json](validation/mobile-comparison.json)。包含地图、AI 连接、提示词、记忆、运行、提示词管理与 AI 总览。
- 既有 `startup-notices` 直接打开存档用例在未修改 main 也失败：最终期望 dialog 数量 0，实际有天气浮层 1 个。[原始失败日志](validation/main-notices-control.log)。没有把该既有失败称作本批业务错误或删除断言。

## 失败与修正

| 阶段 | 观察 | 处理及后续验证 |
| --- | --- | --- |
| 首次编辑 TypeScript | Dialog 编辑时残留旧清理片段导致语法错误 | 删除残片，完整 typecheck／check 通过 |
| 新 map 单元测试初次 | 3 个 test.each 输入被逐参数展开，测试构造错误 | 将每个地点数组作为单独 case 参数；7 个新测试及全部 3202 测试通过 |
| 新 E2E 初次启动 | Playwright 禁止在 describe 中修改 trace 选项 | 改为新文件顶层关闭 trace，避免凭证测试保留网络 trace；随后全套执行 |
| 首轮设置回归 | 86 项中 85 通过，公告场景关闭按钮被天气 top-layer 遮挡 | 提供 main 对照；非模态打开时正确聚焦设置；测试先聚焦关闭按钮并用 Enter 激活，避免公告关闭后异步 hover 的 top-layer 竞争，保留「零 dialog／Repository 相等／零模型请求」原断言 |
| 宽回归的既有导航用例 | 提示词管理六模式与排序已通过，但末尾在封面直接找存档馆按钮超时；未修改 main 的 PC／手机均复现 | 增加原 openLibrary 导航步骤，原排序、内部内容、NPC、正式状态断言全部保留；[main 对照](validation/main-inspector-control.log) |
| 跨尺寸二次确认补测 | PC→手机会把设置放到确认之上，反向转换后原生 CloseWatcher／焦点还可能落错层 | 保留同一表单 DOM，双向恢复上层模态顺序与焦点，统一原生模态 body 滚动锁；新增来回跨尺寸及 Esc／密码／滚动锁断言，修复后定向 4 项通过；随后重跑完整 216 项 |
| 补测断言修正 | 手机主设置本身为模态，关闭二次确认后 body 应继续 hidden；一次测试仍使用桌面空字符串预期 | 按正式手机／桌面语义分别断言，未放宽；后续双端通过 |
| 最终跨分类显示核验 | 未保存提示词偏好带到 AI／记忆时，新增全局本地状态栏可能与原保存栏重叠 | 将本地提示限定在原本地保存分类，保留未保存编辑值与导航脏状态点；追加三套相关双端回归，未触动保存控制器 |
| 视觉检查 | 旧手机 map-tree span 深色底纹覆盖新桌面树；空状态栏与 AI 保存栏叠放 | 仅在桌面地图作用域清除旧 span 样式；隐藏无内容本地状态栏，恢复完整底部保存操作，后续矩阵与回归通过 |
| 中间档案回归 | 63 通过、6 个平台跳过、1 失败：新添加的「设置后重开事件标题必然聚焦」断言与既有缓存行为不符 | 原链接首次进入仍断言精确标题聚焦；重新从 dock 打开按原行为断言档案容器聚焦且原目标完整可见，没有改事件领域逻辑；最终回归重新验证 |
| 既有测试迁移 | 前几批旧测试仍期望地图为原生 Dialog，或设置叠在旧资料之上 | 只调整获批的新非模态容器／切换行为预期，保留正式字段、精确 ID、读取前后状态、草稿、Mock 数量与首跳焦点断言 |
| HTML 截图脚本 | 同一页面只改 fragment 不重新执行设计稿初始化，两个截图最初相同 | 使用不同 query 发起完整页面加载；最终两张 HTML 截图独立验证，产品代码未改 |

初始设置日志见 [initial-settings.log](validation/initial-settings.log)，中间档案日志见 [intermediate-archive.log](validation/intermediate-archive.log)。修复末尾导航与跨尺寸问题前，216 项宽回归为 207 通过、6 平台跳过、3 个旧测试失败，保留 [日志](validation/broad-before-modal-fix.log)／[JSON](validation/broad-before-modal-fix.json)。最终结果以 chromium-final 为准，不把历史失败轮次计入最终通过数量。

## 安全与限制

新凭证测试使用运行时合成值，trace 关闭；截图为密码掩码，断言只比较布尔值。没有读取生产密钥、发送付费模型请求、修改公告、部署、缓存或路由。截图不是用户真实存档。

异常地点的兼容范围、字段差异及资产可见口径详见 [MAP_COMPATIBILITY.md](MAP_COMPATIBILITY.md)。本轮不放宽 main 原有的非法地点图校验，也没有向正式存档写入展示缓存。
