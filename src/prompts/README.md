# 提示词静态注册

M3-P1：`manifest.ts` 使用 Zod 校验根目录 `prompts/manifest.json` 的元数据和固定作用域/排序约束。提示词正文唯一来源仍为根目录文件，不复制到 src，不导入 React，不读取游戏状态。

当前没有正文加载器、占位符替换器、消息组装器、API 客户端、路由或预览 UI。注册表的角色与顺序是 P2 的逻辑约束，不能当成实际发送记录；不会因导入本文件而调用模型。

`npm run prompts:check` 仅检查文件、来源、元数据及六套静态配置的作用域。显式修改文本后，先审核原文与来源，再用 `npm run prompts:refresh` 刷新字符数/hash/占位符元数据；测试不会自动修复漂移。

原版露骨 NSFW 生成指令未迁入，当前常驻资源仅为标注的非露骨节选；见根目录 `M3-P1-DEVELOPMENT.md` 的未完成项。NPC 私密档案/名器录仅在 manifest.futureExtensions 记录设计入口，没有运行模块。
