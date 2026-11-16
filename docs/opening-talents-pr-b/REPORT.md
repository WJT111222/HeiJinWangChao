# 八大开局天赋 V2：PR-B 三阶段机制与验收

本批让正式主角已保存的天赋参与 Story、Variables、World 的上下文。只注入所选一项的完整正式定义和本阶段职责，不增加奖励指令、触发器、数值胜率或额外请求。没有天赋时不注入专属文本。UI 仍留待 PR-C。

## 叠加基线

- 直接起点：PR-A #170 已审查 HEAD `5dc8d448ed7c8a49c6002cb1ecddc19f897cfbec`。
- PR-B 分支：`feat/opening-talents-ai`；Draft PR 目标为 **`feat/opening-talents-data`**，不是 main。最终 HEAD 见该 PR 与交付消息；本报告随提交保存。
- 执行时远端 main：`f36bc51aede49e4ac6edf9a0bda2138905f007c7`。按本轮叠加开发指令，不另行把 main 合入或向 main 推送。
- 权威资料：用户上传的《黑金王朝_八大开局天赋_V2_Codex第一批实施规范_2026-11-16.md》，SHA-256 `c37a83c363b3ec11f8b0b780a9374a051e8e84895e6dcdaf44d1f0f29f9a1beb`。本轮依据用户对 PR-B 的明确授权实施第 4、7 节的三阶段规则；PR-C 未实施。
- PR-A 的目录、Schema、创角数据、全部原测试与提交保持原样；没有改写 PR-A 分支或 main。

## 修改文件与数据流

生产代码只有三处：

| 文件 | 作用 |
| --- | --- |
| `src/prompts/talentContext.ts` | 只读构建单项天赋上下文：直接读取 PR-A 唯一目录的完整定义，附共同边界、本阶段职责及三项高风险机制约束。返回数组副本，调用方无法改坏后续装配。 |
| `src/prompts/sharedContext.ts` | Story/Variables/World 已有共用路径按正式 `state.protagonist.talentId` 选择；缺字段不产生 `PROTAGONIST_TALENT` 键。没有根据玩家自由文字、姓名、职业或城市猜测天赋。 |
| `src/prompts/composer.ts` | 将可选 `PROTAGONIST_TALENT` 放入现有固定前缀；`CURRENT_TIME` 继续是第一个动态字段。无天赋时原字段次序不变。 |

完整定义保留稳定 ID、名称、核心领域、机制名，以及能力介绍、专属机制、长期影响、能力边界。每次只发送选中天赋的一份全文，不发送其余七项全文，也不在存档或草稿保存文案副本。

沿用路径：严格验证的正式状态 → 各阶段既有上下文（World 仍使用合法 Variables 投影）→ `sharedContext()` → `composePrompt()` → 原 `runStageRequest()` / 客户端 → 原格式解析、领域校验、候选与原子 Commit。没有另建工作流、模型调用或保存通道；Memory 不调用此注入路径。

新增测试与夹具：

- `src/tests/talent-context.test.ts`：20 项上下文、兼容、隔离与前缀测试。
- `src/tests/talent-wire.test.ts`：5 项测试，其中 4 项各运行 6 种模式，覆盖四协议 × 三阶段 × 开局/普通共 **24 组真实客户端出站 Mock**；另核对官方 Claude 缓存分块和中转无标记。
- `src/tests/talent-workflow.test.ts`：15 项真实 Coordinator / SaveRepository 集成测试。
- `src/tests/fixtures/talentPrompt.ts`：固定时间的合成物流危机场景及 Memory 输入。
- `src/tests/fixtures/talentAi.ts`：四协议 JSON、DeepSeek SSE Mock 与隔离设置。
- `src/tests/fixtures/talentRoutes.ts`：八条人工编写的 Mock 输出，**不是产品算法、模型质量或真实成功率证据**。
- `src/tests/fixtures/talent-no-selection-baseline.json`：独立 PR-A checkout 生成的完整消息、上下文和模块列表摘要。
- `docs/opening-talents-pr-b/`：本报告、原始日志、大小测量、范围审计及基线生成步骤。

## 八项机制覆盖

同一合成场景为：濒临破产、债务复杂、涉及地下纠纷的物流企业，同时具有数字调度、工程设备、机构争执和公众议题。玩家仅查阅并提出路径，明确没有签约、投资、任职、公开发声或押注。

