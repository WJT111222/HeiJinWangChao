# Variables / World 失败响应可观察性：第一批

基线：`9b0893811572a7f0af1b6790b45c60557499af08`（开工及交付前均重新 fetch）。分支 `fix/stage-response-observability`；本报告随独立 Draft PR 提交，最终 HEAD 以 PR 提交记录和交付答复为准。没有合并或主动部署生产环境。

## 结果与边界

Variables / World 在 `empty`、截断、过滤、格式或命令校验失败前收到的公开 content / reasoning，现在保留在原有临时响应记录中。PC 和手机沿用阶段详情的「模型原文」，主动选择 content、公开思考或安全响应诊断；同一时刻只挂载所选内容。reasoning-only 仍严格报 `empty`，不产生候选，也不从思考中提取命令。

没有新增流式开关。`VariableStage`、`WorldStage` 继续明确传入 `stream: false`。没有修改 Prompt、解析器、领域权限、Schema、Repository、Commit / CAS / Undo、模型参数或重试策略。独立 Memory 不接入本记录系统；Story 继续使用单一连续原文框、实际事件顺序及原有小说流式阅读。

## 数据流与保护

1. `AiClient` 在正式结束原因检查 / 文本提取前观察公开响应；HTTP 状态直接记录；仅对原有兼容逻辑已读取的 400/422 JSON 错误体复用安全投影，不为诊断等待其他 HTTP 错误体，以免改变失败/自动重试时机。新增诊断回调的异常不改变请求结果。
2. `responseContent` 投影有限的类型、已知结束原因、明确拒绝/过滤标记、HTTP 状态和白名单结构。任意供应商错误文字、未知字段值、签名、隐藏思考均不进入安全结构；不根据 Token 推测内容。未知结束原因显示 `unrecognized`，并不伪装为完整供应商原文。
3. `runtime` 将 content 和公开 reasoning 接入原有 `StageResponseStore`，正式解析始终使用原来的 `response.text`。成功传输与通过候选校验是不同状态。失败/取消后封存观察回调，晚到响应不能追加内容。
4. 记录绑定 UUID、saveId / turnId、正式及草稿版本、Story 版本、执行/阶段请求版本、World 所依赖的变量版本；请求检查器仅增加对应临时响应 ID，不复制响应正文。
5. 查看按当前草稿的请求版本定位。正式 Commit 后按实际 journal turnId 定位已完成回合，不错误要求其等于新草稿。切档、退出游戏、Undo 导致 GameScreen 卸载时清除此存档记录；代次校验阻止组装阶段尚未完成的旧请求重新创建记录。
6. 继续最多六条；content 800 万、公开 reasoning 200 万、Story 合并展示 1000 万、规范化结果 800 万、诊断 JSON 1.6 万字符。Store 与 runtime 的观察累积均有限制，超出显示明确提示，不截断正式解析输入。字段容量合计为每记录最多 2801.6 万字符，六条最多 16809.6 万字符（不是精确 JS 堆字节承诺）。没有持久化原文。
7. 使用现有凭证脱敏，并处理跨分块的已知密钥前缀。错误横幅、普通日志不接收原文。收起的诊断详情不挂载原文；切换查看内容重置文本框滚动与选择。
8. Variables 后续候选保存/CAS 失败也将对应临时记录标为失败；现有允许写入草稿的安全失败元数据规则保持不变。

## 正式验证

Node `v24.19.0`、npm `11.9.0`、Chromium `154.0.8037.57`，真实 npm / Vitest / Playwright。没有调用收费模型或读取玩家存档。

