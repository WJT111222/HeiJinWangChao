# SSE 脱敏观察补丁

本补丁沿用 Story Tool Call 的临时诊断和现有下载入口。响应读取仍由同一个 reader 执行。MIME 分类独立于原传输选择，普通文本、JSON 与 SSE 的处理规则以及 Tool Call 默认关闭的设置保持原样。

## 如何读诊断

- `contentType` 是固定的媒体类型分类，响应进入读取层后才记录。类型参数和原始响应头不进入导出。
- `sse.reads` 统计实际交付的数据块，包含空块，另有 `nonEmptyReads` 和累计 `bytes`。`firstReadHadBytes` 描述第一个块，`firstBodyChunkMs` 仍记录首个非空块。所有新计数上限为 2³¹−1，超过时 `saturated` 为真。
- `dataLines`、`commentLines`、`blankLines` 和 `unrecognizedLines` 描述现有扫描分支。未识别行也可能是当前未处理的标准 SSE 字段，例如 `id:`。计数只表示客户端如何处理行，无法确认内容来自 HTML、代理或供应商。
- `delimitedDataEvents` 和 `eofDataEvents` 分别统计由空行和 EOF 兼容分支交出的数据事件。`bufferedTail` 和 `pendingData` 表示最近的读取或分帧位置是否有文本残尾或未交出的 `data:` 行，解码器内部未完成的字节不计入文本残尾。
- `readerEof` 仅在未取消时实际读取到 `done=true` 才设置。收到 `[DONE]` 后可以直接退出，此时无需再读 EOF。正常 EOF 后解码或残尾检查仍可能失败，此时 `readerEof=true`，上层 `boundary` 仍可能为空。
- `failureSite` 在对应分支记录 `reader_read`、`utf8_chunk`、`utf8_eof`、`unrecognized_eof_tail` 或 `missing_body`。工具校验、超时和取消沿用原有结局。取消导致的读流结束不会被标作正常 EOF。

诊断字段只存固定枚举、布尔值和计数，沿用现有临时记录与容量检查。读流和解码异常继续走原错误映射。记录过程不保存原始数据块、异常文本、剧情、工具参数、凭证、接口 URL 或真实存档 ID。单独 CR 换行兼容问题仍按调查报告独立记录。

## 正式回归

`src/tests/story-tool-sse-observation.test.ts` 纳入默认 Vitest。夹具经真实客户端和隔离 Repository，对比观察开启、关闭、回调抛错时的出站指纹、调用次数、错误及保存结果，并验证单 reader、取消、120 秒总超时、真实 DONE／EOF 和计数饱和。浏览器回归也覆盖了在 PC 和手机实际下载零帧 EOF 残尾诊断及刷新后临时记录消失。

所有测试响应为 Mock。下一次自然发生失败时，可对照 `readerEof` 和 `failureSite` 判断本地执行到了哪个分支，再评估是否需要后续修复。
