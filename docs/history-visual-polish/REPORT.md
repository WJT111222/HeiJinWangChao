# PR #181 历史存档：视觉精修与文案减负

2026-11-17（北京时间）。交十四代目复审；保持原 Draft PR，不合并、部署或发布公告。

## 基线及隔离

- 原分支：`feat/history-save-timeline`；原审查 HEAD `07dd07a042b06ced79960046fe50d201e1313a23`，开工核对一致。
- main：`4ef1093ed82e05ce76583ab3ba7cafbdf61249a4`。
- 最终生产代码：`af54a4aed5d60630eb1118067e59bc3beaa87d32`；测试增加截图等待展开完成的选项后为 `4d5b8f17d4cb9e74db49d30d63bdcb9c4b806c51`。其后只增加本报告和证据，最终 HEAD 见 PR。
- 本轮生产修改仅 `src/ui/history/HistorySaves.tsx` 与 `src/ui/history/history-saves.css`。共享 Dialog、SaveCard、MobileHomeScreen、Repository、codec、Worker、Schema、事务、CAS、Undo、模型和 Prompt 均未更改。
- 测试新增 `e2e/history-visual.spec.ts`，原 `e2e/history-saves.spec.ts` 仅更新“正在读取历史存档…”文字等待。未删除、跳过或放宽业务断言。
- `isolation-final.json` 验证组件控制流、27 个 JSX 事件回调（仅排除 setMessage 的状态文案字面量）与原 HEAD 一致。没有重新实现历史系统。

## 视觉与文案

阅读了原桌面/手机面板交接、现有历史测试截图，沿用本作档案纸、黑金边线、中文标题和原生全屏抽屉。

- 夜间采用墨绿黑档案底和香槟金；日间改为米金纸页与深墨文字。全部变量定义在 `dialog.history-saves` 内。
- 节点用回合印签、名称、日期、主角分层；自动历史、手动收藏、旧时间线使用明确文字及局部边色区分。没有增加英文口号或“重要人生节点”式装饰文案。
- 1100px 以上操作列靠右，901px 矮屏保留下面操作区；手机两列按钮自动排布，长名完整换行。
- 详情内的经济金额显式使用当前历史主题，避免日间浅字。按钮主题切换不再出现深底/深字过渡混色，悬停边框也有独立对比度。
- 删除及永久删除采用赭红；收藏、确认覆盖采用金色深字；预览、导出、返回、刷新、取消保持中性。原禁用条件、两步确认、回焦和危险操作回调均保留。
- 普通界面只展示节点与必要提醒；容量、浏览器配额收进“存储详情”，节点容量/收藏日期/来源收进“详情”，保留全部数据可达。

最终主要文案：

| 位置 | 最终文案 |
|---|---|
| 顶部 | 自动保留最近 5 个恢复点；手动收藏不会自动轮换删除。 |
| 始终可见备份提醒 | 普通备份不含历史收藏，重要节点请单独导出。 |
| 操作 | 收藏、刷新、预览、导出、重命名、删除、返回列表、从此继续、确认覆盖、取消、永久删除 |
| 覆盖警告 | 从第 N 回合继续，将覆盖第 N+1～M 回合的剧情与状态〔或当前进度〕，并清除现有恢复点和未结算内容。无法撤销，手动收藏会保留。 |
| 覆盖补充后果 | 确认后保存此进度并生成下一章；即使生成失败，也不会恢复被覆盖的时间线。 |
| 删除警告 | 删除「名称」后无法恢复，当前进度不受影响。重要节点请先导出。 |

预览、删除、覆盖等按钮保留上下文完整的 aria-label，便于读屏区分目标/操作，同时屏幕上显示短词。没有用技术说明替代可见风险提示。底层既有安全错误/损坏提示保持原样。

## 验证

Node 24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57；真实锁定依赖、Vitest 和 Playwright。全部使用隔离合成数据，AI 仅 Mock。

最终成绩以文案精简后的 copy-* 批次为准，不与追加要求前批次相加。

