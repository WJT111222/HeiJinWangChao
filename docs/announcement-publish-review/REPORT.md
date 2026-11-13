# PR #129：发布后失败隔离与正式回归

依据：[最新上线前复审](https://github.com/WJT111222/HeiJinWangChao/pull/129#pullrequestreview-5890785230)。修复前 HEAD 为 `3630021ad633a41111f6c7d0f8d9c7e919de4d81`，main 为 `d122d9d044604dd0846e719bb18ad99069629123`（含 #128、#132、#133），已同步，无新增整合冲突。最终 HEAD 见原 PR #129 描述。

本轮只修发布脚本、类型声明、运维说明与定向测试。不改变 Worker、公告 Schema、前端、KV 绑定、工作流调度、11条公告内容或 version。

## 两项修复

### 写入后复查失败只警告

`wrangler kv key put` 成功并写入 `version` output 后的 `latestOnMain()` 改为 best-effort：Git fetch 失败输出 `::warning::`，保持发布 step 成功，不丢失 output，后续 `--verify` 仍能执行。

写入前的 Git fetch/最新版比较未包入这个 catch，继续 fail-closed。真实 Git 子进程演练验证：

- 写入前 fetch 失败：发布非零退出；假 KV 保持原值；没有 version output。
- 写入成功后 fetch 失败：发布 exit 0；假 KV 已写入；version output 完整；有 warning。
- 随后启动一个独立 Node CLI 子进程执行 `--verify`，fetch 完全由内存 Mock 提供，能读取 version 并完成验证。不联系真实 Cloudflare。

### 单轮请求及响应体有界

每轮线上检查使用独立 AbortController 和 **3秒 deadline**，`Promise.race` 覆盖 fetch 与 `response.json()` 的整个读取过程。即使响应体不主动响应 abort，也能按 deadline 结束本轮；finally 清除定时器。

默认6轮、轮次间20秒，总等待预算约 **118秒**（不计极小调度开销）。超时中止请求并继续重试，耗尽后仍由原 `--verify` 分支输出 warning，进程不会因同步延迟或网络挂起拖满10分钟 job。

新增测试验证：pending fetch 被分别中止、响应头返回但 body 挂起也能超时、首轮超时后下一轮仍可成功。每个测试使用很短的注入 timeout，不等待真实两分钟。

## 先失败、后通过的证据

1. 原15项正式定向测试全部通过，见 [baseline-targeted.log](before/baseline-targeted.log)。
2. 新增5项后，在未修复生产脚本上实际得到 **16通过、4失败**：三个超时相关用例挂起失败，写入后 fetch 失败导致发布 exit 1；写入前拒绝用例本来就通过。见 [修复前失败](before/review-regressions-before-fix.log)。
3. 修复后两文件 **20通过、0失败、0跳过**，见 [定向成绩](after/targeted-after-fix.log)。
4. 完整 `npm run check`：**141文件、3435测试通过，0失败/跳过**，包含 Lint、TypeScript、生产构建通过，见 [完整日志](after/check.log)。20项定向成绩已包含在3435中，不相加为独立测试总数。

原测试的 A/B 逆序、非 main 拒绝、Namespace 精确选择、演练不写入、缺密钥不写入、写入期间 main 更新及最终一致等断言全部保留。没有 skip、弱化断言或引入替代运行器。未重新执行作者此前的替代运行器/变异检验。

## 工程检查

环境：Node.js **v24.19.0**。正式 `npm ci` 安装143个 lockfile 依赖，无离线垫片或依赖替换。

| 命令 | 结果 |
| --- | --- |
| node --version | v24.19.0 |
| npm ci（工作区可写 cache） | 通过 |
| npm run check | 通过，3435测试；Lint/TypeScript/Build通过 |
| npx vitest run src/tests/announcement-publish.test.ts src/tests/announcement-file.test.ts | 20通过 |
| node scripts/check-announcement.mjs announcements/current.json | 通过；1.0 Beta · 2026.11.13，11条 |
| PyYAML解析与调度断言 | 通过：main-only、contents read、串行组、version output → verify条件不变 |
| git diff --cached --check | 通过 |

[结构化成绩](validation-summary.json) · [工程日志](after/) · [可重现的YAML校验](validate-workflow.py) · [文件清单](FILES.txt)

PyYAML仅用于当前环境的附加静态检查，未新增项目依赖，不代替正式 Vitest。没有运行全量 Chromium，脚本改动不涉及 UI；所有发布演练都是临时本地裸仓库、假 Wrangler、假 KV 和 Mock fetch，**真实 KV 写入0、手动 Actions dispatch 0、付费模型请求0**。生产构建只保留既有大于500kB chunk提示。

## 生产只读检查的边界

本轮仅尝试一次公开 API 的只读 GET：

```sh
curl --connect-timeout 5 --max-time 15 --dump-header production-api.headers --output production-api.body https://heijinwangchao.de5.net/api/announcement
```

结果为 curl **exit 56，CONNECT tunnel 403**，响应来自当前执行环境的连接代理，尚未取得目标 API 的 HTTP 响应。见 [原始头](production-readonly/production-api.headers) 和 [原始 stderr](production-readonly/production-api.stderr)。**这不能用来认定生产网站故障。** 没有绕过网络策略或重试写入。

因此，本轮无法独立核验线上 `X-Announcement-Source`、当前 `current.version` 是否已与拟发布版相同、真实 Worker KV 绑定、Token权限、账号及安全回滚备份。原作者报告过 Cloudflare Builds成功；本轮未取得可独立确认这些生产项目的证据，不将其写成已验收。

已阅读并格式校验现有11条Beta公告；本轮未擅自改写产品文案或 version。最终玩家文案确认、当前线上版号核对、#128/#132/#133实际部署及真实Cloudflare配置确认仍留给管理员/十代目，不能用本地假KV成绩替代。

## 交付与授权

本轮修复及正式本地回归通过，生产验收仍有上述待确认项。[保护文件哈希](protected-files.json) 证明原工作流、公告文件、Worker、Schema、前端及包依赖未改。

推送原 `feat/announcement-auto-publish` 分支，更新原 PR #129，不新开 PR。**未合并、未手动触发发布工作流、未部署或写入生产 KV。** 合并本 PR 可能自动触发正式公告写入，仍需用户后续明确授权，测试全绿不等于已授权发布。
