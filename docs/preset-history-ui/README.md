# 王朝预设设置与历史存档 UI 验收

改版前截图采集自开工时的 `main@c14f530dbafef2b637e3552e7a3110f33d30e364`。验收期间主干合入 #209，提交前已同步到 `main@27e8ddfbf9bfa8a4878b3d7dd43eff3f0085e91b`。截图来自真实 React 与 Chromium，所有存档均为合成夹具。桌面常规视口为 1440×900，手机使用 Playwright 的 Pixel 7 视口。基线预设对话框在实际持久化外观切换后仍产生相同画面，文中分别保留两次截屏。原图、运行日志和 computed style 同批保留。

## 设计落实

- 预设设置采用档案纸桌面布局和手机全屏抽屉。采样数字输入与滑块联动，交付方式使用四张选择卡。真实数据生成 8 个分区和 82 个条目。分区计数采用原始归属，跨分区的「自定义文风」仍属于完整文风互斥组，并标记归属。四个自定义文本框均保留。
- 恢复默认先在底栏确认，确认后的草稿仍需显式保存。关闭未保存编辑时保留原有确认。脚本状态来自现有宿主快照，同步 #209 后同时显示已初始化脚本的运行时诊断。估算沿用已保存配置。
- 历史存档采用分类型回合章、节点内重命名和删除确认、存储用量与备份说明。预览复用真实正文阅读组件及现有资料面板。「从此继续」沿用原有二次确认、不可撤销说明、一次性授权和恢复失败处理。
- 设计稿中的存档和作者统计为示例。正式界面只显示实际元数据，无法识别城市时省略城市。现有备份与恢复操作、预设持久化、脚本宿主和模型协议沿用原实现。

## 改版前后截图

下列链接引用同一界面、设备和主题的改版前后截屏。矮屏补充图展示真实确认条和危险按钮。

| 界面 | 设备 · 外观 | 改版前 | 改版后 |
| --- | --- | --- | --- |
| 预设设置 | 桌面 · 夜间 | [截图](screenshots/preset-desktop-night-before.webp) | [截图](screenshots/preset-desktop-night-after.webp) |
| 预设设置 | 桌面 · 日间 | [截图](screenshots/preset-desktop-day-before.webp) | [截图](screenshots/preset-desktop-day-after.webp) |
| 预设设置 | Pixel 7 · 夜间 | [截图](screenshots/preset-mobile-night-before.webp) | [截图](screenshots/preset-mobile-night-after.webp) |
| 预设设置 | Pixel 7 · 日间 | [截图](screenshots/preset-mobile-day-before.webp) | [截图](screenshots/preset-mobile-day-after.webp) |
| 历史列表 | 桌面 · 夜间 | [截图](screenshots/history-automatic-desktop-night-before.webp) | [截图](screenshots/history-automatic-desktop-night-after.webp) |
| 历史列表 | 桌面 · 日间 | [截图](screenshots/history-automatic-desktop-day-before.webp) | [截图](screenshots/history-automatic-desktop-day-after.webp) |
| 历史列表 | Pixel 7 · 夜间 | [截图](screenshots/history-automatic-mobile-night-before.webp) | [截图](screenshots/history-automatic-mobile-night-after.webp) |
| 历史列表 | Pixel 7 · 日间 | [截图](screenshots/history-automatic-mobile-day-before.webp) | [截图](screenshots/history-automatic-mobile-day-after.webp) |
| 历史预览 | 桌面 · 夜间 | [截图](screenshots/history-preview-desktop-night-before.webp) | [截图](screenshots/history-preview-desktop-night-after.webp) |
| 历史预览 | 桌面 · 日间 | [截图](screenshots/history-preview-desktop-day-before.webp) | [截图](screenshots/history-preview-desktop-day-after.webp) |
| 历史预览 | Pixel 7 · 夜间 | [截图](screenshots/history-preview-mobile-night-before.webp) | [截图](screenshots/history-preview-mobile-night-after.webp) |
| 历史预览 | Pixel 7 · 日间 | [截图](screenshots/history-preview-mobile-day-before.webp) | [截图](screenshots/history-preview-mobile-day-after.webp) |

短屏确认截图也来自正式页面。

- 预设恢复默认：[1024×520](screenshots/preset-confirm-desktop-short.webp)、[392×420](screenshots/preset-confirm-mobile-short.webp)。
- 历史覆盖确认：[901×600](screenshots/history-confirm-desktop-short.webp)、[375×420](screenshots/history-confirm-mobile-short.webp)。

## 设计稿与正式界面差异

- 沿用项目的 900px 抽屉断点。窄桌面历史预览把导航放到内容上方，保留正文与继续操作两栏。手机预览改成单列。
- 主角与城市只使用已有摘要。城市沿用存档馆对标题后缀的识别，无法识别时省略。容量使用浏览器估算值，样稿中的示意值与节点未纳入正式界面。
- 保存并生效、手动收藏与恢复仍使用原有文案及业务入口。历史分组切换和预设单选控件换成按钮后，端到端测试改用可访问名称和 ARIA 状态定位。

## 文件

