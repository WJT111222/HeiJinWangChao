# NPC V2 第六批：全系统联调与最终验收

基线：`main@01de8d1c815dc0b5214a9987f4b6f7027f2d7d5a`（PR #100 已合并，开工重新 fetch 核实）。独立分支：`feat/npc-v2-final-acceptance`。所有人物、原文与浏览器数据库均为合成资料；网络仅 Mock，未调用付费模型，不操作玩家存档、不合并、不主动部署。

## 六批成果与实际架构

| 批次 | 已合并职责与本轮核实入口 |
| --- | --- |
| 01 | `npc/schema.ts` 的 ordinary/special、稳定 id/identityKey、电话及常驻地点、关系网；`npc/profiles.ts` 休眠/恢复；`commands.ts` 拒绝新 RetireNpc；历史 retiredNpcs 不复活 |
| 02 | 原始经历唯一进入 npc.memories；`npcMemory.ts` 的总结候选、来源核验；旧 longTermMemories 由 `migrations.ts` 无损整合；原 npcSummaries 保留 |
| 03 | `PromoteNpc` 与玩家 importancePreference；`SaveRepository.setNpcImportance` 独立管理CAS、草稿CAS、幂等回执及epoch；`retainNpcChoices` 撤回只恢复过去档案并保留当前玩家意图 |
| 04 | `composePrompt → contextFor → sharedContext → npcContext` 四级只读投影；SAVE_STATE.npc 单一档案表、NPC_CONTEXT.groups 为索引；不扩大写权限 |
| 05 | `NpcPanel` 统一名录与普通/特殊筛选，`useNpcManagement → changeNpcImportance → Repository → App.setLoaded`；PC双栏、手机列表/详情；电话/住址知晓及可读来源 |
| 06（本轮） | 连续四轮真实 Runtime/解析/候选/Commit/数据库/UI 综合验证；旧档续玩与撤回；总结与星标并发；规模、布局、性能测量；修复下面一项正式更新缺口 |

正式 GameState 仍为V9，IndexedDB仍为结构版本3。普通/特殊不是两套人物库；改名、职业、重要性变化都不更换身份。特殊经历/目标/习惯/关系网/privateProfile休眠；原始记忆、知晓及总结留在同一人物机制。没有新增人物类型、自动降级、评分、额外模型、电话玩法或关系图谱。

`TurnCoordinator` 顺序调用 StoryStage、VariableStage、WorldStage，Runtime 使用最终 Composer messages；合法候选先写草稿，`commitTurn` 重验并在原事务中提交正式状态、正文、回执和完整撤回记录。五回合/64MiB、epoch、CAS、单时间线、快照消费与无Redo不变。

## 本轮实际修复：已有人物改名/职业变化没有文本更新入口

新增连续回合 Mock 让已建档人物改名、保留旧别名、换任协调员，实际 Variables 解析报 `text.unsupported_path`。源码显示 NPC 已有 name/aliases/identity，但 `variableCommands.ts` 的 UpdateNpc.changes 和文本编译有限映射均未开放更新；只能在 CreateNpc 中赋值。不能以创建同身份副本解决。

最小修复：

- `src/domain/variableCommands.ts`：从既有 OrdinaryNpcSchema 复用三个字段的原结构，加入可选更新字段。
- `src/executors/variableText/compile.ts`：三条有限 set 映射，继续转为原 UpdateNpc，原 expectedRevision 和整批模拟/Commit 不变。
- 文本目录自动从同一命令Schema生成，实际 Variables 请求包含这三条路径；不另造协议、不手写另一份目录。
- `diagnostics.ts` 只补安全规范化路径，失败值和技术身份不输出到普通诊断。
- World 的真实 commandCatalog 排除三字段，worldOutput 明确拒绝它们。原现场/场外授权不放宽，World不新增改名/职业/别名写权限。

不允许通过上述入口更新 id/identityKey。空姓名、错误类型与非法别名数组仍拒绝。字段本身已存在于V9，因此没有存档结构或迁移变化。没有修改 Prompt Markdown、Manifest、sources.lock：本轮修复的是动态生成的命令Schema/目录，源提示词内容未变，prompts:check另行验证。

