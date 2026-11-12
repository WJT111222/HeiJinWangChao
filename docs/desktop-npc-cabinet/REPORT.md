# 桌面档案柜第一批施工报告

日期：2026-11-12。基线为重新 fetch 后的最新 `origin/main`：`4e0612f7c635172eb33bb80b7627405f17c13621`（PR #109）。开发分支：`codex/desktop-npc-cabinet`。最终提交 SHA 见 Draft PR 的 HEAD。

## 实施范围与设计依据

读取用户 ZIP 内的面板 HTML、完整交接文档及其他界面参考文件；保留原始面板设计于 [design/heijin-panels.html](design/heijin-panels.html) 与 [design/PANELS_HANDOFF.md](design/PANELS_HANDOFF.md)，参考文件的 SHA-256 见 [manifest.json](design/manifest.json)。

本批只落地第 1 步中的公共非模态容器及 NPC 页面。设计包第 2–6 步、演示控制器、演示数据及旧稿与 main 冲突的功能均不作为本批施工要求。其他资料面板继续使用现有原生 Dialog，手机仍使用原有资料界面。用户后续明确确认：保留既有星标操作，仅在明确点击时按原流程保存。

## 最终实现

- `ArchivePanel` 是可复用的标题、印章、序号、副标题、关闭及内容槽容器；内容与导航由调用方提供。使用 `section role="dialog" aria-modal="false"`，没有原生 `showModal()`、焦点陷阱或全页滚动锁。
- PC ≥901px，纸柜固定在顶栏下方、左栏与 dock 之间，覆盖正文与行动输入台。纸面、噪点、阴影、朱砂印章、功能色、选中标记、分节卡片和头像来自确认 HTML。动画在 reduced-motion 下停止。
- 打开焦点进入纸柜；再次点击 NPC dock、关闭按钮、Esc 均关闭。关闭后回到 NPC dock；切换到其他资料时让新容器接管焦点，避免从新弹窗抢焦点。Tab 可以移出纸柜到 dock。
- 纸柜打开时正文与输入台 `inert`，游戏快捷键不执行；顶栏、左栏与 dock 仍可操作。六个其他 dock 分类可直接切换到原有容器。
- NPC 名录保留搜索、特殊/普通筛选、20 人分页、历史身份记录、星标及反馈。列表与详情分别滚动，姓名完整换行，身份和关系的目录摘要按设计省略，完整内容仍在详情中。
- 详情保留全部正式字段、联系/常驻地点、关系网、任务、关联组织、私密资料的原有可见条件、创角原始设定、已知信息及记忆/来源。增加纯展示的速览、双向好感条及分节导航，空值继续显示原有降级文案。
- 普通详情头部吸顶；异常长姓名或描述使头部超过详情区高度 40% 时，头部随详情滚动，避免持续遮挡正文。文字不丢弃，导航仍可键盘到达。
- NPC → NPC、NPC → 组织 → NPC 的原有目标跳转与定位保留。组织等未改造面板继续使用原生模态 Dialog。

## 与确认 HTML 对照

| 项目 | HTML 标准与 React 结果 |
|---|---|
| 容器边界 | 固定 `top: var(--bar)`、`left: var(--left)`、`right: var(--dock)`、`bottom: 0`；顶栏、左栏和 dock 保持可见 |
| 档案纸 | `#E4DCCA`、7% SVG 噪点、`#EFE8D9` 卡片、深阴影、朱砂顶线与标题印章 |
| 字体与功能色 | 人名/标题衬线；墨色标题、金色选中与星标、蓝色信息、绿/赭好感、城市色在场状态 |
| 名录 | 搜索及筛选各占一行；圆形头像、特殊人物外环、左侧金条与渐隐选择态、星标 |
| 详情 | 头像/姓名/人物类型/真实速览/好感卡，分节导航，双列字段与长字段整行展示 |
| 大量数据 | 保留分页、RecordList 搜索与分页；双滚动区域，不把全部记忆一次堆入正文 |
| 真实数据差异 | React 截图使用 Repository 测试存档投影，人物、金额、时钟与天气不复制设计样例；额外正式字段全部保留 |
| 中等桌面 | 1100px 缩窄目录、头部重排、字段单列；不裁切字段或制造横向页面滚动 |
| 手机 | 不采用纸柜皮肤和桌面导航，继续旧式原生资料弹窗与返回行为 |

[HTML 1440×900](screenshots/design-1440.png) · [React 1440×900](screenshots/react-1440.png) · [React 1280×800](screenshots/react-1280.png) · [React 1100×800](screenshots/react-1100.png)

[未选人名录](screenshots/react-list.png) · [手机 390×844](screenshots/react-mobile.png)

[长姓名/128 人/1440](screenshots/stress-1440.png) · [1280](screenshots/stress-1280.png) · [1100](screenshots/stress-1100.png)

