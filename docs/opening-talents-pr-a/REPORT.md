# 八大开局天赋 V2：PR-A 数据与旧档兼容验收

本批只建立正式天赋目录及数据协议。没有创角选卡、档案展示、天赋触发、胜率判定、额外奖励或天赋专属提示词。所有正式效果留待后续独立授权。

## 基线与权威资料

- main：`f36bc51aede49e4ac6edf9a0bda2138905f007c7`，与附件设计基线一致，包含 #168 日间天际线及 #169 Story 独立流式偏好。
- 独立分支：`feat/opening-talents-data`。最终 HEAD 见 Draft PR 与交付消息；本报告随该提交保存。
- 完整阅读用户上传的《黑金王朝_八大开局天赋_V2_Codex第一批实施规范_2026-11-16.md》。附件 SHA-256、范围校验见 [source-boundary.json](evidence/source-boundary.json)。没有将 PR-B / PR-C 的接口说明当成本轮实施授权。

## 变更文件与数据流

生产代码仅三处：

1. `src/domain/protagonist/talents.ts`：单一有序目录，导出 `talentDefinitions`、`TalentIdSchema`、`TalentId`、`TalentDefinition`、`getTalentDefinition(id)`。数组与每条记录均冻结；安全查询未知值返回 `undefined`，正式数据仍由严格 Schema 拒绝非法 ID，不会自动清洗成无天赋。
2. `src/domain/protagonist/schema.ts`：新增 `talentId: TalentIdSchema.optional()`，没有 default、`none` 或 `null`。
3. `src/ui/creation/model.ts`：创角 Schema 接受同一可选 ID，`newCreation()` 不添加字段；`buildCreationState()` 只在非 `undefined` 时将 ID 交给正式主角 Schema 验证，不把文案写入存档。显式非法 `null`、空串等不会被当成已选择的合法天赋。

测试为 `talents-catalog.test.ts`、`talents-compatibility.test.ts`、`talents-command-boundary.test.ts`，以及独立定稿夹具 `fixtures/talents-v2.json`。

路径沿用：创角资料 → 既有 `createProfileSave()` → Repository 创建；开局包继续从 `CreationSchema.omit(...)` 派生；导入导出继续使用原有严格 Schema、一次性确认与事务流程，没有另建持久化通道。

## 八天赋目录完整性

八个稳定 ID、名称、核心领域与机制名顺序与附件一致：枭雄光环、赛博暴君、黄金律令、权柄猎手、众声主宰、天工奇才、千机谋主、绝命赌徒。

每项保留完整 `introduction`（能力介绍）、`mechanism`（专属机制）、`longTermImpact`（长期影响）、`boundary`（能力边界），另有名称、稳定 ID、核心领域和机制名元数据。没有早中晚期、等级、稀有度、随机分发或百分比胜率字段。

32 段内容的 SHA-256 定稿从上传规范独立生成，测试对生产导出的全文逐段核对。仅去掉 Markdown 的 `**` 强调标记以保存纯文本；不缩写正文，保留全部段落和标点。夹具存摘要而非另一份长文，产品中只有一份完整目录。

## 旧档兼容证据

| 协议 | 本轮行为 |
| --- | --- |
| 正式 V10 | `schemaVersion: 10` 不变；缺少字段仍严格可读，不补天赋、不写回该字段 |
| IndexedDB | 版本仍为 4，仓库、索引与控制记录无变化 |
| 创角草稿 | `heijin.creation.v1` / version 1 不变；旧五步草稿、人物、同伴、技能、背景原样读取 |
| 开局包 | `heijin.opening-pack.v1:` / version 1 不变；旧包正常加载；新包保留单个 ID；无天赋包省略字段 |
| 职业切换 | 既有 spread 流程保留 ID；不把天赋混入技能、职业或长期影响 |
| 套用开局包 | 保留完整覆盖语义；有天赋的包携带 ID，旧包恢复无天赋，不合并前一草稿的 ID |
| 备份恢复 | 八个 ID 及无字段存档均经过真实导出、序列化、校验和、确认、导入及数据库重开 |
| 导入并发保护 | 原有 draftRevision 递增不变；确认后替换备份中的天赋 ID 仍拒绝，五仓库原样保留 |
| V6–V9 | 继续拒绝正式读取/导入，不新增旧版本迁移 |

新增字段是向后读取兼容，不保证带 `talentId` 的新存档能被旧程序读取；即使版本号仍为 V10，旧程序的严格 Schema 也可能拒绝新字段。

## AI 不可更改与原子性

