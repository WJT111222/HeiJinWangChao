# 黑金王朝匿名反馈

## 玩家入口

- 错误日志顶部的「上报错误」发送当前页面仍保留的全部失败条目。面板显示上传数量，可加入补充说明。模型原文与供应商公开思考分别勾选，默认关闭。预览显示即将提交的脱敏数据。附件以本份报告的 `errorRef` 关联失败条目，已清除、已淘汰、来源不明或识别为完整请求／存档的附件省略。提交后原有日志仍可查看。
- 「设置 → 反馈建议」接受功能建议、游戏问题、游玩体验、其他反馈。只发送分类、内容与基础运行信息。

打开面板、填写和预览时均为本地操作。提交失败时表单保留内容，可以手动重试。成功后显示反馈编号。

## 请求、隐私与限制

同源 `POST /api/feedback`，JSON 外层为 `submissionId` 和 `feedback`。客户端使用省略凭证的 fetch，不传 Cookie 或供应商鉴权头。服务端严格校验字段和关联。

| 字段 | 含义 |
| --- | --- |
| `submissionId` | 每次明确提交随机生成的 UUID。同一打开表单、同载荷的失败重试复用。 |
| `feedback.kind` | `suggestion` 或 `error` |
| `version`, `browser`, `device` | 产品版本、粗粒度浏览器类别、桌面／手机／平板等分类 |
| `build` | 构建提交 SHA。反馈建议和错误上报均附带此字段。旧记录允许缺失。 |
| `category`, `text` | 分类和必填文本，建议入口。错误报告仅有选填 `text`。 |
| `errors` | 错误报告的编号、时间、阶段、错误码，以及可用的模型、协议和安全诊断字段，例如 HTTP 状态、白名单路径、结构标签与长度。 |
| `attachments` | 错误报告的选填附件。各项有 `errorRef`，按勾选分别附带 `content` 或 `reasoning`，截短时有 `truncated: true`。可识别的兼容前置 `<think>` 公开思考也从原文选项分离。 |

生产包优先使用 Cloudflare Workers Builds 提供的 `WORKERS_CI_COMMIT_SHA`，其次读取构建工作区的 Git HEAD。无 Git 元数据的生产包标记为 `unavailable`，本地 Vite 开发服务器标记为 `development`。后台详情和「复制技术诊断」均提供此字段。旧记录在后台显示「未记录」。

D1 使用服务器接收时间并分配独立反馈编号。请求上限 512 KiB，反馈正文 4,000 字符，错误日志最多 50 条，附件最多 6 份。单个内容字段最多 30,000 字符，所有附件合计最多 60,000 字符。分配容量时保留完整日志，截短附件会在预览显示。服务端每滚动一分钟最多接收 30 条新记录，限流计算使用接收时间。相同提交 UUID 与载荷返回同一回执，重复使用 UUID 发送不同载荷会拒绝。

关联只使用页面内记录，上传时移除存档、回合、渠道和响应 ID。客户端复用凭证清理，过滤已知本地标识、已保留的完整提示词片段以及可识别的请求／存档结构。服务端拒绝已知敏感结构和常见明文凭证。自由文本仍可能包含提交者主动输入的个人信息，或无法从格式识别的隐私内容。错误上报可以在发送前核对预览。

