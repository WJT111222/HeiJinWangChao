# PR #151 Node24 正式验收

验收日期：2026-11-15（中国标准时间）。仅使用原 PR #151，没有新建PR、重新设计方案或开展Token优化。

结论：格式提醒的静态结构、三阶段真实出站消息顺序和严格解析通过验证。首次7项旧单测错误地读取最后一条消息，现已准确定位独立GAME_CONTEXT，原内容/隐私断言保留。**本轮未修改生产代码**。完整工程检查通过；指定浏览器四文件没有全绿，基线及唯一PR单侧时序失败均如实保留，不能宣称全面浏览器通过或实测掉格式率下降。

## 版本与范围

- main：`d6d35ba8eb9412c961bbdf66f23b450402858876`。
- 原PR HEAD：`5f2dc3de36e0041cbc3eb0c03f09d10b50ad846a`，分支 `fix/prompt-format-tail`。
- 本轮测试提交：`cf27ee533d4f5ebe2e0c42f9b8c21f2a14856319`。后续提交只记录报告及材料；最终HEAD和Workers Build在原PR描述/回复提供。
- 已读取[首轮](https://github.com/WJT111222/HeiJinWangChao/pull/151#issuecomment-6879726666)及[二轮审查](https://github.com/WJT111222/HeiJinWangChao/pull/151#issuecomment-6880071044)。Fable两处模板风险已解除，本轮保留其修复，不再修改提醒设计。

Story可选thinking的说明在骨架之外，骨架占位内没有嵌套保留标签。Variables骨架命令区是真正空块，规则说明在骨架之外。World仍是五数组JSON。原有7项format-tail用正式解析器验证骨架；其中短占位测试降低字数/填入三条选项，仅代表骨架合法，**不代表原样满足生产字数要求**。新增真实请求测试使用实际1521字、1500门槛。

## 本轮必要测试修正

初次 `npm run check` 为 **3779通过 / 7失败（3786项）**，7项均位于 `prompt-runtime.test.ts`：三个人称设置，以及隐藏/普通/特殊NPC/同伴完整资料检查。新增末尾user提醒后，旧 `.messages.at(-1)` 不再是上下文，因而读错消息。干净main原文件36项通过，见日志；这属于本PR需要同步的测试位置假设，并非新权限规则。

现用严格 `^<GAME_CONTEXT>... </GAME_CONTEXT>$` 锚点查找唯一user消息，保留所有原私密资料、正式字段、人物关系、输入转义、状态不变性及模块日志隔离断言，同时增加末条必须为user且含格式提醒的断言。几个原本可能对错误尾条虚假通过的负例也改为检查真正上下文。没有删除断言、放宽内容匹配或改生产权限。

## 实际出站请求：56项矩阵

新增 `format-tail-wire.test.ts` 使用正式 `runStageRequest → composer → AiClient → wireRequest → Mock fetch → 正式解析/模拟`，不是只调用字符串函数。OpenAI兼容、原生DeepSeek、Gemini、Anthropic各14项，共56项。

| 阶段 | 每协议组合 | 核对 |
| --- | --- | --- |
| Story | 有/无项目thinking × 行动选项开/关 × 确认历史开/关，共8项 | 实际小说1521字、门槛1500；规划与正文准确归位，关闭选项不生成该字段 |
| Variables | 空命令、合法非空、非法字段，共3项 | 三区块完整；空命令返回0条；合法命令进入编译/模拟；未知正式字段在mapping严格拒绝 |
| World | 无变化、到期已处理、到期漏处理，共3项 | 五数组齐全；空形状合法；固定阶段按原时刻结案；漏处理仍以stage_due拒绝 |

直接捕获fetch实际body，逐项断言：

- OpenAI/DeepSeek保持完整消息序列；Gemini的systemInstruction、user/model映射和Anthropic的system/messages与正式组装结果逐字段一致。
- 最后一条是对应格式提醒user消息，精确相等；Story确认历史开启时assistant确认仍在提醒之前，关闭时上下文与提醒是两个独立user消息。
- GAME_CONTEXT恰好一条、首尾锚点完整、JSON可读，内容与正式组装投影完全一致，没有并入提醒或丢弃字段。
- 预算字符差额为0，新增尾条被计入既有other分类；只核对测量守恒，没有优化/裁剪Token。
- 每场恰好一次Mock fetch，源GameState及draft深度相同，非法输出没有通过提醒绕开正式校验。
- request body不含虚构测试密钥。只保存请求体，不保存鉴权头。

[完整56个合成请求体](validation/wire-requests.json.gz)及[协议/场景/末条/哈希摘要](validation/wire-summary.json)可复核。该矩阵采用非流式JSON Mock回复以隔离出站结构；既有流式链继续由完整单测和所选四个E2E覆盖，不声称56项全部是SSE。

另新增PC/手机各一项正式React用例：在隔离浏览器内分别显式发送三阶段Mock请求，各阶段一次，实际请求检查器读取脱敏原生body并与截获body深度比较；完整上下文独立，正式Repository状态及草稿前后相同。六张截图直接展示三个阶段最后user提醒。没有用预览冒充已发请求。

## Node24正式成绩

Node **v24.19.0**、npm **11.9.0**、真实Chromium **154.0.8037.57**。PR与干净main各自真正执行npm ci、各安装143 packages。使用项目真实依赖、Vitest和Playwright，无替代运行器或离线垫片。

| 检查 | 实际结果 | 原始日志 |
| --- | --- | --- |
| `node --version` | v24.19.0 | [日志](validation/node-version.log.gz) |
| PR `npm ci` | 成功 | [日志](validation/npm-ci.log.gz) |
| main `npm ci` | 成功 | [日志](validation/main-npm-ci.log.gz) |
| 初次 `npm run check` | 3779通过 / 7测试位置失败；未继续构建 | [日志](validation/check-initial.log.gz) |
| 最终 `npm run check` | Lint、**3842单测 / 152文件**、TypeScript、Build通过 | [日志](validation/check.log.gz) |
| `npm run prompts:check` | **93通过** | [日志](validation/prompts.log.gz) |
| 指定类别及新增wire，共8文件Vitest | **479通过** | [日志](validation/targeted.log.gz) |
| 独立wire与修正后prompt-runtime | **92通过** | [日志](validation/wire-final.log.gz) |
| 干净main原prompt-runtime | **36通过** | [日志](validation/main-prompt-runtime.log.gz) |
| 新增/修改测试ESLint及最终TypeScript复核 | 通过 | [Lint](validation/affected-lint.log.gz)、[TypeScript](validation/typecheck-final.log.gz) |
| `git diff --check` | 通过 | [空输出](validation/diff-check.log.gz) |

479、92及93均为3842中的子集，不累加。Vite大chunk与NO_COLOR提示如实保留，不是检查失败。

## 双端Chromium及干净main对照

按要求完整执行四个明确文件，参数化后每侧为76场景：continuous-turns、event-stages-v2、action-workflow、prompt-inspector。两侧使用同一Chromium、相同项目/视口/2 workers/0 retries；独立5661/5662端口和同配置输出目录，避免复用或停止其他工作台服务。配置原样保存在validation目录。

| 批次 | 通过 | 失败 | 跳过/自动重试 | 证据 |
| --- | --- | --- | --- | --- |
| PR指定四文件初轮 | **48** | **28** | 0/0 | [日志](validation/pr-browser.log.gz)、[JSON](validation/pr-browser.json.gz) |
| 干净main相同四文件 | **46** | **30** | 0/0 | [日志](validation/main-browser.log.gz)、[JSON](validation/main-browser.json.gz) |
| 新增实际出站检查器，PC+手机 | **2** | 0 | 0/0 | [日志](validation/wire-browser.log.gz)、[JSON](validation/wire-browser.json.gz) |
| 手机300 NPC精确用例成对复核：PR | **1** | 0 | 0/0 | [日志](validation/pr-focused.log.gz)、[JSON](validation/pr-focused.json.gz) |
| 同一精确复核：main | **1** | 0 | 0/0 | [日志](validation/main-focused.log.gz)、[JSON](validation/main-focused.json.gz) |

不能把后续复核改写成初轮全绿，也不把重复执行计为额外独立功能。未运行700项全量E2E，没有添加skip、放宽断言或自动重试。

[76项逐项状态表](CASE_RESULTS.md)及[完整错误对照](validation/browser-comparison.json.gz)列出全部结果。27个用例在两侧均失败；主要为旧手机菜单、工作流容器/按钮、alert/note、人物侧栏和历史面板定位。一个共同失败的Variables恢复用例在main卡旧详情入口、PR卡旧alert，不能称为同一断言逐字复现。

原始状态有5处差异：

| 用例 | main | PR | 解释 |
| --- | --- | --- | --- |
| 手机Variables失败恢复 | timedOut | failed | 两侧均失败，停在不同旧UI定位；不算PR新增通过或新的稳定业务回归 |
| PC1000 NPC Worker帧计数 | failed | passed | main帧计数断言失败，PR通过 |
| PC无存档模块浏览 | timedOut | passed | main等待模块原文“初始化”按钮超时，PR通过 |
| PC六种模式预览 | timedOut | passed | main等待检查阶段选择器超时，PR通过 |
| 手机300 NPC Worker帧计数 | passed | failed | 唯一PR单侧失败；详见成对复核 |

手机300 NPC初轮断言为 `progress.frames > 1`，实际未达到。两侧代码中的Worker和该原断言均未修改；干净main桌面300/1000 NPC也出现同一帧计数断言失败。为区分稳定回归与完成时序波动，仅对手机300 NPC做一次成对复核，**两侧均通过**，未追加无限重跑。该断言受Worker完成与requestAnimationFrame调度先后影响，单次不足两帧不能单独证明UI冻结；本轮未发现稳定的PR新业务回归，但保留这项时序不稳定风险供最终复审，不修改预算代码、Token策略或旧断言来换绿。

成对复核原始测量分别为[PR17帧](validation/pr-focused-worker-measurement.json)、[main16帧](validation/main-focused-worker-measurement.json)，均恰好1次Mock请求、1个Worker、与原算法比较equality=true；这不抹去首次失败，也不用于宣称性能提升。

58份初轮失败error-context以gzip原样保存，避免自动生成空行尾空格污染diff检查。[trace索引](validation/browser-trace-index.json)保留全部原始trace路径、大小和sha256；随PR附3份300 NPC代表trace，两侧PC及PR手机首次失败，见[traces](validation/traces)。其他完整trace仍保留在 `/workspace/pr151-evidence/{pr,main}-browser-output/`，未删除。旧E2E生成到既有docs路径的截图已恢复/移出本轮修改，干净main最终git status为空。

## 新增测试的初次问题，未隐藏

- [初次wire日志](validation/wire-initial.log.gz)：12个Variables场景失败。新增合成夹具错误地将turnNumber=0存档配为regular草稿，正式编译器正确拒绝；非法字段预期阶段也误写compile，正式规范名称是mapping。已补正式上一回合/turnNumber=1并修正精确预期；未放宽编译器、Schema或错误断言。最终56项全部通过。
- [新增截图用例启动日志](validation/wire-browser-launch-initial.log.gz)：初次配置重用了正在执行四文件的5661端口，0场景启动。随后给新增用例独立5663端口，没有终止旧进程。
- [新增截图初次网络日志](validation/wire-browser-network-initial.log.gz)：2项因新虚构HTTPS域名的 `ERR_TUNNEL_CONNECTION_FAILED` 失败。改为同源 `/mock-ai/` Playwright路由Mock，外部HTTPS全部中止；只改测试Mock地址，不改生产传输。最终PC/手机2项通过，初次日志/JSON保留。

## 修改清单与守恒审查

本轮仅3个测试文件：

1. `src/tests/prompt-runtime.test.ts`：唯一独立上下文定位和末条提醒断言，保留全部原业务检查。
2. `src/tests/format-tail-wire.test.ts`：56项真实出站协议/解析/状态/预算守恒检查，记录可选合成请求证据。
3. `e2e/format-tail-wire.spec.ts`：正式React实际请求body、三阶段只读检查及双端截图。

另新增本目录报告和证据。**没有生产代码修复**：本轮生产代码与原PR HEAD逐字节相同；整个prompts目录与main相同，包含所有模块正文、Manifest、来源锁。其他455个main已跟踪src文件也逐字节相同，见[守恒记录](validation/protected-files.txt)。解析器、权限、存档、重试、正式UI、模型路由均未动。

## 关键真实React截图

| 实际请求检查器中的最后user消息 | PC | 手机 |
| --- | --- | --- |
| Story可选thinking/正文/行动选项提醒 | [Story](screenshots/desktop-story-wire-tail.png) | [Story](screenshots/mobile-story-wire-tail.png) |
| Variables三区块及空命令骨架 | [Variables](screenshots/desktop-variables-wire-tail.png) | [Variables](screenshots/mobile-variables-wire-tail.png) |
| World五数组和到期提醒 | [World](screenshots/desktop-world-wire-tail.png) | [World](screenshots/mobile-world-wire-tail.png) |

## 实际命令

```bash
node --version
npm ci
npm run check
npm run prompts:check
git diff --check
PR151_WIRE_EVIDENCE=/workspace/pr151-evidence/wire-requests.json npx vitest run src/tests/format-tail.test.ts src/tests/format-tail-wire.test.ts src/tests/prompt-runtime.test.ts src/tests/prompts.test.ts src/tests/text-prompt-readiness.test.ts src/tests/variable-text-parser.test.ts src/tests/story-tag-compat.test.ts src/tests/context-budget.test.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/continuous-turns.spec.ts e2e/event-stages-v2.spec.ts e2e/action-workflow.spec.ts e2e/prompt-inspector.spec.ts --config /workspace/pr151-evidence/pr-browser.config.ts
# 干净main同一命令，仅配置替换为main-browser.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/format-tail-wire.spec.ts --config /workspace/pr151-evidence/wire-browser.config.ts
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/prompt-inspector.spec.ts --project mobile --grep '300 NPC' --config /workspace/pr151-evidence/pr-focused.config.ts
# 同一个精确用例在main使用main-focused.config.ts
```

全部模型响应Mock。请求体和截图只含虚构测试资料，不含真实玩家存档或生产密钥，未保存鉴权头。环境记录见[versions.txt](validation/versions.txt)，证据校验和见[SHA256SUMS](validation/SHA256SUMS)。这只能证明格式骨架、消息组装和受测行为正确，**没有线上掉格式率统计，不宣称实测收益或费用可忽略**。

最终HEAD的Workers Build将在推送后只读核对并补至原PR描述/回复，不拿旧HEAD结果代替。保持未合并，不手动部署正式生产、不发布或更新Beta标签，等待十一代目及项目负责人授权。
