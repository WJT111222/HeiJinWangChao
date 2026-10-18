# M3-P1｜提示词资源入库、模块整理与静态注册

## 开发前核对与文件差异清单

基线：`main@6304d9c`（已合并 M2）。工作分支：`codex/m3-p1-prompt-registry`。
已逐项核对 manifest、shared、六个 stages、writing、27 个变量组文件、memory、prompts/docs、src/prompts 和现有七项设置。src/prompts 原来仅有 README，不存在组装器。

两份上传 ZIP 均可读取。以下清单在实施资源修改前形成：

| 文件 | 操作 | 内容来源及处理 |
| --- | --- | --- |
| `prompts/identity/fusheng.md` | 新增 | M3 包 role_fusheng.md，原字节保留，仅变更目标路径 |
| `prompts/worldbooks/heijin/{01_worldview,02_modern_underworld}.md` | 新增 | 双世界书 V2.0 包正式正文，原字节保留 |
| `prompts/shared/{02_knowledge,03_time_events}.md` | 替换 | M3 包同名正文，原字节保留 |
| `prompts/writing/{natural_prose,action_options}.md` | 替换 | M3 包同名正文，原字节保留 |
| `prompts/writing/{conflict_pacing,emotion_guard,action_feasibility}.md` | 新增 | 无同名旧模块，使用 M3 包原文 |
| `prompts/shared/00_world.md` | 精简并停用注入 | 两本世界书已覆盖世界底座；保留原 ID 作为兼容记录，防止重复注入 |
| `prompts/stages/{opening,regular}/story.md` | 局部修改 | 仅将首句身份改为阶段任务，保留六主提示词、开局保护、普通回合及输出协议 |
| `prompts/variableGroups/{npc_ordinary,npc_special}/{init,update,offscreen}.md` | 增量补丁 | 按审核包 NPC 记忆补丁分段合并，保留原文，不新增命令或字段 |
| `prompts/writing/{nsfw,intimacy_boundaries}.md` | 新增可用节选 | 参考仓库成人主题和同意边界；不加入露骨性描写生成指令，也不移入私密档案/ASD 数值规则；**不是原版完整移植** |
| `prompts/compatibility/cot_format_ack.md` | 新增适配模板 | 格式确认 assistant 模板，保持四段输出；不要求输出内部思考 |
| `prompts/reference/cot_legacy.txt` | 新增只读参考 | 上游默认 COT 模板原文，仅用于迁移核对，永不注入 |
| `prompts/manifest.json` | 扩充元数据 | 保留现有 ID/路径/开关/域；补分类、角色、顺序、常驻、可配置性、版本、内容 hash、占位符与加载策略 |
| `prompts/sources.lock.json` | 新增 | ZIP/源仓库 commit、文件与片段 hash、原文/增量/适配差异可追溯记录 |
| `prompts/docs/{README,ASSEMBLY,OUTPUT_CONTRACT,ACCEPTANCE}.md` | 更新接入说明 | 明确 P1 静态/P2 发送边界、星期派生、COT 兼容、未来扩展和验收缺口；不改输出字段协议 |
| `src/prompts/{manifest.ts,README.md}` | 新增静态 Schema、更新说明 | 只解析和校验注册元数据，不加载/拼接正文，不发送消息 |
| `src/tests/prompts.test.ts` | 新增 | 文件完整性、来源一致、注册/顺序/作用域及原架构保留回归 |
| `scripts/refresh-prompt-metadata.mjs`、`package.json` | 新增维护命令 | 显式刷新内容 hash/字符数/占位符；check 仅校验，不自动修复 |
| `THIRD_PARTY_NOTICES.md`、本文、`DEVELOPMENT.md` | 新增或更新 | MIT 来源许可、范围、交付结果与下一步阻塞点 |

不修改正式 `docs/`、M0–M2 UI/Settings Schema、领域/存档 Schema、数据库、命令与事务。其余阶段、变量组、记忆和写作规则默认原样保留。汇编阅读版仅登记为历史资料，不注入。

## 已识别差异及边界

