# PR #162 验收证据

[报告](../PERSISTENT_WORKFLOW_BUTTON_ACCEPTANCE.md)逐批区分通过、失败和未执行范围。[raw-logs.zip](raw-logs.zip)保留原始输出、退出码和两轮旧手机用例失败快照；包含原始行末空白，没有为了 Git 格式检查改写日志。

最终基线为 main@6a348898，`*-main6a.log` 为正式重测；无后缀的最初批次基于 main@5ba35a85，仅保留历史记录。截图、结算 JSON 及 `main-comparison.json` 已更新到最终基线；`main-comparison-5b.json` 单独保留首轮。

SHA-256：`9ecd91ed24c8d0859fa05dda92fcdbaf5499c8aac5b3530839e354f9f3ed7ead`

仅使用合成存档和 Mock；截图为真实 React + Chromium，手机为 412×839 模拟视口。