## 扩展验收发现的旧 Mock 契约修正

第一次冻结HEAD `7621053` 的完整Vitest 2991/2991及工程检查通过，但扩展浏览器开跑后，`continuous-turns` 的Mock抛出Zod错误：`npc.companion.longTermMemories` 缺失。Trace中Variables HTTP未被Mock正常完成，界面仍等待响应。这不是正式存档丢记忆，而是 `src/tests/fixtures/variableState.ts` 仍使用正式NPC结构解析第四批只读投影；后者按既定协议不再传空的旧长期标记。

仅修测试辅助Schema：复用OrdinaryNpcSchema和去掉兼容空标记的SpecialNpcSchema，保持strict对象与entityTable身份校验；同时拒绝休眠档案、旧标记和未注册字段，不向投影补造完整存档。新增真实Composer三阶段回归核对原始记忆/总结未丢失、辅助解析器不改正式状态。GameStateSchema、npcContext、Runtime/Commit没有因此放宽或修改。

另一个使用该辅助Schema的浏览器文件是time-preflight，因此定向复测及最终扩展集合也纳入它，最终计划24文件、232项。首次扩展批次主动SIGINT保存JSON/Trace后修正：实际15通过、6失败、2中断、191未执行（Playwright stats.skipped=193）；这是未完成批次，不当成完整验收，也未加入skip/fixme。

另外，第二次冻结HEAD `dfafea9` 的完整Vitest 2992/2992及工程检查通过。扩展浏览器运行到player-memory时，旧夹具将同一个`hidden-id`用于短、中、长期及NPC总结，正式全局记忆ID约束正确拒绝，首页显示无法读取卡片。仅为这些独立表示分配不同ID，并在测试写库前执行GameStateSchema.parse；原文本、来源、可见性、全部阅读/费用/不写存档断言保持。未修改任何正式校验。

第二次扩展中止保存：97通过、1失败、2中断、132未执行（stats.skipped=134）。单个失败就是该坏夹具，不是把未执行项目计作通过；Trace已保留。修正后另行定向执行player-memory、world-runtime、turn-undo-capacity双端20/20通过。所有中止批次与最终完整批次独立记录。

## 实际联调链路与覆盖分工

新增 `npc-final-runtime.test.ts` 使用真实 AiClient 的Mock transport、TurnCoordinator、正式文本解析与World校验、fake-indexeddb Repository；`npc-final-acceptance.spec.ts` 补真实React点击、HTTP拦截、IndexedDB、刷新与双端阅读。既有五批专项继续完整执行，不复制所有相同断言。

- 100已提交回合、30人世界继续四轮：首次正式建档→同身份改名/职业与关系更新→原升级命令及七字段→当轮合法离场→World新任务/事件关联补全→下一轮结案与私人经历/独立史料→重逢→记忆追加。原路人不建档，同人不重复建档。
- 每阶段检查最终请求；World使用合法Variables投影与正式基线revision，现场保护列表正确变化。候选生成期间正式状态全等未变；每轮原子Commit、幂等重放、loadGame重载，最后撤回重逢回合。四轮严格12次Mock请求，撤回零请求。
- 新浏览器四轮同样经发送→三阶段→自动结算→UI，随后对该新人物取消/恢复星标、刷新；身份、记忆、任务、七字段保持，仍严格12次请求。
- 原 `npc-context-tiers` 检查三阶段唯一人物投影、实际离返场与后台任务；`npc-importance`、`npc-directory`、`npc-directory-persistence` 继续验证React星标、玩家优先、初始同伴、待完善正常Variables补齐、真实Chromium进程关闭重启与撤回。
- `world-handoff`、World/Commit/撤回专项继续验证在场、初始同伴权限、非法实体/时间/版本、部分写入回滚、取消/失败/重试及候选不丢。没有修改这些领域约束来迎合Mock。

## 总结、认知与费用安全

新增真实 `MemoryMaintenance.run → AiClient → Mock HTTP` 并发场景：请求已经发出后，通过正式管理入口取消初始同伴特殊身份。迟到输出被持久epoch拒绝，数据库不变；付费尝试标记与限流账本仍保留。再次自动调度被 MEMORY_PREVIOUS 阻止，实际HTTP仍只有1次。明确手动立即总结可发第2次Mock并正常保存，原始记忆不删、休眠资料不丢。

