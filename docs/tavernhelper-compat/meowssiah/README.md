# 小猫之神与神域控制台

基线为 `release/1.0` 的 `5d4a42104c3f363d8bf6559f20a5dea719d7e12f`。玩家可在设置的「运行 → 正文预设」选择「小猫之神」，保存后打开「神域控制台」。原生、独立防截断和两个浪潮版本保留各自的入口。开发环境的 C2 夹具继续使用单独的预设 ID 和 `submit_scene`。

## 适配了哪些原版内容

输入文件为 SoliUmbra 的 `Meowssiah-2.1.7.json`，内部标识为 `3.0-Preview-01 / 301`。完整 SHA-256 为 `81c74429031e005fec1d0ea0a2cb7b4c35e3a055c3ce2ad4a7f3cf9c2fdf57f0`。原件有 56 项提示词，100001 顺序表列出其中 54 项。两份各 8 条的正则清单逐项相同。两份 TavernHelper 脚本分别是 SPreset 加载器和菜单。原件仅作为数据静态读取。拥有原件的维护者可在仓库根目录执行 `python3 scripts/adapt-meowssiah.py /path/to/Meowssiah-2.1.7.json`，重建文学资源、菜单、原件声明、清单及版本指纹。[逐条清单](inventory.md) · [固定来源与摘要](../../../experiments/meowssiah/SOURCES.json)

| 原版对象 | 正式接入及取舍 |
|---|---|
| 文学条目与宏 | 保留适用条目的标识、角色、发行顺序和初始开关。24 个可调条目分为 9 组，包括主文风、人物描写、多视角、人称、篇幅、玩家输入转述。解析菜单指令并去除编辑器注释。适用的玩家姓名宏通过现有宿主展开。附加创作要求是独立的 user 消息。发行资源含 36 个条目，包括王朝材料槽、作者标识及附加要求。 |
| 玩家和世界材料 | 正式时间、场景、人物、知识与记忆由王朝提供。历史槽读取已结算正文及可取得的真实行动。主世界观经现有 foundation 装配；玩家触发书在正文准备完成后插入。变量、实体、World 和正式写入使用原工作流。 |
| FinalRequestProcessing | 保留固定回调的请求处理顺序及工具声明。文学菜单指令在资源构建时解释，材料槽和历史在宿主装配。省去原处理器中针对第三方 MVU、数据库、EJS、角色卡、模拟历史及思考预填的分支。出站请求在宿主完成协议适配。 |
| ToolBindings / toolCallFormatter | 实际原版工具名为 `soliumbra_reply`。原始静态绑定只声明 `think_nya`，原件的最终处理器还动态组织其他字段。本版要求 `game_content` 完整承载王朝正文协议。可选的 `think_nya` 只作为模型原文中的作者附注；启用「猫猫悄悄话」时另行注册原版 `comment` 字段。工具执行原 action 的 `{"ok":true}`，宿主验证调用身份及交付正文的 UTF-8 字节数。合法纯文本保留，无工具收据。 |
| OutputPreprocessing | 使用固定的 SPreset 结果归一化管线，在上游完整性验证通过后提取正文。仅在已闭合的前置兼容思考块之后紧接正式开场标签时清理该包装。正文内部的标签和排版不经此步骤改写。原始观察与供应商公开思考分别保留。 |
| RegexBinding | 发送副本应用原版两条历史过滤。其余展示正则由王朝纯文本阅读器承担；正式记忆已提供上下文，不执行酒馆简报替换，不写回历史。 |
| ChatSquash、MacroNest、MessageInjections | 原件关闭前两项、注入数组为空，维持该行为。原件启用空的 ForcedPostProcessing 模式，无独立转换。 |
| 菜单、小纸条与方案 | 将菜单脚本中的分组、互斥及文学条目转为 React 控制台。保留作者的粉玫瑰与浆果色系、中文条目和日夜模式。支持编辑、恢复、命名方案、JSON 导入导出和四项采样设置。导演便签按当前存档保存，支持一次或持续使用。 |
| 缓存、账本与临时状态 | 每次请求从冻结的文学设置、当前正式历史和已验证世界观创建消息。原版独立聊天模式、手工重建酒馆缓存和第三方数据库未接入。撤回或换档后的资料重新来自所选正式时间线。没有模拟助手轮次、虚构工具结果或额外生成调用。 |
| 工具历史与渠道 | 本版使用终端交付，无需向下次模型请求发送 tool-result。保留当前调用的真实供应商 ID；无 ID 的 Gemini 响应用现有公共解析器的本次局部关联标识。局部标识不会作为跨轮签名或历史执行证据发送。跨轮可执行工具和独立 API 渠道管理未开放。 |
| 外部依赖 | 远端加载器、任意脚本编译、外部日志、外链字体与头像、外部模型调用及全局变量写入均未接入。HTML 菜单脚本和展示正则不会在游戏页面执行。 |

