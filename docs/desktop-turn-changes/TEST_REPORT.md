# 验证报告

运行环境：Node.js **24.19.0**、npm **11.9.0**、系统 Chromium **154.0.8037.57**。最终基线为 main `a8334e8f9429b0423eab01690f3751dce96a227c`（#115）。所有模型请求使用 Mock；本轮阅读用例额外拦截 HTTPS 并断言零模型请求。

## 命令与成绩

**最终：npm check 130 文件／3,274 测试通过，prompts 93 测试通过；Chromium 130 passed／6 skipped／0 failed，0 retries。** 6 项跳过为 4 项既有桌面压力用例及 2 项桌面新增入口用例，均只在手机项目按既有或本轮范围跳过。

最终成绩见下方机器摘要及 [validation](validation/) 原始日志。`npm ci --cache /tmp/ui2-npm-cache` 已成功完成；本轮没有改 package.json 或 lockfile。使用隔离端口 5207 运行同一仓库 Playwright 配置，Chromium 由 `CHROMIUM_PATH=/usr/bin/chromium` 指定，2 workers、0 retries，不复用旧服务器，并使用独立 outputDir。

```sh
npm ci --cache /tmp/ui2-npm-cache
npm run check
npm run prompts:check
CHROMIUM_PATH=/usr/bin/chromium PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/changes-broad-final.json \
  npx playwright test --config=/tmp/changes-playwright.config.ts \
  e2e/turn-changes.spec.ts e2e/turn-undo.spec.ts e2e/turn-undo-capacity.spec.ts \
  e2e/undo-summary-recovery.spec.ts e2e/continuous-turns.spec.ts \
  e2e/automatic-settlement.spec.ts e2e/game-window.spec.ts \
  e2e/workflow-feedback.spec.ts e2e/archive-final.spec.ts \
  e2e/archive-step3.spec.ts e2e/archive-step4.spec.ts \
  --output=/tmp/changes-broad-final-results --reporter=line,json
```

隔离端口配置原文一并交付；常规仓库运行可直接使用其默认端口配置。运行前后对 src 与 e2e 文件作 SHA-256 核对，最终测试期间没有编辑源码。既有业务断言未修改；`continuous-turns` 仅补齐第二标签的测试凭证及 context 范围 Mock。旧批次测试重新生成的截图／计时文件恢复为 main 版本，没有作为 UI 改动混入。

## 新增覆盖

- **40 项单元测试**：纯差异 17 项、只读恢复点 23 项（含参数化损坏用例）。覆盖六组、元数据排除、金额精度与未知值、七个装备槽、库存归属、同名不同地点、跨日及毫秒时间、重复无 ID 信息、权限／认知分类（含退场人物长期记录）、并行事件、退役阶段、历史精度及原文保留。
- Repository 使用真实已有写入流程创建开局与普通结算，验证 raw stores 逐字一致；覆盖当前 saveId、turnId、连续后缀、前后 revision、完整 journal、scene、字节数、缺失和孤立恢复点。
- 覆盖撤回后的 revision 分支、重新结算、同 revision 状态变化、并发提交／读取、阶段锁不受读取干扰、实际 readonly put 拒绝、关闭数据库异常、V8 旧状态与快照纯迁移不回写。
- Chromium 新增 6 个场景×双端：胶囊与四个桌面尺寸、9 类真实资料目标和回焦、四种降级／草稿、48 行人物变化压力、真实 Repository 撤回后重结算、Mock 流式生成与取消。两个仅桌面场景在手机项目按范围显式跳过；其余手机用例实际执行原有操作。
- 阅读前后比较 Repository.exportRaw 的正式 saves、drafts、turnUndo、saveControls、turnReceipts；展开、浏览和导航不能改变其中任一项。
- 1440×900、1280×800、1100×800、901×800 无页面／卡片横向溢出；两列／单列断点、8 条展开回收、键盘、reduced-motion 均有断言。手机 390×844 与仓库 Pixel 7 项目回归。

## 手机 main 对照

