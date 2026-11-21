# 我的势力：数据、规则与面板

同一个 PR 内完成数据、命令、提示词、面板与测试。存档版本仍为 V10，全部新增字段可选，旧档读取即为「孤身一人」。

## 概念

- 主势力：主角归属、代表并依靠的组织，同一时间只有一个。普通雇佣、合作、交易或听说不构成绑定。
- 开局一律孤身一人；只有玩家在后续剧情里明确入伙、拜码头、接受任命或自己拉起队伍时，Variables 才写入绑定。开局回合的绑定在编译阶段拒绝。
- 势力覆灭、开除等由 World 推进组织与事件本身；绑定保留到主角在剧情里得知后，由 Variables 解除。

## 数据

| 位置 | 字段 | 说明 |
|---|---|---|
| 存档顶层 | `protagonistFaction?` | `{organizationId, position, departmentId?, joinedAt, bondText}`，只有一份 |
| 组织 | `departments?` | `{id, name, duty, headPosition?, headPublicName?, headNpcId?, scaleText?, statusText?}` |
| 组织 | `members?` | `{npcId, position, departmentId?}`，只收已建档人物 |
| 组织 | `protagonistKnown?` | 主角真实得知的据点/产业（holding）与内情（intel）；id、learnedAt 由程序填写 |
| 帮派、公司 | `reputationText?` | 名声 |
| 公司 | `operatingAreaText?` | 经营范围 |
| 政府、民间 | `fundingText?` | 经费（文字，不是金额） |

## 命令与权限

- `RecordOrgRelation` 新增可选 `faction`：`bind`（绑定新势力即解除旧势力，旧组织关系历史留一条程序记录）、`update`、`unbind`。仅 Variables；World 带 `faction` 按越权拒绝，World 目录不展示该字段。
- 新增 `RecordOrgKnowledge`：逐条追加主角已知条目。仅 Variables，文本协议为 `push organizations[id].protagonistKnown = {...}`；创建组织时不得内联。
- 部门、成员与五个公开字段加入 `UpdateOrganization` 对应类型白名单，Variables 与 World 都可更新。

## 提示词与上下文

- 四个 `org_*/update.md` 各增一段绑定与已知条目规则（只在涉及组织时加载）。
- `08_world_output.md` 增加部门、成员、新字段及「绑定与已知列表只读」的说明。
- 已绑定时三阶段上下文注入 `PROTAGONIST_FACTION`（名称、职位、部门、关系说明及本阶段边界），未绑定时不注入；该字段排入稳定上下文以利缓存。
- 已刷新 `commandCatalogSchemas.json`、提示词元数据，并在 `sources.lock.json` 记录 `protagonistFactionV1`。

## 面板

- 「世界资料」新增入口「我的势力」（印章「盟」），位于「势力组织」之后；电脑端为档案面板，手机端为全屏纸页，共用 `FactionPanel`。
- 未绑定：显示「你目前孤身一人」及如何在剧情里绑定的提示。
- 已绑定，七块内容：
  - 头部：名称、类型、身份与关系说明；
  - 公开信息：四类组织统一为首脑、简介、范围、实力、资金、主要业务、名声，空项不显示；
  - 对外关系；
  - 部门：负责人、职能、规模、现状，下列联系人中属于该部门的人，点名字打开人物资料；主角所在部门标「你在这里」；
  - 势力正在进行的事：取进行中或受阻的主事件，阶段按已完成/进行中/已排定显示，对外隐藏的只在主角知情时出现；
  - 你知道的据点与产业、你知道的内情；
  - 你手上的事、近期动态。
- 组织档案（上帝视角）的「当前状况」同步显示新增的五个公开字段。
- 回合变化：主势力变化与新增已知条目显示在「主角」分组，跳转到「我的势力」。

## 测试

- 新增 `src/tests/protagonist-faction.test.ts`：旧档兼容、绑定/更新/换绑/解除、非法引用、已知条目追加与拒绝、文本协议、World 权限、按需上下文。
- 调整命令数量相关断言（领域命令 29→30、Variables 目录 27→28、文本目录 85→86、文本命令类型 27→28）。
- 新增 `src/tests/faction-panel.test.tsx`（面板与投影）和 `e2e/faction-panel.spec.ts`（电脑端与手机端：空状态、有势力、点名字跳转）；世界资料入口数量相关的 e2e 由 7 改为 8。
- 本地环境无法安装依赖，只用非正式辅助方式运行了部分单元测试；以 CI `check` 为准。
