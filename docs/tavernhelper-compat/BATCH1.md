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
