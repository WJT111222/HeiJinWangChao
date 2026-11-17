# 复现脚本

这些脚本原样使用仓库的正式 Vitest、Playwright、React、AiClient 和领域实现；数据为隔离合成夹具，模型响应全由 Mock 提供。

在仓库副本使用 Node 24、`npm ci` 后：

- `memory-live-proof.test.ts.txt` 复制为 `src/tests/pr187-memory-live-proof.test.ts`，运行 `npx vitest run src/tests/pr187-memory-live-proof.test.ts`。预期 6 项通过，包含真实 MemoryMaintenance 三类任务的 21 次 Mock 请求。
- `ui-proof.spec.ts.txt` 复制为 `e2e/pr187-ui-proof.spec.ts`，使用原 Playwright PC/手机项目运行该单个文件。预期 2 项通过，逐项选择、保存和刷新七种风格，检查 Repository 与草稿不变。
- `memory-style-wake.spec.ts.txt` 复制为 `e2e/pr187-memory-style-wake.spec.ts`，使用同样的两个项目运行。**在被验收代码上预期 2 项失败**：请求数应为 1，实际为 2。这是未解决的严格验收断言，不应加 skip、删断言或改成预期 2 来制造通过。

本轮调用浏览器时设置 `CHROMIUM_PATH=/usr/bin/chromium`。原 5174 端口被占用，使用 `logs.zip` 中的派生配置改为 47581，保留原项目与浏览器配置。移植环境时只调整本地仓库绝对路径、空闲端口和实际 Chromium 路径。

请求唤醒脚本在 main 上没有新风格选项时原样保存一般设置，以对照同一个设置保存副作用；不要把 main 对照描述为它也选择了冷硬黑色。脚本首先在首页刷新加载种子设置，随后进入游戏；不要省掉这一步，否则 React 内存偏好可能与 localStorage 种子不同。

脚本已作为验收证据保留；执行时复制到正式测试目录，结束后移除临时副本即可。本轮没有删除任何原仓库测试。
