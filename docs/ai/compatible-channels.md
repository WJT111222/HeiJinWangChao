# 第三方 OpenAI 兼容渠道

在「设置 → AI 连接」中为每个产品创建独立渠道。选择服务商，填写该产品的 API Key，再为正文或各独立阶段选择模型。模型列表不可读时，可以直接填写控制台提供的调用 ID，保存后刷新仍有效。Variables、World 和 Memory 均可跟随正文，也可使用独立路由。

| 服务 | 基础地址 | 选模型与鉴权 |
| --- | --- | --- |
| 百度千帆 V2 | `https://qianfan.baidubce.com/v2` | 使用绑定了应用权限的千帆 ModelBuilder API Key，选择模型 ID 或服务的 API 名称。 |
| 火山方舟普通 API | `https://ark.cn-beijing.volces.com/api/v3` | 使用普通方舟 API Key，填写账号可用的模型 ID 或已开通的推理接入点 ID。 |
| 方舟 Agent Plan | `https://ark.cn-beijing.volces.com/api/plan/v3` | 套餐有独立密钥及使用场景限制。官方对文本模型限制通用 API 调用。游戏文本生成请使用普通方舟 API。尚未证实套餐提供模型列表，客户端仅查询套餐自身的列表路径。 |
| OpenRouter | `https://openrouter.ai/api/v1` | 使用 OpenRouter API Key，保留完整模型 ID，包括提供商前缀及所选变体后缀。 |

以上均使用 OpenAI 兼容的 Bearer 鉴权。文档核对日期为 2026-11-22。[千帆鉴权](https://cloud.baidu.com/doc/qianfan-api/s/vmwbl43ut) · [千帆列表](https://cloud.baidu.com/doc/qianfan-api/s/Amwbl43sp) · [方舟聊天](https://api.volcengine.com/api-explorer/?action=ChatCompletions&serviceCode=ark&version=2024-01-01) · [方舟列表](https://docs.volcengine.com/docs/ark/models-api) · [套餐地址](https://docs.volcengine.com/docs/ark/agent-plan-personal-other-tools?lang=zh) · [套餐使用范围](https://docs.volcengine.com/docs/ark/agent-plan-personal-plan-overview?lang=zh) · [OpenRouter 聊天](https://openrouter.ai/developers) · [OpenRouter 列表](https://openrouter.ai/docs/api/api-reference/models/get-models)

## 复现与修复

在 main `4e14d924b75ffedcf95b876cda000ad90d0d8d78` 上，填入完整聊天地址时，模型列表能成功，但正式生成重复追加了 `chat/completions`。填入列表地址则向 `models/chat/completions` 发 POST。四类入口的 20 项新增传输测试在旧实现上全部失败，覆盖错误的生成地址和跨产品的列表探测。正确的基础地址原本就能使用。玩家的实际账号、旧配置和失败响应均未提供，无法把每次真实失败唯一归因于这两处缺陷。

修复在构造请求时保留原服务版本、产品前缀，统一处理兼容协议的尾部斜杠、完整聊天和列表地址。原配置无需迁移。四个已知产品地址分别读取自身列表，自定义服务保留原有的有界同源发现策略。未开通服务、填写网站首页、填错区域或混用不同产品的密钥时，仍需玩家修正。切换服务商地址或跨产品编辑地址时请重新填写对应密钥。

过去同一渠道同时出现模型列表失败、测试回复成功时，页面仍优先显示“连接失败”。现在分别展示结果；列表返回空、404、405 或网络错误都不会删除手动模型。列表请求仅能确认枚举接口可用，测试回复仅能确认指定模型能回答简短请求。实际 Variables 回归使用正式 VariableStage、文本命令编译和 IndexedDB 候选保存。

## 错误与验证边界

- HTTP 401／403 检查密钥、项目与模型授权。服务明确报告模型或接入点不存在时单独提示。普通 404 仍可能是地址或模型错误，须对照控制台；客户端不推断账号权限。
- 明确拒绝已发送的可选参数时提示参数问题。沿用已有兼容策略，只有玩家再次主动生成才使用调整后的参数。429 或 5xx 分别提示限流或服务异常。
- 浏览器未获得 HTTP 响应时，只能报告网络、CORS 或 TLS 可能性。可在开发者工具中核对状态和跨域响应，无需复制授权头。服务未开放网页直连时，选用支持浏览器访问的授权入口；服务端中继需要单独设计鉴权、凭证托管与费用限制。
- 不完整 JSON、SSE 读流错误和业务输出格式错误继续走既有校验。Mock 能验证浏览器发送内容、解析和候选是否保存。模型真实授权、额度、跨域策略、长上下文及指令遵从率需用获准的账号分别验收。未调用真实模型。
