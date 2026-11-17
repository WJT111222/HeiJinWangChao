# 完整 Story 上限响应接收与错误作用域修复

2026-11-17（北京时间）。交复审；保持 Draft，不合并或部署。

## 基线和范围

main：`4ef1093ed82e05ce76583ab3ba7cafbdf61249a4`。独立分支 `fix/story-limit-acceptance`。已测试代码提交 `e0bcb4029a6d974425a6cc0875347f52e4086b8f`；随后仅提交报告、日志和截图，最终 HEAD 见 PR。

依据 `/workspace/story-continuation-evidence/REPORT.md` 的已复现根因实施。本次优先解决**原请求已经完整返回但被 limit 提前拒绝**，没有改续写提示词或实现旧失败草稿本地恢复入口，没有接触 #181 分支。

## 修复

原客户端先检查 finish_reason，随后才处理同事件的文本。在 length/max_tokens 分支立即抛错，Story 解析没有机会看到已完整的 content；raw 观察虽已收到全文，仍被误存为 partial。

现在仅 Story Runtime 选择内部 `validateStoryOutputLimit` 通路：已知 limit 作为结束信息保留，并继续提取同事件文本及正常阅读增量。客户端将真实文本与 `outputLimited` 交给现有严格 Story 校验。JSON、SSE、stream 请求回退为 JSON 均适用，四协议使用各自原生格式。

- 完整合法：沿用原 `parseStoryEnvelope()`、StorySchema、最低字数、摘要/选项/JSON、时间与事件校验、凭证和请求身份检查；StoryStage 原 CAS 保存为 ready，再由原协调器执行启用的下游和正式 Commit。
- 真正缺正文/尾部：limit 加现有 tag_missing/tag_unclosed 仍返回 output_limit，沿用既有 partial 与手动续写。
- 完整但无效：保留精确的字数/JSON等校验错误，不因 limit 变成功。
- 过滤、拒绝（包括独立 refusal 字段）、未知结束、中断、取消、HTTP 错误仍拒绝。没有增加请求、自动重发、预算或模型切换。
- 默认客户端、Variables、World、Memory 均没有启用该通路；其 limit 拒绝语义保持。安全诊断仍保留供应商实际 finishReasons，原文/公开 reasoning 的来源和脱敏不变。

UI 修复放在错误来源 Hook：手动 Story 错误绑定原 saveId/turnId/storyRevision，自动工作流错误绑定发起时 saveId/turnId；Variables、World 原有 storyRevision 过滤再加回合身份。Commit 换到下一草稿后旧错误不再成为当前错误，但没有删除临时历史日志或持久失败摘要。新回合真实错误仍可显示。未重排 GameScreen 的状态优先级，避免遮住仍然真实的发送/结算错误。

## 文件清单

生产 8 文件：`src/services/ai/client.ts`、`compat.ts`、`protocols.ts`、`runtime.ts`；`src/ui/game/useStoryGeneration.ts`、`useTurnGeneration.ts`、`useVariableGeneration.ts`、`useWorldGeneration.ts`。

测试 4 文件：新增 `src/tests/story-limit-acceptance.test.ts`（32 项）、`e2e/story-limit-acceptance.spec.ts`（4 场景×双端）；更新 `story-stream-reading.test.tsx`、`story-stream-toggle.test.ts` 中 5 条旧“完整 length 必须失败”预期为新产品规则。保留原文、原生字段、只请求一次、正式状态保护等断言，过滤/未知状态仍拒绝。

未修改 GameState/TurnDraft/IndexedDB Schema、Repository、Commit/Undo、正式解析规则、Prompt、天赋、模型路由、公告或 Cloudflare。没有新增第二套正文解析器。

## Node 24 正式验证

Node 24.19.0 / npm 11.9.0 / Chromium 154.0.8037.57。真实锁定依赖、Vitest、Playwright；模型全部 Mock，未使用真实玩家存档或 API Key。

| 命令/批次 | 通过/失败/跳过 | 退出码 |
|---|---|---|
| npm ci | 143 包成功安装 | 0 |
| npm run check | 177 文件、**4302 / 0 / 0**；Lint、TypeScript、filenames、catalog、Build 成功 | 0 |
| npm run prompts:check | **93 / 0 / 0** | 0 |
| 定向 6 文件 Vitest | **157 / 0 / 0** | 0 |
| PC/手机 Chromium 最终批 | **8 / 0 / 0** | 0 |
| git diff origin/main --check | 通过 | 0 |

