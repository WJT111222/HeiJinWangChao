# M6：模型列表最终加固与验收补充

最终验收日期：2026-10-25（北京时间）。基线：重新 fetch 后的 `main@7867228df0e173d5de21e5ed8d45914aa197aca3`（已合并 PR #27）；开始工作区干净，交付前再次核对远端 main 未变化。独立分支 `codex/m6-model-list-hardening`。本报告补充、保留 [PR #27 原报告](M6-MODEL-LIST-DEVELOPMENT.md)，不是重写模型列表或扩展游戏功能。

## 开发前结论及失败复现

已确认并先用旧源码运行失败测试：

- 原生 Gemini/Anthropic 的完整 Models URL 被追加第二个 `/models`（2 个失败用例）。
- 连续 404 时 UI 没有最后尝试端点与实际候选数量（1 个失败用例）。
- 有官方结构依据的 `models[].model` 被过滤（1 个失败用例）。
- 无法证明语义的 name/label-only 响应被当成成功空表（1 个失败用例）。

首批 5/5 测试修复前失败，修复后通过。后续补充测试还复现：缺少原鉴权 WeakMap 绑定的快照，在 GET 尚未发出时被计作一次尝试；将计数放到鉴权准备成功后，该反例通过且原凭证保护保持。另用标准 `Response.error()` 复现 status=0 被误归类为 HTTP 拒绝的边界；仅在 Models 中将其归为网络错误、状态未知，未更改共享生成处理。

无需修改的既有能力：OpenAI 有限同源候选、401/403/429/5xx 停止、禁止重定向、原生/兼容分页、20 页上限、空数组停止、循环/混合分页拒绝、模型 ID Unicode 校验、四阶段路由、旧选择和共享缓存、Thinking、正式回合事务。

## A：三协议 Models URL 边界

列表路径规范化覆盖三种协议：已以 `/models`（可带末尾斜杠）结束时直接请求该路径，避免由程序制造 `/models/models`。否则只在已配置的合法自定义路径后追加 `/models`。根路径 `/v1`、`/v1beta` 不被强制互换。

原生 Gemini/Anthropic 仍只有一个候选，不套用 OpenAI 四候选。Anthropic 保留 `limit=100` 与 `after_id`，Gemini 保留 `pageToken`；完整 Models URL 的分页也固定在同一端点。这里修复的是重复拼接，不擅自折叠用户自定义路径中已有的重复名称。

`fullEndpointInput` 提示扩展至原生协议。保存的 Base URL 不变；实际生成仍需合法 API 根路径。未修改 `wireRequest` 或任一生成 URL、方法、重试和收费行为。

## B：非标准字段的证据范围

只新增一个受限变体：Ollama 官方 `ListModelResponse` 结构，要求 `models[]` 中具备 `model` 字符串、可解析的 `modified_at`、非负整型 `size`、非空字符串 `digest`。使用 `model` 作为请求标识，不以 `name`、`label` 或 `display_name` 回退。标准显式 `id` 优先，非法 id 不通过另一个名称洗白。

只读核实的官方源码：