| 文件 | 用途 |
| --- | --- |
| `src/ui/settings/PeintureSettings.tsx`、`src/ui/settings/peinture-settings.css` | 预设分区、表单、响应式布局与底栏反馈 |
| `src/ui/history/HistorySaves.tsx`、`src/ui/history/history-saves.css` | 存档列表、只读预览、节点内操作与危险确认样式 |
| `src/ui/settings/TavernAssistant.tsx` | 复用已有脚本状态显示 |
| `src/app/App.tsx`、`src/main.tsx`、`src/ui/Dialog.tsx` | 现有抽屉入口、标题摘要和仅两处启用的可视视口适配 |
| `e2e/peinture-settings.spec.ts`、`e2e/history-saves.spec.ts`、`e2e/history-visual.spec.ts` | 更新操作定位，回归持久化、读写保护、布局、可读性与截图 |

## 日间对比度与验证范围

数值为 Chromium 在测试覆盖的可见普通文字、输入边界和开关中测得的最低值。

| 界面 | 设备 | 普通文字 | 输入及开关 |
| --- | --- | --- | --- |
| 预设设置 | 桌面 | 4.76:1 | 3.37:1 |
| 预设设置 | Pixel 7 | 5.27:1 | 4.03:1 |
| 历史存档 | 桌面与 Pixel 7 | 4.61:1 | 3.61:1 |

手机短视口用于模拟软键盘占用。物理设备、Safari 和真实输入法未验证。所有模型请求均使用 Mock。

## 同步前测试记录

当时的代码与测试提交为 `7b05ef056796d7e6b23864a1acaca34049dc9d3c`。Node 为 v24.19.0，Chromium 为 154.0.8037.57。双端共 62 个独立浏览器用例，桌面和手机各 31 个。按文件拆分执行，复跑与首轮结果未重复累加。

| 检查 | 命令或范围 | 结果 |
| --- | --- | --- |
| 依赖安装 | `npm ci --offline --no-audit --no-fund` | 退出码 0 |
| 完整工程检查 | `VITEST_MAX_WORKERS=1 npm run check` | 退出码 0，文件名、ESLint、TypeScript、生产构建通过，197 个 Vitest 文件共 4,737 项通过 |
| 提示词 | `npm run prompts:check` | 退出码 0，93 项通过 |
| 相关单测 | `npx vitest run src/tests/peinture-settings.test.ts src/tests/history-saves.test.ts src/tests/preset-story.test.ts --maxWorkers=1` | 86 项通过，已包含在全量计数 |
| 历史操作与预设功能 | `npx playwright test e2e/peinture-settings.spec.ts e2e/history-saves.spec.ts` | 首轮 50/54，剩余 4 项分别复跑通过 |
| 历史视觉与只读操作 | `npx playwright test e2e/history-visual.spec.ts` | 首轮 7/8，剩余 1 项复跑通过 |
| 差异 | `git diff --check origin/main...HEAD` | 退出码 0 |

### 首轮失败与对照

- 桌面日间历史截图及手机的中断诊断证据曾因临时盘空间不足而写入失败。清理本轮中间产物、使用单 worker 和独立输出路径后，原断言通过。
- 桌面五次撤回场景首次在 5 秒等待窗口内仍处于 World 生成中。干净主干的桌面和手机对照，以及本分支的单 worker 桌面复跑均通过。原等待窗口和业务断言均未调整。
- 旧 `invalid-story` 夹具用 `not JSON` 作为应拒绝的辅助规划。干净主干的桌面与手机均复现了正文被合法保存的行为。将夹具改为空的必需短期记忆后，双端均验证了已收到正常结束的上游响应、Story 校验失败、未保存草稿和单次请求。正式解析与校验规则没有改动。

改版前历史列表与真实预览在干净主干的双端、日夜四项补拍全部通过。原始截图、computed style 和命令日志保存在工作区证据目录。

## 同步 #209 后的复验

最终代码提交为 `5cf01a3477217ce0fb47a394064e161c2e2b6ba6`。本 PR 只读取现有诊断快照。在预设名片显示「脚本运行时异常」时，原行仍显示「已初始化」，原错误详情可展开。#209 的脚本宿主、事件处理和请求规则均保留。

| 最终检查 | 结果 |
| --- | --- |
| Node 24 `npm run check` | 退出码 0，4,738 项 Vitest 通过，ESLint、TypeScript 与生产构建通过 |
| `npm run prompts:check`、`git diff --check` | 退出码均为 0，提示词 93 项通过 |
| 预设、历史、预设正文、脚本宿主定向 Vitest | 187 项通过，已包含在全量计数 |
| `peinture-settings.spec.ts`、`history-saves.spec.ts`、`tavern-script-errors.spec.ts` 定向 Chromium | 桌面 13/13，手机 13/13，无失败或跳过 |

Chromium 复测包括预设保存、失败重试、初始化与运行时诊断、迟到 iframe 任务隔离，以及历史预览和取消覆盖。同步前 62 项和最终定向 26 项分别记录。截图中的正常状态界面未受 #209 的诊断显示变更影响。
