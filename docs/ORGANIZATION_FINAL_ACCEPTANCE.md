# 势力组织最终完善：开发与验收报告

<details>
<summary>完整修改文件清单</summary>

- `docs/ORGANIZATION_FINAL_ACCEPTANCE.md`
- `docs/measurements/organization-final.json`
- `docs/screenshots/organization-final/desktop-1280.png`
- `docs/screenshots/organization-final/desktop-1440.png`
- `docs/screenshots/organization-final/desktop-1650.png`
- `docs/screenshots/organization-final/mobile-320.png`
- `docs/screenshots/organization-final/mobile-360.png`
- `docs/screenshots/organization-final/mobile-390.png`
- `e2e/organization-archive.spec.ts`
- `prompts/docs/OUTPUT_CONTRACT.md`
- `prompts/manifest.json`
- `prompts/shared/07_command_output.md`
- `prompts/shared/08_world_output.md`
- `prompts/sources.lock.json`
- `prompts/variableGroups/org_business/init.md`
- `prompts/variableGroups/org_business/offscreen.md`
- `prompts/variableGroups/org_business/update.md`
- `prompts/variableGroups/org_civil/init.md`
- `prompts/variableGroups/org_civil/offscreen.md`
- `prompts/variableGroups/org_civil/update.md`
- `prompts/variableGroups/org_gang/init.md`
- `prompts/variableGroups/org_gang/offscreen.md`
- `prompts/variableGroups/org_gang/update.md`
- `prompts/variableGroups/org_government/init.md`
- `prompts/variableGroups/org_government/offscreen.md`
- `prompts/variableGroups/org_government/update.md`
- `src/app/styles.css`
- `src/domain/commands.ts`
- `src/domain/organizations/schema.ts`
- `src/domain/state.ts`
- `src/executors/variableText/catalog.ts`
- `src/executors/variableText/entities.ts`
- `src/prompts/worldDomains.ts`
- `src/services/validation/commandCatalog.ts`
- `src/services/validation/worldDependencies.ts`
- `src/services/validation/worldOutput.ts`
- `src/services/validation/worldProjectionDiagnostics.ts`
- `src/tests/fixtures/organizations.ts`
- `src/tests/organization-runtime.test.ts`
- `src/tests/organization-system.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/prompts.test.ts`
- `src/tests/text-prompt-readiness.test.ts`
- `src/tests/variable-commands.test.ts`
- `src/ui/game/GameScreen.tsx`
- `src/ui/panels/NpcPanel.tsx`
- `src/ui/panels/OrganizationPanel.tsx`
- `src/ui/panels/Panels.tsx`
- `src/ui/panels/WorldEventsPanel.tsx`
- `src/ui/panels/organizationView.ts`

</details>

## 基线与设计

开工与远端 main 核对一致：`b609d51061b76615acbaaa8f2fb280d612fce75c`（PR #102 已合并）。独立分支：`feat/organization-final-acceptance`。

世界事件记录发展过程、因果与结果，组织档案保存当前有效状态。本轮没有独立经营模拟、定时刷新、自动资产增长或关系矩阵；没有新增模型阶段或请求。重大性、公开身份、组织发展及结果由原 Variables/World AI 判断，程序只校验类型、引用、时间、字段权限、版本和事务。

## 数据结构与兼容

保留四类 Organization 及全部原字段，仅在共通组织结构新增两个可选数组：

```ts
leadership?: { position: string; publicName: string | null;
               description?: string; npcId?: string }[]
relations?: { organizationId: string; relation: string; description: string }[]
```

- `leadership` 是组织公开职位资料，不是 NPC 新建指令。普通渠道不可知的身份写 `publicName:null`，不绑定公开人物入口；程序不从 NPC 秘密档案补姓名，也不审查某姓名是否符合剧情。AI负责公开可知性判断。只知道公开姓名不创建 NPC、联系人、记忆或电话。
- 已有正式人物按稳定 ID 在 `keyNpcIds` 或 `leadership.npcId` 直接关联；不从同名、别名片段或职业文字自动猜归属。一个 NPC 可以属于多个组织。更换管理人只替换当前职位，不删除原 NPC，也不改变其好感、重要性、记忆或私密资料。
- `relations` 是稀疏的当前关系，每目标一个记录，目标必须存在且不能为自身；单向合法、可为空，无自动反向关系。更新替换当前项、终止移除当前项；不删除事件或历史。旧 `businessRelations` 原文继续在详情中独立展示，不猜测 ID。
- `protagonistRelation` 是开放文字，可为「闻所未闻」，不是资料解锁条件。所有组织概况、状态、关系和动态均正常展示。

