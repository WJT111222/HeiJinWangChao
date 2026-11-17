# PR #181 · 损坏主档收藏删除保护返修证据

- 原 HEAD：`1d070559e17fbc9a472cce0df0639cae768031f2`。
- main：`4ef1093ed82e05ce76583ab3ba7cafbdf61249a4`（开工重新 fetch，未变化）。
- Node v24.19.0 / npm 11.9.0。新 HEAD 见 PR，源码及测试对应 `tested-files.sha256`，在仓库根验证。
- 所有数据为合成状态，所有模型为 Mock；没有玩家存档、真实密钥或真实 API。

## 截图

| 流程 | PC 1440×900 | 手机 Chromium 390×844（Pixel 7 模拟） |
| --- | --- | --- |
| 不完整原始导出明确提示 | [截图](desktop/unreadable-export-warning.png) | [截图](mobile/unreadable-export-warning.png) |
| 删除被阻止，数据保持原样 | [截图](desktop/unreadable-delete-protected.png) | [截图](mobile/unreadable-delete-protected.png) |
| 用损坏前的标准备份恢复主档 | [截图](desktop/unreadable-recovered.png) | [截图](mobile/unreadable-recovered.png) |

恢复使用测试损坏前通过真实 UI 导出的标准节点备份，**不是** V1 原始数据文件。恢复后比较收藏的每个压缩字节、完整解码状态、其他存档记录及零模型 POST。手机不是实机验收。

## 原始记录

`raw-logs.zip` 保留独立批次 `.log`、`.exit` 及失败的原始 Playwright error-context，未清洗或改写。SHA-256 见 `raw-logs.sha256`（在本目录执行 `sha256sum -c raw-logs.sha256`）。

- `recovery-before`：生产修复前新单测 4 失败 / 1 通过，证明旧实现会删掉受保护记录。
- `recovery-after`：修复后新 5 项与既有不可读存档 27 项，32 通过。
- `typecheck-first`：新增 E2E 动态导入的数据库变量缺少 IDBDatabase 注解，3 个类型错误；补正式类型后 `typecheck-second` 退出 0。无生产类型或校验放宽。
- `chromium-first`：执行环境不能启动 webServer，未进入浏览器用例，退出 1；随后在允许启动本机服务器和浏览器的环境执行。
- `chromium-second`：2 失败；手机在异步列表到达前读取车票索引，PC 刷新后未重新打开存档馆。只修测试导航与等待。
- `chromium-third`：2 通过 / 2 失败；原配额失败／正常删除双端通过。新恢复场景误将手机系统文件选择按桌面导入框操作，且 PC 导入成功会关闭原框，改为真实平台入口及存档馆成功反馈。断言全库不变、二进制一致、恢复结果及零 POST 保留。
- `chromium-final`：新版恢复用例双端 2 通过，retries=0；不是全部浏览器套件，也不与上述批次累加成一次全绿。
- `npm-ci`、`check`、`prompts`：本轮正式工程记录，完整成绩见开发报告。

完整失败 trace 仍在 `/workspace/history-save-evidence/revision1/chromium-second/` 和 `chromium-third/`（工作区不是长期备份），没有把它们称为已持久交付。可核对的原始错误及调用轨迹文本已随本证据归档。

## 复验

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/history-recovery-protection.test.ts src/tests/unreadable-saves.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config=playwright.history-saves.config.ts -g '损坏主档|旧预览冲突'
git diff --check
```

浏览器路径按机器调整。本轮不增加 retries、skip 或放宽测试条件。仍无通用的损坏收藏原始导入／导出格式，因此有收藏的损坏主档会一直保守阻止删除，直到通过既有合法备份恢复主档后进行正常管理。
