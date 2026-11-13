# 手机第四批：王朝文书、人生车票与开局包

分支 `feat/mobile-redesign-batch4`。初始 main 为 `4395ae03f110aa42097c8e3b10a3d41c0787c7e7`（#124）；施工中无冲突快进到 `6bceb28121db393b90912eb2ab2c0b0c96bf5a9c`（#125），之后快进到 `967113fa8aba7b842621b3ddbdaf0e39e1f3b61f`（#127）。最终提交 SHA 见本批 Draft PR 与交付答复。

本轮只完成第四批，PC 保留原界面，不开展第五批，不合并、生产部署或发布。

## 设计依据

完整读取上传的正式第四批指令，以及原始包的 README、NOTICES/CREATION 交接与两份 HTML。原包在 #125 合并后已完整存在 [原始参考目录](../mobile-batch3/reference/README.md)，六份 HTML 与交接均在同一目录，iframe 引用保留，本批没有再次提交重复设计副本。

- [须知/公告原稿](../mobile-batch3/reference/heijin-mobile-notices.html) · [交接](../mobile-batch3/reference/MOBILE_NOTICES_HANDOFF.md)
- [创角原稿](../mobile-batch3/reference/heijin-mobile-creation.html) · [交接](../mobile-batch3/reference/MOBILE_CREATION_HANDOFF.md)
- [HTML / 真实 React 并排对照](comparison.html)

设计中的 demo hash、示例人物、示例公告版本和模拟业务没有接入正式 UI。正文、正式字段及权限以 main 为准。

## 完成内容

### 须知与公告

≤900px 使用原生 Dialog 的全屏底部文书：安全区、22px 顶圆角、金边、模糊暗背景、固定标题/自动步骤条/六章横条/底栏，只有正文滚动。保留原 ARIA 名称、原生模态焦点边界、Esc、遮罩与关闭回焦。

须知来自原 `disclaimer.ts`，没有修改其标题、18+ 提示、引言、六章节、任何段落、强调、结尾与署名。展示了年龄圆印、强调段落、开发者方印和全文完装饰。原 `disclaimer-content.test.ts` 通过。阅读进度只作显示，0% 也可关闭。

六章胶囊来自正式标题，支持点击定位、滚动高亮、自动横向跟随及底部 100%/最后章节。长文和短视口均保留正文与操作栏的独立边界。

从 App 传入现有 `notices.automatic`，`useNotices`、本地日历免打扰与 KV client 完全不变。手机版自动两页复用同一原生 Dialog；225ms 退出、225ms 进入，总约 0.45s。切换有本地关闭锁，避免一次双击关闭两页；reduced-motion 直接切换内容并短暂抑制连击。手动只显示指定一页，关闭按钮与底部主按钮调用同一关闭方法。

公告的版本、标题、主题、全部更新与寄语均读取真实传入 Announcement。保留 `.notice-theme`、`.notice-message`、`.notice-content`、`.notice-footer`；时间线用壹至贰拾编号，没有从版本号臆造“开发里程碑”。Mock 云端展示验证了全部字段、文本转义及滚动不增加请求。网络失败仍使用原本地公告。

### 五站创角

手机顶栏、约92px 实时小票、五站线路和底栏固定，只有原 form 的 `.creation-card` 滚动。`visualViewport` 只用于可见高度和偏移；输入至少16px，保留原生缩放，没有宣称模拟短视口等于真实 iOS 输入法验收。

顶部预览使用原 Dialog，只读票根没有提交事件。姓名、年龄、性别、职业、同伴、城市与站号来自当前 Creation；第三站之前 TO 显示问号；没有使用设备日期推断游戏开局。

保留全部原字段与 `validateStep`、`selectProfession`、`professionProfile`。模板改为有键盘方向键的横向 radio 胶囊，职业使用真实五分类及选中卡内 ProfessionProfile，城市四张卡使用正式 radio/ID/介绍，同伴八字段和两个“跳过”入口均保留。步骤内容按 step 的 key 才播放动画，同一步输入/选项不重新挂载表单区。

第五站显示完整车票、四张折叠回顾（第一张默认展开）、原完整职业表单、同伴所有字段、开局准备、偏好和费用说明。长内容完整显示，不照搬设计中的三行裁切。字段详情和修改入口全部可达。

撕票复用 #125 的 `useTicketTear`；其现有源文件未改。新增创角 wrapper 仅阻止票根原生文字拖拽。超过60px松手时，撕票最终调用原 `<form>` 的 `requestSubmit()`，经过原1–4步校验、原 App/createProfileSave 与开局授权链路。按钮仍走同一 onSubmit。busy 与本地提交锁防重复，校验失败回对应步骤，短拖/pointercancel 不建档；切换步骤、编辑、打开只读预览/开局包、卸载会取消待执行撕票。reduced-motion 直接提交。

