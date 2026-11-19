# 试玩返修 · 正文响应格式与结束诊断

现场版本为 `c6aade848042aecb62234c71b8932e767c0ed52e`。本轮合入 main `5358a36196206e9bad9b06367eaf3fa3768a0db2`。合并时只在 AiClient 的请求检查器入口发生冲突，保留主干的记录开关与预设参数诊断。#203 的局部结算逻辑沿用主干。

## 可以复现的误报

旧版本按请求的 stream 开关和区分大小写的 JSON 类型头选择解析器。要求流式时，完整的 OpenAI 兼容对象即使带有 stop，也可能被当作 SSE。没有 data 行，程序随后报 stream_interrupted。反向也可复现，要求非流式但实际收到 SSE 时，旧版会将帧流交给 JSON.parse。

在同步 main 后的未修版本运行仓库 Vitest，首批 9 组中 8 组失败，标准 JSON 头的对照通过。桌面 Chromium 的生产预览使用真实内置脚本、游戏按钮和合成存档，给完整 JSON 标上 text/plain。草稿持久失败码实测为 stream_interrupted。附件的 Node 22 替代依赖结果只用于设计对照。

现场确实出现过同一错误码。中转后台另有一份带 stop、usage 和 wave_delivery 文本标记的 OpenAI 兼容记录。后台展示可能经过汇总，且与游戏失败日志没有共同请求标识。现场 HTTP 类型、传输格式、是否属于同一次尝试，以及那份正文是否满足业务规则，均未确认。

## 读取与验证

预设后端在同一 reader 上检查最多 4096 字节，允许起始 UTF-8 BOM、JSON 空白和 SSE 前导空行。首个有效字节为左花括号时选完整 JSON。行首 SSE 注释或 data、event、id、retry 字段前缀选 SSE。无法确定、HTML、缩进的伪 SSE 字段及超出前缀预算仍未识别的响应会失败。类型头按 MIME 主类型识别，忽略大小写及参数。复制时只投影已知主类型，其余归为 other，缺省为 null。

所有已读分块原样、原序交给所选解析器一次。SSE 一旦可识别即可输出，无需收齐响应。HTTP 读取异常、UTF-8 错误、完整 JSON 解码、完成标记及工具参数合法性仍分别检查。OpenAI 兼容 SSE 要求 delta，对直接发送完整 message 的帧明确报 unsupported。上游已有 stop 并正常 EOF 时可沿用原有无 DONE 兼容；没有结束依据时，即使正文标签闭合或包装器生成结束帧也会失败。Anthropic 的真实 message_stop 仍可结束尚未关闭的连接。

格式识别只消费当前 Response。正式生成沿用一次性请求关联、一次上游传输与原有 Story、续写和草稿事务。未改内置主脚本和任何提示词。[解析与结束校验](../../src/presets/tavern/upstream.ts) · [前缀读取](../../src/presets/tavern/responseFormat.ts)

## 玩家如何复制

打开「三阶段 → 正文 → 模型原文 → 复制本次诊断」。手机在失败时还会打开「重试与变更详情」，可直接切到「模型原文」，展开三阶段记录及「正文模型原文」，再复制。浏览器拒绝剪贴板权限时，可以展开「本次正文响应诊断」手动选择。记录绑定本页单次请求，刷新或临时记录淘汰后不可恢复。

例如，合成 SSE 已送出文本但缺少结束依据时，诊断包含以下字段节选。

```json
{
  "failureLayer": "upstream",
  "code": "stream_interrupted",
  "fieldPath": "tavern.upstream.missing_finish",
  "storyValidated": false,
  "candidateSaved": false,
  "tavern": {
    "requestedStream": true,
    "contentType": "text/plain",
    "normalized": "sse",
    "formatEvidence": "sse_field",
    "readerEof": true,
    "boundary": "eof",
    "complete": false,
    "calls": 1
  }
}
```

normalized 表示选中的解析器，complete 表示通过上游完整性检查。wrapper=returned、wrapperBodyRead、restored 分别记录脚本返回 Response、客户端成功读完包装响应、取得可交给业务层的文本。Story 校验与成功持久化另行记录。readerEof 只在 reader 确实得到 done 时设置。rawFinish 保留 stop、tool_calls、cancelled 等已知短码及其大小写，任意陌生字符串不公开。缺少上游 usage 时保持缺失。诊断不含模型原文、凭证、任意响应头或真实存档标识。

## 可复验的证据

- 仓库 Vitest 分字节送入 BOM、中文、JSON、SSE 字段和注释。覆盖类型头误标、缺失、大小写、最后一帧没有空行、损坏编码、读取异常、HTML、前缀上限、未知 finish、过滤、部分工具参数，以及包装器试图覆盖失败。每次调用检查 Mock 传输次数。[正式测试](../../src/tests/tavern-backend.test.ts)
- 生产构建预览直接点击游戏按钮。文本标记用较长多行中文、JSON 转义、变量规划和行动选项，验证原脚本处理后的正文与 IndexedDB 草稿逐字相等。失败对照分别缺少上游结束证据、返回 stop 但变量规划非法。两者从界面复制到的失败层不同。actual_content 工具参数仍由实际脚本还原；四协议各有 JSON 和 SSE 用例。[双端场景](../../e2e/peinture-settings.spec.ts)
- 合成测试的中间记录保留在本次工作区。首次桌面 JSON 回放读到草稿失败码 stream_interrupted。另一次同时运行本地构建与预览时，2 个桌面用例在发送上游前发生静态资源 fusheng 模块 HTTP 404，其余 26 项通过。固定 dist 后再单进程运行整批，最终成绩单独报告。
- 手机失败后会自动弹出诊断对话框。中间一次 28 项浏览器运行有两项手机失败用例因测试尝试点击遮罩后的工作流而超时。测试随后按玩家实际可操作的路径从对话框复制，保留存档、次数、错误层及隐私断言。
- 浏览器使用桌面 Chromium 和 Pixel 7 视口。未运行真实模型、真实玩家原文、iOS 真机或无关全量浏览器套件。各批次数与最终 SHA、CI 和对应预览见原 PR 验收留言。
