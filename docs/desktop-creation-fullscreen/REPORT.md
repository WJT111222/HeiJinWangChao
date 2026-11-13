# PC 五步创角全屏布局修复

> 以下为首轮证据。十代目指出的极矮屏第五步根滚动已另行复现并补修，详见 [复审补修报告](review/REPORT.md)；首轮文件和成绩保留，不代表该问题当时已被覆盖。

基线：`f368ada2dd79cda466a3588018e1416834359e19`（开工和交付前均重新 fetch 并核实 origin/main）。独立分支：`fix/desktop-creation-fullscreen`。

## 问题与最小修复

旧 `src/app/styles.css` 中的 `.creation-page` 在桌面组件样式之后加载，其 `max-width: 1240px`、`margin: 2.8rem auto`、`padding: 0 2rem 3rem` 覆盖了同优先级的桌面重置。在 1440×900 的真实 React 页面中，主体边界为 `(100, 104.796875)–(1340, 855.203125)`，导航栏下缘为 60px。旧版矮屏规则还使表单溢出到整页，1100×420 时主体底边达 1253.34375px。

唯一生产修改文件为 `src/ui/creation/desktop-creation.css`：

- 在 ≥901px 范围提高桌面主体重置选择器优先级，清除旧最大宽度、外边距及内边距。
- 用 `100dvh`（保留 `100vh` 回退）和 flex 使主体填满品牌导航下方。
- 移除矮屏退回整页滚动的覆盖，让现有档案和表单滚动区继续内部滚动，底栏继续占据独立空间。

未改组件、职业分类/列表样式、滚动位置管理、职业选择逻辑、其他业务或任何数据结构。没有修改全局 `.creation-page`，也没有修改首页、游戏页面或 ≤900px 的样式。

## 实测结果

使用真实 Vite React App、Playwright Chromium、相同固定时间与本地测试草稿。全部 POST 被阻止并断言请求数为零；不创建正式角色、不调用模型。

| 视口 | 修复后主体边界（左、上、右、下） | 五步最大边界误差 |
| --- | --- | --- |
| 901×800 | 0, 60, 901, 800 | 0px |
| 1100×800 | 0, 60, 1100, 800 | 0px |
| 1440×900 | 0, 60, 1440, 900 | 0px |
| 1600×900 | 0, 60, 1600, 900 | 0px |
| 1920×1080 | 0, 60, 1920, 1080 | 0px |
| 901×500 | 0, 60, 901, 500 | 0px |
| 1100×420 | 0, 60, 1100, 420 | 0px |
| 1440×500 | 0, 60, 1440, 500 | 0px |

每个视口都遍历五步，检查左右边缘、导航接缝、主体底边和底栏底边（阈值 2px），共 40 组；没有页面横向溢出。原始前后矩形见 [汇总](bounds-summary.json) 和 before/after 目录中的 JSON。

1100×420 额外验证：五步底栏导航、姓名/职业名称/开局偏好输入、草稿刷新恢复；档案与表单均可滚动，滚动不移动底栏，窗口 scrollY 保持 0。职业列表滚动状态没有重置或代码改造。

390×844 和 900×844 保留原人生车票，首步与第五步截图修复前后 PNG 字节及 SHA256 完全一致；切换 900/901px 可正确切换两端布局。1440×900 首页和游戏页面也字节完全一致，共六组对照，见 [截图哈希](pixel-comparison.json)。

## 真实截图对照

