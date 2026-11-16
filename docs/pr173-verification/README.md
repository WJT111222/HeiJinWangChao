# PR #173 十三代目评论处理与 Node 24 验收

日期：2026-11-16。审查意见：[review-5921416480](https://github.com/WJT111222/HeiJinWangChao/pull/173#pullrequestreview-5921416480)。

原 PR HEAD：`57e4ac85094fc979eb212bb0400793efba51cddc`，原分支 `fix/mobile-select-scroll`。本次重新 fetch 后 main 为 `4ccf92d205cc9b1d748c49c5b647eb755de3a019`，已包含 #171；PR 原共同基线为 `f36bc51aede49e4ac6edf9a0bda2138905f007c7`。main 新增内容不涉及本 PR 的两个文件，本次不合并或覆盖其他开发分支。

## 审查结论与实际处理

十三代目认可原手机选择抽屉 CSS 的修复方向，两项意见属于验收缺口，没有证据要求继续修改生产逻辑。因此本轮**不再改动生产 CSS 或脚本**，仅扩展原回归和保存证据。

1. 扩展 `e2e/mobile-select-sheet.spec.ts` 中原有 48 模型用例，保留全部浅色高亮、真实 CDP touch 滑到底和末项选择断言。
2. 选择 `[AA]model-48` 后通过原 `saveAi` 辅助操作真实点击「保存 AI 配置」，等待成功反馈，再直接核对 `heijin.ai.v1` 中正式 Story 路由的渠道 ID 和完整模型 ID。
3. 通过 Esc 关闭设置，重新打开，检查渠道文字、模型文字及模型控件 `value`；再关闭并刷新页面，重新打开后核对相同模型文字与 `value`，不以编辑态显示代替持久化验收。
4. Mock 模型服务单独计数并中止所有 POST，最终断言 **0 生成 POST**。测试没有请求真实模型，也不点击「测试回复」。
5. 使用 Node 24 执行锁文件安装、TypeScript、ESLint 与真实 Chromium 定向回归。保留主干对照的失败，不修改无关提示词测试或生产协议。

## 正式环境与结果

Node **v24.19.0**、npm **11.9.0**，Chromium **154.0.8037.57**，真实 Vite + React App。桌面使用项目默认 **1440×1000**，手机为 Pixel 7 **412×839** 视口模拟，不是 iPhone/Safari 实机。

| 批次/命令 | 通过 | 失败 | 跳过 | 退出码 |
| --- | ---: | ---: | ---: | ---: |
| PR 分支 `npm ci` | — | — | — | 0 |
| `npm run typecheck` | — | — | — | 0 |
| `npm run lint`（零警告） | — | — | — | 0 |
| 首次 Chromium 启动（沙箱本地监听 EPERM） | 0 | 未启动用例 | 0 | 1 |
| PR 分支定向 Chromium（8 项） | **4** | **2** | **2** | 1 |
| 未修改最新 main 的相同失败用例对照（2 项） | 0 | **2** | 0 | 1 |
| `git diff --check` | — | — | — | 0 |

首次启动未执行用例，属于环境监听权限限制；获准本地监听后正式执行。不同批次成绩分别报告，不合并为一次全绿，也不以 Preview Build 代替结果。本轮未运行完整 Vitest、Build 或全量 E2E，符合评论要求的最小精准补证范围。

### 本次实际通过的四项

- **mobile / 手机选择抽屉：选项远离屏幕底边；没有渠道时提示先添加渠道**：通过。
- **mobile / 手机选择抽屉：48 项滑到底、末项高亮与选择**：通过；新增保存、重开、刷新后保留模型及零生成 POST 断言全部执行通过。
- **desktop / 主题浮层的搜索、键盘、Escape、Tab 与窄屏内部滚动**：通过，PC 下拉原行为未回归。
- **mobile / 同一主题浮层搜索、键盘与滚动用例**：通过。

两个 skip 是上述两条手机专属选择抽屉用例原本在 desktop 项目下的预期跳过。本轮没有新增 skip、重试、放宽断言或删除任何旧检查。

### 两项失败及 main 同环境对照

`e2e/ai-settings.spec.ts:9`「真实浏览器加载原文、校验哈希并组装六种模式，记录模块顺序」在 desktop、mobile 两端均失败，定位到 **第 66 行的模块 ID 断言**：

```text
expected: stages.opening.variables.text
received: stages.opening.variables
```

这不是本次保存恢复或滚动失败，也不能笼统写作“提示词加载失败/环境问题”：页面已完成 Composer 调用，失败在返回模块名的旧断言。新建干净 main 工作树，独立 `npm ci`，使用相同 Node、Chromium、配置、运行器执行同一用例，**两端均在同一行发生完全相同差异**。PR 与 main 的该测试文件完全一致。本轮保留失败并不扩展修改它，未声称整个工程全绿。

## 可复现命令

```sh
node --version
npm ci
npm run typecheck
npm run lint
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/mobile-select-sheet.spec.ts e2e/ai-settings.spec.ts e2e/ai-model-selection.spec.ts \
  --grep '手机选择抽屉|真实浏览器加载原文|主题浮层的搜索' --reporter=list,json
git diff --check
```

main 独立对照命令：

```sh
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/ai-settings.spec.ts --grep '真实浏览器加载原文' --reporter=list,json
```

## 真实截图与原始证据

- [48 项选择后的编辑态](last-model-selected.png)
- [保存、关闭并重新打开后的正式模型选择](last-model-saved-reopened.png)
- [PC 下拉搜索与键盘保护截图](ai-model-selection-desktop.png)
- [手机下拉搜索与键盘保护截图](ai-model-selection-mobile.png)
- [原始日志、各命令退出码、逐例 Playwright JSON 与 main 对照失败上下文](raw-evidence.tar.gz)
- [测试与生产 CSS 源文件 SHA-256](source-sha256.txt)

原始证据中的 `chromium-final` 表示本轮正式浏览器批次，并非“全绿”；其失败和 main 对照都完整保留。截图全部来自实际项目，不是静态设计页。测试数据和凭证为合成数据，不读取玩家存档。

## 残余边界

已确认原 CSS 可使手机列表触摸滚到底，且最后模型真实保存后可重开/刷新恢复，没有发现需追加生产修复的新问题。仍存在上述与本 PR 无关的双端旧提示词断言失败；未验证 Safari/iPhone 实机。本轮没有改 AI 保存逻辑、模型路由、Prompt、Schema、游戏状态或结算，不更新 main，不合并、不手动部署、不发布。交十三代目复审。