## 从设置到提交

`src/presets/meowssiah/` 提供独立注册、资源及版本。`src/ui/settings/meowssiah/` 保存按预设版本校验的方案；互斥组选项、启用项文本与采样实值进入 v4 文学指纹。文学版本摘要绑定发行资源、两条历史正则和本地处理组件。关闭预设后恢复原生设置。编辑中的旧标签页保存前会检查已持久化版本。

`StoryStage.generate` 获取世界观租约后读取当前存档实例的小纸条。一次性纸条 ID 只随成功候选交给 `SaveRepository`。写入候选、发布世界观来源、删除匹配的一次性纸条在同一 IndexedDB 事务内完成。发生竞争时，较新的纸条得到保留。打开设置、取消、保存失败和单纯阅读不消费纸条。纸条属于本机存档控制数据，不进入正式 GameState 或备份文件。

`executePrepared` 只在 Story 选择猫神时启动正式文学沙箱。宿主所在的页面持有渠道凭证及正式存档权限。固定处理器运行在不透明来源 iframe 的专属 Worker 中，每个请求具有一个私有端口，依次执行 prepare 和 finish。真实 HTTP 响应先经过公共 `UpstreamFrames` 的顺序与终止校验，然后交付调用参数。候选建立后仍须通过王朝原有的正文、世界观和业务校验，正式提交才改变回合及 revision。错误或取消原样交回原流程。普通隔离生成使用单次直连；需要通过跨域中转的真实渠道仍受既有传输能力限制。

## 源码、署名和许可

项目负责人已明确确认取得作者对公开分发本次文学适配资源及 SPreset 组合产物的授权。原件自带的私下免费传播说明仍完整保留。仓库使用固定 SPreset 提交 `53bd585da14248ba10baaede7fc7ed0cebe1eeeb`。本地修改的组件保留 SoliUmbra / starowo 署名、GPLv3 全文和可编辑对应源码。生产构建在控制台的「来源及许可」提供下载，同一件产物随附 frame、pipeline、worker、build 四份 .mjs、来源清单、作者声明与 COPYING。在空目录中用 Node 24 执行 `node build.mjs --standalone` 可离线重建完全相同的 sandbox.html。整部游戏的授权范围没有随本次适配改变。后续增加第三方素材或变更组合分发范围须核对各自权利。[第三方署名](../../../THIRD_PARTY_NOTICES.md) · [GPLv3](../../../experiments/spreset/COPYING)

## 独立验收

在 Node 24 下使用锁文件安装依赖。在开发服务器 5174 和生产预览 5196 分别运行，Chromium 测试使用单 Worker、零重试。

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/meowssiah.test.ts
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/meowssiah.spec.ts e2e/spreset-isolation.spec.ts e2e/spreset-prototype.spec.ts e2e/spreset-terminal.spec.ts e2e/spreset-tool-order.spec.ts e2e/worldview-source.spec.ts --workers=1 --retries=0
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test -c playwright.peinture.config.ts --workers=1 --retries=0
git diff origin/release/1.0...HEAD --check
```

四协议主用例通过本机 HTTP 服务接收浏览器 POST，读取真实序列化字节。测试检查界面已保存的文学要求、正文工具、实际沙箱回执、候选及正式回合变化。署名、协议与文学指纹检查独立于模型文笔。本地 Token 是估算，供应商 usage 缺失时显示「未返回」。真实模型文学质量、不同渠道采样参数的采纳、缓存命中与费用由 D 阶段在授权预算内验证。
