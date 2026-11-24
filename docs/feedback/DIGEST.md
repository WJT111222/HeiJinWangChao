# 玩家反馈邮件简报

## 统计与隐私

正式 Worker 通过 Cloudflare Cron `0 0,12 * * *` 在北京时间 08:00 和 20:00 统计反馈。时间窗使用 D1 接收时间，包含起点和截止时刻之前的记录。第一次从该次触发前 12 小时开始，后续从上次完成的截止时刻续算。空窗口只推进检查点。

邮件标题为「【黑金王朝】玩家反馈简报」。邮件展示新增反馈、错误报告、四类反馈建议、失败阶段、错误码、模型、构建版本，以及受原有鉴权保护的管理后台链接。每个错误分组区分包含该项的报告数和日志数。一份含重复错误的报告在该分组内只计一份，日志逐条计数。不同分组的报告数可能重叠。

错误码及公开模型 ID 使用精确白名单。缺失、私有别名和未知值统一归入「其他或未提供」。构建 SHA 仅显示校验过的 12 位缩写，最多列出 15 组，其余合计。邮件只从 D1 获取计数及限定标签。玩家文本、模型原文、思考、凭证、路径、存档和内部备注不会进入邮件。

## 授权上线

1. 正式环境已绑定 `FEEDBACK`，并已设置运行时 Secret `FEEDBACK_DIGEST_TO`。收件邮箱已验证，域名 Email Routing 已启用。保留这些配置。发件人由 `FEEDBACK_EMAIL` 绑定固定为 `feedback@heijinwangchao.de5.net`，收件人只从 Secret 读取，不通过请求传入。沿用 Email Routing 的已验证地址免费投递。 [Cloudflare 发送限制](https://developers.cloudflare.com/email-service/platform/limits/) · [原生邮件绑定](https://developers.cloudflare.com/email-service/configuration/send-bindings/) · [Workers 发送 API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
2. 获准上线后，从本 PR 的检出目录对正式 `FEEDBACK` 执行 `npx wrangler d1 migrations apply FEEDBACK --remote`。它会应用待执行的迁移。本次新增的 [0002_feedback_digest.sql](../../migrations/feedback/0002_feedback_digest.sql) 只创建检查点表，原反馈和原迁移均保留。
3. 走既有正式 Worker 发布流程，核对 Cron、`FEEDBACK_EMAIL` 和正式环境变量 `FEEDBACK_DIGEST_ENABLED=true`。首次有反馈的计划窗口结束后，检查 Cron 执行历史及维护者私有收件箱。Secret 或绑定缺失时任务直接跳过。停用邮件时，可在授权发布中将 `FEEDBACK_DIGEST_ENABLED` 设为 `false`，保留检查点以供恢复。

分支 Previews 使用独立配置，缺省没有反馈 D1、邮件绑定或收件 Secret，且明确关闭 Digest。配置禁用能访问生产绑定的 Worker 版本预览 URL。预览验收只能使用合成数据、独立 D1 和模拟邮件。 [Cloudflare 预览配置](https://developers.cloudflare.com/workers/previews/configuration/)

## 重复执行和故障恢复

D1 单行租约防止两个 Cron 同时发送。成功发送后才推进检查点，发送报错会保留窗口起点。下次定时运行会合并补报仍保留在 D1 的反馈。执行中断后，20 分钟租约到期可以恢复。同一区间若已确认完成，重复触发无需重新查询反馈。

邮件服务接收发送与 D1 写检查点之间无法组成同一个事务。如果邮件已被接收而 Worker 随后中断，或确认写入失败，下一次补报可能重复。任务优先保留未确认的区间。管理后台删除的记录以重新统计时的 D1 数据为准。任务错误只记录固定分类，不返回收件人或上游异常内容，反馈提交继续由原 HTTP 路由处理。

## 本地复跑

用 Node 24 执行 `npm ci`，运行 `npx vitest run src/tests/anonymous-feedback.test.ts`。测试使用真实迁移、内存 SQLite 和模拟邮件绑定。

需要验证 Cloudflare 运行时接线时，复制一份临时 Wrangler 配置，将 D1 换成本地测试数据库，将收件人换为 `maintainer@example.test`，使用 `wrangler d1 migrations apply FEEDBACK --local` 和 `wrangler dev --local --test-scheduled`。使用合成反馈，通过 Local Explorer 的 Cron Triggers 选择相应的 UTC 截止时刻。检查本地模拟邮件、重复触发后邮件数量和空窗口，保留本地模拟模式。 [Cron 本地测试](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally) · [邮件本地模拟](https://developers.cloudflare.com/email-service/observability/local-development/sending/)
