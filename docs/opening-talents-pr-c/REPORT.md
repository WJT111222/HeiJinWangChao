# 八大开局天赋 V2：PR-C 双端选择与档案展示

本批交付第二步可选八卡单选、第五步复核、PC 实时档案、手机车票及正式游戏双端人物档案。所有名称和四段正式说明均读取 PR-A 唯一目录；没有第二份天赋文案、触发器、数值判定、AI 权限或公告改动。

## 叠加基线与范围

- 起点严格为已审查 PR-B #172 HEAD **`9de3351739aa0335ee4f1fe04d5b783167fa435b`**。
- 新分支 **`feat/opening-talents-ui`**；Draft PR 目标为 **`feat/opening-talents-ai`**，不是 main。
- 执行时远端 main 为 `f36bc51aede49e4ac6edf9a0bda2138905f007c7`；PR-A 仍为 `5dc8d448ed7c8a49c6002cb1ecddc19f897cfbec`。没有将其他分支合入本批。
- 完整沿用用户上传 V2 规范第 7 节的 PR-C 契约，以及本轮明确授权。原规范 SHA-256 为 `c37a83c363b3ec11f8b0b780a9374a051e8e84895e6dcdaf44d1f0f29f9a1beb`。
- [源码边界](evidence/source-boundary.json)：PR-A / PR-B 引入的 **59 个文件逐个与批准基线字节相同**。原目录、Schema、创角 model、开局包 model、三阶段政策/协议、AI 客户端、Repository、Commit/CAS/Undo、公告和依赖清单均未修改。
- 最终 HEAD 见 Draft PR 和交付消息；本报告随该提交保存。只推送新 PR-C 分支，不修改 PR-A、PR-B 或 main。

## 实现与修改文件

| 生产文件 | 变化 |
| --- | --- |
| `src/ui/creation/TalentPicker.tsx` | 原生 fieldset / radio：八项加“不选择天赋”，最多一个。完整能力介绍与长期影响默认可读；专属机制和能力边界用原生 details 展开。已选卡可明确取消，焦点回到“不选择天赋”。没有职业、性别或城市条件。 |
| `src/ui/components/TalentProfile.tsx` | 共用正式四段说明与只读档案；没有保存或编辑回调。缺少 ID 时返回空，不虚构默认值。 |
| `src/ui/components/talents.css` | 局部深色创角卡、暖纸档案卡、选中/焦点样式。PC 宽桌面双列，1199px 以下单列；全文自然换行，没有行数截断。触控操作至少 44px，不新增动画。 |
| `src/ui/creation/CreationWizard.tsx` | 第二步接入选择，第五步接入复核。只复制当前 Creation 草稿并设置/删除既有 `talentId`，继续走原 `onChange` 保存流程；其余字段不动。五步、校验、按钮条件及创建行为不变。 |
| `src/ui/creation/DesktopCreation.tsx` | PC 左侧实时档案显示已选名称、机制名和核心领域；无选择不显示该节。 |
| `src/ui/creation/MobileCreation.tsx` | 手机迷你车票摘要及完整车票显示选中名称，完整车票另显示机制名；没有选择时不添加假值。撕票逻辑未改。 |
| `src/ui/panels/ProfilePanel.tsx` | PC 正式档案读取 `hero.talentId`，展示完整资料。 |
| `src/ui/game/GameScreen.tsx` | 仅增加 import 和手机人物档案中的一行只读组件；工作流、导航回调、正式状态与运行逻辑未改。 |

测试与配置为 `src/tests/talent-ui.test.tsx`、`e2e/opening-talents-ui.spec.ts`、`playwright.talents.config.ts`，以及 `e2e/character-creation-v2.spec.ts` 的一处必要定位调整：职业数量仍断言原 **6/7**，只将范围限定在正式 `.profession-picker` 内，避免把新增的九个天赋选项误计为职业。没有删除、跳过或弱化职业、隐私、保存或请求断言。

完整逐文件清单见 [modified-files.txt](evidence/modified-files.txt)。隔离 Playwright 配置使用独占端口 5188，明确限定两个相关测试文件，避免另一个叠加工作树的服务影响结果。

## 行为与兼容证据

