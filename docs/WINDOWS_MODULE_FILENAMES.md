# Windows 本地白屏：模块文件名兼容修复

基线：`main@0e8b75f57a6e3f07b641c76fe09bfcd3cfdf553c`。
独立分支：`fix/windows-module-filenames`。验收环境为 Linux、Node v24.19.0、Vite 8.3.4、真实 Chromium；日期为 2026-11-15 UTC。

## 原因与复现边界

主干存在三组同目录、忽略大小写后文件名主干相同的 `.ts` / `.tsx`。组件使用省略扩展名的 import；大小写不敏感文件系统可能先命中逻辑 `.ts`，而逻辑模块没有相应的 React 组件导出，符合玩家提供的 `does not provide an export named 'OpeningPacks'` 报错。

`CreationWizard` 位于应用入口依赖中，故首页即可白屏；另外两组通过 `GameScreen` 懒加载，可能进入游戏时才失败。三个逻辑文件分别提供开局包存储、正文解析、回合变化计算，不应被当作组件。

本环境没有 Windows 11。没有原生复现该 Windows 浏览器错误，也不将 Linux 构建或合成检查称为 Windows 实机通过。可重复的本地证据是：在未重命名的 main 文件树运行新检查器，退出码 1，准确报告三组；重命名后为零冲突。Linux 真实开发服务器的双端页面验证另行列出。

## 最小重命名与引用

| 原组件路径 | 新组件路径 | 保持的导出 |
| --- | --- | --- |
| `src/ui/creation/OpeningPacks.tsx` | `src/ui/creation/OpeningPacksPanel.tsx` | `OpeningPacks` |
| `src/ui/game/StoryReading.tsx` | `src/ui/game/StoryReadingView.tsx` | `StoryReading` |
| `src/ui/game/TurnChanges.tsx` | `src/ui/game/TurnChangesView.tsx` | `TurnChanges` |

使用 `git mv`，三处 Git 重命名均为 R100；[字节校验](windows-module-filenames/evidence/rename-verification.json)确认三个组件正文与 main 完全相同。因此 Props、JSX、样式与组件内部的逻辑 import 均保持原样。

实际引用更新只有：

- `CreationWizard.tsx` 的一条组件 import。
- `GameScreen.tsx` 的两条组件 import；没有修改其他内容、常驻按钮或任何回调。
- `mobile-turn-changes.test.tsx` 的一条组件 import。

三份原有小写 `.ts` 数据/逻辑文件保留；引用它们的类型、动态 import 和 E2E 不需要更改。当前可执行代码没有旧组件路径引用。历史开发报告中记录的旧路径作为历史证据保留，没有批量改写。

## 通用检查器

`scripts/check-source-filenames.mjs` 零新增依赖，扫描整个仓库的 Git 索引及未忽略、未跟踪文件，不限三个已知名称。检测：

1. 同目录、忽略大小写后同主干的 `.ts/.tsx/.js/.jsx/.mts/.cts/.mjs/.cjs/.json` 模块。
2. 文件与目录的纯大小写路径冲突。
3. Git 索引中保留、但 Windows 检出时可能已合并的路径。不能只看当前磁盘上残留的一份文件。

类型声明文件不作为运行时模块候选；正常 CSS、图片、不同目录同名模块不会因同主干而被拒绝。资源本身若存在纯大小写路径冲突仍会报告，因为它们在 Windows 上也无法可靠并存。

源码压缩包没有 Git 时回退到文件系统扫描，并在输出中明确说明。此时无法重建解压时已经被覆盖的文件名；推荐全新 Git 克隆。检查不宣称覆盖 Windows 保留名称、权限或所有 Unicode 文件系统差异。

入口为 `npm run filenames:check`，冲突或无法读取时非零退出并列出文件路径。接入 `predev`、`check` 与 `build`，开发启动前和正式验收均拦截。Git 索引代表待提交内容，文件删除/移动应使用 `git mv` 或正确暂存后再检查。

未调整 Vite `resolve.extensions`，也没有机械添加 `.tsx` 后缀。

## 验证记录

所有浏览器数据均为虚构隔离存档，外部请求被阻止。各批次分别记录，不合并数量：