这与“把paused设false”不同：测试同时检查请求实际发出次数、保存结果、来源与账本。旧时间线失败不推断成免费重试，不清空限流。既有 `undo-summary-recovery` 和 `memory-summary-v2` 负责撤回后迟到、刷新不重试、每分钟3/每小时12、关闭类型和手动权限。

统一记忆保持sourceTurnIds、知识性质、可见性和npcProvenance；无可靠来源旧总结不猜覆盖范围、不自动付费重做。任务/事件参与者名单不复制私人知晓；完整作者读取也不向主角/NPC广播。测试不以自然语言关键词审批剧情。

## V6/V7/V8/V9与旧撤回快照

新增4个参数化真实Repository用例：直接安装相应旧/现行格式，load严格迁移→Runtime三次Mock继续游戏→Commit→将恢复点保留为原版本表示→重新打开Repository→按需撤回至V9。全部核对人物、原始记忆、总结来源、正文、游戏时间及七字段，消费快照后没有Redo。

V6/V7使用原两层记忆夹具；V8/V9使用统一后的表示，不伪造旧格式含新管理字段。既有 npc-unified-memory/npc-v2-foundation/npc-importance 覆盖冲突ID、来源缺失、初始同伴、保守旧联系人、失败迁移不覆盖raw export与未来版本拒绝写回。没有清空旧联系人、总结或快照，没有虚构电话号码。

## 七字段终验

bodyDescription、chestDescription、pussyDescription、isVirgin、firstExperienceTarget、firstExperienceTime、firstExperienceText 全部沿原路径。

新增真实Runtime和双端多回合用例从Variables写入，Commit保存、详情逐字展示、取消进入休眠、再次加星恢复、刷新与撤回。布尔false、换行、末尾空白保留。既有私密档案与人物重要性专项继续检验初次经历不可覆盖、原写入资格、普通详情隐藏和三阶段请求休眠隔离。未改原生成提示词、七字段Schema或写入保护。

## 性能与容量测量

可重复方法：

```sh
NPC_FINAL_METRICS=/workspace/npc6-scale-metrics.json npx vitest run src/tests/npc-final-volume.test.ts
```

合成规模为30/100/300/1000人，对应100/100/300/300已提交回合。普通轻量人物各2条记忆，部分人物8条，长期同伴42条和2份可靠总结；另含组织、任务、事件和史料。不是每人几百条超长记忆。真实 `composePrompt().messages` 测量字符、UTF-8字节、启发式Token，不调用模型。所有人物数量与正式状态未裁剪。

每项重复3次，报告中位数与最大值，原始样本见同目录测量JSON。Node v24.19.0，AMD EPYC 9V74，执行环境暴露3逻辑CPU、约9.7GiB RAM。共享机器、JIT、GC和并行测试会影响耗时，不报告这三次样本为稳定P95，不把heap差值叫峰值RAM。

| NPC/回合 | 原始记忆 | 正式JSON字节 | 单份快照编码字节 | playerView中位ms | 名录SSR中位ms | 四级投影中位ms | V8迁移中位ms | Repo读取中位ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30/100 | 126 | 151,645 | 162,430 | 0.805 | 9.504 | 0.176 | 6.399 | 3.206 |
| 100/100 | 350 | 281,139 | 305,490 | 0.426 | 3.229 | 0.472 | 6.831 | 4.292 |
| 300/300 | 990 | 816,059 | 885,571 | 0.857 | 3.365 | 4.657 | 14.123 | 14.236 |
| 1000/300 | 3230 | 2,121,979 | 2,327,151 | 3.878 | 3.833 | 40.754 | 40.924 | 37.937 |