GameState 保持 V9，IndexedDB 版本未变，无新增数据库表、迁移或批量重写。缺少新字段的 V6/V7/V8/V9 旧组织继续原样读取，不补空数组、更不生成管理人或关系。旧原始记忆、总结、七项 privateProfile 字段及旧联系人均不变。新字段随原正式存档和完整撤回快照保存，未新增第二套组织真值。

**旧客户端边界：** 新版程序可读取合法旧档；旧版严格 V9 客户端不保证能读取包含新可选字段/新 UpdateOrganization 候选的存档。本轮没有假称旧程序具备向前兼容，也未用丢字段、清快照的方式兼容。需要使用本 PR 对应的新客户端；不应回退到旧客户端继续写同一新档。现有未来版本拒绝覆盖机制没有修改。

## 正式更新能力

新增 `UpdateOrganization`：

```json
{
  "commandId": "org-update", "type": "UpdateOrganization",
  "organizationId": "org-business", "expectedRevision": 10,
  "changes": {"operatingStatus":"完成已确认的业务整合"},
  "evidence": "本轮正式结果"
}
```

共通白名单：`name/description/keyNpcIds/currentTaskIds/leadership/relations`。

| 类别 | 类型专属更新字段 |
| --- | --- |
| gang | territoryText、funds、powerText、industries、internalStatus |
| government | jurisdictionText、lawfulPowers、cases、administrativeAffairs、enforcementCapacityText、publicTrustText、internalStatus |
| civil | missionText、supportersText、membershipText、activities、activityAreaText、publicInfluenceText |
| business | sectors、assetsEstimate、liquidityEstimate、ownershipText、operatingStatus、businessRelations |

程序按现有组织类型再次校验白名单，不允许跨类型字段、任意深层补丁、覆盖 `id/kind/protagonistRelation/relationHistory` 或整个组织。主角关系仍用 `RecordOrgRelation`。正式更名保留 ID，创建/更名不能与同类另一组织重名；旧档的既有记录不会因此被重写或合并。

### 金额权限的明确扩展

原 World `CreateOrganization` 的金额限制保持不变。新增的是独立、可定位的 **组织更新** 白名单：仅 gang.funds、business.assetsEstimate/liquidityEstimate。金额为非负安全整数人民币分；未知不写，不以0代替未知。

每次金额更新须提供同一命令的 `financialBasis={at,note}`，at 为合法 ISO 游戏时间且不晚于执行时钟，note 为非空说明。它是结构化时间与说明，不是自然语言证据审批：程序不匹配 Story 原句、关键词或组织事件结果措辞。是否可靠由原 AI 判断，不能把 Mock 视为金额真实性的验证。

估值、流动资金和组织持有资金相互独立，命令只写组织字段，不执行交易、不更改玩家账户或收入账本。非法负数、小数、超安全范围、错误组织类别、缺少依据、未来依据、版本冲突均有反例；其他 World 资金/物品命令权限未放开。

### Variables 与 World 链路

Variables 使用原三标签四操作协议：

```text
set organizations[org-business].state = {"operatingStatus":"完成现场确认的整合"}
```

若有金额，`financialBasis` 与变化字段一起放在 state 值内；编译器拆为命令元数据并注入正式 expectedRevision，不存进组织对象。数组为明确替换，清空当前关系使用 `relations:[]`。

链路：实际 Composer/目录 → 文本编译或 World JSON 解析 → 原候选模拟 → 原子 Commit 重验 → IndexedDB → 刷新/撤回。World使用正式基线 revision，不改变 PR #73 投影语义。World不能覆盖本轮已验证 Variables 写过的同一组织字段或主角关系；不冲突字段仍可独立推演。整个数组是一个字段，当前不做隐式合并或冲突覆盖。

World 创建后可在同批使用明确的 UpdateOrganization（仍必须上述金额依据）；结构化依赖顺序支持先创建后更新。不存在的对象、安全引用、任务归属和失败原子回滚继续由原完整投影验证，安全诊断支持映射 UpdateOrganization 的字段路径与命令位置。

## 实际提示词接入

