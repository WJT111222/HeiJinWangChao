# 游玩须知与王朝公告

基线：最新远端 main `5d9caba0db29e27e3a7dd0ebb1cbb59efe799710`。
分支：`codex/startup-notices`。本次仅涉及阅读界面、公告偏好和对应测试。

## 页面与交互

此前首页直接进入游戏或设置，没有游玩须知和更新公告。现在每次整页加载先显示「黑金王朝 · 游玩须知与免责声明」，关闭后显示「王朝公告」，再次关闭即可使用原界面。

- 免责声明包含醒目的 18+ 标识和六段说明；公告包含 Demo 主题、五项更新及指定开发者寄语。
- 两张弹窗均复用原生 Dialog 的关闭、Escape、焦点约束和焦点归还；长内容在弹窗内部滚动。
- 底部仅显示同一行复选框与「今日不再弹出」，不附额外小字。
- 首页和设置分类栏提供两项手动入口。手动查看只打开所选内容，不串联另一个弹窗；关闭后回到原位置，设置编辑内容保留。
- 公告正文集中在 `src/ui/notices/announcement.ts`，日后更新内容无需修改流程。免责声明文案在 `disclaimer.ts`。

实测截图：[桌面免责声明](docs/screenshots/startup-notices-desktop.png)、[移动端公告](docs/screenshots/startup-notices-mobile.png)。关闭按钮与底部勾选固定可达，较长内容向下滚动阅读。

## 日期与生命周期

`useNotices()` 由 App 单实例持有，仅在页面初始化时读取偏好。不会根据路由、存档、候选或设置变化重新启动。React StrictMode 的重复初始化只读数据，不写入或发送请求。

唯一新增存储键为 `heijin.notices.hidden-on.v1`，值为设备本地 `YYYY-MM-DD`，通过 `getFullYear/getMonth/getDate` 取得，不使用 UTC 日期，也不读取游戏世界时钟。

勾选立即保存本地当日，取消仅删除这个键。两张弹窗共享状态；勾选第一张不会跳过本次第二张，第二张可以撤销。同日后续加载跳过两张，日期不同则恢复展示。跨日不会打断正在游玩的页面，只影响下次加载；手动入口会重新读取当日偏好。

读取属性、读取键、写入或移除失败均捕获：当前页面仍可勾选和关闭。浏览器拒绝存储时，无法保证下次加载记住免打扰；若删除偏好失败，旧的当日值也可能仍存在。为遵循简洁交互要求，不新增阻挡游戏的报错或小字。

## 修改范围

| 文件 | 修改 |
| --- | --- |
| `src/ui/notices/announcement.ts` | 独立维护更新公告 |
| `src/ui/notices/disclaimer.ts` | 六部分正式说明 |
| `src/ui/notices/preferences.ts` | 本地日历日与容错读写 |
| `src/ui/notices/useNotices.ts` | 本次页面的顺序、共享勾选和手动入口 |
| `src/ui/notices/Notices.tsx` | 两张弹窗及共用查看按钮 |
| `src/ui/Dialog.tsx` | 可选样式类、关闭按钮无障碍名称；原默认行为保留 |
| `src/app/App.tsx` | 页面级状态、首页入口、设置动作传递 |
| `src/ui/settings/SettingsPanel.tsx` | 重新查看入口，不卸载现有设置内容 |
| `src/app/styles.css` | 黑金样式、内部滚动、固定底部勾选区域 |
| `src/tests/notice-preferences.test.ts` | 13 项日期与存储异常测试 |
| `e2e/startup-notices.spec.ts` | 首次访问、两步流程、共享勾选、刷新、日期、手动入口、异常、键盘与移动端 |
| `e2e/helpers/test.ts` 及 30 个现有 E2E 文件的 import | 既有非公告场景预置当日已读偏好；测试断言未删除或放宽 |
| `e2e/game.spec.ts` 的手工历史夹具 | 模拟已提交回合时同步清除 main 新增的开局初始化标记，不修改 Schema |

生产代码没有测试专用旁路。新增公告 E2E 使用原始 Playwright `test`，不会预置免打扰；既有 E2E 使用共用 fixture，将测试起点明确设为已经阅读公告。每次运行均使用独立浏览器测试上下文。

未改动正式存档、Schema、迁移、领域命令、三个生成阶段、Prompt、模型路由、自动结算或产品版本。没有新增依赖、API 请求或收费场景。

## 验证记录

| 检查 | 本次结果 |
| --- | --- |
| `npx vitest run src/tests/notice-preferences.test.ts` | 13 / 13 通过 |
| `npm run check`（最终代码及夹具） | 75 文件、2310 / 2310 通过；Lint、TypeScript、生产构建通过 |
| `npm run prompts:check` | 3 文件、82 / 82 通过 |
| Chromium 相关桌面／移动回归 | 最终单批 94 / 94 通过：desktop 47、mobile 47；0 失败、0 跳过，5.3 分钟 |
| `git diff --check` | 通过 |

相对 main 新增 13 项工程测试、12 个浏览器场景（桌面与移动各执行一次）。没有调用真实模型。构建保留已有的大包体积提示，未为本任务修改分包配置。

浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/startup-notices.spec.ts e2e/game.spec.ts e2e/game-window.spec.ts \
  e2e/ai-route-persistence.spec.ts e2e/automatic-settlement.spec.ts \
  e2e/opening-life.spec.ts e2e/unreadable-saves.spec.ts \
  --project=desktop --project=mobile
```

覆盖新公告流程，以及创角、存档读写／坏记录管理、设置保存、全窗口布局、连续自动结算、World 失败恢复等相关功能。未重跑本次范围之外的全库浏览器用例。

开发过程中先修正了浏览器故障注入测试的 TypeScript 可选参数类型；截图检查发现全局 label 纵向样式影响复选框，将公告局部样式改为横排并加入断言。没有改动其他表单样式。

首轮相关浏览器回归 92 通过、2 失败、0 跳过。既有「五步完整创建、返回修改及刷新恢复」用例在桌面和移动端均出现读取失败：它直接写 IndexedDB 模拟第 2 回合，清除了 `openingTimePending`，但保留 main 新增的 `openingInitializationPending`。真实 `GameStateSchema` 复现返回「开局初始化标记仅限尚未执行命令的新存档」，清除该标记后同一状态通过。只补齐夹具在模拟正式提交时的标记清除；原有断言及生产保存逻辑未放宽。初次失败的 Trace 与日志保留在本次工作环境的 `/tmp/startup-notices-first-failure/`。

修正后重新运行上述完整相关集合，94 项全部通过，两个创角用例均恢复通过。最终工程、提示词和浏览器日志分别为 `/tmp/startup-notices-final-check.log`、`/tmp/startup-notices-prompts.log`、`/tmp/startup-notices-final-e2e.log`。实现代码提交为 `f388091e9fe318c451bc95246201aae3877b451a`；此后仅补充本报告，无生产代码或测试逻辑变动。

## 边界

全部网络场景使用 Mock，未调用真实付费模型；日期测试覆盖上海和洛杉矶本地午夜。移动端为 Chromium Pixel 7 模拟及 320×568 窄屏，未进行真实手机或 Safari/Firefox 验证。

免打扰依赖当前浏览器同源 localStorage，不跨设备同步，也不作为年龄认证或法律同意记录。未增加倒计时、实名验证、后台服务或自动修复。

不自动合并，不主动部署生产环境；如 PR 产生预览环境，属于仓库现有自动流程。
