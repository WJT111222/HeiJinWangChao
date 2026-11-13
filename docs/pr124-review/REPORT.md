# PR #124 最小整改与定向验收

针对[九代目正式复审](https://github.com/WJT111222/HeiJinWangChao/pull/124#pullrequestreview-5883869421)，保留分类列表、原文页和高级两栏布局，修正保存入口和预览失效。

## 修改

- `SettingsPanel` 在提示词管理页显示原有「保存本地设置」按钮，继续调用同一个 `save()`、Schema 和 `onSave`。管理页的 `role=status` 在电脑和手机上都提示未保存；再次编辑会清除上次保存成功的提示，并恢复普通提示级别，避免继续显示成功颜色。未新增存储路径，没有自动保存。
- 列表和原文中的四个开关共用 `changePrompt()`：先调用原有 `invalidate()`，再通知父组件。旧预览和统计立即清空，要求重新组装；generation 同步递增，使旧任务的成功、失败和 finally 均不能写回新任务状态。原文开关补充明确的无障碍名称。
- 手机管理页增加 sticky 保存栏；桌面继续使用设置外壳原有 sticky 保存栏。
- `e2e/prompt-inspector.spec.ts` 增加保存/刷新及四开关竞态场景，补充变量文本/JSON原文精确比对和截图。移除设置测试中不必要的 `openGameTools()`：#123 手机工作流是弹窗，打开后会挡住后续设置/资料操作；原业务断言均保留。
- `playwright.pr124.config.ts` 显式只选 15 个场景，避免误跑全量 E2E。

## 分支整合与范围

无冲突合并最新 main `ae342d6008d298eac8b2efb3bb59daf94295040e`，本地合并提交 `b71b666`；包含 #123 手机第二批设置、弹窗、选择器和公告成果。

[范围核验](preservation.json)：相对该 main，产品源码只有 `PromptInspector.tsx`、`SettingsPanel.tsx` 和专用 `prompt-manager.css` 有差异。Prompt、manifest、组装/选择器、模型路由、正式存档协议、Dialog、ThemedSelect、手机诊断、公告、wrangler、依赖清单及锁文件均保持一致。

## 执行环境与命令

Node **v24.19.0**、npm **11.9.0**，真实系统 Chromium **154.0.8037.57**。没有类型垫片；没有执行部署命令或调用付费模型。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | 通过 |
| Lint | `npm run lint` | 通过（零警告） |
| Build | `npm run build` | 通过（有既有的大 chunk 提醒，未为此扩展范围） |
| 定向 Vitest | `npm run test -- src/tests/prompt-inspector.test.ts src/tests/prompt-runtime.test.ts src/tests/mobile-feedback.test.tsx` | 3 文件、77 项通过 |
| 定向 Chromium | `npx playwright test --config playwright.pr124.config.ts` + 下述复测 | 15 个唯一场景的最终结果均通过；见分轮记录 |

命令日志位于 [logs](logs)，环境版本见 [environment.txt](logs/environment.txt)。依赖安装使用临时 npm cache，未修改锁文件。

## Chromium 覆盖

- **1440×900 / 390×844，各 5 项**：分类与搜索、真实模块原文、变量文本/JSON双格式及阶段切换；真实存档六模式预览、排序保存/刷新/恢复；Mock实际快照的主动查看、去密钥与刷新清除；四开关列表/原文/提示词页联动、未保存刷新丢弃和显式保存刷新保留；四开关竞态。
- **桌面 4 项旧业务入口**：正文流式生成、变量候选、世界候选、独立记忆维护。所有 HTTP 生成均被 Mock 拦截。
- **手机 1 项 #123 回归**：模型选择器无匹配、Tab 环、Esc、遮罩和仅关闭顶层。
- 竞态使用测试内的存档读取闸门，并只在测试响应里包装真实离线组装器以观察完成。依次对四个开关交替从列表/原文修改：旧预览清空 → 启动新任务 → 放行旧任务 → 新任务仍忙且没有旧预览 → 放行新任务 → 当前结果才有效。未向产品添加测试旁路。

没有运行 `npm run test:e2e` 或 `npm run check` 全链，没有运行 300/1000 NPC Worker 重负载场景。

## 分轮记录

首轮 12 通过、3 失败：[原始日志](logs/chromium-initial.txt)。两项是新竞态测试的观测包装遗漏导出，一项是旧手机测试先开工作流弹窗挡住了资料入口，均已修正测试。随后竞态主体断言已通过，但测试结束前仍保留读取闸门，使最终只读存档核验超时；已在核验前恢复原读取方法。产品代码未因这些测试脚本问题增加旁路或放宽断言。手机导航另补充等待游戏界面加载完成。第二轮 11 通过、4 失败：[日志](logs/chromium.txt) / [JSON](chromium-results.json)；另一次复测错误地复用了该轮即将关闭的 Vite 服务，出现连接拒绝：[日志](logs/chromium-server-interruption.txt)。已改为独立顺序运行，不将环境故障记为产品通过。

最终独立复测：

- 预览/排序/竞态双端及手机选择器：**5/5 通过**（[日志](logs/chromium-recheck.txt) / [JSON](chromium-recheck-results.json)）。命令：`npx playwright test --config playwright.pr124.config.ts --grep '四开关取消旧组装|真实存档六种模式预览|底部选择器：无匹配' --output test-results/pr124-final --reporter=list,json`。
- 保存成功后再次编辑时同时重置提示颜色，并新增断言；双端保存流程 **2/2 通过**（[日志](logs/chromium-save-recheck.txt) / [JSON](chromium-save-recheck-results.json)）。命令：`PLAYWRIGHT_JSON_OUTPUT_NAME=docs/pr124-review/chromium-save-recheck-results.json npx playwright test --config playwright.pr124.config.ts --grep '四开关显式保存' --output test-results/pr124-save-final --reporter=list,json`。
- [汇总](validation-summary.json) 按项目和场景记录每项的最新结果：**15 个唯一场景最终全部通过**。保留各轮失败记录，不宣称一次全绿。

## 真实界面截图

均来自运行中的 React 页面，CSS 像素尺寸为 390×844 和 1440×900；已查看手机与电脑的列表、未保存状态、原文/格式、高级与预览失效界面。

| 画面 | 手机 | 电脑 |
| --- | --- | --- |
| 列表 | [390](screenshots/390-list.png) | [1440](screenshots/1440-list.png) |
| 四开关未保存与保存入口 | [390](screenshots/390-unsaved.png) | [1440](screenshots/1440-unsaved.png) |
| 显式保存成功 | [390](screenshots/390-saved.png) | [1440](screenshots/1440-saved.png) |
| 文本变量原文 | [390](screenshots/390-source-text.png) | [1440](screenshots/1440-source-text.png) |
| JSON变量原文 | [390](screenshots/390-source-json.png) | [1440](screenshots/1440-source-json.png) |
| 原文开关未保存 | [390](screenshots/390-source-unsaved.png) | [1440](screenshots/1440-source-unsaved.png) |
| 高级预览 | [390](screenshots/390-advanced.png) | [1440](screenshots/1440-advanced.png) |
| 开关修改后的预览失效 | [390](screenshots/390-preview-invalidated.png) | [1440](screenshots/1440-preview-invalidated.png) |

## 协作提示

后续手机第三至第五批不要重写 `PromptInspector.tsx` 内部和 `prompt-manager.css`。若设置外壳修改 `SettingsPanel.tsx`，后合并者同步最新 main，保留 `onPromptChange` 和本次手动保存入口、未保存提示；不保证仅一行冲突。

## 交付与部署边界

保持原 PR #124，等待九代目复审，不合并。用户已明确允许现有 Cloudflare 自动 Preview 随新 HEAD 更新。**自动 Preview 已运行，未进行生产部署**；没有执行手动部署，没有修改正式域名或生产 KV。原 HEAD 的自动 Preview 已有 PR 机器人记录，新 HEAD 的状态以 PR 最新检查和机器人记录为准。