### 开局包

复用唯一 OpeningPacks 组件与原六视图：browse/save/rename/delete/apply/overwrite。手机套用原生底部抽屉，列表方印、单选圈、横滑保存方式与确认操作；PC DOM 保持原呈现。

原 OpeningPackStore、OpeningSettingsSchema、存储键、80字名称限制、跨标签重读、隔离损坏记录、取消与失败保护均未变。实际套用仍重建新存档身份，不携带原存档时钟/API凭证；已有手动技能、完整职业表单与同伴内容无损。原桌面同名包管理、损坏与存储拒绝用例未改断言，仍通过。

## 明确的设计与正式语义差异

1. 设计交接曾要求预设职业强制 automatic；最新正式指令与 main 允许已保存手动技能。本批**不修改 skillsSource 语义或 selectProfession**。预设职业的额外编辑器默认折叠，仍可展开编辑；已有手动技能在职业档案、回顾、开局包和正式角色中原样保留。
2. 设计回顾字段最多3行与正式指令“长文本全部可达”冲突，采用完整自然换行与表单区滚动，没有删除字段或自动摘要。
3. 原 main 没有独立人物卷宗完成度业务字段，小票完成度仅按当前填表/步骤投影作提示，不回写、不增加校验或创角字段。
4. 设计预览示例有可撕票根，本轮正式要求顶部预览只读，因此预览永远不绑定创建动作；只有第五站正文票根可提交。
5. 城市仍是 Creation 的四个正式 ID；装饰元信息和防伪纹在 #125 合并后改为复用其 `CITY_TICKET_META` 与 `guilloche()`，临时重复实现已移除。

## 测试成绩与实际范围

Node.js `v24.19.0`、npm `11.9.0`、Chromium `154.0.8037.57`，使用真实 npm ci 依赖。全部模型请求 Mock；本批新场景拦截并断言 POST 为0。没有调用真实付费模型。

| 检查 | 结果 |
|---|---|
| `npm ci --cache /tmp/ui2-npm-cache` | [成功](npm-ci.log)；lockfile 未变 |
| `npm run typecheck` | [通过](typecheck-final.log) |
| `npm run lint` | [通过](lint-final.log) |
| `npm run build` | [通过](build-final.log)，保留现有 >500kB chunk 警告，无构建错误 |
| 指定四文件 Vitest | **87 通过**，[日志](unit-final.log) |
| 手机第四批主场景 | **14 通过**，[日志](final-chromium.log) |
| 保存失败重试、#125 首页/创角草稿交叉 | **2 通过**，[日志](additional-chromium.log) |
| 原桌面开局包业务 | **2 通过**，[日志](legacy-desktop.log) |
| 原 #125→#120 双层非模态工作流冒烟 | **1 通过**，[日志](pr125-cross.log) |
| 最终视觉更新后的三项复核 | **3 通过（重复验证）**，[日志](visual-final.log) |
| 撕票期间打开预览/开局包的取消保护复核 | **1 通过（重复验证）**，[日志](gesture-final.log) |
| PC 完整 PNG | **16 组逐像素一致**，[结果](desktop-pixel-comparison.json) |
| `git diff --check` | [通过](diff-check.log) |

共 **19 个不同 Chromium 场景最终通过**，最终验收记录23次成功执行（含4次复核），无跳过、自动重试或 flaky。每个用例/项目/报告来源见 [validation-summary.json](validation-summary.json)。初轮另有14次执行，7通过7失败，原因与修复如下，原始记录不隐去。

四个定向单测文件：`disclaimer-content.test.ts`、`notice-preferences.test.ts`、`character-creation-v2.test.tsx`、`opening-packs.test.tsx`，原断言不变。

```sh
npm run typecheck
npm run lint
npm run build
npm run test -- src/tests/disclaimer-content.test.ts src/tests/notice-preferences.test.ts src/tests/character-creation-v2.test.tsx src/tests/opening-packs.test.tsx
MOBILE4_RUN=final npx playwright test --config playwright.mobile-batch4.config.ts
MOBILE4_RUN=additional npx playwright test --config playwright.mobile-batch4.config.ts --grep '正式保存失败|#125 车票首页'
MOBILE4_BUSINESS=1 MOBILE4_RUN=legacy-desktop npx playwright test --config playwright.mobile-batch4.config.ts
MOBILE4_COMPAT=1 MOBILE4_RUN=pr125-cross npx playwright test --config playwright.mobile-batch4.config.ts
```

配置默认仅匹配本批 UI 文件；business 只匹配两项旧开局包用例且只跑桌面，compat 只匹配原手机导航冒烟。未运行约700项全量 E2E、全量 Vitest、`npm run check` 全量链或 Prompt 检查，不宣称这些项目在本轮通过。