- **八项正式内容**：每张卡显示能力介绍及长期影响全文；展开后可读专属机制、机制名和能力边界。四段均来自 `talentDefinitions` / `getTalentDefinition()`，不是根据名称另写效果。界面 01–08 是装饰序号，不是等级。
- **可选单选**：默认“不选择”，不要求选择才能继续；选择、更换、取消、刷新后恢复均经实际 React 页面验证。键盘方向键切换原生 radio；取消按钮恢复合理焦点。手机逐一使用真实 `tap()` 选择八项、取消已选项。
- **草稿保留**：浏览器深比较选择前后 Creation，只有 `talentId` 不同。姓名、年龄、性别、职业说明、手动技能、背景、同伴、城市、进度及时间不因选择重置；清除时实际删除自有字段，不写 `null`、空串或 `none`。
- **开局包**：通过正式界面保存有天赋包、套用旧无天赋包、再套用有天赋包。沿用完整覆盖语义，旧包恢复无字段，新包恢复原 ID；没有新格式或版本。
- **正式建档**：实际点击第五步创建按钮、刷新、从 Repository 读取并核对 ID 与原职业/技能/背景/同伴。未配置 AI 时原自动开局安全停止；测试没有发出模型 POST。
- **旧角色**：无天赋建档与无字段档案不显示天赋卡，也不补选或推断。现有 V10、旧草稿/备份/开局包兼容与命令拒绝测试仍在全量检查中。
- **正式档案只读**：双端均从正式主角读取，卡内没有 input/select/textarea/button，没有写入回调；仅展开资料、滚动、关闭前后，真实 `exportRaw()` 五仓库内容完全相同。原三个档案入口保留，Esc 关闭行为不变。
- **三阶段边界**：本批不修改 PR-B 规则或 PR-A 白名单。AI 不能修改天赋，原子结算、幂等、撤回及非法命令测试保留。新界面没有新增模型请求、奖励或成功判定。

## 双端视觉与可访问性

新组件仅使用自己的类名和局部颜色变量，没有全局 `!important`，不改既有页面主题或高度规则。创角沿用原来的深色桌面/车票，即使本地选择日间外观也不另做创角日间主题；正式资料继续沿用暖纸档案，日夜主界面下均可读。

实际覆盖桌面 **901×500、1100×580、1440×900**，常规桌面项目 **1440×1000**；手机 **375×667、390×844、430×932、900×600** 以及 Pixel 7 默认模拟视口。检查内部滚动、最后一张长卡、展开全文、按钮实际在视口内、无横向溢出、reduced-motion、键盘焦点和触控。

对比度使用真实 computed 前景色，并沿祖先查找实际不透明卡片背景；测试明确拒绝半透明前景、未知渐变/混合、opacity 或 filter，避免用变量名猜测有效背景。新卡片背景本身为不透明实色。完整探针见 [contrast.json](evidence/contrast.json)。

| 正式人物档案（PC / 手机，日 / 夜相同） | 前景 / 实际背景 | 实测对比度 |
| --- | --- | ---: |
| 天赋名称与正文 | `#2B2723` / `#F4EFE3` | **12.91:1** |
| 字段标题、展开入口 | `#755613` / `#F4EFE3` | **5.91:1** |
| 只读标识 | `#5F574C` / `#F4EFE3` | **6.20:1** |

初次浏览器检查发现手机原 `.mobile-archive dt` 会盖过新组件颜色，字段标题只有 **3.63:1**；已只在天赋卡内提高选择器优先级。未调整其他档案或全局配色。截图还发现旧表单的 `flex-direction: column` 被新 label 继承，已在本组件显式恢复横向卡头；最终以元素实际几何关系和截图复核，未改职业列表。

## 真实 React 截图

图片来自正式 React App、真实 Chromium 和合成草稿/存档，未用静态 HTML 代替，也未修图。全部图片尺寸和 SHA-256 见 [screenshots.json](evidence/screenshots.json)。