| 批次 | 命令 / 范围 | 成绩 | 退出码 |
|---|---|---|---|
| 依赖 | `npm ci --cache /workspace/.npm` | 安装 143 包 | 0 |
| 缺陷对照 | main + 仅新增的初始三个回归测试 | 3 失败，证实两个阶段 reasoning-only 及截断原文丢失 | 1 |
| 新增专项 | `stage-response-observation.test.tsx` | 23 通过 | 0 |
| 受影响专项 | Variables runtime/stage、World stage、Story 连续原文、Thinking、DeepSeek、新增专项共 7 文件 | 161 通过 | 0 |
| Commit / Undo / Memory | `variable-source-runtime`、`memory-summary-v2`、`npc-memory` | 69 通过 | 0 |
| 完整工程 | `npm run check` | 155 文件、3879 单测通过；Lint、catalog、TypeScript、Build 通过 | 0 |
| Prompt | `npm run prompts:check` | 3 文件、93 通过（已包含在完整单测中，不叠加计数） | 0 |
| 新双端 Chromium | `stage-response-observation.spec.ts` | 4 通过，0 失败/跳过 | 0 |
| 既有双端 Chromium | 4 文件定向 grep，见下方命令 | 13 通过、5 失败，0 跳过 | 1 |
| main 同条件对照 | 上述失败的桌面 1 项、手机 4 项 | 同样 5 失败 | 1 |
| 差异检查 | `git diff --check` | 通过 | 0 |

专项与全量相互重叠，不相加为独立通过数。没有运行无范围全量 E2E。

完整工程原始日志见 [logs/check-delivery.log](logs/check-delivery.log.gz)；原始日志以 gzip 无损压缩保存（`gzip -dc 文件.log.gz` 可读取），保留原有输出及尾部空白；每批退出码见同名 `.exit`。其他日志见 [logs](logs)。完整失败 trace / error-context 原件保留在执行环境 `/workspace/stage-response-evidence/browser-regression`、`main-desktop` 和 `main-mobile`。

浏览器使用独立配置，拒绝复用其他工作树的 Vite 服务器：

```bash
OBSERVATION_PORT=54089 CHROMIUM_PATH=/usr/bin/chromium \
  npx playwright test e2e/stage-response-observation.spec.ts --config playwright.observation.config.ts
OBSERVATION_PORT=54089 CHROMIUM_PATH=/usr/bin/chromium \
  npx playwright test e2e/story-raw-continuous.spec.ts e2e/variable-runtime.spec.ts \
  e2e/world-runtime.spec.ts e2e/prompt-inspector.spec.ts \
  --grep '连续原文|变量正常生成|错误 JSON 安全失败|世界生成、补算|错误输出可重试|已发送阶段快照' \
  --config playwright.observation.config.ts
```

main 使用同一 Node、Chromium、依赖和配置，仅将端口分别设为 54090 / 54091：桌面 `e2e/variable-runtime.spec.ts:116`；手机运行 Variables / World 文件中上述四个对应场景。

## 关键回归覆盖

- DeepSeek content=null + reasoning 非空：仍 `empty`；原文视图明确显示“供应商未返回可展示的正文；已收到公开思考。”；只有主动选择思考才挂载实际文字。
- 空响应、不支持的对象结构、仅 `<think>`、明确 refusal / content_filter / length；不伪造正文、不接纳候选。
- 四协议公开 content / reasoning / 截断原因；不展示 Gemini / Anthropic 签名或隐藏思考块。
- HTTP 400 / 401 / 429 / 500：各一次 Mock 请求；OpenAI 400 复用原有一次 JSON 读取，其余错误不额外读取正文。任意服务错误文字不外传，原有失败/重试时机保持不变。
- Variables 格式错误和 World 非法 JSON：实际原文可查，拒绝候选。真实 Stage → Repository 失败只保留既有安全失败元数据；正式状态不变。
- SSE 部分响应、中断、超时、取消、密钥跨分块；取消后迟到 JSON 不更新旧记录，更不能覆盖新请求。
- 同回合显式重试、不同阶段及请求版本隔离；容量截断提示、六条淘汰、清空后不恢复。
- 真实协调器两回合执行及 Commit 后，三个阶段原文可按 journal 定位；实际 Undo 后不匹配新草稿。维护/总结的现有测试通过。
- 新增浏览器四场景分别运行 PC / 手机 × Variables / World，均经过正式按钮与失败草稿写入，验证内容非默认 DOM、复制、只读、内部滚动、关闭、两次明确尝试隔离、刷新清空及读取前后 Repository 完全一致。
- 原有 Story 四种连续原文场景在 PC/手机共 8 项通过；原有请求检查器双端通过。既有合法候选及取消/切档行为的桌面场景到达业务断言，手机旧测试定位阻断另列，不冒充通过。

