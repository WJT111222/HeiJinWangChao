# 网页版跨域自动中转

玩家可在「设置 → AI 连接 → 网页版跨域自动中转」切换。默认开启，选择保存在当前浏览器，立即对新请求生效。偏好无法读取时使用直连。

智谱 GLM 可沿用 OpenAI 兼容配置和基础地址 `https://open.bigmodel.cn/api/paas/v4`。模型列表和聊天端点分别是该地址下的 `models` 和 `chat/completions`。

| 请求结果 | 行为 |
| --- | --- |
| 直连返回响应 | 交给现有 HTTP、JSON 或 SSE 处理流程。明确的 HTTP 错误保留原状态。 |
| 首次获取响应头前遇到疑似跨域的浏览器网络错误 | 对符合条件的请求，使用同一正文、鉴权、取消信号及剩余超时预算，向同域 Worker 再发一次。 |
| 用户取消、达到超时、收到响应头后断流或校验失败 | 结束该次请求。诊断、草稿和结算继续由当前工作流处理。 |
| 中转失败 | 显示失败，等待玩家操作。启用中转且符合条件的生成请求也禁止外层工作流在 5xx 后再次发送。关闭开关则沿用原直连错误处理。 |

**费用与隐私。** 浏览器无法区分某些网络故障和供应商隐藏跨域响应。供应商可能已经处理了直连生成，中转再发一次有重复计费风险。中转时本站 Worker 会接触凭证、请求及响应。实现没有日志、缓存、KV 或数据库写入。玩家可随时关闭。模型列表仍沿用原来的端点发现和分页，每个列表页分别处理。

## 移植对照

| 墨色江湖参考文件 | 王朝实现 |
| --- | --- |
| `services/ai/corsRelay.ts`、`services/ai/chatCompletionClient.ts` | `src/services/ai/corsRelay.ts` 在 `AiClient.response()` 内复用既有传输，包括注入的测试传输。模型列表、测试回复、Story、Variables、World、Memory 使用相同判断。 |
| `functions/api/ai-relay/[[path]].ts` | `src/worker.ts` 将精确路径 `/api/ai-relay` 交给 `src/aiRelay.ts`。原配置已经让 Worker 优先处理 `/api/*`，继续使用原来的公告 KV 和静态资源绑定。 |
| `components/features/Settings/ApiSettings.tsx` | `src/ui/settings/AiConnections.tsx` 的 PC／手机共用开关。偏好与现有渠道、密钥分别保存。 |
| `__tests__/aiRelayCors.test.ts` | `src/tests/cors-relay.test.ts` 验证实际传输次数和错误策略；`src/tests/ai-relay-worker.test.ts` 验证 Worker 边界和流式传递。两组 Chromium 用例覆盖真实设置页及游戏请求。 |

Worker 接受同域浏览器的 GET、POST 和 OPTIONS。前后端共用目标检查，只中转公开 HTTPS 默认端口的 OpenAI 兼容模型列表和聊天端点。拒绝 URL 凭证、本站、受限主机及私有 IP 字面量；仅模型列表允许规定的分页参数。请求体上限为 2 MiB。只透传鉴权、内容类型及 Accept，拒绝上游重定向，过滤响应头，禁止缓存。原生 Gemini、Anthropic 和本机地址继续直连。

Worker 等到上游真实响应头再返回状态，直接传递响应流。上游首字节仍受浏览器和托管平台各自的等待时限约束。浏览器中止后无法保证供应商也停止处理。

Worker 给已取得的上游响应添加来源标记。静态托管站点或开发服务器缺少该路由时，首页 HTML、站点 404 等回复会显示为「本站中转接口不可用」。直连响应和模型列表下一页分别判断；标记仅用于区分响应来源。

服务端使用 Origin 和 Sec-Fetch-Site 检查浏览器来源。独立 HTTP 客户端可以省略或自行设置这些头，因此公开路由仍有被第三方调用、消耗 Worker 配额的风险。目标与端点限制、请求体上限和重定向拒绝仍须独立生效。

## 验证入口

- Node 24 下执行 `npm ci`、`npm run check`、`npm run prompts:check`。
- 协议与路由专项执行 `npx vitest run src/tests/cors-relay.test.ts src/tests/ai-relay-worker.test.ts`。
- 双端 GLM 验收执行 `npx playwright test e2e/ai-cors-relay.spec.ts e2e/story-stream-toggle.spec.ts -g GLM --workers=1`。测试拦截合成 GLM 请求，并核对实际传输顺序、结算次数和失败后的正式存档。
- 本地 Worker 预览使用生产资产和 Wrangler dry-run 生成的 Worker，放在 workerd 中，通过 Mock 上游验证模型列表、SSE 聊天、私有目标拒绝、公告回退与静态路由。未使用玩家密钥或真实供应商生成。
