# 工作流

M4-P1 的 `storyStage.ts` 从 SaveRepository 重读已绑定回合，复用 runStageRequest / Composer / AiClient，完整校验后通过 rerollStory 与 saveDraft 乐观锁原子替换正文草稿。`storyStream.ts` 仅投影明确落入正文块的临时文本，不执行任何命令。

M4-P2 的 `variableStage.ts` 复用同一 runtime 和 SaveRepository，先显式创建执行尝试，再装配九域适用规则、校验并保存变量候选。`stageGuard.ts` 从正文提取共用锁、取消与尝试身份，正文、变量和世界不能在同页同时覆盖同一存档。

正文失败/取消保留旧文。变量重跑明确废弃旧候选及世界依赖，保留正文；网络失败只保存安全失败元数据，取消/迟到不强行回写。三个阶段都不创建新回合、不修改正式 GameState。完整协调、自动重试与正式提交仍待后续 M4。详见根目录 M4-P1-DEVELOPMENT.md 和 M4-P2-DEVELOPMENT.md。

M4-P3 的 `worldStage.ts` 复用上述 Runtime/StageGuard。重读正文与变量候选、校验来源/权限/时间，在同一正式基线整批模拟，只通过 saveDraft 保存 world（无变量时 preview）。重新补算世界保持正文及合法变量；取消、跨标签页更新或旧回包无法覆盖新草稿。详见根目录 M4-P3-DEVELOPMENT.md。
