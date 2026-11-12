# 桌面档案柜第二批施工报告

基线：重新 fetch 后的 `origin/main`，`4fba364b91e0ac5c0d309f43c4c7506c705addd5`（已合并 PR #110）。独立分支：`codex/desktop-profile-organizations`。日期：2026-11-12。最终 HEAD 以 Draft PR 的提交为准。

## 范围与依据

本批只迁移 PC ≥901px 的人物档案与势力组织，复用 #110 的非模态暖纸色 ArchivePanel。用户 ZIP 中的 HTML、交接文档及参考截图已读取；第二节为本批视觉依据，第三至第六节不施工。现行 main 决定业务语义：经济入口继续打开完整旧面板，不采用旧交接稿中的占位建议，也不恢复主动 Roll。

原始 [HTML](../desktop-npc-cabinet/design/heijin-panels.html)、[交接文档](../desktop-npc-cabinet/design/PANELS_HANDOFF.md) 已在 #110 随设计原件归档；本批附 [s2-profile](design/s2-profile.png)、[s2-org](design/s2-org.png) 与 [完整包文件 SHA-256](design/manifest.json)。这些设计文件不作为新增业务功能的指令来源。

## 实施结果

### 人物档案

- 使用「档」印章、`PROTAGONIST · 主角档案` eyebrow、「主角 · 姓名」副标题；身份卡包含证件照字印、姓名、年龄、性别、职业、真实城市文本、正式回合数及原有三个入口。
- 装饰「主角」圆章明确 `aria-hidden`，≤1199px 隐藏。中等桌面合并为单栏，正式字段完整显示。
- 原 profile-details 的 16 个字段分布于基本资料、此时此地及四张状态卡；标签与原有值/降级文案不变。候选时间仅在原 `openingTimeSelection()` 确实产生结果时显示，保留「（未正式结算）」；普通回合没有候选时显示其余 15 项。手机仍保留旧版字段布局。
- 复用原 `ProfessionProfile`，保留 `aria-label="职业档案"`、职业介绍、技能、长期影响。七个穿戴/装备槽位继续使用 GameScreen 原有投影，空值「无」不变。
- 身体、情绪、社会状态、法律状态完整换行，没有 clamp 或隐藏溢出。装备长名称也可完整换行。
- 「经济与资产」打开完整旧 Dialog，「NPC 人物资料」切到 NPC 档案柜，「切换存档」继续调用原 onSaves。左栏入口获得当前态。

### 势力组织

- 名录和详情各自滚动；搜索、类别计数、20 条分页、data-org-id、选择态、全部关联入口保留。四种类型色仅映射已有 kind，不新增类别或正式字段。
- 按确认 HTML 展示类型色徽章、名称、与主角速览、六个分节导航及七个资料部分。组织概况超过 500 字时继续使用原 260 字预览与全文折叠逻辑。
- 各类型当前状况沿用原字段过滤和 money()；管理层、关键人物、组织关系、文字业务关系、事件、任务、已结束事件、关系历史、完整 WorldRecord 均保留。
- publicName 为 null 仍显示「未知」，不以 npcId 查出真实姓名。原先满足 npcId、公开姓名和链接条件的人物按钮继续跳转；没有公开姓名时不增加泄露身份的新入口。
- 原有事件/任务超过 20 条仍走 RecordList。桌面关系历史超过 20 条也使用 RecordList，保留全文检索、分页及原始文字；不解析或补写日期，不改变现有时间精度。手机历史呈现不改。
- 技术记录默认折叠，仍传递完整正式组织对象给原 WorldRecord，未裁剪字段。
- NPC 与组织头部使用实心 `#E4DCCA` 纸色；普通头部吸顶，异常长头部超过详情可用高度 40% 后随内容滚动，避免遮住整块资料或无法到达底部。

### 公共交互与最小接入修改