| 检查 | 结果 | 退出码 |
|---|---|---|
| npm ci | 143 包安装成功 | 0 |
| 最终 npm run check（copy-check） | 178 文件、4297 单测通过；Lint、TypeScript、catalog、Build 通过 | 0 |
| npm run prompts:check | 93 通过 | 0 |
| 历史/恢复/损坏主档/备份/Undo 定向 Vitest | 6 文件、86 通过 | 0 |
| 最终原历史功能 Chromium（copy-functional） | 20 通过，0 失败/跳过 | 0 |
| 最终视觉 Chromium（copy-shots） | 8 通过，0 失败/跳过 | 0 |
| git diff 07dd07a --check | 通过 | 0 |

Prompt 93 和定向 86 属于完整 Vitest 子集，不重复累加。原历史功能测试和新增视觉测试分别记录，未运行无关全量浏览器。

视觉矩阵为 PC 1440×900、PC 矮屏 901×600、手机 390×844、手机短屏 375×667，各夜间/日间。每组查看自动列表、24 个收藏、分页与旧时间线、删除确认、只读预览、长正文底部、人物、经济和覆盖确认。检查 Repository 浏览前后相等、0 个模型请求、关闭回焦、触控尺寸、内部滚动、页面和容器无横向溢出。使用现有全屏 sheet，未改滚动锁或 Dialog 生命周期。

原功能套件完整覆盖：自动五节点、命名/重开/重命名/删除、单节点标准备份导出、覆盖确认/取消、回溯后继续三阶段和纯小说、旧预览/CAS/配额故障/正式删除、跨标签锁、容量与分页、续写保护、历史根连续五次撤回，以及损坏主档导出不解锁收藏删除的 P1 保护。所有业务断言沿用原文件。

## 对比度、焦点和触控

最终 computed styles 的每组测量写入 `contrast-summary.json`；完整前景/祖先背景/透明度合成、控件颜色、几何和滚动数据按组压缩保留。不是仅检查颜色深浅或 DOM 存在。


| 平台 / 尺寸 | 主题 | 最低文字 | 最低按钮边界 | 最低输入边界 |
|---|---|---|---|---|
| desktop 1440x900 | day | 4.61:1 | 3.61:1 | 3.61:1 |
| mobile 390x844 | day | 4.61:1 | 3.61:1 | 3.61:1 |
| desktop 901x600 | day | 4.61:1 | 3.61:1 | 3.61:1 |
| mobile 375x667 | day | 4.61:1 | 3.61:1 | 3.61:1 |
| desktop 1440x900 | night | 7.85:1 | 4.33:1 | 4.76:1 |
| mobile 390x844 | night | 7.85:1 | 4.33:1 | 4.76:1 |
| desktop 901x600 | night | 7.85:1 | 4.33:1 | 4.76:1 |
| mobile 375x667 | night | 7.85:1 | 4.33:1 | 4.76:1 |

8 组测量无文字/控件失败，所有启用按钮实际高度至少 44px。文字以实际前景与有效背景计算；输入/选择器沿用既有合成检查，另检查所有有可见边框的启用按钮与其外侧背景。纸面与控件采用实色，无需用未知纹理猜测对比度。所有启用按钮实际高度至少 44px；禁用按钮保留原生 disabled 与 .58 透明度，禁用状态不冒称适用普通文字对比度门槛。

原 HEAD 对照日间曾发现文字最低约 1.07:1，经济金额约 1.31:1；夜间原本可读。精修过程中发现并修复日间经济浅字、共享悬停深底、主题过渡混色和悬停边框 2.72:1，不改其他页面。

## 批次与失败记录