93 和 157 是完整 Vitest 的重叠子集，不累计为独立总数。未运行无关全量浏览器。Build 有大 chunk 警告、退出码 0，未扩展做打包优化。

定向单测：story-limit-acceptance、story-stream-toggle、story-stream-reading、story-continuation、story-continuation-coordinator、ai-client。

32 项新增覆盖：stream 开/关的完整 stop/length、正文/记忆中断、最终标签未闭合、字数不足、非法 JSON、行动选项不匹配；四协议原生 limit 并确认最后正文进入阅读增量；独立 refusal 不能被完整内容掩盖。所有拒绝分支正式状态不变、请求只一次。

双端每端分别覆盖 stream 开/关：

1. 完整四块与 length 在同一 SSE 事件（或完整 JSON）返回，原请求 Story → Variables → World，Journal 正确、revision 只加一次、下一空行动草稿无 partial，没有续写入口；刷新没有再请求。
2. 真截断经手动 Hook 失败 → 自动续写完整并结算，顶部、阶段均已结算；随后新行动 403 仍准确失败并记录 authorization。请求为 Story、Story（玩家主动续写）、Variables、World，随后新行动一笔失败 Story；没有偷偷重复生成。

## 先红后绿和失败记录

- [red](logs/red.txt)：未修复生产代码时新矩阵 **16 通过/6 失败**，完整 limit、完整但非法结构被掩盖等新预期失败。修复后新增 32 项全部通过。
- [browser-red](logs/browser-red.txt)：同一新 E2E 在干净 main 的桌面 stream 开/关两类路径共 **4 失败**；正文不能原请求结算、结算后旧错误残留均复现。没有修改 main。
- [browser-final](logs/browser-final.txt)：修复后 PC/手机 **8 通过**，0 retries。开发早期相同 8 项通过不重复计数。
- [check](logs/check.txt)：首次完整检查 4295 通过/7 失败，含 5 条旧规则断言及拒绝字段保护尚未加载的早期工作版本。补齐 refusal 防护并更新产品断言后下一批为 4298 通过/4 旧规则失败，最终为 4302 通过。
- [main-old-rules](logs/main-old-rules.txt)：干净同 SHA main 的原版两个测试文件 **57 通过**。这 5 条预期变化是本次明确授权的产品语义改变，并非声称 main 原有失败。
- [targeted](logs/targeted.txt)：新增四协议早期 98 通过/2 失败，原因是测试将 Gemini 实际原样 `MAX_TOKENS` 错写成小写；只修正预期，不改供应商原文，最终 157 项定向通过。

完整原始日志以 `.txt.gz` 保留字节内容；便于浏览的 `.txt` 仅清理行尾空白。每批退出码同目录 `.exit`。没有删除、跳过失败用例或放松业务校验。

## 截图和复核

全部真实 React + 合成 Mock：

- [PC 原请求完成](screenshots/desktop-true-limit-settled.png) / [手机原请求完成](screenshots/mobile-true-limit-settled.png)
- [PC 重试结算后无旧失败](screenshots/desktop-true-committed-stale-error.png) / [手机重试结算后无旧失败](screenshots/mobile-true-committed-stale-error.png)
- 相同非流式截图也在 screenshots 目录（文件名含 false）。

PC 1440×1000；手机使用原仓库 Pixel 7 项目（412×839）。独立端口 55918，main 对照 55919，2 workers，0 retries；仅在外部配置调整端口/服务器复用/截图。配置与完整 trace 在 `/workspace/story-limit-evidence/`。可按仓库原配置复核：

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/story-limit-acceptance.test.ts src/tests/story-stream-toggle.test.ts src/tests/story-stream-reading.test.tsx src/tests/story-continuation.test.ts src/tests/story-continuation-coordinator.test.ts src/tests/ai-client.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/story-limit-acceptance.spec.ts
git diff origin/main --check
```

## 限制与后续建议

本次未实现旧完整 storyPartial 的本地无收费恢复，旧玩家已误存 partial 的处理仍需独立批准；也未重写续写资格或提示词。新请求的完整合法 limit 已不再进入该错误路径。

未知结束原因、真正网络中断不扩展为自动接受。Mock 证明请求与保存边界，不证明某供应商真实的 finish 排列、计费或模型文学质量。没有真机 Safari、付费模型或生产验收结论。

本轮未发现新增 P0/P1/P2 阻断；等待独立复审，不自动合并、发布或部署。
