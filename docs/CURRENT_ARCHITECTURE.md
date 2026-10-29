# 当前架构速览（V1.0 可玩里程碑）

> 快速接手索引，核对基线为 2026-10-24 `main@9176ed6`（合并 PR #25）。**这是文档快照，不替代当前源码、Schema 或测试**；以后请先读取最新 main。

## 应用与状态

- React 19、TypeScript、Vite、Zod、IndexedDB；开发与测试使用 Vitest / Playwright。入口参见 `src/ui/`，存档参见 `src/services/storage/saveRepository.ts`。
- 现行正式 `GameState` 为 **Schema V5**（`src/domain/state.ts`）；`src/services/storage/migrations.ts` 管理旧档迁移。**产品 V1.0 与内部存档 Schema V5、npm 包版本 0.1.0 不是同一概念**。
- `TurnDraft` 与正式 `GameState` 分离，正文、变量、世界阶段先形成候选。提交由 `SaveRepository.commitTurn` 统一验证并原子结算，绑定下一回合草稿；CAS、StageGuard 和 Web Locks 限制重复提交、迟到响应及跨标签并发。核心结算见 `src/domain/turnCommit.ts`、`src/services/validation/turnCommit.ts`。
- 普通历史的正式 `journal` 不因提示词窗口、记忆压缩或重 Roll 直接删除。

## AI 流程与提示词

```text
角色/正式状态 + 当前玩家输入
    → Story（正文/短期摘要/变量指导候选）
    → Variables（VARIABLE_TEXT_V1 → 编译与模拟 → 严格领域命令候选）
    → World（场外 NPC/组织/任务/事件候选）
    → 校验和原子提交 → 新的正式状态与草稿
```

- 运行时 Prompt 正文的唯一来源为 `prompts/` 与 `prompts/manifest.json`，装配代码在 `src/prompts/`，三协议客户端在 `src/services/ai/`。不要将历史汇编 Markdown 直接当做当前注入文本。
- 开局 9 步 `prompts/planning/opening.md`，普通 15 步 `prompts/planning/regular.md`，属于项目专用的 **`<thinking>` 叙事规划标签**；供应商公开的原生 Thinking 单独解析和临时展示，均不写入正式状态或作为世界事实证据。详见 PR #23。
- API 路由区分 **Story、Variables、World、Memory**，允许单独选择渠道/模型或跟随 Story；PR #25 已完成模型列表 UI，PR #27 已合并同源列表兼容、分页与诊断；最终加固和真实服务限制见 [M6 状态](API-MODEL-LIST-COMPATIBILITY.md)。
- 输出经Zod、领域引用、经济、时间、权限及版本保护；Variables没有额外文学事实审批，World保留来源与角色知识隔离。模型结果仍是候选，不直接结算。

## 世界与记忆

- `worldClock` 是唯一正式游戏时钟；时间推进预检在 `src/domain/timePreflight.ts`。Story结构化开局时间由程序规范化；普通回合不设置固定步长，合法零耗时允许，非法日期或倒退被拒绝；严格限定的他人纯过去视角不改变当前状态。隐藏事件不得因时间预检泄露。
- 公开记忆与历史检索见 `src/domain/memories/`；记忆维护为额外可授权任务，自动付费维护默认关闭。NPC 私有总结须按人物身份和来源隔离。
- 世界客观事实、转述（reported）、怀疑（suspected）、个人知识和玩家可见信息必须分层。未核实报告不能经“任务已完成”自动变成世界事实。
- **NPC 安全退场（PR #22）**：终态任务可释放活跃调度，成果可交接。符合严格条件的非联系人 NPC 允许从活跃 `state.npc` 移出，保留 `retiredNpcs` 身份和必要历史；正式联系人、初始同伴、现场/有职责或活跃引用的 NPC 受保护。部分未选私有材料会被清理，不应声称全量永不删除。

## 安全、局限与下一步

- 浏览器本地存档不是账户云备份；清站点数据可能损失进度。密钥/请求内容、项目规划与 NPC 私密信息不得写进公开调试文档。
- Cloudflare 当前 `wrangler.jsonc` 配置静态 `./dist` 资产；**不能据此宣称有安全的动态 API GET 代理**。
- 测试记录主要是 Mock/本地浏览器执行，真实付费模型兼容、长时间游玩和完整导入/回滚需单独核实。
- 已合并：M0～M5-P6、PR #25、PR #27 模型列表主体。当前专项：M6 列表最终加固与验收。未来 M7 UI/UX 和 Issue #6/#24 需求均未自动排期。

历史设计稿及 `M*-DEVELOPMENT.md` 保留可追溯性；**实现以最新 main 为准**。

## 当前事件生命周期更新

本节优先于上述历史里程碑快照及V0.1旧稿中的“结束时间或条件”Event规则。新事件必须有estimatedEndAt、backgroundText、goalText和参与者；Task仍是dueAt或completionCondition。World在同一请求读取EVENT_SCHEDULE，处理正式→变量投影窗口及积压事件，到期不自动成功。终态普通事件可DeleteEvent；重大且公开的实际结果可ArchiveEvent/时间线，隐藏结果不自动公开。Schema V5以retiredEvents保留最小身份和必要成果引用，V1–4迁移仅加空表，不补日期、不改revision。Variables的events[id].sceneState仅更新已有现场状态。完整边界见[事件生命周期](WORLD_EVENT_LIFECYCLE.md)。
