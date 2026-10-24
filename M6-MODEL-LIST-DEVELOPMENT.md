# M6：API 模型列表兼容性修复

日期：2026-10-24（北京时间）。基线为最新远端 `main@9176ed6a7fcf6a290679a982cfb3fa7777a47da0`，已合并 PR #25。开始工作区干净，独立分支 `codex/m6-model-list-compat`。

第一轮验证后远端新增了仅文档的 PR #26；已在本开发分支快进同步至 `main@0c30bb36d614542ce86512d0da985065dbfb20ee`，保留全部 9 个文档变更，并阅读新增 `docs/API-MODEL-LIST-COMPATIBILITY.md`。据此补齐完整 `/models` 地址及脱敏端点/HTTP 状态；不复制任务书 P1 代理，本轮仍遵循用户明确的“不开发跨域中转”要求。

本轮仅修复模型列表获取、解析及安全诊断，不开展其他 M6 功能，不变更四阶段生成路径或浏览器直连架构。

## 实际审查与失败复现

旧代码将 Base URL 简单拼接 `/models`，仅支持 `data` / Gemini `models` 对象数组；未知 JSON 也会被转换成空数组。分页只有 Gemini/Anthropic 分支，OpenAI 分页被静默忽略。模型 ID 的 ASCII 白名单会排除中文、空格、括号、加号等合法中转标识。

先新增并运行 5 个只调用原 `AiClient.listModels` 的测试，修复前全部失败：

1. 根地址 `/models` 返回 404，而同源 `/v1/models` 可用：旧实现直接失败。
2. 用户误填 `/v2/chat/completions///`：旧实现请求错误的聊天地址子路径。
3. 未知 JSON 对象：旧实现错误返回成功空列表。
4. 服务实际返回 `厂商/模型+1 (线路A)`：旧实现过滤了该 ID。
5. `has_more + last_id` 的第二页：旧实现只返回第一页。

修复后上述 5 项全部通过。这是可复现的客户端缺口；没有用户真实服务响应，不能据此断言所有“模型少”的渠道都由同一个问题造成。

## 参考仓库核对

只读检查 `WJT111222/MoRanJiangHu` 默认 main 的真实源码，未修改参考仓库。记录本次读取的文件 Git blob SHA：

| 文件 | Blob SHA |
| --- | --- |
| `utils/openAIModelListFetcher.ts` | `babb10ef7eb9e74b37be53a2dde02e7c73196829` |
| `utils/openAICompatibleEndpoint.ts` | `ce00426b67c462044389ffabd77f25b13759ace5` |
| `utils/apiConfig.ts` 的候选地址构建 | `b63b8c92e24e9d67bcd07102161bddd21e36c131` |
| `services/ai/corsRelay.ts` | `8cb2d5938195216ba15a5bdb4f5b7c0788c9f7cd` |

参考了去除聊天后缀、尾部斜杠、版本父路径和有限同源候选。没有复制 Capacitor、供应商域名特判、模型容量业务、第三方/同域 CORS 中转或新设置。参考代码对错误和空列表继续换路径，本项目则区分授权/路径/格式/网络错误，并在首个合法空列表处停止，避免反复查找所谓“更多模型”。

## 列表专用地址与停止条件

`modelListCandidates` 只为 Models GET 构造地址，不写回 Base URL。OpenAI 标准地址优先；误填的 `/chat/completions` 及所有末尾斜杠仅在列表查询内去除。

| Base URL 示例 | 按顺序尝试的同源路径 |
| --- | --- |
| `https://relay.example/` | `/models` → `/v1/models` |
| `https://relay.example/v1///` 或 `/v1/models///` | `/v1/models` → `/models` |
| `https://relay.example/proxy/v2/chat/completions/` | `/proxy/v2/models` → `/proxy/models` → `/models` → `/v1/models` |
| `https://relay.example/proxy` | `/proxy/models` → `/proxy/v1/models` → `/models` → `/v1/models` |

候选去重、最多 4 个，保留配置的 origin（协议/主机/端口），不会猜测管理后台、用户接口、代理路径或第三方域名。列表仍使用原认证头、`credentials:omit`、`redirect:error` 和 `no-referrer`。配置本身继续通过原 HTTPS/本机 HTTP、禁止 URL 凭证/查询参数等校验。

- 404/405、非法 JSON、未知列表结构或浏览器网络 TypeError 可有限尝试下一个同源候选。
- 401/403、429、其他拒绝及 5xx 不靠换路径绕过；取消和超时立即停止。
- 首个合法模型数组即确定端点，**包括合法空数组**。后续分页固定使用该端点；第二页失败不重新试其他端点，不把分页残缺误报为完整成功。
- 整次列表操作沿用原总超时/AbortSignal，不为每次候选重置超时。
- 不跟随响应重定向或分页 `next/links.next` URL。只将明确受支持的游标编码进同一个列表路径的查询参数。