- `before-final` 为独立原 HEAD 工作树、相同 Node/Chromium/Mock 的真实前图：4 夜间通过/4 日间对比度失败；完整截图均保留，未将 baseline 失败算作本次新回归。
- 最早 `before`/`baseline` 的合成夹具错误使用关闭阶段后又写候选，被正式校验拒绝；只改测试夹具的阶段配置，未改安全规则。`before-clean`、`after-first` 后来因误假定旧收藏一定在第二页等待超时，开发中中断，保留日志。最终测试按既有排序实际定位旧节点，不改变产品排序。
- `after-first` 还发现日间金额/悬停可读性失败；`after-third` 8 项通过，但属于精修中间版本。
- `visual-final` 7 通过/1 失败，抓到悬停按钮边框 2.72:1，修复后 `visual-complete` 8 通过。追加文案要求后又完整运行 `copy-visual`，该批 8 项通过；审图发现少数截图处于抽屉淡入中间帧后，统一用 Playwright animations:disabled 获取展开完成状态（未改产品动画），copy-shots 再次 8 项通过，为最终截图和视觉验证。原 HEAD 的 before-shots 只采集相同 8 组列表前图，8 项通过，不计入产品功能场景。
- 首轮原功能批 `functional` 出现一项日间瞬间混色；过程中 Vite 输出 `Killed`，随后连接拒绝，整批失败。没有将连接失败归为存档缺陷或冒称通过。降低并发、独立端口重跑 `functional-complete` 20 通过。追加文案要求后再完整运行 `copy-functional`，单独计数。
- 外部功能配置首次引用 @playwright/test 的路径错误，`functional-final` 未执行用例；改为导入项目现有配置。没有替代运行器。
- 第一轮正式 `check` 和其后的 `check-final/check-complete` 均为 4297 通过的独立批次；最终文案以 `copy-check` 为准，不重复计数。
- 构建有既有大 chunk 警告、退出码 0；未扩展到打包优化。

所有原始日志/exit 在 `raw-logs.zip`，包含失败、中断及各次重跑，没有篡改原文。原工作区完整 trace 路径 `/workspace/history-visual-evidence/`；截图和关键计算数据随本报告保存。

## 截图与复核

前图来自 `07dd07a` 的独立 worktree，后图来自最终文案批次的真实 React。`screenshots/before/` 为原版自动列表；`screenshots/after/` 包含 8 组主题/视口下的各关键状态。`comparisons/` 为原图等比例排版的并列对照，不是设计稿或生成图。

复核命令：

```sh
npm ci
VITEST_MAX_WORKERS=2 npm run check
npm run prompts:check
npx vitest run src/tests/history-saves.test.ts src/tests/history-recovery-protection.test.ts src/tests/history-capacity.test.ts src/tests/unreadable-saves.test.ts src/tests/turn-undo.test.ts src/tests/save-backup-upgrade.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config playwright.history-saves.config.ts --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/history-visual.spec.ts --workers=1
git diff 07dd07a --check
```

实际使用项目原双端配置，外部配置仅指定独立端口（功能 55925、视觉 55924；原 HEAD 55922）、输出目录和 worktree；retries=0。完整检查使用 Vitest 官方环境变量限 2 workers，浏览器各单 worker，避免资源争用；未缩小测试集合或增加重试。

## 结论与限制

结论：本轮视觉精修及文案减负通过，未发现新增功能性回归。原功能套件最终单批 20 通过，视觉最终单批 8 通过，均无失败/跳过。没有对历史存储、回溯、备份及事务进行功能改造。未调用收费模型，未使用真实玩家存档。没有真实 iPhone Safari 验收；本轮是 Chromium 双端模拟，真实工具栏/键盘/安全区仍建议真机视觉确认。不自动合并或部署，等待十四代目复审。

### 快速查看

- 前后对照：[PC 夜间](comparisons/desktop-night.png)、[PC 日间](comparisons/desktop-day.png)、[手机夜间](comparisons/mobile-night.png)、[手机日间](comparisons/mobile-day.png)。
- 最终手机短屏：[自动历史](screenshots/after/mobile/day-short-automatic.png)、[旧时间线与分页](screenshots/after/mobile/day-short-page2-old.png)、[覆盖确认](screenshots/after/mobile/day-short-overwrite.png)、[删除确认](screenshots/after/mobile/day-short-delete.png)。
- 最终 PC：[手动收藏](screenshots/after/desktop/night-normal-manual.png)、[历史预览](screenshots/after/desktop/day-normal-preview.png)、[长正文底部](screenshots/after/desktop/day-short-long-reading-bottom.png)。
