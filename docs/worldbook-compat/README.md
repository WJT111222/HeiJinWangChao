# 世界书阶段 C：回滚兼容性测试证据

- **旧版客户端**：`main@a820f5e`（当前生产部署所用的 main）。测试在 `git worktree` 里的 main 原始代码上运行，只额外放入场景模块和测试脚本两个文件；本分支对存储、存档结构、草稿、界面代码没有任何改动，在分支上运行的结果与 main 逐项一致。
- **环境**：Playwright 驱动的 Chromium（`chromium-1243`），桌面与移动两种配置；Vite 开发服务器加载未打包的源码，历史收藏的压缩和解压在真实 Worker 中进行。Node v22。
- **方法**：先用正式代码造出真实的回合、撤回点和命名收藏，再按新版客户端可能写入的形式直接改写 IndexedDB 原始记录；然后用旧版代码逐项执行列表、打开、撤回、历史预览与回溯、备份导出与解析。每个场景结束后核对相关原始记录没有被改动。所有数据都在测试浏览器的隔离上下文中新建，不接触任何真实玩家数据。

## 复现

```bash
# 1. 准备 main 工作树（只加两个测试文件）
git worktree add /tmp/main-wt a820f5e
mkdir -p /tmp/main-wt/src/tests/support
cp src/tests/support/worldbookRollbackScenarios.ts /tmp/main-wt/src/tests/support/
cp e2e/worldbook-rollback-compat.spec.ts /tmp/main-wt/e2e/
# 2. 在 main 工作树中启动开发服务器并运行
cd /tmp/main-wt && npx playwright test e2e/worldbook-rollback-compat.spec.ts --workers=1
# 3. 正式 Vitest（fake-indexeddb）
npx vitest run src/tests/worldbook-rollback-compat.test.ts
```

原始观察结果：`rollback-observations.json`（两种配置各 46 项，全部符合预期）。第 3 步需要在 Node 24 和正式依赖下运行，本地环境未运行。