正文、变量、世界、记忆的 `wireRequest/endpoint` 代码均未变。若用户误填完整聊天地址，列表可以兼容，但生成仍按原配置执行；UI 明确提示将 Base URL 改为接口根地址，不能声称已自动修复生成配置。完整 models 地址同样给出该提示；原配置不被静默覆盖。

## 解析、ID 与分页

支持的列表形态：

- OpenAI：`{data:[{id:...}]}`、`{models:[string|{id:...}]}` 或顶层字符串/ID 对象数组。
- Gemini：`{models:[{name:"models/..."}]}`；保留原前缀规范化及能力元数据。
- Anthropic：`{data:[{id:...}]}`。

不拿 `name/display_name/label` 猜成 OpenAI 模型 ID，不把数字强行转成 ID，不编造服务未返回的模型。仅对列表 ID 去首尾空白，保留大小写；去重后排序。

模型 ID 与手动配置共用原 Schema，允许可见 Unicode 和标点，但仍非空、最多 200 个 UTF-16 代码单元，拒绝控制/格式字符、行段分隔符、孤立代理码及配置首尾空白。原合法配置仍可原样读取，无版本迁移。Gemini 的路径编码与 OpenAI/Anthropic 的 JSON 模型字段保留原安全处理；不是新增任意 URL。

| 协议 / 明确返回字段 | 下一页参数 |
| --- | --- |
| Gemini `nextPageToken` | `pageToken` |
| Anthropic `has_more=true + last_id` | `after_id`，保留 `limit=100` |
| OpenAI-compatible `has_more=true + last_id` | `after` |
| OpenAI-compatible `next_cursor` | `cursor` |
| OpenAI-compatible 正整数 `next_page` | `page` |

游标有长度/控制字符/凭证检查；循环、矛盾、缺少游标、混合分页协议或不支持的 URL 延续会明确报分页错误，不导航到任意地址。最多 20 页；若到上限仍有后续，返回已实际收到的模型并标记 `complete=false`，UI 明确说明尚未读完整及可手填。`complete` 仅代表已支持的分页契约是否读完，不代表平台全部模型或推理权限。

## 数量、错误与缓存

成功后各模型选择区显示：

> 当前接口返回 N 个模型。列表由服务端提供，可能不是该平台全部可用模型。

同时显示脱敏列表端点和成功 HTTP 状态，以及累计原始条目、有效条目、过滤条目、重复条目、最终列表模型数、页数和同源端点尝试数。有效条目包含重复，`原始 = 有效 + 过滤`，`有效 = 最终模型数 + 重复`。默认选项及已保存/手填的额外值不冒充服务返回模型。

`onDiagnostics` 仅含计数、完成状态、脱敏后的真实同源列表端点及 HTTP 状态。端点删除全部查询参数、只保留受信 origin/path，再遮蔽已知凭证及编码形式；不含认证头、响应正文或条目原文。含当前凭证及编码形式的 ID 被过滤，不展示敏感样本。UI 错误区分：

- 401/403：原有安全授权错误。
- 404：明确模型列表接口不存在/路径不支持。
- CORS/网络：浏览器连接失败，不能仅凭 Failed to fetch 断定是 CORS、TLS、DNS 或 Key 错误。
- 非法 JSON 与合法 JSON 中的未知结构：分别报告 JSON / 模型列表格式错误。
- 合法空数组或全部 ID 无效：请求成功、没有可用模型，附真实过滤数量。
- 无法安全继续分页：分页信息错误；20 页上限另有明确不完整提示。

PR #25 的共享缓存、并发合并、手动刷新、四阶段选模、跟随正文及手填保留。失败刷新保留上次成功列表及其数量诊断，不覆盖配置、默认模型、路由或 CredentialVault；连接身份变更和迟到写入保护继续有效。列表数据及诊断只留设置页内存，不写游戏存档。

## 测试与开发记录

新增 `model-list-compat.test.ts` 56 项和原缓存测试中 2 项，共新增 58 项单元/集成；覆盖候选顺序/边界、三协议、错误停止、空列表、异常结构、Unicode/旧配置、数量、分页/循环/上限、取消/超时、敏感信息和四阶段生成路径不变。

