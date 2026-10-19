# 工作流

M4-P1 的 `storyStage.ts` 从 SaveRepository 重读已绑定回合，复用 runStageRequest / Composer / AiClient，完整校验后通过 rerollStory 与 saveDraft 乐观锁原子替换正文草稿。`storyStream.ts` 仅投影明确落入正文块的临时文本，不执行任何命令。

同页互斥、取消信号、尝试身份与持久化版本共同保护迟到结果。失败/取消保留旧草稿；不自动创建回合、不修改正式 GameState、不执行变量/世界。三阶段编排、自动重试、补算与正式提交留待后续 M4。详见根目录 M4-P1-DEVELOPMENT.md。