| NPC | 阶段 | 最终字符 | 估算Token | 组装中位ms | 组装最大ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 30 | story | 124,486 | 81,632 | 13.175 | 57.867 |
| 30 | variables | 168,111 | 82,653 | 17.308 | 27.531 |
| 30 | world | 206,442 | 95,157 | 18.565 | 25.67 |
| 100 | story | 239,354 | 125,609 | 15.687 | 16.538 |
| 100 | variables | 292,113 | 128,913 | 19.476 | 21.357 |
| 100 | world | 325,623 | 140,652 | 23.314 | 23.831 |
| 300 | story | 571,343 | 252,206 | 42.491 | 49.302 |
| 300 | variables | 650,422 | 262,091 | 44.49 | 46.164 |
| 300 | world | 669,841 | 271,557 | 52.832 | 55.437 |
| 1000 | story | 1,733,134 | 695,254 | 91.9 | 117.558 |
| 1000 | variables | 1,904,333 | 728,168 | 92.494 | 104.803 |
| 1000 | world | 1,874,437 | 729,681 | 109.94 | 112.939 |

大型V8格式迁移也使用同一100～300回合完整合成状态，核验迁移结果与V9原状态全等；V6/V7旧双层来源另测21条记忆样本，并由实际Repository续玩/旧快照用例覆盖。上述SSR是Node服务端渲染初始20条名录，不是浏览器绘制耗时。完整字节、堆差值及三次原始样本见 [scale-metrics.json](assets/npc-v2-final/scale-metrics.json)。

完整快照另按真实version1编码测量单份字节；五份近似总量只是同等状态大小的容量估计，不等于物理IndexedDB占用，也不承诺五回合必然可用。正式窗口始终受现有64MiB限制。长纪事、NPC记忆及休眠资料都计入存档/快照，UI分页不减少这些数据或模型上下文成本。

局部只读投影与20条列表未发现需改数据库架构的证据，因此本轮没有重写npcContext/playerView、强制裁剪历史或增加人数上限。千人请求仍可能超过实际模型窗口；窗口未知时不能保证可发送，启发式Token不是供应商usage或费用。

## 双端界面与证据

新增浏览器用例在1280/1440/1650桌面、320/360/390手机宽度检查真实渲染；PC保持两栏，手机保持列表→详情；测量实际边界、无横向溢出、星标44px触控、搜索别名、类型筛选、人物切换焦点、关系跳转、44条原文/总结翻页与来源展开、主游戏继续使用。

手机额外缩小可用高度至540px并聚焦搜索，只是可用高度压力，不是真实操作系统键盘测试。没有实体手机，不能称真机终验。

真实React Chromium截图与每项目交互时延JSON位于 `docs/assets/npc-v2-final/`：名录、普通详情、特殊详情、长记忆。全部为合成资料。Playwright操作耗时含自动化等待/进程通讯，与Node playerView/SSR、上下文组装及AI响应耗时分别列示。

| 项目/宽度 | 打开名录ms | 搜索ms | 切换人物ms | 详情实际CSS宽度px |
| --- | ---: | ---: | ---: | ---: |
| desktop/1280 | 1362.4 | 248.9 | 563.4 | 854.8 |
| desktop/1440 | 753.7 | 150.2 | 679.7 | 866.0 |
| desktop/1650 | 1545.9 | 420.7 | 586.5 | 866.0 |
| mobile/320 | 2717.0 | 289.5 | 206.7 | 254.4 |
| mobile/360 | 735.6 | 121.5 | 244.7 | 294.4 |
| mobile/390 | 719.7 | 99.6 | 104.0 | 324.4 |

每视口一次实际交互，未宣称分位数；首次打开含Vite开发模块加载和React渲染，测试机没有实体键盘/真机。后续冻结复验会重新生成测试截图，原始测量文件仅作为本次已采集样本，不将后续时延差异冒充稳定优化。

- [desktop-roster](assets/npc-v2-final/desktop-roster.png)
- [desktop-ordinary](assets/npc-v2-final/desktop-ordinary.png)
- [desktop-special](assets/npc-v2-final/desktop-special.png)
- [desktop-relationships](assets/npc-v2-final/desktop-relationships.png)
- [desktop-long-memory](assets/npc-v2-final/desktop-long-memory.png)
- [mobile-roster](assets/npc-v2-final/mobile-roster.png)
- [mobile-ordinary](assets/npc-v2-final/mobile-ordinary.png)
- [mobile-special](assets/npc-v2-final/mobile-special.png)
- [mobile-relationships](assets/npc-v2-final/mobile-relationships.png)
- [mobile-long-memory](assets/npc-v2-final/mobile-long-memory.png)