新增 8 个浏览器场景，桌面/移动各执行，共 16 项：真实设置保存自动查询、候选+分页+共享缓存、数量对账、Unicode 保存恢复，以及授权/404/网络/格式/非法 JSON/空列表分类；均检查旧选择、配置、凭证及手填入口。原 PR #25 和 P6 测试保留，仅同步成功说明文案及失败路径的有界请求数量。

原缓存测试重复使用同一个 Response 对象，刷新时实际已消费 body；改为每次返回新 Mock Response，保留原断言。新生成 URL 测试最初复制快照，触发了原 WeakMap 凭证保护；修正为用真实 channelSnapshot 创建测试请求，未削弱保护。类型检查发现 findLastIndex 不属于项目 ES2022 lib，已用原生循环处理，没有提升构建目标或加依赖。

首轮定向单元/缓存/Thinking 回归 101/101、Chromium 32/32，通过；首次完整检查 1083/1083、Chromium 180/180（10.3 分钟）通过。随后同步仅文档的 main 并补齐两项兼容细节，定向回归增至 106/106，通过。同步后的首次提示词检查暴露 PR #26 的基线元数据遗漏：`prompts/docs/README.md` 正文已更新而 `docs.README` 注册字符数/hash 未同步，导致 2 项资源完整性测试失败。使用既有 `npm run prompts:refresh` 修复，实际 diff 仅该说明文档的字符数（1354 → 1639）和 SHA-256；保留用户正文、原版本和 activation=never，不修改任何运行时提示词。中止该轮浏览器运行后重新执行全部检查，最终结果另列如下，不用旧结果冒充最终代码验证。

| 最终命令 | 结果 |
| --- | --- |
| `npm run prompts:check` | 82/82 通过（全量测试子集），含新 main 的 README 校验。 |
| `npm run check` | 1088/1088 通过，34 个测试文件；原 1030 项 + 新增 58 项。Lint、TypeScript 和 Vite 生产构建通过。 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 182/182 通过，10.3 分钟；原 166 项 + 新增 16 项，桌面/移动完整 Chromium，`.last-run.json` 为 passed，无失败。 |
| `git diff --check` | 最终工作区和暂存区均通过。 |

所有 API 使用 Mock，不调用真实收费模型；通过不能代表已经验证用户的真实中转站、模型调用权限或 CORS 配置。

生产构建仅保留既有 >500kB chunk 非阻断提示（最终主包 521.22kB，gzip 165.33kB）；没有新增依赖或改动构建目标。

## 哪些已修复，哪些仍依赖服务端

客户端已通过失败测试证明并修复：列表地址拼接/有限候选、合法 ID 错误过滤、未知 JSON 误当空列表，以及明确分页漏读。新增可核对统计和安全错误提示，不再静默把已知分页的第一页当完整结果。

以下仍取决于服务端：没有 Models 接口、不同授权套餐仅返回部分模型、服务只返回少量条目、采用尚不支持的封装/分页契约、CORS 未放行、模型列出但 Key 无调用权、服务内部失败。20 页/ID 长度等客户端安全上限也仍存在，并有明确诊断。不能为了凑全平台名单继续探测成功后的其他接口，不能编造缺失 ID。

本轮不提供 CORS 中转；需放行网页来源、提供兼容列表接口或使用手填备用，代理方案留待单独讨论。没有改变密钥策略、部署配置、Thinking、四阶段生成、运行时提示词正文、正式存档、领域命令和原子事务。说明文档的注册校验修复单列如上。

## 文件清单

新增：

- `src/services/ai/modelListing.ts`：同源候选、严格解析、分页及安全诊断类型。
- `src/tests/model-list-compat.test.ts`：56 项兼容回归及首批 5 项失败复现。
- `e2e/model-list-compat.spec.ts`：8 个新增浏览器场景。
- `M6-MODEL-LIST-DEVELOPMENT.md`：本报告。

修改：

- `src/services/ai/client.ts`：在原 listModels 内串联候选/分页，保持返回 string[] 接口兼容。
- `src/services/ai/configuration.ts`：模型 ID 字符兼容，原配置结构/版本不变。
- `src/services/ai/errors.ts`：列表格式与分页的安全错误类型。
- `prompts/manifest.json`：仅修复 main 文档更新遗漏的 docs.README 字符数/hash，运行时配置不变。
- `src/ui/settings/modelCatalog.ts`：数量说明、列表专用错误和旧诊断保留。
- `src/tests/model-catalog.test.ts`：新增 2 项，修复 Response 复用夹具。
- `e2e/ai-model-selection.spec.ts`、`e2e/ai-settings.spec.ts`：文案和有界回退的原断言适配。

独立 Draft PR 供审查；不合并、不主动部署，不改参考仓库或其他阶段功能。
