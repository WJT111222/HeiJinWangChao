# PR #134 正式工程与浏览器验收

浏览器实测版本：Chromium 154.0.8037.57；手机项目沿用 Playwright Pixel 7 的 UA 与 DPR 2.625，实际引擎版本以本机 Chromium 为准。

基线 main：`4c8ca11b7250711a660cfa628f35ee01b0688ca2`。审查源码：`cbb31a8d399c3eb0fc55cbe46ad8714fea90a9b9`。审查：[5892164600](https://github.com/WJT111222/HeiJinWangChao/pull/134#pullrequestreview-5892164600)。

本轮使用 Node 24.19.0、锁文件 `npm ci`、项目正式 Vitest / ESLint / tsc / Vite 与 Playwright，浏览器为系统 Chromium。运行完整 App，包含真实 IndexedDB 与创角、开局授权路径；AI 网络均 Mock 或阻断。本轮不使用辅助 esbuild 页面作验收。

## 失败归因与最小整改

| 发现 | main 对照 / 依据 | 处理 |
| --- | --- | --- |
| 手机初始“自由选择” radio 不存在、预设 radio 精确名称匹配失败 | 未修改 main 的两个职业用例同样失败；手机使用“✎ 自由选择”按钮，预设标签还带三项技能 | 测试走实际分类卡及自由选择按钮，仍逐个检查 5×6 职业、完整介绍、技能、长期影响 |
| 手机个人技能与确认职业资料不可见 | main 的 `.creation-manual-skills` 和 `.creation-review-fold` 原有折叠结构 | 主动展开后继续核对全部原内容 |
| 手机覆盖包不是 select | main 同名包管理复现 `Element is not a <select>`；正式手机使用 radio | 通过明确命名的覆盖选项，取消与二次确认、独立 ID、原包不变断言保留 |
| 返回后再次创角找不到原按钮 | main 的桌面长流程复现；`goHome()` 到存档馆，实际入口是“开启新的人生”；手机创角返回按钮为“‹ 首页”，已有存档时需选择空白车票 | 仅改测试导航；不改变首页、开局包或创角业务 |
| 手机正式人物档案入口过时 | 测试截图显示正式底栏“人物”和城市状态入口，main 的 GameScreen 与共用旧 helper 相同 | 本文件手机分支经“此时此地与主角状态”进入人物档案；仍逐项核对正式职业资料、技能、重载、无 API 请求 |
| 首轮 check 的公告发布测试 `spawnSync sh EPERM` | 当前沙箱阻止本地子进程，非创角源码故障 | 保留初次失败日志，允许本地 Git 子进程后重跑正式 check |
| 中间浏览器批次服务终止 / CPU 争抢 | 并行批次复用临时服务，一批结束关闭了其他批次依赖的 Vite | 明确中断受影响批次，保存失败与未运行记录；改独立常驻 App 服务、逐批单 worker，未新增重试 |
| 新增验收测试回调缺类型 | 首次 typecheck 捕获新测试的隐式 any | 补回调类型；未调整编译器或正式代码 |

没有删除、skip 或放宽原业务断言。测试中 30 职业、完整技能/背景/开局偏好、同伴、原包不变、独立 saveId、正式存档、请求数均保留。仅“同一屏有 7 个职业 radio”改为符合产品的桌面 7 / 手机 6，手机自由选择另行检查实际按钮。

## 设计稿逐项核对口径

| 设计要求 | 正式 App 验证 |
| --- | --- |
| 左侧纸质档案、右侧五步、金色页签与按钮 | 901 / 1100 / 1440px 实际 React 截图；只在 ≥901px 出现 |
| 实时姓名、年龄、职业、城市印 | 实际填字及切换四城后检查 dossier 与城市印 |
| 模板卡与键盘 | 鼠标点击、ArrowRight / ArrowLeft、Home / End，值与焦点同步 |
| 30 职业和自由职业 | 核心双端用例逐职业检查；自定义四字段、手动技能与刷新保持 |
| 城市背景、同伴开关八字段与错误 | 四城、完整背景、同伴错误和八字段；主流程与跳过流程分别验收 |
| 确认核对、修改、立档 | 五步/修改入口、实际建档失败、busy 印章及存档隔离 |
| 短窗口、独立滚动、底栏 | 1100×580；其余 901×768、1100×800、1440×900；长文本与页内滚动 |
| 手机人生车票 | 375 / 390px 实际 App，901px 往返切换不丢表单；第四批与撕票兼容回归 |

设计稿的演示控制和辅助静态预览不作为正式结果。`../preview/` 保留为初版历史参考；本目录 `screenshots/` 才是此次完整 App 实拍。截图元数据会记录源代码提交、浏览器、CSS 视口和像素尺寸。

## 正式结果

### 工程命令

| 命令 / 批次 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --version` | 0 | v24.19.0 |
| `npm ci` | 0 | 锁文件安装 143 个包，无替代运行器 |
| `npm run check` 首次沙箱批次 | 1 | ESLint 通过；Vitest 140 文件通过、1 文件收集失败，3416 用例通过；`spawnSync sh EPERM`；此批次没有执行后续 build |
| `npm run check` 完整重跑 | 0 | ESLint、141 文件 / 3435 Vitest 用例、TypeScript、Vite 生产构建全部通过；0 失败 / 0 跳过 |
| 创角 / 开局包指定 Vitest 两文件 | 0 | 2 文件，73 通过 / 0 失败 / 0 跳过 |
| `npm run prompts:check` | 0 | 3 文件，93 通过 / 0 失败 / 0 跳过 |
| 新测试首次独立 typecheck | 2 | 新验收测试回调缺少类型；已补类型，保留原始错误日志 |
| 固定测试代码的 `npm run lint` / `npm run typecheck` | 0 / 0 | 正式项目配置，无新增警告或类型错误 |
| 最后手机导航等待修正后的 `npm run lint` / `npm run build` | 0 / 0 | 包含正式 TypeScript；生产构建成功 |
| `git diff --check` | 0 | 无差异格式问题（证据打包曾多出一个末尾空行，已清理；原检查日志保留） |

构建有既存的 >500kB 分包提示，本轮未为此修改打包或产品代码。工程工具未运行的测试数用“不适用”理解，不把 CLI 成功当成额外通过用例。

### 浏览器最终批次

- PC 补充七项：**7 通过，0 失败 / 跳过**。其中 4 个视口各走完整五步与截图，1 项正式存储故障/重试/并发点击，2 项桌面真实 Coordinator Mock 开局与恢复。
- 手机兼容二十项：**20 通过，0 失败 / 跳过**。包含 375/390 车票与断点、`mobile-batch4.spec.ts` 全部 16 项、手机 `opening-life.spec.ts` 2 项。
- 核心双端中间批次曾为 13 通过 / 1 失败；诊断关闭后单独复测又发现首页撕票动画尚未结束时就读取新草稿。实际页面随后已是第一步；修正为等待“基本信息”标题可见，再检查持久化 step=1。修复后该长流程 **1/1 通过**。没有增加测试级重试或改动撕票/建档逻辑。
- 最终固定代码再次运行两个核心文件的 desktop + mobile 全部 14 项，**14 通过，0 失败 / 跳过**（`pr134-core-delivery`，退出码 0）；结果在下表及原始日志记录。

`mobile-batch4.spec.ts` 是手机专用，未把其 desktop 版本算作通过；PC 专用验收五项只选择 desktop。375/390 新用例明确设置视口；第四批旧截图文件名虽含“390”，其未覆盖视口的用例实际沿用 Pixel 7 的 412×839，不能将名字当成精确视口。本目录独立截图元数据采用真实 CSS 视口。

### 全部浏览器批次（包括失败与中断）

见自动生成的 `browser-batches.json` 及下表。失败列包含 failed + timedOut，未运行、明确中断与 skip 分开，不将历史批次数相加冒充一次全绿。

| 批次 | 退出码 | 通过 | 失败/超时 | 中断 | 未运行 | 实际 skip |
| --- | --- | --- | --- | --- | --- | --- |
| pr134-core-initial | 1 | 9 | 5 | 0 | 0 | 0 |
| pr134-main-mobile-before | 1 | 0 | 2 | 0 | 0 | 0 |
| pr134-main-packs-before | 1 | 1 | 3 | 0 | 0 | 0 |
| pr134-core-revised | 1 | 10 | 4 | 0 | 0 | 0 |
| pr134-compat | 130 | 3 | 7 | 1 | 7 | 0 |
| pr134-acceptance-initial | 130 | 0 | 5 | 0 | 2 | 0 |
| pr134-core-final | 1 | 12 | 2 | 0 | 0 | 0 |
| pr134-core-verified | 1 | 13 | 1 | 0 | 0 | 0 |
| pr134-desktop-verified | 0 | 7 | 0 | 0 | 0 | 0 |
| pr134-pack-mobile-verified | 1 | 0 | 1 | 0 | 0 | 0 |
| pr134-mobile-compat-verified | 0 | 20 | 0 | 0 | 0 | 0 |
| pr134-pack-mobile-final | 0 | 1 | 0 | 0 | 0 | 0 |
| pr134-core-delivery | 0 | 14 | 0 | 0 | 0 | 0 |


### 截图与设计核对

本轮新增 **42 张完整 App 截图**，清单和 SHA-256 在 `screenshots.json`。PC 对应 `5b681bcd089050125c86c00a5b05f3efe4c7ad05`，手机 375/390 对应 `3fa515191a108fbc24828bc8ccca13c3043eaa1e`；后续代码差异仅是手机开局包测试等待，不改变截图所使用的 React/CSS。交付提交只追加报告与证据。

- [1440 基本信息](screenshots/desktop-1440x900-01.png)
- [1440 职业分类与详情](screenshots/desktop-1440x900-02-preset.png)
- [1440 自由职业](screenshots/desktop-1440x900-02-custom.png)
- [1440 城市与背景](screenshots/desktop-1440x900-03.png)
- [1440 同伴八字段](screenshots/desktop-1440x900-04.png)
- [1440 同伴校验错误](screenshots/desktop-1440x900-04-error.png)
- [1440 确认核对](screenshots/desktop-1440x900-05.png)
- [1440 开局包](screenshots/desktop-1440x900-pack.png)
- [1440 正式保存中](screenshots/desktop-1440-saving.png)
- [正式建档失败](screenshots/desktop-1440-save-failure.png)
- [901 基本信息](screenshots/desktop-901x768-01.png)
- [1100 基本信息](screenshots/desktop-1100x800-01.png)
- [1100×580 短窗口](screenshots/desktop-1100x580-02-custom.png)
- [375 手机车票](screenshots/mobile-375-ticket-01.png)
- [390 手机确认](screenshots/mobile-390-ticket-05.png)

旧 `docs/screenshots/character-creation-v2/` 六图与 `docs/opening-packs/screenshots/` 六图也由正式核心 E2E 更新；对应项目默认视口 desktop 1440×1000 / mobile 412×839，不与本目录 1440×900、375/390 混淆。初版 `preview/` 为辅助历史资料，未拿来替代本轮结果。

### 保护范围、残余边界

相对审查 HEAD，本轮不修改任何 `src/`、Prompt、Manifest、锁文件或业务配置。没有修改 Creation/validateStep、GameState、Repository、IndexedDB、开局授权、AI 路由、原子结算、开局包存储或手机撕票实现；正式公告和第三方 API 文案保持原样。

存储失败及 busy 用例只在隔离浏览器中注入 Repository 测试替身，正常成功路径仍经实际 Repository、IndexedDB 与 App。对已有存档的完整 loadGame、独立 saveId、双击单次新增、重载一致性都作断言。opening-life 使用 Mock 供应商返回，确认三阶段各一次、刷新不重复、失败只恢复 World；不代表真实付费模型输出质量已验收。

窗口覆盖有限，未声称验证全部操作系统、所有字体或所有浏览器引擎。没有运行无关全量 Chromium，也不验证生产 Cloudflare 部署。没有已知未解决的本轮阻断；保留既有分包警告，不扩大重构。

### 重现与日志

```bash
node --version
npm ci
npm run check
npx vitest run src/tests/character-creation-v2.test.tsx src/tests/opening-packs.test.tsx
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/character-creation-v2.spec.ts e2e/opening-packs.spec.ts --config=playwright.pr134.config.ts --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/desktop-creation-acceptance.spec.ts e2e/opening-life.spec.ts --config=playwright.pr134.config.ts --project=desktop --grep 'PC |创角自动|World失败' --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/mobile-batch4.spec.ts e2e/opening-life.spec.ts e2e/desktop-creation-acceptance.spec.ts --config=playwright.pr134.config.ts --project=mobile --grep-invert 'PC ' --workers=1
git diff --check
```

`playwright.pr134.config.ts` 扩展原配置，保留正式 desktop/mobile、真实 runner、失败 trace 和 retries=0，仅隔离端口到 5182；main 对照可通过 `PR134_BASELINE_ROOT` 指定未修改工作树并使用 5282，其 testDir 读取 main 自己的原用例。本轮最终采用独立常驻 Vite 服务，避免多批 runner 互相停止同一服务。

`logs/*.log.gz` 为未经内容改写的原始 stdout/stderr 压缩件，`*.json.gz` 为 Playwright 原始 JSON reporter，`*.exit` 保存退出码。`failure-contexts/` 保留原失败页面/定位上下文。使用 `gzip -dc 文件.log.gz` 查看；SHA-256 清单覆盖报告以外的证据文件。原始 trace ZIP 只在本工作台 `/tmp/pr134-*`，未声称它们可长期保存，公开交付以日志和失败上下文为准。
