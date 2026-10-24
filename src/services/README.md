# 服务模块（现行概览）

> 2026-10-24 根据已合并 M3～M5 阶段更新；完整入口见 [当前架构](../../docs/CURRENT_ARCHITECTURE.md)。

- `ai/`：OpenAI-compatible、原生 Gemini、原生 Anthropic 请求与流式协议、渠道参数、模型列表、Thinking 分离和脱敏检查。
- `storage/`：IndexedDB 多存档、V1～V4 严格迁移、正式状态和草稿原子事务、乐观版本控制/回执。
- `validation/`：正文、变量、动态世界和正式回合的结构、证据、时间、知识来源与权限校验。
- `local/`：配置等本地文件/资料服务。

**当前问题**：部分中转站的模型列表格式、地址或 CORS 不兼容（[M6 文档](../../docs/API-MODEL-LIST-COMPATIBILITY.md)）。此前 M1 “服务层尚不接 API”的说法已过时。请勿把测试 Mock 当作真实厂商兼容性证明。正式数据由存储/领域层守护，AI 请求本身无权直接提交游戏状态。
