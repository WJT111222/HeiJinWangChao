# PR #126：旧客户端连接隔离与 Lint 修复

本轮依据 Codex 独立审核发现的两个问题，在原 `feat/save-backup` 分支修复，不新开 PR。修复前 HEAD 为 `2c2a9e54b74b3b26e411bd6feb298adc27654072`，实际 main 为 `fbb1f13902eff11924b5dd74f42fa91a082106c5`（含 #130）。最终 HEAD 见原 PR #126 最新描述。

## 旧客户端误删的修复

原问题：新增的实例身份只能约束新版 Repository。已经加载旧 main JavaScript 的标签仍按 revision 删除，不读取控制记录，可删除刚导入的同 ID、同 revision 存档。修复前使用旧 main 实际 Repository 与 PR Repository 的独立正式 Vitest 复现为旧删除成功、存档数变为 0，见 [原失败](before/old-code-delete-probe.log)。

现在 `SaveRepository.open()` 使用 IndexedDB 连接版本 **4**，建立导入可用之前的版本隔离：

1. 已部署 V3 代码原有 `onversionchange => db.close()` 会关闭其连接。正在排队的事务先完成，升级随后完成。
2. 新版只有数据库升级成功后才能取得 Repository，才可能比较或导入备份。
3. 旧连接调用删除/读取会因连接关闭得到 `InvalidStateError`；旧代码固定按 V3 重开会得到 `VersionError`，无法绕过实例保护。
4. 不释放的连接会导致 `STORAGE_BLOCKED`，新版无法取得导入仓库；提示关闭旧版游戏标签后重试，正式数据不变。此前被阻塞的请求迟到成功时仍会关闭连接，未引入连接泄漏。
5. 升级中止时五个仓库原记录和 V3 版本保持，重试可以正常升级。

**兼容性影响：** 这是整个本地数据库的连接版本边界，不只影响已经导入的存档。数据库一旦由新版打开并升级到 V4，所有仍运行旧 V3 代码的标签均需刷新到新版；旧程序不能再打开该本地数据库。没有承诺向旧程序降级兼容。GameState schemaVersion、备份 v1 格式、五个对象仓库、索引、主键、记录内容均未改变，升级不重写存档、不清除草稿和撤回。旧 V2 迁移、正式结算、撤回等原测试继续通过。

导入后的新版页面仍继续使用原实例身份校验，未删改前轮 A/B/C 的保护。

## Lint 修复

文件名清理改用字符码过滤 ASCII 0–31，继续清理原来的非法文件名符号和空白，保留中文、回合和日期等原格式。新增测试覆盖全部 32 个控制字符、非法符号和中文。`no-control-regex` 不再报错，没有禁用 ESLint 规则。

## 测试与真实浏览器证据

环境：Node.js **24.19.0**，正式 npm lockfile 依赖，Chromium **154**。沿用此前独立工作树 `npm ci` 成功安装的真实依赖；package.json/lockfile 本轮逐字不变。未使用作者的 Vitest、Zod、React 离线垫片。

| 检查 | 成绩 |
| --- | --- |
| TypeScript | 通过 |
| 完整 ESLint | 通过 |
| 生产构建 | 通过；既有大于 500kB chunk 提示保留 |
| 13 文件定向正式 Vitest | **340 通过，0 失败** |
| Chromium 双标签定向 | **2 通过，0 失败，无 skip/retry** |
| 差异检查 | 通过 |

340 项由原 12 文件 334 项与新增 6 项组成。新增 6 项曾先独立通过，最后再纳入整体定向检查；不把重复执行计为新场景。原 44 项备份业务断言未改。

新增单元测试：

- 升级前后五仓库逐项相同；旧 V3 删除/读取/重开拒绝；同 ID、同 revision 的导入及草稿完整，新版重载后能正常删除。
- 冻结的旧删除器在升级前能正常工作，防止测试夹具变成永远拒绝。
- 不释放的旧连接阻塞升级，原记录完整，释放后重试成功，迟到成功不泄漏连接。
- 升级事务中止，V3 及五仓库记录完整，重试成功。
- 已排队的 V3 写入完成后升级，保留升级前最后一次修改。
- 全部 ASCII 控制字符及非法符号的文件名清理。

真实 Chromium 同源双标签执行：

1. 首个标签先打开 V3 连接并保存原草稿，第二个标签打开新版并导入同 ID、同 revision。验证旧删除为 InvalidStateError，旧重开为 VersionError，存档/草稿完整，新版重新读取后能正常操作。
2. 首个标签额外保持一个不自动关闭的 V3 连接。第二个标签打开失败为 STORAGE_BLOCKED；旧记录仍完整；释放后新版重试并导入成功。

测试使用两个没有启动 App 的同源测试文档，确保新版 App 不会提前升级首个旧标签；执行真实浏览器 IndexedDB 和正式 Repository。它们是存储层双标签测试，不宣称覆盖了手机 UI 或完整游戏链路。全部 POST 计数为 **0**，没有付费请求。

旧客户端夹具保存部署 main `fbb1f13902eff11924b5dd74f42fa91a082106c5` 的 open/close、load/delete 和所需私有方法原文，仅类名和 import 相对路径适配。已逐段机器核对，见 [保护检查](protected-code.json)。

[测试日志与 Chromium JSON](after/) · [修复前失败和 main Lint 对照](before/) · [本轮文件清单](FILES.txt)

执行范围：

```sh
npm run typecheck
npm run lint
npm run build
npm run test -- src/tests/save-backup-upgrade.test.ts src/tests/save-backup.test.ts src/tests/saveRepository.test.ts src/tests/unreadable-saves.test.ts src/tests/npc-importance.test.ts src/tests/npc-roster.test.ts src/tests/drafts.test.ts src/tests/turn-undo.test.ts src/tests/turn-commit.test.ts src/tests/story-stage.test.ts src/tests/variable-stage.test.ts src/tests/world-stage.test.ts src/tests/turn-coordinator.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --config playwright.backup-upgrade.config.ts
git diff --cached --check
```

未运行全量 Vitest、700 项 E2E、Prompt 检查或原作者离线 13 项变异测试，不宣称这些检查通过。未修改 UI、GameState/草稿协议、领域规则、AI、模型路由、回合结算或撤回逻辑。未通过 skip、删除/削弱业务断言获取通过。

仅有一个原测试夹具适配：`unreadable-saves.test.ts` 原本要求“与当前数据库同版本”的损坏数据库，改为使用 `saveDatabaseVersion` 常量；其主键保护及全部断言保持原样。

未合并、部署、发布或打标签。原 PR #126 状态保持，交九代目与玩家最终复审。
