# 领域模块

M1 使用各子目录的 Zod Schema 定义人物、物品、经济、四类组织、事件与记忆数据，不依赖 React、IndexedDB 或 AI 供应商。`state.ts` 组合完整快照并校验关联，`commands.ts` 提供纯函数状态变更，`drafts.ts` 保存正文与候选的来源版本。

所有金额均为人民币分的安全整数；未知余额为 `null`。正式状态只能经仓库的版本检查与原子提交落库。详细契约和边界见根目录 `M1-DEVELOPMENT.md`。