| 天赋 | Story 专属路径 | Variables / World 边界与测试 |
| --- | --- | --- |
| 枭雄光环 | 与既有事实关联的地下联系人提出人才求见或合作意向 | 求见、提议、同意、合作分别处理；没有新建忠诚部下或自动关系收益。 |
| 赛博暴君 | 卓越分析数字调度，提出 AI / 软件核心方案 | 不凭空获得访问权限、算力或技术成品；与实体设备领域区分。该路径另走真实 SSE Mock。 |
| 黄金律令 | 非常规资本重组、资产价值与经营方案 | 未投资就无收益、不凭空加钱、不代替机构职位；合法经济规则不变。 |
| 权柄猎手 | 识别制度内决策权缺口及联盟谈判路径 | 没有任职或授权就不写职位；不替代公众认同或战术执行。 |
| 众声主宰 | 发现公共议题，提出传播和社会叙事方案 | 不把公众影响写成每个 NPC 好感，不捏造受众/支持率；NPC 和公众仍可拒绝、反对。 |
| 天工奇才 | 突破性的机械结构、制造工艺与实验方案 | 实验、材料、设备、资金、时间仍必要；不凭空获得设备、专利或数字权限。 |
| 千机谋主 | 人员、时间、地点和资源的协同战术 | 不全知、不预知敌方秘密，不获得职位或自动指挥未授权的人。 |
| 绝命赌徒 | 普通查阅未押注：不套用优势；另测玩家明确押上重大筹码 | 四条件为主动押注、真实重大筹码、合理明确损失、明显潜在收益。测试只记录已支付 8000 元保证金，收益未实现；无百分比、保证翻盘或自动押注。 |

每项完整正式定义在三阶段开局/普通模式均实测装配；不是仅替换称号。共同规则明确顶级优势、显著强于普通角色，并保留真实资源与失败边界，不降格为一般观察力，也不加入等级或早中晚期。

三阶段分别负责：Story 提供有条件的机会、卓越发挥与已发生结果；Variables 只落地 `STORY_RESULT` 中充分支持的成立事实，继续允许合法空命令块；World 从正式状态、合法投影与历史推动独立后续活动，保持 NPC 目标、资源、知识和受保护现场边界。实际 Mock 世界结果只给既有 NPC 一个自主调查公开资料的计划，不意味着接触、效忠或已知主角秘密。

## 无天赋与旧档兼容

在**独立 detached PR-A checkout** 上，用与 PR-B 字节相同的场景 fixture、原正式 `composePrompt()` 和正式 Vitest 生成 9 组 SHA-256：三阶段 × 开局/普通 6 组，以及公共短→中、中→长、NPC 总结 3 组。当前分支逐项比较 `JSON.stringify(messages/context/modules)` 的完整摘要，全相同。Memory 另外逐个验证无天赋及八种 ID，仍与 PR-A 完全相同。

这是固定合成输入的完整字节对照，不是只断言键不存在。旧存档无字段时不补 ID、不注入政策、不增加请求；姓名/职业/玩家输入中的天赋名称不构成选择。未知正式 ID 仍由既有严格 Schema 在出站前拒绝。

基线重现：检出上述 PR-A HEAD，在临时 checkout 复制当前 `src/tests/fixtures/talentPrompt.ts`，将 [baseline-export.test.ts.txt](evidence/baseline-export.test.ts.txt) 临时放到 `src/tests/talent-baseline-export.test.ts`，设置 `TALENT_BASELINE_OUTPUT=/tmp/talent-baseline.json` 后运行 `npx vitest run src/tests/talent-baseline-export.test.ts`。不要用 PR-B 代码重算并替换基线摘要。原采集 [日志](logs/baseline-golden.log.gz) 保留，独立采集 1 项不计入产品专项数量。

PR-A 的 V10、创角草稿、开局包、备份导出/导入兼容测试全部仍在完整检查中。没有改动 GameState、TurnDraft、IndexedDB、备份格式或旧版本策略。仍不保证包含 `talentId` 的新存档能被旧程序读取。

## 安全与不变性

- Variables 尝试 `set protagonist.talentId` 与 World 命令夹带 ID 均通过真实解析/执行链拒绝，失败阶段没有非法候选，正式状态不变；PR-A 原有直接命令、整体 set、push/delete、初始化旁路等保护测试保留。
- 八条真实三阶段链均断言结算前正式状态不变；结算后只有允许的时间/情绪/独立 NPC 计划变化，没有凭天赋增加财富、物品、职位、NPC 数量、好感或忠诚关系。
- 每条正常链只有 Story / Variables / World 各一次请求，共三次；幂等重放不发请求。撤回在合法普通回合恢复点验证，保留天赋身份；不更改开局回合不可撤回的原规则。
- CAS 冲突和 IDB 写失败前后，真实 `exportRaw()` 五仓库记录完全相同；取消后迟到 Story 响应不形成候选、正式状态不变、没有自动重发。
- 官方 Claude 缓存文本块重新拼接与原完整上下文相同，中转不额外加缓存控制；原格式末尾提醒、文本命令/World JSON 解析保留。
- [范围审计](evidence/scope-audit.json) 对比批准基线：`src/domain`、`src/executors`、`src/services`、`src/workflows`、`src/ui`、`src/app`、`prompts/`、公告与依赖清单均无改动。PR-A 唯一目录和 Prompt Manifest / 来源锁字节一致。

