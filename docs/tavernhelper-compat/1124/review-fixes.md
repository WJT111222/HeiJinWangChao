# C1 独立审查整改记录

本轮基于 #252 的 `0c6e1e0931f98ad1484a3bb8bf92425a24e82839`。三项原始反例均在该提交重现，并用相同探针在修复版本复跑。测试使用锁文件依赖、Node 24.19.0、Chromium 154.0.8037.57 和本地 Mock HTTP 服务。远端复审 HEAD 与 Actions 链接见 [Draft PR #252](https://github.com/WJT111222/HeiJinWangChao/pull/252)。

## P1 · 供应商原始响应

公共提交为 `0ced7f21d819e22ac168273083e5ae9e14691a95`。在投影成包装器需要的格式前，按实际供应商检查候选、结束原因、工具身份、调用数量、完整参数和流式边界。同一 Gemini 候选内的两个调用即使逐字相同也会分别检查；在 SSE 不同事件中可识别有稳定 ID 的累计快照。OpenAI 兼容和 DeepSeek 按调用索引拼接分片，Anthropic 按块拼接并检查闭合。[公共接口契约](upstream-contract.md)

1118 和 1124 按本次真正声明的交付工具启用单次正文约束，保留正常文本途径。通用调用者可处理多个工具。新的上游校验失败时，工作流保留原先可提交的合法候选。双端重新读取 IndexedDB 后显式提交，只写入原合法正文，正式回合只推进一次。实现集中在 `tavern/upstream.ts`、`tavern/wire.ts`、`tavern/backend.ts`、`ai/compat.ts`、`ai/client.ts`。C1 的启用点和候选保护分别在 `ai/runtime.ts` 与 `workflows/storyStage.ts`。

在小猫之神 C2 审查提交 `24e6134c7adf5d21f5cb8bd4df276021748b5eb7` 的隔离检出，单独 cherry-pick 公共提交无冲突。原审查解析器探针从 37/45 变为 45/45，TypeScript、C2 的 20 项定向单测及 22 项双端 Chromium 原型专项均通过。C2 开发端可以继承该提交并沿用自身的单终端工具校验。该验证仅覆盖此固定检出及公共响应路径，#251 的其他独立审查项仍由其专项处理。

## P2 · 有效文学指纹

新写入的文学断点使用 v4。消息组装和指纹投影共用 `macros.ts` 的解析器。指纹记录静态文本和宏参数树，不求值随机选择，不读取人物或世界的动态值。合法注释是空输出，前后的字面量在解析后相接。转义与未知宏保留对应的字面语义，非法的已知宏在两个入口均报错。变量读写、参数及随机选项仍参与指纹。

| 断点 | 续写时可核验的依据 |
| --- | --- |
| v1（无版本号） | 复算当时保存的四类覆盖字段摘要。 |
| v2 | 复算当时启用的原始条目、注入属性、有效脚本及变量的投影。 |
| v3 | 复算当时的文学条目与标记投影，文本保留原来的宏拼写。 |
| v4 | 同一预设 ID 和包版本下比较解析后的有效文学投影。 |

v1–v3 均须先匹配包身份并验证当前 v4 配置。若当前状态不能直接重现旧摘要，还可核验该包的发行默认配置，且其 v4 投影须与当前相等。历史自定义配置只留下摘要、旧原文又无法重现时，继续保留断点及恢复原设置的入口。没有新增许可推测或存档批量迁移。相关实现和断言见 `presets/library.ts`、`domain/storyWriting.ts`、`literary-macro-witness.test.ts` 和 `story-writing-repair.test.ts`。

## P2 · 旧版文学方案

`peintureScheme.ts` 与 `peintureSettings.ts` 在编辑副本上先汇总所有显式选择，再处理互斥组，最后按最终文风应用意识流联动。未涉及的组沿用编辑状态，同一组有多项显式开启、联动冲突或格式非法时，原编辑内容保持可用。只加载开放目录中的条目。控制台仍经预览、载入编辑区和明确保存；新文件有误时清除旧预览，避免误载上一个文件。入口见 `PeintureSchemes.tsx`。

验收样本由历史提交 `6fbcce02aaf9358ed194300d065f64fdf58d0dcf` 的 1118 控制台导出逻辑生成。使用该脚本的目录、快照和校验函数，以及本地合成人物环境；选中散文并写入可辨认的校样文字。控制台脚本内容 SHA-256 为 `53982d4288754bb5e34928ec98876110cea54110a23c5159a0ebb953951bf3dd`。导出含 101 行提示项，没有 1124 的意识流条目。生产构建双端实测，预览取消后意识流仍有效，重新导入、保存、刷新后散文有效。随后发出的 POST 同时含散文要求和校样，编辑期间为 0 份 POST，生成各为 1 份。两端请求 SHA-256 均为 `0fa5b1cb798f608e60e8fdcf4e07ff5ae0f3a85917026190db7f707cf570884b`。[测试夹具](../../../e2e/fixtures/peinture-1118-essay.json.gz)