全部来自正式 React 组件；不是静态 HTML。before 为未修改 main，after 仅应用本次 CSS。截图固定时间、草稿和 reduced-motion。

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 901×800 | [截图](before/901x800-step1.png) | [截图](after/901x800-step1.png) |
| 1100×800 | [截图](before/1100x800-step1.png) | [截图](after/1100x800-step1.png) |
| 1440×900 基本信息 | [截图](before/1440x900-step1.png) | [截图](after/1440x900-step1.png) |
| 1440×900 职业与能力 | [截图](before/1440x900-step2.png) | [截图](after/1440x900-step2.png) |
| 1440×900 确认与开局 | [截图](before/1440x900-step5.png) | [截图](after/1440x900-step5.png) |
| 1600×900 | [截图](before/1600x900-step1.png) | [截图](after/1600x900-step1.png) |
| 1920×1080 | [截图](before/1920x1080-step1.png) | [截图](after/1920x1080-step1.png) |
| 901×500 矮屏 | [截图](before/901x500-step1.png) | [截图](after/901x500-step1.png) |
| 1100×420 矮屏 | [截图](before/1100x420-step1.png) | [截图](after/1100x420-step1.png) |
| 1440×500 矮屏 | [截图](before/1440x500-step1.png) | [截图](after/1440x500-step1.png) |
| 手机 390 首步 | [截图](before/mobile-390-step1.png) | [截图](after/mobile-390-step1.png) |
| 手机 390 末步 | [截图](before/mobile-390-step5.png) | [截图](after/mobile-390-step5.png) |
| 手机 900 首步 | [截图](before/mobile-900-step1.png) | [截图](after/mobile-900-step1.png) |
| 手机 900 末步 | [截图](before/mobile-900-step5.png) | [截图](after/mobile-900-step5.png) |
| PC 首页 | [截图](before/home-1440.png) | [截图](after/home-1440.png) |
| PC 游戏页面 | [截图](before/game-1440.png) | [截图](after/game-1440.png) |

## 正式检查与原始日志

环境：Node.js **v24.19.0**、npm **11.9.0**、系统 Chromium **154**。使用真实项目依赖及 Playwright，无替代运行器。

| 命令/阶段 | 结果 |
| --- | --- |
| `npm ci` | 退出 0，安装 143 个包 |
| `npm run check` | 退出 0；Lint、3435 项 Vitest（141 文件）、TypeScript、生产构建通过 |
| 未修改 main 边界与对照测试 | 3 通过、8 失败、0 跳过；8 个失败均复现本次待修边界；不计作最终通过 |
| 修复后定向 Chromium | **12 通过、0 失败、0 跳过、0 重试** |
| `git diff --check` | 退出 0 |

构建存在非阻断的打包大块提醒；日志另有 Node 的 NO_COLOR/FORCE_COLOR 提醒。没有修改断言或增加重试。没有运行全量浏览器回归；工程检查中的全体单测仅运行一次。

原始日志逐字 gzip 保存：[安装](logs/npm-ci.log.gz)、[工程检查](logs/check.log.gz)、[修复前](logs/before-browser.log.gz)、[修复后](logs/after-browser.log.gz)、[差异检查](logs/diff-check.log.gz)。用 `gzip -dc <file>` 查看。压缩前哈希见 [sha256.json](logs/sha256.json)。机器可读 Playwright 报告：[修复前](before-results.json)、[修复后](after-results.json)。

可重现命令（证据目录使用绝对路径）：

```bash
node --version
npm ci
npm run check
CREATION_LAYOUT_PHASE=after \
CREATION_LAYOUT_EVIDENCE=/tmp/creation-fullscreen-evidence \
CREATION_LAYOUT_RESULT=/tmp/creation-fullscreen-results.json \
CHROMIUM_PATH=/usr/bin/chromium \
npx playwright test --config playwright.creation-fullscreen.config.ts
git diff --check
```

修复前使用相同测试、相同断言，仅通过 `--grep '视口边界|未改手机|首页及游戏'` 排除额外的矮屏表单用例，并设置 `CREATION_LAYOUT_PHASE=before`。phase 只决定证据目录，不影响断言或跳过行为。

## 文件清单与交付边界

- `src/ui/creation/desktop-creation.css`：唯一生产变更，桌面全屏布局。
- `e2e/creation-fullscreen.spec.ts`：12 项边界、短屏交互、手机及其他路由隔离测试。
- `playwright.creation-fullscreen.config.ts`：独立端口、明确单文件范围、零重试配置。
- `docs/desktop-creation-fullscreen/`：本报告、32 张前后真实截图、40×2 组边界数据、对照哈希、工程结果和原始日志。

未修改游戏核心、公告文案、模型配置、Repository 或存档功能。交付保持 Draft，未合并、未部署、未发布，等待正式审查。
