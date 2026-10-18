# 《黑金王朝》V0.1 提示词资源库

M3-P1 已整理静态资源与注册信息，**没有组装器、API 调用、模型兼容/剧情效果验证**。两份 2026-10-18 审核包中的身份、双世界书、七项专项规则按原文字节入库；其它原始阶段/变量组/记忆模块继续沿用或做有记录的局部增量补丁。

**明确未完成项：**原版 NSFW 中的露骨性描写生成指令未迁入。当前 `writing/nsfw.md` 和 `intimacy_boundaries.md` 是标注的非露骨/非数值边界节选，不宣称为原版完整移植。两者独立常驻，无任何 NSFW 关闭开关。

## 资源职责

- `identity/fusheng.md`：固定叙事身份，正文最先；保留 `{{playerName}}`，不绑定特定世界，不管理变量。
- `worldbooks/heijin/01_worldview.md`：完整世界观 V2.0，紧跟身份。
- `worldbooks/heijin/02_modern_underworld.md`：完整社会/地下生态 V2.0，核心叙事规则第一位。合法、灰色与十四类非法产业分别保留，包括伪造货币与假币流通。
- `shared/`：权限、知识域、时间、状态真值、上下文及三阶段输出协议。`00_world` 只保留兼容 ID，已不注入。
- `writing/`：七项既有设置对应资源，以及常驻的冲突、情绪、行动可行性与成人题材边界；不新增设置项。
- `stages/{opening,regular}/{story,variables,world}.md`：六主提示词完整保留，任一请求仅对应一个 stage/mode 主模板。
- `variableGroups/`：主角、普通 NPC、特殊 NPC、物品、经济和四类组织，共九组 × init/update/offscreen。它们与 M1 六大实体组相容，不要求新增模型次数。
- `memory/`：原有五项按需辅助任务，不是每轮必跑阶段。本轮不实现记忆压缩。
- `compatibility/`：只供 P2 使用的 assistant 格式确认模板，未实际注入。
- `reference/`：仅供核对的上游 COT 原文，严格禁止作为运行模板。
- `docs/`、`examples/`、历史汇编：文档与演示，不进入 AI 请求。审核包本身不作为提示词资源复制/注入。

`manifest.json` 是静态元数据入口，`sources.lock.json` 记录来源、hash 与适配差异。现有稳定 ID 保留，只有新内容新增 ID；正文不复制到 src。完整逐文件变化、来源许可、未完成项和测试见仓库根目录 `M3-P1-DEVELOPMENT.md` 与 `THIRD_PARTY_NOTICES.md`。

玩家视角与主角认知不同，信息隔离首先保障 NPC 独立认知；最终 NPC 档案展示范围仍待后续设计。本阶段不改 M2 UI 或可见性策略。
