# PR #51 NPC 诊断整合验收

## 基线与整合方式

原PR #51为`fix/scene-error-npc-id-in-log@8a413b90784d3ab41714e788dc601088460cfe0b`。先完成PR #52验收并推送`0eda4980871702aa9fe02e1bf1902b6b574b7133`，才在PR #51原分支整合该代码。远端main核对仍为`39b772dbbfd4b85423452ba3d6520684eb209bdf`。

这是开发分支之间的代码整合，未合并任何GitHub PR、未修改main。PR #51依赖已验收PR #52；建议先审查合并52，再复核51相对于最新main的增量。未主动部署生产环境；PR预览环境由现有Cloudflare自动流程部署。

仅有runtimeLog.ts和RuntimeLogPanel.tsx两处内容冲突，逐项保留WorldRule类型、白名单与展示，同时保留relatedNpcId链路，不以任一分支覆盖整个共享文件。

## 复现与最小修复

原PR #51的runtimeLogEvent仅验证IdSchema。新增反例后实际运行两个文件151项，128通过、23失败：22种非允许领域规则和缺少领域规则的World诊断，都可能携带合法格式NPC ID。这是日志字段白名单问题，不是领域命令权限问题。

只允许domainRule为scene_transition或scene_location，且ID通过现有IdSchema时输出relatedNpcId；npc_scene_location以及其他规则、无规则、原型属性名、非法字符、超长ID都不能携带NPC ID。不会把错误消息、模型原文、URL或凭证带入运行日志。WorldRule仍使用独立现有白名单。

保留PR #51原实现：两个SCENE错误的固定消息给出实际未处理NPC，aggregateDomainDiagnostic及variableValidationError仅从这两个错误类型提取并校验ID，最终安全日志显示具体NPC。单NPC、多NPC、SCENE_LOCATION链路和非法ID测试全部保留。非场景类型错误中的实体ID仍隐藏。

## 双诊断真实调用链

新增桌面/移动同一个浏览器场景，走真实解析器、阶段执行器、IndexedDB、TurnCoordinator和commitTurn：

1. Mock Variables移动主角但不更新原现场NPC，整批失败，日志显示scene对应NPC ID，不运行World，正式状态不变。
2. 明确恢复并补全NPC地点后，Mock World返回缺少estimatedEndAt的新事件，显示World schema/字段诊断，先前NPC诊断仍可查看，已保存变量保留，正式状态仍完全不变。
3. 再明确恢复只请求World，完成后自动结算恰好一次，进入空待输入草稿。刷新不额外调用模型，保存结果不变。

额外两条Mock请求只用于人为制造的两次失败恢复测试；生产代码没有新增请求路径或重试。全部模型请求为Mock，不代表真实模型或供应商验证。

## 相对于已验收PR #52的文件

- src/domain/sceneTransitions.ts：保留规则，只在固定错误文案携带实际NPC ID。
- src/executors/variableText/aggregateDiagnostics.ts：固定场景错误ID提取和IdSchema验证，明确注释例外。
- src/executors/variableText/diagnostics.ts：安全诊断可选relatedNpcId。
- src/services/validation/variableDiagnostics.ts：同样的固定错误转换。
- src/ui/game/runtimeLog.ts：保留WorldRule并增加精确两规则NPC ID白名单。
- src/ui/game/RuntimeLogPanel.tsx：同屏保留World规则与NPC ID说明。
- src/tests/runtime-log.test.ts：保留PR #51用例，新增22种非允许规则、2种允许规则/非法ID、无规则World诊断共25项。
- src/tests/variable-text-executor.test.ts：保留PR #51单/多NPC执行链回归。
- e2e/automatic-settlement.spec.ts：增加双诊断、逐阶段恢复、单次结算与刷新验证（桌面/移动各1项）。
- PR51-NPC-DIAGNOSTICS-INTEGRATION.md：本报告。

相对PR #52，World校验器、领域Schema、存档事务、TurnCoordinator、自动结算、GameScreen、Prompt和模型协议无改动。没有放宽来源、认知、事件生命周期、经济、时间或权限规则，没有新增玩家设置、收费阶段或AI审查。

## 本轮验证

日志目录：/workspace/pr51-integration-verification/。PR #52单独验收见PR52-FINAL-ACCEPTANCE.md，不能把该阶段的316项冒充整合后重新跑过。

| 检查 | 结果 |
| --- | --- |
| 白名单修复前定向 | 151项，128通过、23项新增反例失败，确认缺口 |
| 修复后World/Variables/Commit/日志定向8文件 | 313/313通过 |
| npm run check | 待完成 |
| npm run prompts:check | 82/82通过 |
| 整合后Chromium桌面/移动5文件 | 74项，待完成 |
| git diff --check | 提交前通过，最终再核实 |

## 边界与合并建议

建议PR #52先合并、PR #51后合并，合并前重新检查远端main及两个PR头提交，防止用旧共享文件覆盖另一套诊断。若选择squash，需要同步最新main后重新确认PR #51增量；本轮不替项目负责人执行合并。

未调用真实付费API、未修改正式玩家存档。静态规则和Mock验证不能证明任意供应商都兼容；原有生产构建大于500kB提示仍是非阻断限制。两个PR继续保持Draft，等待最终审查。