- 审核包中的“尚待审核”“世界书缺失”、旧拟定路径及其对后续 UI/API 的建议，不是本次执行指令。按当前用户确认使用双世界书 V2.0 与指定路径；本轮不实施 API、组装预览或管理 UI。
- 玩家视角与主角认知必须区别；本轮按审核包信息域原文入库，不修改 M2 资料投影，不确定最终 NPC 全档案开放模式。
- 上游 COT 模板带额外 `<thinking>` 和 `<剧情规划>`，不能直接当作黑金王朝运行模板。上游原文保留在非注入参考项；可用模板只做格式确认。消息角色/位置、DeepSeek/GLM Prefix、GPT/酒馆模式互斥在 P2 适配，不假装已经可用。
- 上游 NSFW 正文要求生成露骨性细节，这部分不能迁入生成规则。本次仅提供非露骨的成人题材及自愿边界节选，独立常驻、无开关；明确记录原文迁入未完成，不能以静态测试通过宣称满足完整原版移植要求。
- 上游亲密边界原文要求维护私密档案和 ASD 数值，与本阶段禁止新增字段/概率判定的要求冲突；不移入这两条，保留人格、自愿与场景边界。没有私密字段、名器录、图片、概率表或 V0.2 功能。
- 既有变量输出中的“推荐命令”并不等同 M1 实际命令目录。P2 必须传入真实 COMMAND_CATALOG 并在后续校验拒绝未知类型，本轮不借提示词整理修改 M1 命令。


## 来源与原文校验

两份上传 ZIP 的 SHA-256、正式资源的原始路径/hash、参考仓库 commit 与五个指定/关联文件的 hash 均写入 `prompts/sources.lock.json`。10 份审核包正文按原字节保留（身份 1、世界书 2、信息/时间 2、写作 5）；只移动身份路径，不重排段落或格式化原文。其它沿用资源也记录原始 hash。NPC 六份补丁保留原始文件完整字节前缀，按对应任务追加审核段落；两篇 story 只替换首句身份，其余内容不动。第三方 MIT 许可全文见 `THIRD_PARTY_NOTICES.md`。

## 注册、排序与后续展示

共 75 项注册：24 项在所属阶段/模式内常驻、8 项既有设置条件资源（含三种互斥人称）、27 项相关变量域、5 项按需记忆、1 项待 P2 实现的协议兼容模板、10 项永不注入的文档/示例/兼容记录/参考。不是 75 项同时注入。

正文默认逻辑次序：

`0 身份` → `10 世界观` → `20 现代社会/地下生态` → `30–70 shared.01–05` → `80–82 冲突/情绪/可行性` → `210–227 字数、人称、一般风格及原有开关` → `250–251 成人题材/边界节选` → `300 本轮唯一 story 主模板` → `406/409 正文/对白协议` → `未来数据容器` → `900 兼容时的独立 assistant 确认模板`。

变量/世界只保留背景、共同事实/权限规则、各自唯一主模板、各自 JSON 输出协议及相关变量组；不加载正文身份、小说写作或 COT。记忆任务独立按需。`shared.00_world` 保留 ID、停用注入；未把旧底座或汇编阅读版再塞入世界书。

元数据保留旧 id/path/title/kind/applicableStages/modes/toggle/domain/characters，补充 category/defaultOrder/orderGroup/reorderable/permanent/configurable/version/messageRole/contentSha256/placeholders/activation。title 为显示名称；角色是逻辑默认值，不是实际请求消息。当前不计算 Token，不提供虚构 actual usage；完整内容由路径与 hash 定位，P3 可完整读取。字符数是 Unicode code point，后续需模型 tokenizer 才能估算 Token。

可移动范围只预留三项核心规则的 80–82 槽位，以及四个可选写作增强的 224–227 槽位；固定身份、世界书、输出、NSFW、阶段及角色不能跨越。当前没有排序保存、前端或请求生成实现。

## 测试与验证