- Variables正式加载 `shared/07_command_output.md`，以及四类 `variableGroups/org_*/init.md`、`update.md`。新增路径真实进入 TEXT_COMMAND_CATALOG，白名单列表与领域运行规则共用 `organizationChangeFields`，没有另维护自由字段协议。
- World正式加载 `shared/08_world_output.md` 和四类 `offscreen.md`，COMMAND_CATALOG包含真实 UpdateOrganization Schema、分类字段表及金额规则。删除了“后台组织经营变更目前不支持”等过时表述；原创建金额限制与其他领域权限保留。
- 共享原则强调低频、实质变化、自然语言为主、角色知情独立；不强制关系、事件、任务、NPC或机械周期。普通关系变化可直接更新，重大变化通过已有事件承接。
- Manifest刷新当前字数/哈希。sources.lock追加 `organizationFinalAcceptance` 与实际基线，旧来源哈希和历次适配均保留。四个原verbatim场外资源明确改为适配状态，并保留previousTreatment，不伪称修改后仍为原文。命令契约文档同步追加新命令。

## 势力档案馆与导航

新 `OrganizationPanel` 使用现有黑金主题和同一个资料弹窗：桌面左名录/右详情独立滚动，手机列表→详情→返回。搜索名称/类型/概况/主角关系，类别筛选、每页20条，空分类和空关系简洁展示。长概况明确提供「阅读完整组织概况」，完整文本不截断、不写回原记录。

详情区为概况、当前状况、管理层与人物、稀疏势力关系、当前动态、主角关系；技术字段仅在折叠记录中。政府、民间不出现强制资金或战力；企业资产估值与流动资金分别显示；数字没有可靠值时不强造。

当前事件/已结束事件从原事件参与者及保留的退役 detail.actorRefs投影；当前任务按正式组织行动者和非终态状态筛选，旧 currentTaskIds 中已结束任务不会冒充进行中。不在组织里复制完整事件或任务。

通过 GameScreen 原 panel 状态增加有限的目标 ID，复用 NpcPanel/WorldEventsPanel：组织→已有NPC、NPC→明确关联组织、组织→组织、组织→当前/已结束事件。没有新全局路由。未建档公开姓名只有文字，不能点击成不存在的 NPC。所有阅读操作零模型请求、零领域写入。

**地图未修改：** `Panels.tsx` 仅替换组织分支并传递可选导航参数，原地图分支字节完全一致（SHA-256 `2dbc6701ef6fbb2a6fafe1a45ef23d861e809057c2c206737cb8717af0154523`）；地图入口、地点层级、坐标、导航及地图样式均未改动。

## 完整 Mock 示例

`organization-runtime.test.ts` 用完全虚构的澄川工贸场景，真实 Coordinator → AiClient/Runtime → Mock transport 连续三轮：

1. 创建业务收购主事件，组织没有实际状态变化，不发组织更新。
2. 事件继续，仍无实质变化，组织仍原样。
3. 收购正式结案，World同请求 SaveEvent 与 UpdateOrganization 更新经营、股权、经理、资产及流动资金估计。主角账户与全部NPC保持不变。
4. 候选期间正式状态不变；原子 Commit 后重开 Repository 内容一致。撤回第三轮，组织与事件同时恢复第二轮，旧结果不复活。

另测收购失败且组织未实际变化时不强制更新，原后续任务仍存在；已结束任务不显示为当前任务。普通单向关系可在没有事件时独立建立/更新/结束。

## 验收记录

| 最终批次（分别计数，不相加） | 结果 |
| --- | --- |
| `npm run check`：Lint → 完整 Vitest → TypeScript → 生产构建 | 全部通过；116个文件，3033通过 / 0失败 / 0跳过；Vitest 87.69秒 |
| `npm run prompts:check` | 3个文件，93通过 / 0失败 / 0跳过；7.70秒 |
| 相关Chromium完整批次（5个文件） | desktop 23通过 / 0失败 / 0跳过；mobile 23通过 / 0失败 / 0跳过；共46通过，约3.6分钟 |
| `git diff --check`、完整Diff自查 | 通过；无地图实现变更，无正式存档或模型配置改动 |

Chromium命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/organization-archive.spec.ts e2e/npc-directory.spec.ts \
  e2e/world-events-archive-v2.spec.ts e2e/turn-undo.spec.ts \
  e2e/npc-directory-persistence.spec.ts --project=desktop --project=mobile