- 人物档案、NPC、势力组织共用同一 ArchivePanel；`role="dialog"`、`aria-modal="false"`、标题关联与关闭按钮名称保留，不调用 showModal，不设焦点陷阱。其他面板继续使用原生 Dialog。
- 游戏正文与行动台在柜体打开期间 inert；柜体或外部 dock 上的按键不会误触数字行动或 Ctrl/Command+Enter 发送。顶栏、左栏、右侧 dock 可操作。
- 关闭、再次点击当前入口、Esc 后回到对应入口。关联跳转时保留子页已进入的目标标题焦点，不由外框抢走。切至旧 Dialog 后由原生模态接管焦点和 Esc。
- 最近明确选择的 NPC/组织 ID 仅保存在 GameScreen 本地 ref，离开面板再回来可以恢复目标；没有写入 Repository，也没有新增存档字段。刷新仍按原主界面初始状态打开。
- 天气详情原本只识别原生 Dialog。人物页迁移后，原天气 E2E 发现键盘打开柜体时悬浮层不收起；对照 main 通过，确认是本批集成回归。最小修复仅让 SceneDetails 两处现有焦点/Esc 判断也识别 `.archive`；天气文本、天气系统、样式和时间规则均未改。

## 设计与真实 React 截图

[可点击的 HTML/React 对照页](comparison.html) · [完整对照图](screenshots/comparison.png)

| 内容 | 截图 |
|---|---|
| 人物页宽度矩阵 | [1440×900](screenshots/profile-1440.png)、[1280×800](screenshots/profile-1280.png)、[1920×1080](screenshots/profile-1920.png)、[1100×800](screenshots/profile-1100.png) |
| 人物页底部/七槽与职业 | [装备及职业档案](screenshots/profile-equipment-1440.png) |
| 待确认开局及真实候选时间 | [候选时间](screenshots/profile-candidate.png) |
| 组织页宽度矩阵 | [1440×900](screenshots/organization-1440.png)、[1280×800](screenshots/organization-1280.png)、[1920×1080](screenshots/organization-1920.png)、[1100×800](screenshots/organization-1100.png) |
| 组织当前状况与管理层 | [详情](screenshots/organization-details-1440.png) |
| NPC ⇄ 组织 | [NPC 入口](screenshots/npc-to-organization.png)、[组织目标](screenshots/organization-from-npc.png) |
| 长文本与大量数据 | [1440](screenshots/organization-stress-1440.png)、[1280](screenshots/organization-stress-1280.png)、[1100](screenshots/organization-stress-1100.png)、[四张长状态卡](screenshots/profile-long-1100.png) |
| 手机原界面 | [人物](screenshots/profile-mobile.png)、[组织](screenshots/organization-mobile.png) |
| 确认 HTML 的实际浏览器渲染 | [人物](screenshots/design-profile-1440.png)、[组织](screenshots/design-organization-1440.png) |

React 截图来自隔离 IndexedDB 中的正式 GameState 投影，不使用 HTML 演示人物或产品硬编码数据。普通组织夹具属于开局身份中性的旧档，因此部分固定城市装饰留空；正式创角的重庆开局候选截图显示已持久化城市身份。资料内当前地点读取实际 locationId，不决定天际线或城市视觉主题。独立截图停止有限入场动画，避免把淡入过渡误当作透明纸面。

对照结果：纸色/卡片色/朱砂、身份卡比例、两栏与中屏单栏、类型色与徽章、目录选择标记、分节导航、独立滚动和按钮排列沿用 HTML。真实长概况、额外正式字段、业务降级文案及原始历史使内容高度不同于演示稿，完整数据优先保留。

## 验证环境及命令

Node.js `v24.19.0`，Chromium `154.0.8037.57`，仓库现有 Desktop Chrome 与 Pixel 7 项目。新增手机截图明确使用 390×844 CSS 视口。其他任务占用默认端口，实际使用独立 5185，配置记录于 [playwright-config-used.txt](validation/playwright-config-used.txt)。

```sh
npm ci --cache /tmp/ui2-npm-cache
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/archive-step2.spec.ts e2e/desktop-cabinet.spec.ts \
  e2e/npc-directory.spec.ts e2e/npc-final-acceptance.spec.ts \
  e2e/organization-archive.spec.ts e2e/game-window.spec.ts \
  e2e/city-night-followups.spec.ts e2e/character-creation-v2.spec.ts
```

所有模型请求 Mock；新增只读用例直接拦截外部 HTTPS，并检查零请求、零 pageerror、浏览前后完整 Repository state/draft 一致。连续三阶段、星标并发与撤回由既有 Mock 用例验证，不访问真实付费模型。