## 成本与容量

对真实 `JSON.stringify(talentContext(id, stage))` 测量如下，单位为 JS 字符；同阶段开局/普通复用同一规则。完整结果见 [context-size.json](evidence/context-size.json)。

| 天赋 | Story | Variables | World |
| --- | ---: | ---: | ---: |
| 枭雄光环 | 1320 | 1332 | 1336 |
| 赛博暴君 | 1191 | 1203 | 1207 |
| 黄金律令 | 1180 | 1192 | 1196 |
| 权柄猎手 | 1174 | 1186 | 1190 |
| 众声主宰 | 1317 | 1329 | 1333 |
| 天工奇才 | 1185 | 1197 | 1201 |
| 千机谋主 | 1201 | 1213 | 1217 |
| 绝命赌徒 | 1441 | 1453 | 1457 |

每阶段 1174–1457 字符，项目 `unicode-heuristic-v1` 估算为 1398–1787 Token；**不是供应商实际 Token、缓存命中或费用数据**。其中包含被要求保留的该项四段全文。未注入其余七项全文，没有额外模型调用。无天赋增量为零。相邻回合的选中天赋保持在 `CURRENT_TIME` 前的固定前缀。

## Node 24 正式验证

环境 Node **24.19.0** / npm **11.9.0**，正式 `npm ci`、Vitest 与项目依赖，没有离线垫片。日志均为合成资料，不含真实玩家存档或生产密钥。

| 批次 | 实际结果 | 退出码 |
| --- | --- | ---: |
| `npm ci --cache /workspace/.npm` | 成功，安装 143 个包 | 0 |
| 最终专项 `npx vitest run src/tests/talent-context.test.ts src/tests/talent-wire.test.ts src/tests/talent-workflow.test.ts` | **3 文件 / 40 通过 / 0 失败 / 0 跳过** | 0 |
| `npm run check` | **172 文件 / 4182 通过 / 0 失败 / 0 跳过**；文件名、ESLint、catalog、TypeScript、Build 通过 | 0 |
| `npm run prompts:check` | **93 通过 / 0 失败 / 0 跳过** | 0 |
| `git diff --check` / 暂存差异检查 | 通过 | 0 |

40 项专项和 93 项 Prompt 均包含在 4182 项内，不重复累加。24 组出站组合位于 4 项 Vitest 内部循环中，也不冒称为另外 24 项独立测试。[完整日志](logs/)与[结果/退出码](evidence/results.json)随 PR 提交。Build 有大 chunk 警告但退出码为 0，不在本轮扩展打包优化。

保留开发过程的失败原始证据：初次 wire 测试错误读取 `.body`，正确接口是 `.init.body`；初次 8 条链错误尝试撤回开局回合，而原设计只允许普通回合恢复点。仅修正本批新增测试准备：用正式普通回合建立恢复点再撤回，没有修改传输、Undo 或放宽原业务断言。初次类型预检也报告同一错误取值，已随测试修正；最终完整类型检查通过。所有压缩日志保留原字节，可用 `gzip -cd` 查看。

本批没有 JSX、CSS、UI 控件或交互改动，依规范第 8.3 节不运行 Chromium 或大型视觉矩阵；不宣称已验证真实模型的叙事品质或手机 UI。Story 解析、流式链、Memory、Web Locks、幂等/撤回等原单测均保留在完整检查中。

## 已知限制与停止点

1. 这是**模型上下文机制**，不是新增确定性触发系统。八种机会案例是受正式契约约束的人工 Mock，用于验证规则出站、合法链路与保存边界，不能证明真实模型每次都会正确兑现优势。
2. 原校验器验证格式、白名单、引用、权限、金额、时间和并发等硬边界，无法独立证明所有自然语言叙事都真实、有充分因果证据。本批未放宽它们，也不把提示词约束冒称为万能语义审计器。
3. 绝命赌徒的四条件由模型依据事实理解，现引擎没有通用的风险价值量化或可验证概率判定器。本批没有伪造触发标记、百分比或数值加成；如需数学意义上的优势，须另立设计审批。
4. 公众传播暂无量化社会舆论领域，继续使用已有合法组织/事件事实记录，不虚构支持率。天赋成长规模由真实资源与历史决定，不增加阶段或等级。
5. 创角选择、车票复核和人物档案展示留待 PR-C。PR-A / PR-B 均保持未合并，本次没有手动部署、发布或更新公告。

完成后停止，等待十二代目独立审查和项目负责人授权。