千人及完整关系/记忆页面另见 [千人名录](screenshots/thousand-roster.png)、[特殊人物详情](screenshots/special-detail.png)、[关系网](screenshots/relationships.png)、[长记忆](screenshots/long-memory.png)。这些均为真实 React 页面截图，不是 HTML 截图或合成稿。

## 验证环境与可复现命令

Node.js `v24.19.0`，Chromium `154.0.8037.57`（Linux），Playwright 运行仓库现有 Desktop Chrome/Pixel 7 项目。手机新增截图将 CSS 视口设为 390×844；原有手机压力回归还覆盖多个宽度及可用高度。

```sh
npm ci --cache /tmp/ui2-npm-cache
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/desktop-cabinet.spec.ts e2e/npc-directory.spec.ts \
  e2e/npc-final-acceptance.spec.ts e2e/organization-archive.spec.ts \
  e2e/game-window.spec.ts
```

环境中已有其他任务占用默认 5174 端口，实际执行使用相同配置和项目、单独 5183 端口，记录于 [playwright-config-used.txt](validation/playwright-config-used.txt)。JSON 和原始日志同时保留。所有模型请求只由既有 Mock 路由响应；新增只读用例拦截外部 HTTPS，并断言零请求。

## 测试成绩

| 检查 | 结果 |
|---|---|
| npm ci | 成功，安装 143 个包，未修改 lockfile |
| npm run check | ESLint、123 个测试文件/3142 项单元测试、TypeScript、Vite 生产构建通过 |
| npm run prompts:check | 3 个测试文件/93 项通过 |
| Chromium 相关双端回归 | 48 项：47 通过，1 项按计划跳过（手机不执行桌面专属布局用例） |
| 最终长头部修正复验 | 10 项：9 通过，1 项相同桌面专属跳过 |

新增单元测试逐项比较普通/特殊/其他 NPC 的桌面和移动端字段标签及值，并检查未成年人私密信息边界；新增浏览器测试验证焦点、关闭/Esc/切换、dock Tab 可达、正文 inert 与快捷键隔离、六个旧容器、关联目标、三档 PC 无横向溢出、长姓名、多页目录、独立滚动、reduced-motion、手机原样及浏览前后 Repository 完全相同。

保留并运行原有 NPC 回归：明确点击星标保存、保存中去重、跨标签过期冲突、请求中禁止管理、IndexedDB 原子回滚、人物消失后安全返回；1000 NPC/300 回合/分页与关系跳转；真实 React 连续四轮 Mock 创建/改名/离场/重逢；组织跳转及 Mock 结案/撤回；游戏阅读、输入、草稿、取消及失败恢复等双端回归。

开发过程中发现并修正了本批引入的问题：旧 SSR 测试依赖完整的名录行 class 字符串（改用 data-kind 保留原 class）、分节滚动偏移、人物消失时 ResizeObserver 的失效引用、星标点击区不足 44px。新增组织往返测试的初版夹具引用了未加载任务，改用完整合法的基础组织夹具。未删除或削弱既有断言，不把这些问题归因于 main。最终没有未解决的断言失败。另有一次共享测试服务器的重复复跑主动中止，最终完整及针对性成绩以附档为准。

Vite 提示现有主 bundle 超过 500kB，npm 提示版本更新，均非检查失败；本批没有为了消除提示扩大构建改造范围。

原始记录：[check](validation/check.txt)、[prompts](validation/prompts-check.txt)、[双端 E2E](validation/chromium.txt)、[双端 JSON](validation/chromium.json)、[最终复验](validation/final-focus.txt)、[最终复验 JSON](validation/final-focus.json)。

## 数据与兼容性

未修改 GameState、NPC Schema、IndexedDB、Repository、Prompt、Story/Variables/World 协议、领域规则或执行/结算/撤回流程。没有存档迁移或新持久化字段，也没有新版特有存档格式。固定开局城市身份、历史场景、日期星期及天气使用原有实现。

查看、搜索、筛选、选人、分页、滚动、分节与跳转只改变 React 本地 UI 状态；只读用例加载 Repository 完整状态并在结束时逐项比较，结果不变。星标仅明确点击后调用原 `management.change()`，并发、锁与原子保护均沿用 main；这项保留的写入是用户明确确认的例外。

未恢复主动重新 Roll；未调用真实付费模型；未合并、部署或发布。等待九代目审查及玩家视觉确认。

## 修改文件清单

完整清单见 [FILES.txt](FILES.txt)。产品代码限于 `ArchivePanel.tsx`、`archive.css`、`GameScreen.tsx` 与 `NpcPanel.tsx`；另有两份新增测试及本报告、设计原件、验证记录与截图。既有 E2E 自动重写的旧截图/指标不纳入本批改动。