在未修改生产源码的 main 工作树运行同一合成数据、同一截图用例；仅加入未跟踪测试 fixture 与截图测试，不修改应用。截图先后刷新页面以固定初始位置，禁用动画。main 与本分支 390×844 截图逐像素比较结果见 [mobile-comparison.json](validation/mobile-comparison.json)。截图物理分辨率由 Pixel 7 的设备缩放决定，不等于 CSS 视口。

## 开发期失败与修复

1. 新增长历史 fixture 初稿超过正式 summary 的 600 字限制：改为合法长度并保留末尾标记。没有放宽 Schema。
2. 新增测试中 prefer-const 与隐式 any：修复测试代码，typecheck／lint 重跑通过。
3. 新增导航测试查找「新地点」时，该行在世界分组的第 8 条之后：先执行真实的展开操作再定位，保留目标正确性与回焦断言。
4. 压力测试最初误写预期 47 行；实际还包含原场景人物离场，正式状态应为 48 行：修正新增测试期望，并保留前 8／全部 48／收回 8 的断言。
5. main 合入 #115 后主动中断旧基线综合 E2E（22 passed、2 interrupted、112 未运行），同步 main 后从头重跑。
6. HTML／React 比对发现跳转提示占据额外空行：明确摘要和跳转提示使用同一第二行，并为正文留出提示空间；补充短行高度上限断言，完整长内容仍可换行。为冻结最终源码重新启动综合回归。
7. 中间两次 Playwright 命令并行时共享默认 test-results，后启动命令清理了前一命令的 trace 临时目录，导致两个既有用例在 browserContext.close 报 ENOENT（并非业务断言失败）。停止该轮并为最终运行指定唯一 outputDir；另在未修改 main 对同两个用例执行控制测试，日志一并保留。中间轮为 42 passed、2 failed、2 interrupted、90 未运行，不计入最终成绩。

构建可能报告主包超过 500kB 的体积提示；不是构建失败。本轮没有借机修改打包、领域或模型逻辑。所有中间失败和控制实验单独列出；不以删除、跳过或放宽旧断言解决。

## 既有双标签测试的对照与修复

综合 Chromium 回归第一次完整成绩为 **129 passed / 6 skipped / 1 failed**。失败是原有 `continuous-turns` 的「快速双击与另一标签发送」：5 秒内正式 turnNumber 仍为 1，期望为 2。

- 未修改 main 的原用例重复 6 次均通过，不能据此声称原用例在 main 稳定失败。
- 源码检查发现其 Mock 只绑定主 Page，且通过 context.newPage 创建的第二标签没有 sessionStorage 测试凭证。
- 在**未修改 main 应用源码**上，仅用临时测试控制第二标签先发送（原回合数与草稿断言不变），2 次均复现同样的 turnNumber 1／2 失败。诊断测试补丁、命令结果与 JSON 已保留。
- 修复仅限测试前置条件：Mock 覆盖 BrowserContext，并给第二标签设置相同的虚构凭证后重新加载。没有修改产品凭证管理、模型路由、锁或三阶段实现，没有增加重试或延长断言超时。
- 对同样“第二标签先发送”的 main 控制实验应用此测试修正后，6 次通过。main 应用源码未修改，测试补丁在 validation 中。
- 同时标准竞争次序的补充双端重跑仍观察到 1 次手机超时（21 passed / 2 skipped / 1 failed）。相同完整 Mock 的 main 手机控制用例重复 6 次通过。因此测试前置遗漏得到修正，但不能据此声称剩余偶发超时根因已完全定位。所有原始输出保留；未扩展到修改锁、正式结算或其他业务。最终综合回归结果另列。

综合回归后为退场人物长期记忆补齐正式认知标签，新增 reported／suspected／unknown 三项测试；时长显示改为整数毫秒分解，增加 61.1 秒正反向测试以防浮点减法尾数。没有改变世界时钟或时间推进。之后重新执行完整工程检查和综合双端回归；各阶段源代码指纹与原始成绩均保留。

## 机器摘要

由最终命令结果生成于 [results.json](validation/results.json)。
