# 第一批 · 内置预设与正文组装

基线为 `553212ac2bc569cfcf19415f9a28225b092c4bdb`。原 Draft PR #201 继承阶段 A 的源码审计，采用 #199 确定的可信扩展路线。本批可以在 Mock 传输上走完正式 Story 请求与严格响应解析。玩家设置面板、虚拟后端、助手执行和附页属于后续工作。

## 资源与授权

内置库提供《我即浪潮 · 1118 peinture》的王朝适配版本 `peinture-1118@heijin.1`，作者署名为 ⁺✞ʚ界徐盛重度依赖ɞ✟。负责人已确认改编正文和两份脚本获得二传许可。固定参照为 SillyTavern 1.19.0 和 TavernHelper 4.12.1，版本、提交与源码入口见[阶段 A 参照表](README.md)。本仓实现独立编写。

本地核对了原件 SHA-256、条目标识与顺序，两份脚本 content 分别为 168,497 和 591,492 个 UTF-8 字节。原件及适配件的 extensions 深度比较相等，包括目录、脚本、按钮、data 和未识别的扩展。原 JSON 留在本地。预览构建会分发经授权的改编 JSON，以惰性资源加载；脚本 content 作为字符串保存。

| 资料 | 原件 | 内置适配 |
| --- | ---: | ---: |
| prompts 条目 | 164 | 164 |
| 100001 顺序行 | 163 | 163 |
| 启用行 | 87 | 80 |

逐条比较得到 25 个有变化的条目。清单中的 23 个条目清空内容并锁定关闭，包括旧篇幅、附页、替代交稿格式和与本项目无关的请求指令。其余两项为 `wave-tool-definitions` 和 `jailbreak`。前者改为读取真实消息中的资料；后者引用原写作安排与规划变量，并把公开提纲交给游戏的 thinking 块。资料区两端的原标记保留。全部 23 个标识与原件摘要见[资源清单](../../src/presets/resources/peinture-manifest.json)。

## 数据、组装与出站

| 入口 | 实际行为 |
| --- | --- |
| `loadPreset` / `exportWithOverrides` | 保留输入原串 `raw`，按唯一 100001 顺序表解析；顺序行控制启用，未排序条目只留在包中。覆盖层分别合并条目、采样值和脚本偏好。原件导出取 raw；合并导出仍保留未知字段。对内置包，raw 指随游戏分发的适配原件。 |
| `readPresetSettings` / `savePresetSettings` / `resetPackage` | 一个全局 localStorage 文档。按包 ID、版本和脚本 ID 分开配置；恢复目标包会保留其他包与游戏存档。写入失败向调用方报错。默认关闭。 |
| `captureStoryPreset` → `resolveStoryPreset` | StoryStage 开始即快照选择与覆盖，随后加载资源；关闭时沿用原生组装。各存档使用各自的世界与临时宏变量。 |
| `assemblePreset` / `storyMaterials` | 顺序表驱动 set/get、两种随机参数分隔、嵌套和角色宏；角色、深度和同层次序保留。未知宏原样保留并列入 unknownMacros。实际启用条目包含上游 `{{// …}}` 注释宏，本批按未知宏保留。 |
| `historyForSending` | 取 extensions.regex_scripts 的 placement 2、promptOnly 子集；对历史 assistant 副本按顺序、深度及捕获替换执行。1118 有三条符合条件。SPreset 中的绑定及显示正则只作数据保留。 |
| `composePrompt` → `runStageRequest` → `wireRequest` | 写作表现交给预设，保留游戏的关系边界、篇幅、行动选项和最终格式提醒。角色、事实、场景、长期记忆分别映射到资料区；当前玩家行动在历史末尾出现一次。续写继续在组装后的消息后追加原阶段所需的部分正文和指令。 |
| 采样与后续适配 | 温度、top_p 和惩罚来自包；渠道、模型、密钥、超时、输出 Token 上限沿用游戏快照。OpenAI 兼容消息保留角色。Gemini、Anthropic 遇到无法表示的中途 system 在出站前明确失败。第二批可以从实际 messages 与 sampling 接协议适配器；第三批可以直接读取规范化脚本树。 |