## 各批测试与修正记录

不将独立批次相加，不用历史成绩冒充最终冻结版本。

| 批次 | 通过 | 失败 | 跳过 | 原因/处理 |
| --- | ---: | ---: | ---: | --- |
| 未修改main源码的完整Vitest | 2982 | 0 | 0 | 基线已有能力 |
| 浏览器首次启动 | 0 | 0 | 0 | webServer未启动，无测试执行；换允许本地监听的执行环境，不计作通过 |
| 新Runtime首次 | 0 | 6 | 0 | 新测试内联创建错误包含id、四项用JSON代替Story SSE、一个无Story的Composer输入；修正夹具与正式协议，同时继续定位真实更新路径缺口 |
| 新Runtime第二次 | 5 | 1 | 0 | 真实改名/别名/职业有限路径缺失；没有创建副本绕过 |
| 新Runtime第三次 | 5 | 1 | 0 | Schema已加但编译有限映射尚未补齐；完整补齐原UpdateNpc路径 |
| 新Runtime第四次 | 6 | 0 | 0 | 连续回合与四版本通过 |
| 定向World/变量/重要性/新增路径 | 131 | 1 | 0 | 新最终Composer测试错误传入含凭证库函数的整个测试环境，structuredClone安全拒绝；改为只传合法ComposeInput |
| Composer修正后新Runtime | 7 | 0 | 0 | 含实际目录与World反例 |
| 加组织后的新Runtime | 4 | 4 | 0 | 合成组织错误引用NPC归属任务，现行Schema正确拒绝；修正组织夹具，不放宽领域规则 |
| 修正组织并加入实际HTTP并发 | 8 | 0 | 0 | 来源、epoch、费用账本与手动总结通过 |
| 初次规模测量 | 1 | 0 | 0 | 30/100/300/1000，后续最终夹具另测 |

初次TypeScript发现新测量调用RecallCues缺少stage，补齐测试参数；不放松类型检查。开发中失败JSON、Trace和错误上下文保留在独立工作区。

| 后续批次 | 通过 | 失败 | 跳过 | 原因/处理 |
| --- | ---: | ---: | ---: | --- |
| 开发中原相关双端 | 120 | 0 | 0 | desktop60、mobile60，无重试/flaky |
| 新增双端初次 | 2 | 2 | 0 | 两项连续回合误认为结算后空输入也应允许发送；改为核对清空和禁用，再输入下一行动；未改正式UI |
| 新增双端修正复测 | 4 | 0 | 0 | 六种宽度与连续四轮 |
| 补关系网截图后双端复测 | 4 | 0 | 0 | 无新增业务改动 |
| 第六批首次完整Vitest | 2990 | 1 | 0 | 旧负例将identity视为不可写，与本轮明确补齐的职业更新冲突；保留负例为不可修改的稳定identityKey，新反例亦核验id/identityKey不可写 |
| 冻结前直接受影响四文件 | 178 | 0 | 0 | 含新增Runtime/压力、旧文本执行器、实际目录，补大型V8迁移测量 |
| 冻结前提示词检查 | 93 | 0 | 0 | 原资源/Manifest未变 |
| 第一次冻结HEAD完整Vitest | 2991 | 0 | 0 | 7621053，新增只读辅助解析器测试前 |
| 扩展浏览器中止批次 | 15 | 6 | 193 | stats.skipped含2中断+191未执行；6项为同一个旧Mock契约错误，非完整批次 |
| 只读Mock修正后定向单元 | 66 | 0 | 0 | 实际Composer、原始记忆/总结、strict拒绝未知字段与休眠泄漏 |
| 连续回合＋时间预检双端定向 | 30 | 0 | 0 | desktop15/mobile15，含真实创角后连续十回合；未改原超时和业务断言 |
| 第二次冻结HEAD完整Vitest | 2992 | 0 | 0 | dfafea9，包含新的只读投影回归 |
| 第二次扩展中止批次 | 97 | 1 | 134 | stats.skipped含2中断+132未执行，坏夹具ID重复；非完整批次 |
| 记忆阅读/World/撤回容量双端定向 | 20 | 0 | 0 | desktop10/mobile10，保留原全部断言 |

