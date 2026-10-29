# 《黑金王朝》文档索引

> **项目负责人确认：V1.0 已达到正式可玩里程碑。** 本目录记录当前实现与未来任务，不等于已有 GitHub v1.0.0 Release；实际状态以最新 `main` 和已合并 PR 为准。

## 现行入口

- [项目介绍、运行及当前里程碑](../README.md)
- [当前架构和状态安全边界](CURRENT_ARCHITECTURE.md)
- [动态世界事件生命周期（当前规则，替代Event的旧OR规则）](WORLD_EVENT_LIFECYCLE.md)
- [M6 API 模型列表兼容专项任务](API-MODEL-LIST-COMPATIBILITY.md)（主体已随 PR #27 合并；最终加固及真实服务边界见补充报告）
- [项目变更记录](../CHANGELOG.md)
- [运行中的提示词结构](../src/prompts/README.md)、[Prompt 资源库与历史说明](../prompts/docs/README.md)
- [工作流模块与阶段说明](../src/workflows/README.md)

## 历史资料（只供追溯）

- [V0.1 游戏设计规范](黑金王朝_V0.1_游戏设计规范.md)
- [V0.1 技术开发与实施计划](黑金王朝_V0.1_技术开发与实施计划.md)
- 根目录 `DEVELOPMENT.md`、`M1-DEVELOPMENT.md`、`M2-DEVELOPMENT.md`、`M3-*-DEVELOPMENT.md`、`M4-*-DEVELOPMENT.md`、`M5-*-DEVELOPMENT.md` 是对应阶段的**完成时快照**，不是仍待执行的开发命令。

旧文若要求“强制灾难开局”“M5-P5/P6 尚未开发”或“所有 NPC 完整档案永不清理”，均以 PR #22/#23 的现行实现为准，不要从历史草案倒推当前行为。

## 尚未排期的未来产品需求

- [Issue #6：未来 15 项、三款永久免费 DLC](https://github.com/WJT111222/HeiJinWangChao/issues/6)
- [Issue #24：「我的势力」模块](https://github.com/WJT111222/HeiJinWangChao/issues/24)
- [Issue #8：M7 UI/UX 改版](https://github.com/WJT111222/HeiJinWangChao/issues/8)

**阅读原则**：当前源码 / 已合并 PR ＞ 历史设计文档。更改产品规则需要另立实施范围、测试与独立 PR；文档归档不授权自动开发。