- [ollama/ollama api/types.go](https://github.com/ollama/ollama/blob/main/api/types.go)：`ListResponse` / `ListModelResponse`，blob `1aa71342a372fc2a0902cc55f43afe91c3a55d06`。
- [ollama/ollama server/routes.go](https://github.com/ollama/ollama/blob/main/server/routes.go)：`ListHandler` 返回 `api.ListResponse`，blob `fdf7a18f954ab7c249bb0e95a859b399105c7289`。

这是已知响应结构的兼容，不是声称用户真实中转站采用该格式；不新增 `/api/tags` 等探测地址，不部署 Ollama，也不调用真实模型。

未确认、明确不支持：普通 `{data:[{model:...}]}`、name-only、label-only、display_name-only 或只有 model/name 而缺少上述结构依据的对象。若非空列表完全不具备已支持的标识结构，报告格式错误，不能伪装空表。已有明确 id 结构中的非法条目继续过滤并计数，合法空数组继续是真实空列表，不因此探测更多路径。

Gemini 原生 name 字段按原协议继续支持。原始 ID 的大小写、内部空格、中文和合法标点不重写；沿用 PR #27 的字符/长度校验和去首尾空白。新增闭环测试通过列表 → 配置保存/恢复 → RequestSnapshot → 四阶段实际 Mock POST body，确认发送真实 ID，未发送展示名；所有 POST 都是 Mock 协议测试，不是付费探测。

## C：本次失败诊断

新增独立 `onFailureDiagnostics`，不复用成功统计：

- 最后实际尝试的 Models 端点（全部查询参数移除）。
- 已实际开始的候选数量（分页仍计同一个候选）。
- 最后一次请求真实收到的 HTTP 状态；没有收到响应则为 undefined，UI 明确显示“未获得 HTTP 状态”。
- 已读页数及固定的错误分类，不含原始异常或服务响应。

每发起一页都会重置“本次 HTTP 状态”，不能在第二页网络失败时借用第一页 200。收到响应头后再超时可以保留真实已收到的状态；没收到响应时不能伪造状态。取消或超时覆盖整次查询，失败回调只有一次；迟到回包在 signal 检查前不能更新状态或恢复成功。诊断观察器异常不改变原始错误、取消或重试语义。

分类继续区分授权、404/405 路径、JSON、列表结构、分页、网络/疑似 CORS、超时和取消。候选之间可能保留早期更有意义的格式错误分类；“最后端点/HTTP”始终只指最后一次真实尝试，不把较早响应状态挪到最后路径。

共享 ModelCatalog 分别保留 `diagnostics`（上次成功）与 `failureDiagnostics`（本次失败）。UI 明确写“本次获取失败”“保留上次模型列表，非本次请求结果”，选模、手填、路由及凭证不改，不自动切第一项。关闭设置或连接身份变化仍使用原取消/身份检查，不让旧回调污染新尝试。诊断仅设置页内存，不入 GameState、journal 或 IndexedDB。

## 密钥与路径脱敏

成功与失败共用端点脱敏：删除全部 query/hash，遮蔽已知凭证、其小写 percent 编码及多层编码形式；对超过解码边界的编码路径保守隐藏。显式 token/access_token/api_key/authorization 后的路径值、编码的 Bearer/Basic 内容也隐藏。仅有界解码用于判断，安全路径保留原格式；不跟随 URL、不请求新地址。

没有认证头、完整响应、分页游标或原始异常进入诊断。测试覆盖网络异常中回显密钥、连续 404、JSON/结构异常、第二页 HTTP/网络失败、预取消、超时、观察器异常，以及上次成功/本次失败并存。

这不是能识别任意自由路径隐私的语义系统；未知路径如含业务私密数据，用户分享诊断前仍应检查并进一步脱敏。未新增凭证存储位置或访问权限。

## 防御性验证（没有重写相关实现）

- 原同源/同协议/同端口与最多四候选、401/403/429/5xx 停止、redirect:error、GET-only、整次硬超时。
- 原 Gemini/Anthropic/OpenAI 游标、分页固定端点、循环/混合/任意 next URL 拒绝、重复去重、20 页明确不完整、首个合法空表停止。
- 四阶段选模、跟随正文、主题菜单、缓存合并、跨连接身份与迟到保护、旧合法 ID、Unicode/标点原样保存与请求。
- 所有生成工作流、Thinking/9 步/15 步、正式存档、事务及 NPC 信息隔离，继续跑原完整测试；核心代码无 diff。

## 用户本机真实浏览器检查（未替用户执行）

1. 打开游戏设置 → AI 连接，只在自己的设备填写协议、API 根地址和 Key，不分享明文凭证。
2. 保存后观察自动 Models GET，或点“刷新模型”。不用点“测试连接”，后者会生成内容且可能计费。
3. 记录成功/失败、脱敏端点、HTTP 或“未获得状态”、候选数、原始/有效/过滤/重复/模型数、页数及不完整提示；检查浏览器 Network 中实际 GET。分享前再检查敏感路径。
4. 网络错误不能直接断言是 CORS；需结合开发者工具区分服务路径、预检、DNS/TLS/浏览器策略。若仍列表少或结构不支持，只提供脱敏结构、字段类型和数量，不分享 Key/认证头/原始私密响应。

没有真实用户地址、密钥和脱敏响应样例，因此真实中转兼容仍待用户本机验证，不算完成验收。模型列出不代表 Key 有生成权限；服务只返回少量模型、授权过滤和未支持的封装不能由客户端编造名单解决。

## P1 代理结论

没有证据证明用户的真实故障必然是 CORS，当前无需实现代理。未来仅在真实阻塞已确认、服务端无法解决、Cloudflare 安全动态转发能力核实且用户明确批准后，另立 GET-only 任务研究。本轮未核验或改动 Cloudflare 动态转发/部署能力，不声称可部署代理；没有 POST 生成代理、自动付费重试或跨域扩权。

## 检查与历史保护

首轮 5 个失败复现和后续零次尝试反例均保留为正式测试。定向单元（含 PR #27 和缓存回归）107/107 通过；定向桌面/移动 Chromium 34/34 通过。ESLint 曾拦截诊断回调 finally 中 throw；改为仅隔离观察器异常，再抛原错误，并加入不掩盖授权错误的回归，未禁用规则。

新增 40 项单元测试、9 个浏览器场景 × 双视口（18 项），保留原 1088 项工程与 182 项 E2E。原 M6 报告及其验收历史未覆盖。技术文档仅纠正 #27 仍被写成待实施的状态，保留三代目原任务来源。

| 最终命令 | 结果 |
| --- | --- |
| `npm run prompts:check` | 通过，3 个文件、82/82 项。 |
| `npm run lint` | 通过，无警告。 |
| `npm run typecheck` | 通过。 |
| `npm run build` | 通过，输出 `dist/`。 |
| `npm run check` | 通过，35 个测试文件、1128/1128 项，包含 Lint、类型检查及生产构建。 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 通过，200/200 项（桌面及移动端），耗时 11.2 分钟。 |
| `git diff --check` | 通过。 |

工程测试保留原 1088 项并新增 40 项；E2E 保留原 182 项并新增 18 项。提示词检查 82 项也是完整工程测试的子集，不另算新增数量。生产构建仍提示部分 chunk 超过 500 kB；构建成功，本次不扩大到拆包优化。

全部 API 使用 Mock；绿色测试不是全供应商真实测试或长期游戏质量证明。没有真实收费模型、合并、部署、发布版本或新玩家设置。

## 文件清单

- `src/services/ai/modelListing.ts`：原生完整 URL、受证据约束的字段兼容、失败诊断类型及统一脱敏。
- `src/services/ai/client.ts`：仅 Models 查询的失败观察、真实状态/计数、取消和迟到边界。
- `src/ui/settings/modelCatalog.ts`：本次失败与旧成功分离，只改说明，不改选择器交互设计。
- `src/tests/model-list-hardening.test.ts`：40 项新增回归。
- `e2e/model-list-hardening.spec.ts`：9 场景双视口验证。
- `M6-MODEL-LIST-HARDENING.md`：本补充报告。
- `docs/API-MODEL-LIST-COMPATIBILITY.md`、`docs/README.md`、`docs/CURRENT_ARCHITECTURE.md`、`src/services/README.md`、`README.md`、`CHANGELOG.md`：#27 合并状态及补充报告入口。