| 命令/批次 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm ci` | 0 | 使用锁文件安装 143 个包 |
| 原主干文件名扫描（先红） | 1 | 3 组模块主干冲突，0 组纯大小写路径冲突 |
| 重命名后全仓扫描（后绿） | 0 | 无模块主干或纯大小写路径冲突 |
| 检查器与相关组件定向 Vitest | 0 | 5 文件、53 通过、0 失败、0 跳过；其中检查器 11 项 |
| `npm run check` | 0 | 159 文件、3906 通过、0 失败、0 跳过；文件名检查、ESLint、TypeScript、目录契约检查、生产 Build 均通过 |
| `npm run prompts:check` | 0 | 3 文件、93 通过、0 失败、0 跳过 |
| PC/手机定向 Chromium | 0 | 2 通过、0 失败、0 跳过 |
| `git diff --check` | 0 | 通过 |

完整 Vitest 用时 127.76s。生产构建仅有已有的大 chunk 提醒，未隐藏或当成失败。没有运行全量浏览器套件，没有出现需要用 main 对照归因的测试失败。检查器在原 main 报错是本任务预期的可重复红例，不是被跳过的失败。

[原始日志与退出码](windows-module-filenames/raw-logs.zip)保留各批原始字节；[重命名字节校验](windows-module-filenames/evidence/rename-verification.json)及 [PC](windows-module-filenames/evidence/startup-desktop.json)/[手机](windows-module-filenames/evidence/startup-mobile.json)结果均随 PR 提交。

新增检查器测试包括 TS/TSX、JS/JSX、混合扩展名、ESM/CJS、JSON、Git 索引大小写冲突、大小写目录、未跟踪文件、源码压缩包、正常 CSS/图片和不可读取目录。真实 Node CLI 与 Git 索引均实际执行。

新增 `e2e/module-startup.spec.ts` 经完整 React App 和 Vite 开发服务器，验证首页、五步创角导航、开局包空状态/套用、游戏懒加载、正文及六组回合变化。断言 Console 无相关模块错误、无 pageerror、模型 POST 为零，查看变化前后正式存储完全一致。

| 真实 React 截图 | PC 1440×1000 | 手机 412×839 |
| --- | --- | --- |
| 套用开局包后第五步 | [截图](windows-module-filenames/screenshots/opening-pack-review-desktop.png) | [截图](windows-module-filenames/screenshots/opening-pack-review-mobile.png) |
| 正文阅读 | [截图](windows-module-filenames/screenshots/game-desktop.png) | [截图](windows-module-filenames/screenshots/game-mobile.png) |
| 回合变化展开 | [截图](windows-module-filenames/screenshots/turn-changes-desktop.png) | [截图](windows-module-filenames/screenshots/turn-changes-mobile.png) |

首页、创角第一步及游戏未展开变化的原始截图也保存在独立验收材料中。

## Windows 11 待实机复验步骤

使用新的克隆目录与独立浏览器配置/无痕窗口，不清空玩家现有浏览器存档，不在旧源码上覆盖解压。PowerShell 逐行执行：

```powershell
git clone https://github.com/WJT111222/HeiJinWangChao.git HeiJin-Windows-Verify
cd HeiJin-Windows-Verify
git fetch origin
git switch --track origin/fix/windows-module-filenames
node --version
npm ci
npm run filenames:check
npm run check
npm run prompts:check
npm run dev -- --host 127.0.0.1 --port 5174
```

保持开发服务器运行，在新浏览器窗口访问 `http://127.0.0.1:5174`，检查首页、五步向导、开局包、游戏正文与变化面板；Console 不应再有缺少组件导出或动态模块导入错误。不要启动真实收费开局请求来验收文件名修复。

需要完整 Mock 浏览器回归时，在另一终端执行：

```powershell
npx playwright install chromium
npx playwright test e2e/module-startup.spec.ts --project=desktop --project=mobile
```

**Windows 11 26100 / Node 24.21.0 实机仍未验证，必须由持有该环境的审查者复验。** Linux 结果不能替代此项。

## 保护范围

不修改 GameState、存档、数据库、迁移、Prompt、三阶段解析/校验/Commit、AI 请求或 UI 行为。没有进入、合并或改动 Claude 的独立分支。没有付费 AI 调用、合并、部署或发布。
