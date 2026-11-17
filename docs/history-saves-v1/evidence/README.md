# 合成测试证据

本目录根级日志与源码哈希对应返修前 `1d070559e17fbc9a472cce0df0639cae768031f2`；应在该提交核验原哈希。本轮 P1 返修证据与新哈希独立保存在 [revision1](revision1/README.md)，不覆盖旧成绩。

开工基线 `6e013f47db4ae7947e8218e44f1f917b1fc1f976`；随后无冲突 rebase 至 `4ef1093ed82e05ce76583ab3ba7cafbdf61249a4`。`*-main-sync` 日志及 `main-sync/` 为最新基线证据，其他批次不冒充同一版本；本目录随实现提交。业务代码与测试的 SHA-256 在 `tested-files.sha256`，可在仓库根运行 `sha256sum -c docs/history-saves-v1/evidence/tested-files.sha256` 核对。最终 Git HEAD 见本 PR，避免在提交内部写入不可能自洽的自身 SHA。

- `raw-logs.zip` 内的 `logs/`（校验值见 `raw-logs.sha256`）：独立批次原始输出及实际 exit；中断与失败没有删除。`check-first` 为完整失败批次，`check-second-interrupted` 明确未完成。`*-before` 是先红证据。`types-ui` 是实现期间首次 TypeScript 报错记录，随后修复类型边界。不要把子集加到完整成绩。
- `main-sync/desktop/` 为最终主干同步截图；`final-export/` 为末次导出尺寸检查后的默认配置双端截图。根目录 `desktop/`、`mobile/` 保留合流前记录，不混称为最新 HEAD。
- `desktop/`：Chromium 1440×900；日间窄屏 901×600。
- `mobile/`：Chromium Pixel 7 模拟，390×844；日间短屏 375×667。截图物理像素受设备 DPR 影响，不是 iPhone/Android 真机。
- `browser-capacity.json`：真实浏览器 Worker、IndexedDB 和完整状态往返测量，开发服务器、合成重复文字；不是生产玩家容量保证。
- `day-contrast.json`：实际 computed styles、前景/背景合成、对比度与控件边界。未隐藏失败元素。
- 压缩包内 `logs/chromium-third-timeout-actions.json` 与对应 error-context 保留超时动作轨迹摘要；完整原始 trace 位于执行工作区 `/workspace/history-save-evidence/chromium-third/`，约 11 MB，未作为长期可下载备份承诺。

复验（Node 24）：

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/history-saves.test.ts src/tests/unreadable-saves.test.ts src/tests/turn-undo.test.ts src/tests/save-backup-upgrade.test.ts src/tests/story-continuation-coordinator.test.ts
npx playwright test --config=playwright.history-saves.config.ts
```

安装本机 Playwright Chromium 或通过 `CHROMIUM_PATH` 指定真实 Chromium；`HISTORY_EVIDENCE_DIR` 可指定输出目录。浏览器测试单独运行，避免与完整 Vitest 争用资源；retries=0，普通用例总时限仍为 60 秒。容量测试 120 秒、单元 64 MiB 压力测试 30 秒是大数据执行预算，不是降低业务断言。

所有 AI 为 Mock，页面使用真实 App。测试没有使用真实玩家存档或真实凭证。

原始 Playwright error-context 含行尾空格，直接提交会触发 diff whitespace 检查。原件与全部日志已无改写归档到 zip；没有清理或改写失败内容。生产代码及测试没有因此变化。

新增 E2E 文件声明与专用 config 相同的 60 秒用例预算，避免仓库默认配置回到 30 秒。默认配置的收藏／导出／两回合流程也独立通过 PC 与手机两项，retries 仍为 0。