| 场景 | PC | 手机 |
| --- | --- | --- |
| 第二步选择与正文介绍 | [PC](screenshots/desktop-selection-cyber.png) | [手机](screenshots/mobile-selection-cyber.png) |
| 第五步完整资料复核 | [PC](screenshots/desktop-confirmation.png) | [手机](screenshots/mobile-confirmation.png) |
| 第五步完整车票 | — | [手机车票](screenshots/mobile-confirmation-ticket.png) |
| 日间设置下的创角 | [PC](screenshots/desktop-creation-day.png) | [手机](screenshots/mobile-creation-day.png) |
| 夜间主界面下的正式档案 | [PC](screenshots/desktop-profile-night.png) | [手机](screenshots/mobile-profile-night.png) |
| 日间主界面下的正式档案 | [PC](screenshots/desktop-profile-day.png) | [手机](screenshots/mobile-profile-day.png) |
| 机制与边界全文 | [PC](screenshots/desktop-profile-day-boundary.png) | [手机](screenshots/mobile-profile-day-boundary.png) |
| 矮屏 / 边界 | [901×500](screenshots/desktop-short-901x500.png)、[1100×580](screenshots/desktop-short-1100x580.png) | [375×667](screenshots/mobile-short-375x667.png)、[390×844](screenshots/mobile-short-390x844.png) |

## Node 24 与 Chromium 结果

环境：Node **24.19.0** / npm **11.9.0** / Chromium **154.0.8037.57**。正式 npm 依赖、Vitest 和 Playwright，无垫片。模型请求全部 Mock/禁止出站，使用合成资料，没有真实玩家存档或 API Key。

| 批次 | 结果 | 退出码 |
| --- | --- | ---: |
| `npm ci --cache /workspace/.npm` | 正式安装成功，143 包 | 0 |
| `talent-ui` + 现有创角/天赋兼容定向 Vitest | **140 通过 / 0 失败 / 0 跳过**，其中新增 UI 专项 **17 项** | 0 |
| `npm run check` | **173 文件 / 4199 单测通过**；文件名、ESLint、catalog、TypeScript、Build 通过 | 0 |
| `npm run prompts:check` | **93 通过** | 0 |
| Chromium 两文件相关完整范围 | **18 通过**：PC 9、手机 9；新功能每端 6、原职业回归每端 3 | 0 |
| 卡头 CSS 收尾后天赋专项 | **12 通过**，与上行重叠 | 0 |
| 最终截图 / 日间创角 / 矮屏补核 | **6 通过**，与前两行重叠 | 0 |
| 原生手机触控、取消及键盘复核 | **2 通过**，为已有场景子集 | 0 |
| 第五步车票 / 复核截图补核 | **2 通过**，为已有场景子集 | 0 |
| 局部 CSS 修正后的 `npm run build` | catalog / TypeScript / Build 通过；也包含在最后完整 check 中 | 0 |
| 修改文件 ESLint / TypeScript 预检 | 通过；最终版本又由完整 check 覆盖 | 0 |
| `git diff --check` 与暂存差异 | 通过 | 0 |

**17、140、93 都包含在 4199 中，不相加。浏览器是 18 个独立场景，后续小批为相关样式/截图/触控复核，不冒称额外独立覆盖。** 中途完整检查之后曾修正本组件 CSS 与新增 E2E 准备/截图，因此在最终固定代码上再执行一次完整 check。两批 4199 也不累加；日志保留 `check-before-css` 与最终 `check` 以区分版本。

原始日志保留在 [logs/](logs/)，可 `gzip -cd` 读取；[结果与退出码](evidence/results.json)、[浏览器逐项结果](evidence/browser-cases.json)及原始 Playwright JSON 同时保留。Build 的大 chunk 警告不影响退出码，本批不扩展打包优化。

失败记录如实保留：初次 SSR 新测试误依赖 React 输出属性次序，8 失败/132 通过，已改为核对同一 input 的名称与 checked，不放松单选数量；初次新 Chromium 9 通过/3 失败，两项是新增 `has` 定位错误，一项是上面的真实颜色层叠问题，均已修正。另一次 `--grep '^矮屏'` 未匹配 Playwright 完整标题，执行 0 项、退出 1；修正为明确子串后实际布局场景通过。没有既有测试失败需要归因 main，没有删除或 skip 原用例。现有测试产生的历史截图已复原，不覆盖早期批次证据。

## 限制与停止点

- Chromium 手机设备模拟不是实机 iPhone / Safari，本轮未执行 Safari、WebKit 或真实输入法验证，不宣称这些平台已通过。
- PR-A、PR-B、PR-C 仍是叠加开发；只有授权整合后才可对外宣称玩家已获得完整入口。本批不合并、不推送 main、不手动部署、不发布公告。
- 本批只读展示 PR-A 定义；PR-B 的模型上下文能力及其真实模型质量、语义证据和概率判定限制仍然有效。没有加入新效果或保证成功。

完成后停止，等待十二代目独立审查与项目负责人授权。