应用和 D1 不记录 IP、账号、设备 ID 或设备指纹。Cloudflare 网络接入仍会处理连接来源，匿名反馈指应用层的数据边界。Worker 关闭 Workers Logs 和 Logpush，且接口不打印报文、凭证、搜索内容或 IP。上线前核对 Dashboard 的 Workers Observability、Logpush、Tail Workers 和外部日志导出，避免平台侧留存不必要的数据。D1 删除影响当前记录，Cloudflare 的时间旅行及备份按其保留政策运行。 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [Logpush](https://developers.cloudflare.com/workers/observability/logs/logpush/)

## 管理后台

访问同站 `/admin/feedback`。用户名为 `developer`，使用 Worker Secret `FEEDBACK_ADMIN_PASSWORD`。服务端在读取 D1 前对总览、列表、详情和写操作鉴权。更新和删除要求本站表单的 Origin，响应禁缓存；内容按纯文本显示。管理 URL 不会出现在玩家入口中。凭证应使用至少 32 字符的随机值，通过 HTTPS 使用和定期轮换。Cloudflare Access 可以作为额外一层，保护同域 `/admin/feedback` 及其子路径，Worker 的鉴权继续生效。 [Cloudflare Access 官方说明](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

总览包括总数、待处理、处理中、已处理和最近五条反馈。错误统计按日志条目计数，每类展示前十项。列表可按反馈分类、模型、错误码筛选，支持建议和补充说明的文本搜索、时间顺序和翻页。复制技术诊断仅包含安全元数据，详情中的选填原文与公开思考可按需查看。状态及内部备注都只存在于后台。删除需要展开删除区并确认。

## Cloudflare 配置与上线

维护者可通过定时邮件收到反馈聚合统计。迁移、上线和本地模拟见[玩家反馈邮件简报](DIGEST.md)。

仓库中的 `wrangler.jsonc` 配置了 Worker 路由和日志设置。实际 D1 UUID 与管理密钥由维护者在批准上线后配置。缺少绑定时提交会明确失败，游戏、公告和模型中转仍可照常运行。

1. 在目标 Cloudflare 账户选择或创建独立 D1 数据库，例如 `npx wrangler d1 create heijin-feedback`。记录输出中的实际 UUID。测试和生产使用不同数据库，不把生产记录带入预览。
2. 在正式部署采用的 Wrangler 配置下添加 D1 绑定，使用真实 `database_id`。名称应与所选数据库一致。若通过 Dashboard 配置，把绑定一并纳入持续部署的实际配置，避免下一次 Wrangler 部署丢失设置。

   ```jsonc
   "d1_databases": [
     {
       "binding": "FEEDBACK",
       "database_name": "heijin-feedback",
       "database_id": "<实际 Cloudflare D1 UUID>",
       "migrations_dir": "migrations/feedback"
     }
   ]
   ```

3. 先在测试环境执行 `npx wrangler d1 migrations apply FEEDBACK --remote --config <测试配置>`。验收后，由有权限的维护者对正式部署配置运行同一命令，应用 [初始迁移](../../migrations/feedback/0001_feedback.sql) 到生产数据库。
4. 在 Cloudflare Dashboard 的 Worker 变量与机密中设置 `FEEDBACK_ADMIN_PASSWORD`，类型选 Secret。可在密码管理器生成随机值，也可在批准发布时执行 `npx wrangler secret put FEEDBACK_ADMIN_PASSWORD --config <正式配置>`，按提示输入并在密码管理器保存随机值。配置变更可能发布 Worker 版本，只在授权发布阶段执行。密钥不要写入代码、客户端环境变量、PR 或截图。
5. 走现有 Worker 发布流程。用合成建议检查 201 和编号、错误报告可选附件、未授权后台 401 和鉴权后查询。核对同一站点公告、静态资源和模型中转。需要临时停用提交时，在受控发布中移除 D1 绑定即可，已有数据留在 D1。

首次部署涉及外部资源准备和批准发布，本 Draft 只交付代码、迁移和本地验证。 [D1 迁移官方文档](https://developers.cloudflare.com/d1/reference/migrations/) · [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)

### 本地复跑

使用 Node 24、锁文件依赖和 Chromium。先运行 `npm ci` 与 `npm run build`。复制一份 `wrangler.jsonc` 为 `wrangler.feedback.local.jsonc`，只给该文件添加测试 D1 绑定。数据库名可用 `feedback-local`，UUID 用本地新生成的随机值，避免复用正式 UUID。在未跟踪的 `.dev.vars` 设置合成管理密码，然后执行以下两个命令。

```bash
npx wrangler d1 migrations apply FEEDBACK --local --config wrangler.feedback.local.jsonc
npx wrangler dev --local --config wrangler.feedback.local.jsonc --ip 127.0.0.1
```

访问本地站点，在设置提交建议，再进入 `/admin/feedback` 登录并核对回执与详情。Vitest 的 Worker 测试使用真实迁移 SQL 和内存 SQLite，E2E 使用 Playwright 拦截模型与反馈请求。交付截图来自 Chromium 带合成数据的实际界面，手机为 Pixel 7 模拟视口。后台使用本地 Wrangler 和 D1，已验证了登录、筛选、纯文本附件、诊断复制、状态、备注和删除。

| 界面 | 桌面 | 手机模拟 |
| --- | --- | --- |
| 错误上报 | [截图](screenshots/error-desktop.png) | [截图](screenshots/error-mobile.png) |
| 反馈建议 | [截图](screenshots/suggestion-desktop.png) | [截图](screenshots/suggestion-mobile.png) |
| 管理后台 | [夜间总览](screenshots/admin-overview-desktop.png) · [详情](screenshots/admin-detail-desktop.png) | [日间总览](screenshots/admin-overview-mobile.png) · [详情](screenshots/admin-detail-mobile.png) |