- `npm run check`：6 个测试文件、163/163 通过（原 M0–M2 的 141 项全部保留，新增静态资源回归 22 项）；ESLint 零警告、TypeScript 检查、Vite 生产构建通过。
- `npm run prompts:check`：只做文件完整性、来源 hash、注册及静态作用域检查，不调用或伪造组装器。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`：桌面 1440×1000 与 Pixel 7 移动视口共 8/8 通过；验证原五步创角、多存档、七面板、设置恢复及隐私回归，未执行 AI 请求。
- 基线逐文件核对：正式 docs/、src/domain、src/ui、src/app、src/services 与所有已有测试的 SHA-256 均不变。没有修改 Settings Schema、SaveRepository、创角、装备引用、M1 草稿/补算或三阶段事务。
- `git diff --check`：通过。没有执行模型请求/输出效果测试，没有密钥、部署或合并。

新增可用维护命令 `npm run prompts:refresh` 显式刷新注册表的字符数/hash/占位符；它不改提示词正文、不更新来源确认，也不在 check 内自动修复错误。原文字节校验失败仍须审查真实差异。

## 未完成与 M3-P2 接入要求

1. **本轮内容缺口**：未迁入原版 NSFW 露骨生成指令；现有节选不能视为完整原版迁移。此差异已在开发前清单、资源标题、版本、来源锁与 manifest.contentGaps 明确记录。
2. P2 实现正文加载、实际 stage/mode/设置/领域/任务选择、占位符替换（包括 worldWeekday）、未解析值阻断、真实消息角色/顺序及模型兼容。不要以本轮静态注册推断发送成功。
3. 星期按 worldClock 和 Asia/Shanghai 派生，测试跨月、跨年、闰年和 UTC 边界；不新增独立时钟或修改正式存档 Schema。
4. COT 需实测各协议，显式兼容时一次注入 assistant；不兼容时诊断跳过，Prefix 与通用模板互斥。上游 DeepSeek/GLM 的通用伪装关闭分支、GPT 标记与输入角色特殊处理均已核对，不能把上游消息发送器或 thinking/剧情规划 一起复制。
5. 必须提供与 M1 一致的 COMMAND_CATALOG，不将旧推荐类型/未实现 NPC 更新命令当成已支持；正式校验/生成工作流按后续阶段实施。
6. P3 再做完整模块浏览、全文、受限排序、Token 估算、实际上下文与 usage 展示。当前不新增 API 配置页/请求、模型路由、提示词管理 UI、完整 NPC 私密档案、名器录、DLC 或任何 M4/M5/M6 功能。

本次提交供审查，不自动合并 main，不部署。


## 最终文件清单

### 新增（16 个文件）

- `M3-P1-DEVELOPMENT.md`
- `THIRD_PARTY_NOTICES.md`
- `prompts/compatibility/cot_format_ack.md`
- `prompts/identity/fusheng.md`
- `prompts/reference/cot_legacy.txt`
- `prompts/sources.lock.json`
- `prompts/worldbooks/heijin/01_worldview.md`
- `prompts/worldbooks/heijin/02_modern_underworld.md`
- `prompts/writing/action_feasibility.md`
- `prompts/writing/conflict_pacing.md`
- `prompts/writing/emotion_guard.md`
- `prompts/writing/intimacy_boundaries.md`
- `prompts/writing/nsfw.md`
- `scripts/refresh-prompt-metadata.mjs`
- `src/prompts/manifest.ts`
- `src/tests/prompts.test.ts`

### 修改（21 个文件）

- `DEVELOPMENT.md`
- `package.json`
- `prompts/docs/ACCEPTANCE.md`
- `prompts/docs/ASSEMBLY.md`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/docs/README.md`
- `prompts/manifest.json`
- `prompts/shared/00_world.md`
- `prompts/shared/02_knowledge.md`
- `prompts/shared/03_time_events.md`
- `prompts/stages/opening/story.md`
- `prompts/stages/regular/story.md`
- `prompts/variableGroups/npc_ordinary/init.md`
- `prompts/variableGroups/npc_ordinary/offscreen.md`
- `prompts/variableGroups/npc_ordinary/update.md`
- `prompts/variableGroups/npc_special/init.md`
- `prompts/variableGroups/npc_special/offscreen.md`
- `prompts/variableGroups/npc_special/update.md`
- `prompts/writing/action_options.md`
- `prompts/writing/natural_prose.md`
- `src/prompts/README.md`

没有删除文件。
