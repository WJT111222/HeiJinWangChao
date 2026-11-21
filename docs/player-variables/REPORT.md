# 当前存档的变量管理与 NPC 称呼

## 入口与操作

载入存档后，打开 **设置 → 变量管理**。桌面把设置分类侧栏让给变量分区，可用「返回设置分类」退出。手机采用横滑分区导航。主角、人物、世界、组织、经济、物品、记忆、历史和存档九个分区覆盖当前正式快照的全部根字段。

| 入口 | 操作 |
| --- | --- |
| 结构树 | 展开对象或数组。点击字段值即可在原位置编辑，保留类型和真实路径。人物下可以分别填写两个方向的称呼。 |
| 分区 JSON | 编辑当前分区的全部字段，按正式根键组织。保留实体 ID 键表及数组顺序。完全受保护的分区只能查阅。 |
| 路径修订 | 输入 JSON Pointer，支持设置值、数值增减、数组追加、删除字段或元素。 |
| 变量登记表 | 在整个工作草稿中检索已有路径，查看类型与读写标记，选择可编辑路径可直接进入修订。 |

各入口共用同一份工作草稿。「加入待保存修改」更新差异预览；点击「保存变量修改」才会写入当前存档。尚在输入的 JSON 有错误时保留原文。年龄、性别与专属档案资格冲突、悬空引用等在正式保存时显示错误。账本、历史及实体身份等保留专用事务保护。

## 与参考实现的对应关系

对照《墨染江湖》的 VariableManager.tsx 和 SettingsModal.tsx，采用了分区导航、递归编辑、分区 JSON、路径修订和登记表。路径、分区字段、校验与写入均来自《黑金王朝》。工作台以四个可切换的视图共享编辑空间，手机上可只展开所需的分支。分区 JSON 使用正式根字段名，便于与路径登记表互查。

## NPC、存档和正文

- NPC 按稳定 ID 保存可选的 addressing。playerToNpc 与 npcToPlayer 独立；旧 V10 存档可继续缺省。同伴创角档案在人物分区单列只读。
- Variables 根据剧情判断称呼的变化，按方向合并。正文无须逐字写出新称呼。玩家可在变量管理器直接编辑。Story 获得当前正式称呼与方向说明，关闭 Variables 也能读取。旧正文仍按原样保留。
- playerVariables.ts 对候选执行完整 GameStateSchema、引用及受保护路径检查。SaveRepository.savePlayerVariables 在同一 IndexedDB 事务内重读正式状态、草稿与控制记录，比对快照与实例。持有运行锁、版本冲突或任一写入失败均拒绝保存。玩家可以保留表单修改，或放弃后重新读取。
- 成功写入时保留当前已绑定行动、更新草稿版本与管理修订，清除基于旧状态的未结算候选。旧请求不能覆盖保存结果。正式回合号和 Journal 不会因手动修订增加。历史节点及撤回恢复各自时点的状态。

## 审查位置

| 部分 | 涉及文件 |
| --- | --- |
| 称呼协议 | src/domain/npc/schema.ts、src/domain/variableCommands.ts、src/executors/variableText/{catalog,compile,diagnostics}.ts |
| 提示上下文、命令目录与校验 | src/prompts/npcContext.ts、src/services/validation/{aiOutputs,commandCatalog,variableWork,worldOutput,worldSceneWrites}.ts、commandCatalogSchemas.json |
| 手动事务与同伴档案 | src/domain/playerVariables.ts、src/services/storage/saveRepository.ts、src/services/local/companionProfile.ts |
| 设置与工作台 | src/app/App.tsx、src/ui/settings/{SettingsPanel,VariableManager,VariableTree}.tsx、variableSections.ts、variable-manager.css |
| 验证 | e2e/player-variables.spec.ts、src/tests/{player-variables,variable-sections,talent-context,text-prompt-readiness}.test.ts、src/tests/fixtures/talent-addressing-prompt-baseline.json |

## 浏览器验收

真实 React + Chromium 154，使用合成存档及 Mock Story。桌面 1440×1000，手机使用 Playwright Pixel 7 视口。测试使用真实 SaveRepository 与 IndexedDB。

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 分区布局、递归编辑年龄、路径登记表选中 NPC 布尔字段、分区 JSON、未加入的草稿保护、差异审阅、放弃后校对整份正式状态及零模型请求 | 通过 | 通过 |
| 双向称呼、非法 JSON 保留、放弃、跨标签锁拒绝写入并保留差异、解锁保存、刷新、关闭 Variables 后读取真实出站正文消息、在途请求阻止手动写入 | 通过 | 通过 |

| 截图 | 桌面 | 手机 |
| --- | --- | --- |
| 变量工作台 | [桌面](desktop-workbench.jpg) | [手机](mobile-workbench.jpg) |
| 路径登记表 | [桌面](desktop-registry.jpg) | [手机](mobile-registry.jpg) |
| 双向称呼保存前的差异 | [桌面](desktop-variable-changes.jpg) | [手机](mobile-variable-changes.jpg) |
| 暂停时的早期实现 | [桌面](initial-desktop.jpg) | [手机](initial-mobile.jpg) |

已验证本地持久化、请求边界与出站上下文。手机证据来自 Chromium 仿真。未覆盖 iOS Safari 或真实模型对称呼的遵循率。

## 工程验收记录

基线 main 为 `6ea62b15fc4ce46183bdabe1ff45b89a4b0ce1ae`。沿用暂停时的分支和四个提交，工作台提交为 `1250ae6`，最终界面及 Chromium 截图对应 `1bf8891051cc0c3d7e65f884e02be7277524da08`。最后一个文档提交仅附验收材料。

| 命令 | 实际结果 |
| --- | --- |
| Node 24.19.0 · npm ci | 当前工作树按锁文件安装 148 个依赖，退出 0 |
| npm run catalog:check | World / Variables 展示目录与运行时 Schema 一致，退出 0 |
| npm run prompts:check | 3 个文件、93 项通过，退出 0 |
| npm run check | 文件名检查、Lint、199 个 Vitest 文件共 4,790 项、TypeScript 及生产构建通过，退出 0 |
| CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/player-variables.spec.ts --workers=1 --reporter=line | 最终桌面 2/2、手机 2/2，退出 0 |
| git diff --check | 通过，退出 0 |

专项测试包含在上述成绩中。首次 Lint 指出了未使用的导入，已移除。受限沙箱下公告和文件名测试创建子进程时遇到 EPERM；在允许本地子进程与测试监听的环境中重跑了整个 check。截图复查发现设置主分类占用桌面编辑空间，以及选中页签悬停时混入浅色背景；最终双端测试覆盖分类收起、编辑区尺寸、选中页签实际颜色和操作流程。

## 称呼校验返修

按变量与 World 内容审查移除决策，删除了文本命令解析和 JSON 候选重验中的正文逐字检查。命令示例保留两个方向的含义和省略字段的合并规则。沿用 Schema、人物引用、阶段写入权限及存档事务。

生产校验修改前，文本单向更新、JSON 双向更新和 JSON 新建人物三条合法场景均失败。返修后均能结算，错误类型和不存在的人物继续被拒绝。逐条对比开局及普通 Variables 的组装结果，只更新称呼示例对应的快照；天赋用例中的 World 请求保持原值。

Node 24.19.0 验证：定向 Vitest 222 项，Prompt 93 项，Chromium 桌面和手机模拟各 2 项均通过。首次全量运行中，撤回测试子进程被 SIGKILL。使用 2 个 Vitest Worker 重新执行完整检查，199 个文件、4,793 项全部通过，Lint、TypeScript、命令目录检查和生产构建通过。