### 初轮失败和修复

- 城市 radio 的透明输入被后画出的装饰圆章拦截。修正输入的原生命中层级，保留原 check 断言，四城全部通过。
- 同一票根连续短拖后，浏览器文字拖拽触发了原生 pointercancel。只在创角 wrapper 阻止文字拖拽并禁用票根文本选中，取消与短拖断言保留，之后能正常撕票建档；#125 控制器本身没有改动。
- 五个尺寸用例先注入“今日免打扰”初始化脚本，随后试图删除键并刷新来强制首次须知；初始化脚本又写回了偏好。改为按实际手动入口打开须知，仍断言固定头/底栏、正文滚动和无横向溢出；自动顺序与隔日恢复由独立用例覆盖。
- 对照截图中补齐了原生输入命中、18+ 圆章 padding、步骤线和回顾编辑按钮的手机样式。所有修正均限定 ≤900px。

[初轮日志](initial-failures/chromium.log) · [初轮 JSON](initial-failures/chromium-results.json)。失败均已修复或确认为测试准备问题，最终19个场景无失败；没有修改领域逻辑、删除/削弱旧断言或提高重试数。

## 截图与设计对照

[并排对照页](comparison.html) 左侧为静态确认 HTML，右侧为真实 App/React。演示人物和日期不同属于测试数据差异，不进入正式产品。

- 须知：[首次](screenshots/notice-auto-390.png)、[六章/100%进度](screenshots/notice-read-end-390.png)。
- 公告：[自动](screenshots/announcement-auto-390.png)、[手动](screenshots/announcement-manual-390.png)、[隔离云端 Mock 数据](screenshots/announcement-cloud-mock-390.png)。
- 创角：[第一站](screenshots/creation-step1-390.png)、[自由职业](screenshots/creation-step2-custom-390.png)、[预设职业](screenshots/creation-step2-preset-390.png)、[同伴关闭](screenshots/creation-step4-off-390.png)、[同伴开启](screenshots/creation-step4-on-390.png)、[第五站车票](screenshots/creation-step5-ticket-390.png)。
- 四城：[重庆](screenshots/creation-city-重庆-390.png)、[上海](screenshots/creation-city-上海-390.png)、[哈尔滨](screenshots/creation-city-哈尔滨-390.png)、[广州](screenshots/creation-city-广州-390.png)。
- 提交：[撕票效果](screenshots/creation-tear-390.png)、[校验错误](screenshots/creation-validation-390.png)、[保存失败可重试](screenshots/creation-save-failure-390.png)。
- 开局包：[浏览](screenshots/pack-browse-390.png)、[保存](screenshots/pack-save-390.png)、[重命名](screenshots/pack-rename-390.png)、[删除确认](screenshots/pack-delete-390.png)、[套用确认](screenshots/pack-apply-390.png)、[覆盖确认](screenshots/pack-overwrite-390.png)。
- 短视口：[375×667](screenshots/creation-375x667.png)、[390×844](screenshots/creation-390x844.png)、[430×932](screenshots/creation-430x932.png)、[392×640](screenshots/creation-392x640.png)、[392×420](screenshots/creation-392x420.png)。对应须知截图也在截图目录。
- PC：901×900、1440×900 的须知、公告、五步创角和开局包各有 main/react 两份完整视口 PNG。例：[901 须知](screenshots/pc-notice-901-react.png)、[901 第五步](screenshots/pc-creation-5-901-react.png)、[1440 创角](screenshots/pc-creation-1-1440-react.png)、[1440 开局包](screenshots/pc-pack-1440-react.png)。

PC 对照基线为开工时未修改的 `4395ae0`，相同存储与字体、移开鼠标、等待字体及两帧布局后完整 PNG 比较，未用遮罩或容差。后续同步的 #125 保留原 PC 首页，#127 只移除设置运行页占位；本批对照的须知/创角/开局包不受其影响。

## 内容/业务保护证明与交付

[protected-files.json](protected-files.json) 记录24份重要文件与最终 main 字节一致，包括须知原文和定稿夹具、useNotices、日期偏好、KV/Worker、创角 model/模板/职业库、开局包存储、#124 PromptInspector 与样式、#125 首页/撕票、#120 工作流及 #127 设置。

App 的 `createProfileSave` 调用和原建档/开局授权函数未改。Dialog 只增加可选的正文前固定插槽与关闭按钮禁用属性，默认无效，不新建模态系统。PC 保留旧分支，16组 PNG 一致。修改清单见 [FILES.txt](FILES.txt)。

无已知本批功能缺项。物理 iOS/Android 软键盘、触觉强度和手感仍需玩家真机确认，本报告只声明所列 Chromium 及短视口模拟结果。等待九代目源码复审与玩家视觉确认，未自动开展第五批。
