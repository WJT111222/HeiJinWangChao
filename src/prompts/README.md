# 提示词运行时

根目录 `prompts/` 是正文唯一来源。`manifest.ts` 只校验注册元数据；`loader.ts` 通过 Vite raw import 延迟读取 Markdown，核对 SHA-256 和 Unicode code point 字符数，不复制一套 TS 正文。

`composePrompt()` 读取调用者提供的正式状态快照、严格 V1 设置和相符的 M1 草稿，根据阶段、opening/regular、七项设置、相关变量域和单一记忆任务选择资源。固定身份/双世界书/输出/常驻模块不能排序，可移动模块只允许同组已有槽位置换。所有必需占位符替换后仍有 `{{...}}` 会阻止请求。

`context.ts` 按阶段选择资料，并以 user 数据容器提供给模型；正文不接收 NPC 内部知识、隐藏事件和私有记忆。`worldWeekday` 由 `worldClock` 在 Asia/Shanghai 派生，不保存独立字段。候选投影只在脱离仓库的副本上运行。通用 Composer 的 memory 分支仍仅提供任务级组装基础，不可直接作为已授权的压缩输入。M5-P2 的 `workflows/memoryMaintenance.ts` 复用真实 Manifest selector/loader 和 contextMessage，但仅把经过来源/权限/预算验证的公开批次交给 AiClient，避免通用分支带入完整 memories/journal；实际请求检查从真实 payload 派生。公开历史检索与即时窗口见 `domain/memories/publicMemory.ts`，M5-P3 的NPC私人归纳也复用同一维护路径，但只发送指定人物的授权批次；来源按原始记忆ID追溯，不复用公开journal覆盖逻辑。内部变量/世界上下文按ownerNpcId分区，私人总结不注入普通正文或公开历史。

`src/services/ai/runtime.ts` 提供独立三阶段请求入口，协议层负责 OpenAI-compatible / 原生 Gemini / 原生 Anthropic 的实际消息结构。返回值是内部候选，包含版本依据，`commitAllowed=false`，不调用 SaveRepository，不执行下游阶段、重试或正式提交。没有导入即请求，也没有把游戏发送按钮接成完整回合系统。

`npm run prompts:check` 覆盖原有静态检查和真实组装/候选测试；`npm run check` 覆盖全部测试与生产构建。显式修改允许修改的文本后，用 `npm run prompts:refresh` 刷新元数据，再运行检查；测试不会自动掩盖资源漂移。

用户 690d01d 的 NSFW 适配正文完整保留，NSFW 与独立亲密边界在正文请求各注入一次、无开关。旧版未经修改的全文逐字移植仍为 not-completed。未来 NPC 私密档案/名器录仅有原 manifest 设计入口，没有运行模块。

实际模块顺序、Mock 验收结果及 API 边界见根目录 `M3-P2-DEVELOPMENT.md`。M3-P3 管理界面见 `M3-P3-DEVELOPMENT.md`：共享 `selection.ts`，独立 `order.ts` 保存受限排序，`preview.ts` 只调用真实 Composer，不发送请求。浏览器独立阶段请求默认读取已保存的排序；显式 orderOverrides 继续遵守原 P2 校验，不能与 orderPreferences 混用。

`services/ai/inspection.ts` 在真实客户端发送边界捕获脱敏原生 payload，只在内存保留最近 12 条；查看器默认仅显示结构，完整内部内容须主动查看。`statistics.ts` 将 Unicode 启发式 Token 估算与供应商 usage 分开，不补算未提供的真实总量。没有改动正式存档或七项写作设置 Schema。