- `protagonistChanges` 白名单、文本命令目录/编译映射、World 协议与普通主角修改入口未改。新增主角 Schema 字段没有进入更新白名单。
- 直接 `UpdateProtagonist` 混入 ID（含换值、重申、`null`、`undefined`、多选）拒绝。
- `set protagonist.talentId`、整体 `set protagonist` 夹带字段、`push`、`delete`、开局初始化夹带字段均经正式文本解析与编译拒绝；合法前缀不返回部分计划。
- World 的 `worldCommands` / `taskCommands` / `eventCommands` 均经正式 JSON/Schema 路径拒绝非法字段。
- 伪造候选既不能 `saveDraft()`，也不能 `commitTurn()`；独立兼容 `save()` 批次同样拒绝。比较 `saves`、`drafts`、`turnReceipts`、`turnUndo`、`saveControls` 全部原始记录，确认没有部分字段、回合或候选落盘。
- 八个 ID 和无天赋均通过两轮合法候选整批提交、重复提交回执与撤回验证，天赋原样保留。合法整体白名单更新也不会清掉既有 ID。
- 备份的显式玩家恢复仍按原权限恢复整条时间线；这不是给模型提供改写入口。

[源码边界证据](evidence/source-boundary.json)核对 219 个受保护文件与 main 字节相同，包括 Prompt、AI、工作流、存储、命令、GameState/TurnDraft、开局包、UI 和公告。所有专项数据测试将 `fetch` 替换为禁止出站的 Mock 并断言未调用。

## T01–T15 对照

| 项目 | 证据 |
| --- | --- |
| T01–T02 目录、ID | 八项顺序/唯一性、32 段独立全文摘要、冻结、安全查询；名称/未知值/null/none/多选拒绝 |
| T03–T04 创角 | 默认无自有字段；八种数据创角；职业/技能/同伴/资金不被赠送或改写 |
| T05–T08 旧草稿/旧档/开局包 | 五步旧草稿无损读取、V10 原样重载、职业切换及开局包完整覆盖 |
| T09 备份 | 八项及无天赋往返；旧包覆盖；损坏 ID 拒绝；确认绑定整个天赋事实 |
| T10 跨回合 | 八项及无天赋，两轮 Story/Variables/World 合法候选 → Repository 原子提交/幂等/撤回 |
| T11–T13 写保护 | 直接命令、文本命令、World 三数组、开局初始化与装备旁路拒绝；合法普通更新保留 ID |
| T14 原子性 | 真实 fake-indexeddb + SaveRepository，失败前后五个仓库完全一致 |
| T15 基线 | 完整既有单测、Prompt、类型、Lint、catalog、Build；专项零网络调用 |

T10 使用仓库已有合法三阶段候选 fixture 的等价流程，没有模型生成请求；本轮不是天赋剧情效果验收。

## Node 24 验证

环境：Node **24.19.0**、npm **11.9.0**，正式 `npm ci` 与 Vitest 运行器，无垫片。

| 实际批次 | 结果 | 退出码 |
| --- | --- | ---: |
| `npm ci --cache /workspace/.npm` | 安装真实依赖成功 | 0 |
| 初次三文件专项 | 123 通过 | 0 |
| 最终专项及相关九文件 | **390 通过**，其中新增专项 **126 项** | 0 |
| 修改文件 ESLint / 类型预检 | 通过 | 0 |
| 最终完整 `npm run check` | **169 文件、4142 项单测通过**；ESLint、TypeScript、catalog、文件名、Build 全通过 | 0 |
| `npm run prompts:check` | **93 通过** | 0 |
| `git diff --check` / 暂存差异 | 通过 | 0 |

专项、相关测试和 Prompt 是完整 4142 项的重叠子集，不重复相加。[原始日志](logs/)与退出码随 PR 保存。Build 的大 chunk 提示不影响退出码，不扩展到打包优化。

本批无 JSX/CSS/UI 或交互改动，按规范不跑 Chromium 或截图矩阵；不宣称已完成后续创角选卡或真实模型玩法验收。所有检查只执行必要批次，未删、跳过或放宽既有断言。

## 已知限制与停止点

- 尚无选择/展示天赋的 UI，数据层可指定、切换和删除该可选字段；UI 留待 PR-C。
- 没有天赋专属 Prompt、机会/触发系统或效果判定，留待 PR-B。既有全量主角上下文投影可能携带合法 ID，本批没有增加目录文本、专属政策或注入逻辑；不承诺模型已经能正确发挥天赋。
- 存档只存 ID，目录文案不复制到存档；以后目录修订应独立审查并更新定稿证据。
- 所有测试使用合成资料与 Mock，没有真实玩家存档、密钥或付费 API。

只交独立 Draft PR；不合并、不部署、不发布、不更新公告，完成后等待十二代目审查。