## 失败和修复记录

- 初次默认 npm 缓存目录 `/home/agent/.npm` 不可用（ENOENT）；改用可写 `/workspace/.npm` 后正式 `npm ci` 成功，没有使用垫片。
- 新测试初稿把包含 vault 的对象直接展开进 ComposeInput，导致 structuredClone 失败；修正为正式输入字段后，在 main 上得到真实的 3 个观察缺陷失败证据：[before-main.log](logs/before-main.log.gz)。
- 新 Repository / 浏览器夹具初稿跳过了初始草稿版本，触发“初始草稿已存在或版本不为零”。改为初始草稿 → 正文 → 变量候选的正式保存顺序。未修改 Repository。开发期第一次完整检查因此 3877 通过、2 失败，日志保留 [check-1.log](logs/check-1.log.gz)；最终 3879 全通过。
- 旧 Story 单测对 Variables/World 使用 `pre` 的展示断言，与本批可复制只读查看器不再相符；改为断言单个只读 textarea，继续断言公开思考不默认挂载。没有弱化领域、权限或付费断言。
- 默认端口 5174 / 5198 被其他旧工作树占用；新增隔离 Playwright 配置并使用空闲端口重新测试，旧页面的初次试跑不计入验收。
- 本分支与 main 同样存在以下 5 个既有 E2E 失败，测试文件未改、未 skip、未弱化：
  - 桌面 `variable-runtime.spec.ts:156`：期待旧模块名 `stages.opening.variables.text`，实际为 `stages.opening.variables`。此前路由、候选、原文、隐私与状态断言已执行。
  - 手机 `variable-runtime.spec.ts:116`、`:207`：seed 阶段期待可见的 `林舟` heading，当前手机默认布局不提供此元素。
  - 手机 `world-runtime.spec.ts:143`、`:230`：同类 seed 标题定位失败。

main 对照的断言、位置与本分支一致。未借本批更改旧测试导航或 Prompt 模块名。

## 双端真实截图

截图全部来自 React、Mock 数据与脱敏凭证，非设计稿：

- [PC Variables 公开思考](screenshots/desktop-variables-public-reasoning.png)
- [PC Variables 诊断](screenshots/desktop-variables-diagnostics.png)
- [PC World 公开思考](screenshots/desktop-world-public-reasoning.png)
- [PC World 诊断](screenshots/desktop-world-diagnostics.png)
- [手机 Variables 公开思考](screenshots/mobile-variables-public-reasoning.png)
- [手机 Variables 诊断](screenshots/mobile-variables-diagnostics.png)
- [手机 World 公开思考](screenshots/mobile-world-public-reasoning.png)
- [手机 World 诊断](screenshots/mobile-world-diagnostics.png)

## 修改文件与剩余限制

生产文件：`client.ts`、`responseContent.ts`、`runtime.ts`、`stageResponses.ts`、`inspection.ts`；`StageResponsesPanel.tsx`、`WorkflowPanel.tsx`、`VariableCandidates.tsx`、`WorldCandidates.tsx`、`MobileDiagnostics.tsx`、`GameScreen.tsx`；`variableStage.ts` 仅补临时观察状态。

测试：新增 `stage-response-observation.test.tsx`、`e2e/stage-response-observation.spec.ts`、隔离 `playwright.observation.config.ts`；更新 `story-raw-continuous.test.tsx` 展示断言、增强 `variable-source-runtime.test.ts` Commit/Undo 原文定位断言。其他新增为本报告、日志和截图。

限制：这是安全投影而非任意 HTTP 包抓取。未由原有兼容路径读取的 HTTP 错误只展示状态，不展示或推断错误体。未知结构只给类型和存在性，不自动解释；不展示供应商任意错误 prose、隐藏推理或凭证。离开游戏/撤回、刷新及六条淘汰后原文不能恢复。容量以上的临时展示不保留。Mock 证明工程行为，不能认定此前真实 DeepSeek 失败的唯一供应商根因，也不能证明真实 API 的可用性。

第一批已完成，等待十二代目复审。5 项已复现的旧浏览器失败仍如实保留；没有实施第二批流式开关，没有新增付费请求、生产部署或发布。