## 原始反例与验收结果

| 相同输入 | 修复前 | 修复后 |
| --- | --- | --- |
| Gemini 单条响应内重复调用、OpenAI 返回 Anthropic 的结束原因；两版本 × 双端 | 8/8 生成候选，显式提交使 revision 从 1 变成 2 | 8/8 在候选前拒绝，正式 revision 均保持 1，无提交回执 |
| 取消、上游错误、拒答、截断、错误标签；双端 | 10/10 无候选 | 10/10 无候选 |
| 仅添加合法宏注释；双端 | 相同 HTTP 正文，续写被拦 | 相同 HTTP 正文，续写成功；真实要求改变时两端仍在派发前阻止续写 |
| 意识流状态载入明确选择散文的旧方案；双端 | 保存后仍是意识流 | 保存后为散文。锁定项保持关闭，跨标签过期编辑仍保留未保存值 |

宏注释与基准各自第一次实际出站均为 111358 字节，SHA-256 为 `70d4387cb8e7bfddd3909c72e3dfb5949bcc88314eb61127bc664480336f03cc`。原始探针、各设备收件记录、修复前后结果、旧方案实测请求摘要和命令输出已归档。[复审证据包](review-evidence.tar.gz)

| 验收范围 | 通过 | 失败 |
| --- | ---: | ---: |
| 全量 Vitest，233 个文件 | 5512 | 0 |
| 提示词检查（全量中的 3 个文件） | 93 | 0 |
| 四协议原始响应与宿主后端定向单测（全量子集） | 140 | 0 |
| 指纹、方案与旧断点定向单测（全量子集） | 46 | 0 |
| C1 原 54 项生产构建，桌面及手机模拟 | 54 | 0 |
| 历史 1118 导出方案的新增生产构建验收 | 2 | 0 |
| #247 续写授权、旧断点与四模式文学归属 | 52 | 0 |
| 正式版四组定向门槛，双端 | 16 | 0 |
| #247 HTTPS 严格收件诊断，双端 | 14 | 2 |

各行独立统计，跳过和未执行均为 0。文学归属 8 项加上异常重生成后读取候选与显式提交断言，又完整复跑了 8/8，已包含于 52 项。锁文件安装、Lint、TypeScript、命令目录校验、生产构建、`npm run check`、`npm run prompts:check` 及 `git diff --check` 通过。首次全量复跑发现一个旧 Mock 只发送用量和 DONE；补上供应商真实的结束事件后，全量复跑通过。新增方案用例初跑因同时匹配按钮与下拉项而中止；改按按钮角色定位后双端通过。

严格收件仍有两个已接受的失败，均为「直连受理后断开连接」。两端均记录应用直连 1 次、Worker 中转 0 次、模型收件 2 次。保留原断言。另一项已知待办是上游合法结束、游戏正文信封非法时，手动重生成后旧候选仍可能报 `TURN_INCOMPLETE`。它在整改前后的同一独立探针中均可重现，正式版待办保持开放。[#247 传输记录](../LITERARY_OWNERSHIP.md)

真实供应商、实模文学效果与实体手机未验收。所有本轮 HTTP 证据均来自本地 Mock。

## 复跑入口

在锁文件安装及生产构建完成后，可单独执行以下检查。浏览器专项使用系统 Chromium；正式版四组门槛采用仓库工作流中的原断言和端口。

```sh
npm ci
npm run check
npm run prompts:check
npx vitest run src/tests/tavern-provider-integrity.test.ts src/tests/tavern-backend.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test -c playwright.peinture.config.ts --grep 'C1|复审：1118' --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test story-continuation-consent story-legacy-writing story-literary-ownership --workers=1
CHROMIUM_PATH=/usr/bin/chromium npx playwright test story-continuation-transport --workers=1
git diff --check 0c6e1e09..HEAD
```

证据包内脚本与联合独立审查的脚本逐字节相同。将 C1 检出目录命名为 `c1`，在其父目录创建 `evidence` 并放入这三个脚本，依次运行 `node boundary-probes.mjs c1`、`node browser-probes.mjs c1`、`node ui-review.mjs`。C2 公共继承探针在同级隔离检出 `c2` 上运行 `node parser-probe.mjs`。
