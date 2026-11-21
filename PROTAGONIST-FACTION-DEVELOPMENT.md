# 我的势力：数据与规则（第一部分）

本次只做数据、命令、提示词与测试；面板界面另开 PR。存档版本仍为 V10，全部新增字段可选，旧档读取即为「孤身一人」。

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

## 测试

- 新增 `src/tests/protagonist-faction.test.ts`：旧档兼容、绑定/更新/换绑/解除、非法引用、已知条目追加与拒绝、文本协议、World 权限、按需上下文。
- 调整命令数量相关断言（领域命令 29→30、Variables 目录 27→28、文本目录 85→86、文本命令类型 27→28）。
- 本地环境无法安装依赖，只用非正式辅助方式运行了部分单元测试；以 CI `check` 为准。
