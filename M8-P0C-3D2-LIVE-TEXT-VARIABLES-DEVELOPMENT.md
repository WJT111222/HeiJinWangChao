# M8-P0C-3D-2：正式文本变量工作流接入

基线：`623cd2dc3156018d294b611a8f0fa1f17bf112d9`（PR #41）。分支：`codex/m8-p0c3d2-live-text-variables`。

## 接线与边界

旧：Story → Variables JSON提示词 / 原生JSON Mode → JSON领域命令候选 → World JSON → 原子Commit。

新：Story → composeTextVariablesPrompt / 文本请求 → parseVariableText → compileVariableCommands → simulateVariablePlan → 原VariableResultSchema领域命令候选 → World JSON / projectTurn → Commit重新验证 / 原子事务。

新Variables请求只发送一次。不解析JSON模型输出，不猜协议、不失败回退，不调用第二个模型；已保存JSON领域候选仍由原parseVariables同步复核。Story和World执行器、保存CAS、StageGuard、提交回执和存档Schema沿用原实现。

原生JSON Mode只用于World/Memory，Story原协议保持不变；OpenAI/Gemini Variables不携带原生JSON格式参数，Anthropic维持现有构造。默认Composer/模块状态和正式Runtime都选择.text Variables，九域选择不变，World/Story使用各自原资源。

## 说明与安全

说明正文不写入存档/候选/公开日志，不变成命令或客观事实。出现说明时仅在既有unresolved中保留固定安全提示：只有列出的领域命令通过模拟，说明未执行。不会复制其中的NPC秘密、凭证或供应商响应。语法、映射和模拟失败使用静态错误码及安全位置，不输出原文、动态ID或值。

开局编译器生成的opening-clock:storyRevision与variableCommandsForTurn使用相同规范身份和值；投影/Commit合并时归一为一条，不重复推进。

## 复现和阶段性验证

先加入正式runStageRequest三协议测试。原main对合法空文本命令块均以invalid_json拒绝（3/3失败），随后切换正式入口与JSON Mode后3/3通过。尚未完成全量验证；此记录不将历史结果当成本次通过。

## 已知缺口

未知现金/线上余额初始化、历史资产无交易登记、房产购买和部分NPC/组织字段没有原生命令，本轮不伪造收入/借款或任意覆盖。余额为null时交易仍安全失败；没有交易的开局允许空命令，只有程序时钟也可继续。完整场景、实际影响、文件清单和最终测试结果在收尾时补录。