| 检查 | 最终成绩 |
|---|---|
| npm ci | 成功，143 包；package/lockfile 未改变 |
| npm run check | ESLint、124 文件 / 3152 项测试、TypeScript、Vite 生产构建通过 |
| npm run prompts:check | 3 文件 / 93 项通过 |
| Chromium PC/手机扩展回归 | 76 项：70 通过、6 项按对应设备范围跳过，0 失败 |

另在未修改 main 上运行相同的手机人物/组织用例，2 项通过；同一夹具、视口及 Chromium 下，两张手机页面截图与本分支逐像素一致，见 [像素对照](validation/mobile-visual-parity.json)、[main 人物](screenshots/main-profile-mobile.png)、[main 组织](screenshots/main-organization-mobile.png) 与 [基线视觉用例日志](validation/baseline-mobile-visual.txt)。

六项跳过均为既有或新增的设备限定用例：桌面压力布局不在手机运行、桌面 hover/资金压力不在手机运行、触控专属用例不在桌面运行；没有跳过失败来获得成绩。原业务断言未删除：两份旧测试仅调整已迁移容器类型与滚动区域选择器。

覆盖人物 16 字段及可选候选时间、职业四项、七槽/空值、三个入口、四种组织类型、空名录、类别/搜索/分页、长概况展开、49 组织、多名管理层、46 事件和当前任务、45 条原始关系历史及精度、NPC/组织/事件目标定位、旧经济 Dialog、焦点/Esc/dock/快捷键隔离、不透明头部、reduced-motion、手机原界面，以及既有千人 NPC / 300 回合、星标 CAS/失败回滚、Mock 正常结算与撤回、天气详情及创角职业档案等。

原始日志：[ci](validation/npm-ci.txt)、[check](validation/check.txt)、[prompts](validation/prompts-check.txt)、[Chromium](validation/chromium.txt)、[完整 JSON](validation/chromium.json)。截图尺寸和 SHA-256 见 [screenshots.json](validation/screenshots.json)。

## main 对照及失败说明

1. 开发阶段的新增测试夹具曾使用不符合正式创角校验的「男」而非「男性」，已修正夹具；字段提取器也改为支持带属性的 dd。测试滚动等待改为等待平滑滚动发生。没有放宽产品校验。
2. 扩展回归初次 76 项为 69 通过、6 跳过、1 个天气详情用例失败。未修改 main 的同一用例通过，确认是资料容器迁移的集成问题，已按上述两处选择器修复并完整复跑。原用例与断言保持原样。
3. 新增的手机焦点探针发现：旧原生 Dialog 内容切换后，焦点未必立即进入新内容/目标标题。将相同两个探针放入未修改 main `4fba364…`，均复现失败；没有更改 main 的 src 文件。此问题与本批手机结果一致，属于原有行为。本批严格不修改手机焦点机制。最终桌面测试要求直接交接到目标；手机测试保留原生 modal、原流程操作与 Esc，并验证事件页可通过 Tab 接续操作。

手机对照原始记录：[日志](validation/baseline-mobile.txt)、[JSON](validation/baseline-mobile.json)、[同一探针](validation/baseline-mobile-probe.spec.txt)。天气 main 对照：[日志](validation/baseline-weather.txt)、[JSON](validation/baseline-weather.json)。基线源码校验及命令见 [baseline-source.txt](validation/baseline-source.txt)。这些诊断探针的失败单独呈现，不计入最终通过的 76 项。

Vite 的主 bundle 大于 500kB 提示及 npm 更新提示仍为非失败提示，本批不扩大到打包优化。

## 数据安全、兼容性及交付

没有修改 GameState、IndexedDB、NPC/组织 Schema、Repository、AI Prompt、协议、原子结算、撤回或领域规则；不新增正式字段或存档迁移。固定开局城市、历史场景、星期、时间推进及天气数据实现保持原样。正式存档格式和兼容性不因本批改变。

查看和跨面板切换不写正式状态；NPC 星标仍仅明确点击才按原管理流程保存，既有锁、CAS 与原子回滚回归保留。经济、物品、世界事件、历史、记忆、地图、设置、创角、公告及手机资料没有迁移或重做。

完整修改清单见 [FILES.txt](FILES.txt)。产品修改限于档案柜框架、资料展示/选择回调、PC 左栏选中态、GameScreen 挂载与本地导航，以及为新容器补齐的悬浮层关闭判断。没有合并、部署或发布；Draft PR 等待九代目审查及用户视觉确认。
