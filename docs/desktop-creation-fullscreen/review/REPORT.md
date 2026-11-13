# 十代目复审补修：极矮屏第五步根滚动

对应 [十代目 Review](https://github.com/WJT111222/HeiJinWangChao/pull/137#pullrequestreview-5893549966) 及 [九代目补充 Review](https://github.com/WJT111222/HeiJinWangChao/pull/137#pullrequestreview-5893631339)。复核起点为 PR HEAD `1fa4987986f6640c8282c60c70b64df278074794`；重新 fetch 后 main 仍为 `f368ada2dd79cda466a3588018e1416834359e19`。

## 结论及根因

审查指出的高度异常确实会让用户滚出底部空白，并非只存在于布局计算。第五步的 `.creation-review .profession-profile h3` 为保留读屏标题而使用绝对定位和 1px 裁剪；由于缺少局部定位参照，其 offsetParent 落在 body，静态位置约 568.625px。这个绝对定位后代的包含块在现有滚动/裁剪祖先之外，造成根文档高度达到 570px。

复现时，901×500 的 `window.scrollTo(0,9999)` 和步骤条上的滚轮均使 `scrollY=70`，主体顶部变为 -10px，底栏底边变为 430px；1100×420 同理 `scrollY=150`、主体顶部 -90px、底栏底边 270px。截图清楚显示被卷走的顶部及底部空白。

本轮唯一生产补修是在 **≥901px** 现有 `.creation-review .profession-profile` 声明中增加 **`position: relative`**，使无障碍标题留在确认卡片的滚动体系内。没有给 html/body 禁止滚动，没有删除标题或正文，没有改职业列表、滚动位置管理、React 或任何业务。原有 `overflow: auto` 全部保留。

## 交互证据

相同真实 React 页面、长背景内容、Node v24.19.0、系统 Chromium 154、真实 Playwright；所有 POST 被阻断并断言为零。每个视口记录九个检查点：初始、`scrollTo(0,9999)`、步骤条滚轮、Ctrl+End、输入聚焦填写、Tab、表单内滚轮、表单触底继续滚轮、左档案独立滚动。

| 视口 | 修复前根 scrollHeight / clientHeight | 修复前最大 scrollY | 修复后根高度 | 修复后全部检查点 scrollY | 修复后底栏底边 |
| --- | --- | --- | --- | --- | --- |
| 901×500 | 570 / 500 | 70 | 500 / 500 | 0 | 500 |
| 1100×420 | 570 / 420 | 150 | 420 / 420 | 0 | 420 |

修复后所有检查点的主体顶部均为 60px，等于品牌导航下缘；主体底边及底栏始终贴合视口。表单仍可滚动至 1057px / 1115px，左档案可独立滚动至 353px / 433px。输入框可聚焦、填写和进入视口；「上一步」实际点击可回第四步；「确认并创建存档」通过真实点击前的 Playwright actionability 检查（`click({ trial: true })`），不实际提交或发起模型请求。

原始逐次数据：[901 修复前](before/901x500-root-scroll.json)、[修复后](after/901x500-root-scroll.json)、[1100 修复前](before/1100x420-root-scroll.json)、[修复后](after/1100x420-root-scroll.json)、[汇总](review-scroll-summary.json)。

## 真实截图

| 场景 | 补修前 | 补修后 |
| --- | --- | --- |
| 901×500 初始第五步 | [截图](before/901x500-step5-initial.png) | [截图](after/901x500-step5-initial.png) |
| 901×500 尝试滚动根文档 | [截图](before/901x500-step5-scrollTo.png) | [截图](after/901x500-step5-scrollTo.png) |
| 901×500 输入及独立滚动后 | [截图](before/901x500-step5-input.png) | [截图](after/901x500-step5-input.png) |
| 1100×420 初始第五步 | [截图](before/1100x420-step5-initial.png) | [截图](after/1100x420-step5-initial.png) |
| 1100×420 尝试滚动根文档 | [截图](before/1100x420-step5-scrollTo.png) | [截图](after/1100x420-step5-scrollTo.png) |
| 1100×420 输入及独立滚动后 | [截图](before/1100x420-step5-input.png) | [截图](after/1100x420-step5-input.png) |

本轮手机 390/900 首末步、PC 首页及游戏的六组截图与首轮修复后的截图仍逐字节一致；1440×900 的职业步和第五步也一致。1440 首步 PNG 有一处 38×2px 范围的文本框底边细节差异，未宣称该张完全一致，边界断言通过。[完整哈希比较](review-pixel-comparison.json)。

## 定向测试与工程记录

仅新增两个极矮屏第五步测试，原有测试和断言全部保留。新增测试最终使用显式推导类型保存采样数据。

| 阶段 | 实际结果 |
| --- | --- |
| 未补修 CSS 的新增两项 | **2 失败**，准确复现根文档高度、实际 scrollY、主体/底栏偏移；无 skip/retry |
| CSS 补修后定向集 | **6 通过、0 失败、0 跳过、0 重试**：两个第五步场景、1440×900 五步、390/900 手机、首页及游戏隔离 |
| 补齐测试类型声明后的第五步复跑 | **2 通过、0 失败、0 跳过、0 重试**，与上述两个为同一用例，非新增独立场景 |
| `npm run lint` | 通过 |
| 第一次 `npm run build` | 失败：新增测试采样数组隐式 any（TS7034/TS7005），生产文件无类型错误 |
| 补齐采样类型后的 `npm run build` | **通过**，含正式 TypeScript 和生产构建 |
| `git diff --check` | 通过 |

本轮最终覆盖 **6 个独立 Chromium 场景**；两项第五步因测试类型整理另有复跑，不重复计作新的通过场景。没有重跑首轮完整 12 项、全体单测或全量浏览器测试。首轮 `npm ci`、3435 Vitest、Lint/TS/Build 和 12 项浏览器证据保留在上级目录，不与本轮成绩混算。构建的大块提醒、Node 的 NO_COLOR 提醒仍为非阻断提示。

机器可读报告：[补修前](review-before-results.json)、[六项定向](review-after-results.json)、[最终两项](review-final-results.json)、[工程结果（含失败）](review-engineering-results.json)。原始 stdout/stderr 逐字 gzip 保存在 [logs/](logs)，压缩前大小及哈希见 [sha256.json](logs/sha256.json)，使用 `gzip -dc <file>` 查看。

复现命令：

```bash
CREATION_LAYOUT_PHASE=review-final \
CREATION_LAYOUT_EVIDENCE=/tmp/creation-fullscreen-review \
CREATION_LAYOUT_RESULT=/tmp/creation-fullscreen-review-results.json \
CHROMIUM_PATH=/usr/bin/chromium \
npx playwright test --config playwright.creation-fullscreen.config.ts --grep '第五步根滚动隔离'

# 本轮六项定向集的范围
# --grep '第五步根滚动隔离|未改手机|首页及游戏|视口边界与五步 1440x900'
npm run lint
npm run build
git diff --check
```

## 本轮文件

- `src/ui/creation/desktop-creation.css`：确认卡片局部定位，一个 CSS 属性及注释。
- `e2e/creation-fullscreen.spec.ts`：两种极矮视口的真实滚动/聚焦/按钮可达性回归，采样根文档和内层矩形。
- `docs/desktop-creation-fullscreen/REPORT.md`：标注首轮证据并链接本报告。
- `docs/desktop-creation-fullscreen/review/`：本轮报告、前后截图、逐次测量和原始日志。

保持原 PR #137 Draft，未合并、未部署、未发布，等待十代目复审。