## 历史资料边界

Journal 提供最近 N 回合的完整正文，N 取现有 immediateWindowSize。正式 Journal 没有逐字记录行动。Repository 的新只读方法校对当前正式状态与活动时间线，只返回可核实的撤回记录中的原行动。现行上限为五个普通回合并受容量限制；开局、旧备份或已淘汰记录可能只有正文。该情形省略缺失的 user 消息。若要求任意 N 的全部逐字行动，需另行决定持久化来源。

## 验证

本地 Node 24.19.0 使用锁文件依赖和正式 Vitest。专项套件见 [preset-story.test.ts](../../src/tests/preset-story.test.ts)，历史窗口及撤回测试见 [turn-undo.test.ts](../../src/tests/turn-undo.test.ts)。测试使用合成存档、内存配置和 Mock fetch；正式资源作为产品载入，私人原件未作为 CI 夹具。

定向范围包括预设、撤回、Story 阶段、断点续写、七风格隔离和格式提醒出站。覆盖真实 role 与次序、无附页交稿、当前行动唯一、旧设置恢复、非法响应拒绝、单次请求、跨存档隔离，并逐项比对 Variables、World、Memory 的 messages、模块、上下文和序列化请求。全量结果对应 PR 提交的 Actions。没有新增 UI、浏览器截图或付费测试；真实供应商接受率、文学质量和脚本动态行为未验证。

## #201 第一批复审：预设采样参数

复现方式为真实请求入口配合 Mock transport：旧版在 OpenAI Chat Completions 兼容路径直接发送预设中的 `top_p` 和两个惩罚系数。关闭渠道温度也不会阻止 `top_p` 出站。对中转站明确拒绝这些字段的 400/422，旧版不会记住，玩家再次主动生成仍发送同一字段。

- 截至 2026-11-19，只在 `https://api.openai.com/v1/chat/completions` 的 OpenAI 渠道前置应用已核实规则。`gpt-5`、`gpt-5-mini`、`gpt-5-nano` 及各自 `2025-08-07` 快照省略 `temperature` 和 `top_p`。两项惩罚系数逐项判断，文档未证实的模型限制不预先套用。参见 [GPT-5.2 采样兼容说明](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2#parameter-compatibility) 和 [Chat Completions 参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
- 官方 `gpt-5.1`、`gpt-5.2` 及其正式快照以实际 `reasoning_effort` 判断。游戏当前未发送该字段，两种型号使用官方明确的 `none` 默认值，保留 `temperature` 和 `top_p`。项目不改变推理档位，中转站同名模型、其他别名及未知推理配置不推定为官方默认。参见 [GPT-5.1 模型页](https://developers.openai.com/api/docs/models/gpt-5.1) 和 [GPT-5.2 模型页](https://developers.openai.com/api/docs/models/gpt-5.2)。
- 收到明确指向实际发送字段的不支持错误时，本次照常失败。仅下一次主动生成会按渠道 ID、协议、地址、模型和实际推理配置使用内存兼容记录。对可确认的「只允许默认值」仅记住本次被拒绝的值。未知条件、数值越界、含糊错误、未发送字段、认证失败、限流和服务端错误均不写入该记录。记录沿用现有清理入口，独立于原生模式已有的参数兼容记忆。
- 已有的 AI 请求检查逐项显示预设期望值、最终发送值或省略原因，例如已知模型限制、该路由此前明确拒绝。它不改变预设存储或出站凭证与渠道预算。Variables、World、Memory 的请求载荷不变。

正式 Vitest 保留修改前的失败证据。测试直接捕获序列化请求体与传输次数，覆盖保留 0、官方规则、条件与路由隔离、未发送字段、旧 max_tokens 和 temperature 兼容，以及启用预设前后的原生四阶段请求。真实 StoryStage 和测试 IndexedDB 验证首次参数拒绝只发一次，原正文与正式存档仍在；第二次主动生成只再发一次。真实供应商、实际收费与第二批的 Gemini／Anthropic 消息布局未在本轮验证。