```

最终批次使用`--reporter=list,json`另存机器可核对的结果。没有运行无关全量Chromium。Vite保留原有大于500kB构建包提示，没有构建失败。

开发批次保留：初始领域21/21；新增集成初跑24通过/6失败（合成旧档关联了不属于该夹具的NPC ID，及测试Story未标ready），修正夹具/就绪设置后四文件93/93；后续六文件161/161。提示词初跑91通过/2失败，是新增命令后旧目录数量断言，按真实目录更新数量并保留严格Schema检查。Lint初跑两项未使用导入，已通过接入实际字段目录及移除无用导入修正。

新增浏览器初跑4通过/2失败，复测5通过/1失败：组织类别可访问名称、刷新后的可见性等待、手机原有世界目录弹窗未关闭阻挡撤回。分别修正可访问标签和测试交互，未绕过断言；同时根据实际截图完善长概况展开、目录固定筛选及独立滚动。最终新增用例单批6/6通过，之后冻结并执行下表的完整批次。首次完整Vitest为3031通过/2失败，均为另两份历史目录数量断言；更新为实际84条路径/29类领域命令/26类Variables命令，同时增加新入口显式断言，没有删除测试或改变生产校验。其后发现同一目录测试还有一项去重类型数量25→26未同步：单文件定位批次56通过/1失败，已修正；第二次完整检查在该已知失败后主动中止，没有完整成绩，不计为通过。不同批次不相加。

## 容量与性能（合成资料，不是真实玩家存档）

可复现：

```sh
ORG_BENCHMARK_OUTPUT=/tmp/organization-benchmark.json npx vitest run src/tests/organization-runtime.test.ts
```

测量包含现有3名NPC、10回合正文、2个组织事件与组织任务，并分别扩展到10/100/1000组织，刻意保留较长组织概况；没有真实模型请求。输入字符/字节来自真实 composePrompt 最终 messages，不是GameState体积代替请求。每个阶段检查全部组织仍存在，调用只读。

| 组织数 | 阶段 | 正式状态UTF-8字节 | 实际消息字符 | 实际消息UTF-8字节 | Compose毫秒 | 只读动态投影毫秒 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 10 | story | 28376 | 52828 | 117034 | 18.92 | 0.17 |
| 10 | variables | 28376 | 113590 | 174810 | 10.42 | 0.17 |
| 10 | world | 28376 | 156693 | 231439 | 10.46 | 0.17 |
| 100 | story | 231768 | 137600 | 320426 | 7 | 0.18 |
| 100 | variables | 231768 | 198362 | 378202 | 13.7 | 0.18 |
| 100 | world | 231768 | 326237 | 638223 | 15.44 | 0.18 |
| 1000 | story | 2267560 | 987192 | 2356218 | 32.45 | 0.37 |
| 1000 | variables | 2267560 | 1047954 | 2413994 | 39.66 | 0.37 |
| 1000 | world | 2267560 | 2025421 | 4709807 | 47.27 | 0.37 |


完整记录：[JSON测量材料](measurements/organization-final.json)。耗时为本次 Node/合成环境单次观察，不是性能门槛、浏览器延迟承诺或真实模型Token费用。正式状态容量不含IndexedDB索引、事务和回执开销；快照还受原5回合/64MiB共同限制。1000组织样本本身约2.27MB，不可据此假定长期玩家存档只有此体量。组织越多、概况越长，正式档/完整快照和AI输入均增长；本轮没有裁剪背景以美化数字，也没有改动上下文预算和既有专项视图。

## 真实界面截图

均由本PR真实React界面、合成存档和Chromium生成，非静态设计图；已经检查实际截图：

| PC | 手机 |
| --- | --- |
| [1280×900](screenshots/organization-final/desktop-1280.png) | [320×844](screenshots/organization-final/mobile-320.png) |
| [1440×900](screenshots/organization-final/desktop-1440.png) | [360×844](screenshots/organization-final/mobile-360.png) |
| [1650×900](screenshots/organization-final/desktop-1650.png) | [390×844](screenshots/organization-final/mobile-390.png) |

## 剩余边界

1. Mock证明协议、来源/结构、权限和事务链路，不证明真实模型一定正确判断公开身份、可靠金额、组织重大变化或低频取舍，仍需后续授权的真实模型与人工验收。本轮零付费模型请求。
2. 旧轻量退役事件若没有保留组织参与身份，不按标题/姓名猜归属；旧事件/史料仍保留在原世界事件/历史面板，不伪造丢失关联。
3. 旧文本业务关系不会自动转为组织 ID，需要未来正常模型请求在有明确身份时记录。明确 NPC 归属同样由既有模型流程记录稳定 ID，不做文字模糊匹配或额外建档请求。
4. 跨类型字段不通用，数组当前关系是整体替换；AI需保留仍然有效的项。金额说明不会被程序文学审查，财务真值仍依赖AI判断，玩家资金和交易权限由严格命令边界保护。
5. 现有大型构建包、较大世界上下文等成本问题不在本轮顺手重构；正式交易、NPC、事件、历史和撤回核心没有重做。

保持Draft，不合并、不主动部署、不修改真实玩家存档，交负责人及八代目审查。