TypeScript、ESLint、生产构建、差异检查通过。保留既有>500kB chunk提醒，不扩展拆包。路径计数测试从80同步为83，新增三条精确路径断言；没有减少命令类别、ID/权限/事务安全断言。

**冻结提交的最终复验单独记录在本PR最终验收评论**：在已提交HEAD依序运行完整Vitest、提示词检查、TypeScript、ESLint、构建、差异检查，再单独运行24文件、232项相关desktop/mobile Chromium。不能把上表120与4相加当作这个扩展批次。若最终失败必须先解决，不以本表宣布最终全绿。保留冻结提交不为更新测试报告再次改动代码，最终SHA与实际通过/失败/跳过以PR评论及交付回复为准。

冻结验证命令（浏览器可同时使用line,json记录进度，JSON通过PLAYWRIGHT_JSON_OUTPUT_FILE单独保存）：

```sh
npm test -- --reporter=json --outputFile=/workspace/npc6-full-head.json
npm run prompts:check
npm run typecheck
npm run lint
npm run build
git diff --check
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-final-acceptance.spec.ts e2e/npc-directory.spec.ts e2e/npc-directory-persistence.spec.ts e2e/npc-importance.spec.ts e2e/npc-context-tiers.spec.ts e2e/npc-unified-memory.spec.ts e2e/npc-v2-foundation.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/world-handoff.spec.ts e2e/game.spec.ts e2e/game-window.spec.ts e2e/memory.spec.ts e2e/world-observer.spec.ts e2e/continuous-turns.spec.ts e2e/turn-coordinator.spec.ts e2e/memory-maintenance.spec.ts e2e/memory-summary-v2.spec.ts e2e/world-runtime.spec.ts e2e/player-memory.spec.ts e2e/turn-undo-capacity.spec.ts e2e/time-preflight.spec.ts --project=desktop --project=mobile --reporter=json
```


## 未来真实模型人工验收清单（本轮未执行）

不批量自动运行，由负责人自行选择并承担服务商费用：

1. 小背景开局与普通交谈：有价值且有姓名人物是否合理建档，无名路人是否被乱起名。
2. 重逢/改名/换职业：是否复用正式稳定人物，关系、性格和既有记忆是否连续。
3. 普通人物逐渐重要：是否合理调用specialProfile，未干预人物可升级；玩家取消后是否尊重ordinary。
4. 首次玩家星标：后续正常Variables是否自然补齐；已恢复档案是否避免重写和重复总结。
5. 离场独立生活与任务：World是否承接结果，重逢Story是否使用实际历史，而非自动把私人消息授予他人。
6. 四级索引理解：Story/Variables/World是否遵守唯一人物表和不同读取深度，在长线状态下保持连贯。
7. 私人知识：检查主角/NPC是否错误知道未获知的消息、电话或住所；不能以Mock响应合法证明真实叙事正确。

## 结论与剩余边界

**建议结论：有条件通过。** 核心链路的Mock联调及旧档保护已验证；关闭NPC V2开发阶段的前提是上述冻结HEAD最终完整批次全部通过（由本PR最终验收评论确认），真实模型质量、实体手机与长期真实配额仍是下列明确的非阻塞边界。若最终发现存档/核心游戏阻塞，必须改为未通过并返修，不能用建议代替结果。

- 本轮没有真实付费模型或真实usage测量；不能保证模型建档、升级、记忆及叙事质量。
- Chromium模拟手机不是实体设备；原生输入法、后台冻结、低内存设备与真实浏览器配额还需自愿实机体验。
- 千人轻量世界仅为可重复压力样本；真实长篇记忆可能更大，完整上下文成本仍增长，不承诺适配未知窗口。
- 无新增跨标签实时广播；现行CAS冲突后重读保持安全，未刷新的另一标签卡片仍可能是旧显示。
- 现有付费尝试安全策略保守：撤回/管理使已发出的总结失效后，可能需要玩家手动处理；不会据此自动收费重试。
- 首次经历保护、活动特殊档案读取、普通休眠隔离、初始同伴未知好感、旧联系人保守规则均保留。

等待负责人审查，不自动关闭PR、不合并、不部署。
