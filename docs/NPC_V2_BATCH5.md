# NPC V2 第五批：统一人物名录与金色星标

基线 main：`651819a642c197bc81984e48cfbc4c261bc13ea0`（PR #99 合并）。独立分支：`feat/npc-v2-directory`。

## 源码审计与范围

原 `Panels.tsx` 将人物分页后再分普通／特殊两组，搜索不含别名；详情同时渲染联系人保护文案、原始 WorldRecord、稳定身份和记忆来源 ID。它没有玩家重要性管理接线。

本批提取 `NpcPanel.tsx` 替代该分支；沿用 GameScreen 的 Dialog、资料坞与手机世界目录。正式 V9、IndexedDB、迁移、NPC/记忆 Schema、命令、Prompt、四级上下文、记忆维护与三阶段／撤回事务未改。

## 名录与双端阅读

- 一个正式人物名录，包括普通、特殊、初始同伴、在场与离场人物；按实际 kind 显示 ☆/★，不创建联系人分类。
- 姓名、别名、身份／职业不区分大小写检索，全部／特殊／普通筛选；搜索筛选只改变 React 显示状态。每页20人，分页不裁剪正式数据。
- 名录仅显示姓名、身份、关系简述、在离场和最近互动，长背景、技能、记忆与关系网在右侧详情。
- PC 双栏独立滚动；手机列表→详情，有返回入口。900px 边界、原全局导航和游戏正文布局不改。对话框使用剩余高度分配滚动区，保存反馈不挤掉底部内容。
- 关系跳转及当前姓名仅按合法稳定 npcId 查找现有人物，关系记录保留旧别名也不误认他人；未建档对象只有姓名、关系与介绍，不新建人物。人物好感单向读取，不写回对方。
- retiredNpcs 仅显示可展开的历史身份姓名与退役时间，不复活档案或生成完整人物卡。

## 星标真实调用链

`NpcPanel.Star → useNpcManagement.change → changeNpcImportance → SaveRepository.setNpcImportance → 原管理事务 → onNpcManaged → App.setLoaded → playerView → NpcPanel`。

UI adapter 从当前正式 GameState 和草稿提供：saveId、expectedRevision、expectedManagementRevision（旧档缺省0）、expectedDraftRevision、expectedTurnId、npcId、identityKey、choice、每次用户操作独立的 operationId。传给 Repository 的不是 playerView 投影，因此不会把未确认好感 null 等展示值写入存档。

- 不做乐观星标更新；成功只接收 Repository 返回的完整 state/draft。
- 管理进行中共享 ref 锁与禁用态，避免快速重复点击；同时暂停 UI 发送／Roll／撤回等操作入口，避免它们使用尚未返回的草稿 CAS。没有取消已发出的模型请求。
- 工作流正在生成时，显示「当前回合正在生成，请完成或取消后再修改人物重要性。」；跨标签忙由既有 Web Lock／Repository 拒绝，UI 不绕过它。
- 版本／身份／草稿冲突后读 loadGame 并反馈失败；当前选择仍是稳定 ID，没有刷新路由或重建整个游戏。若人物已不在恢复后的正式状态中，安全回到无选择／名录状态。
- 写入失败不假报成功。事务任何一项失败，正式资料、草稿与控制记录沿用原原子回滚；重新读取也失败时保留当前显示并明确提示。
- App 接收管理结果时核对 saveId、正式 revision、管理计数、同回合草稿 CAS，拒绝较旧视图。增加同回合 onDraftSaved 的防倒退判断，以及 onMemorySaved 的管理计数匹配，防止迟到界面回调盖掉新的选择；不改持久化／执行规则。不同回合及旧基线草稿恢复仍沿用原接收路径。
- 后台记忆请求不被 UI 主动取消或重试；原持久 epoch 仍防止旧写入，尝试／失败／限流账本不清空。星标不调用 memory.run 或任何 AI。

首次加星显示 profilePending 说明，不伪造资料、不立刻生成。取消后由原事务休眠专属资料并保存 ordinary 偏好；再次加星恢复原档案。下一次正常 Variables 仍按第三批规则补齐，玩家取消优先权不变。星标不重算现有候选；若取消使旧升级命令不再合法，后续 Commit 仍会拒绝，保留 Story／候选供玩家使用原有阶段重试，不自动收费修复。

## 详情、知识与私密档案

基础身份、别名、年龄、性别、外貌、性格、背景、技能、健康、关系、好感、互动时间、当前位置、电话、常驻地点、知晓、原始记忆及总结均为正式资料的只读显示。缺省显示未记录／未知；初始同伴 affinityConfirmed 未确认时显示「尚未确认」，不把0占位写成事实。

电话严格使用 phoneContact 的 known/unknown/invalid，旧 contactNpcIds 和 contactReviewNpcIds 继续由存档兼容保留，但不推导电话或显示技术保护文案。常驻地点映射正式地点名称，并保留「世界记录／主角未知」与「主角已知」区分；没有新增拨号／寻人动作。

特殊人物当前激活时展示详细经历、目标、习惯、人物关系网、待完善状态与既有任务关联；任务从正式 actorRef 归属和 offscreenTaskIds 合并读取，不重复显示，不要求模型重复维护两套关联；普通人物完全不读取休眠专属资料。创角原始设定独立折叠展示人类可读字段，不替代当前状态。

香闺秘档沿用原 UI 资格：当前 special、female、年龄未知或18岁以上。七字段 bodyDescription、chestDescription、pussyDescription、isVirgin、firstExperienceTarget、firstExperienceTime、firstExperienceText 分别完整展示，保留换行与尾部空白；未知布尔值不当作否。取消后栏目消失，恢复后原样取回。未修改私密字段 Schema、首次经历保护或 Variables 生成提示词。既有恢复资格校验仍由领域层决定，失败不修改性别或年龄以绕过。

人物记忆仍是 npc.memories 与原 npcSummaries，同一个通用 RecordList 阅读／分页，不新增普通／特殊记忆双轨。原始文本、来源、认知性质、可见性和游戏时间不改。普通详情不再渲染原始 JSON：人物（包括旧退役身份）与组织引用转成已知姓名，回合转成「第N回合」，总结覆盖凭据转成「第N条人物原始记忆」。源 ID 留在正式数据中，界面不展示 id、identityKey、事务版本、偏好字段或复制ID按钮。其他既有调试／原文检查功能未删除。

## 实际验证记录

以下是独立批次，不相加冒充一次完整通过：

| 批次 | 通过 | 失败 | 跳过 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 新名录＋原重要性＋四级上下文，首次定向 | 41 | 2 | 0 | 测试将10回合状态传给只允许新档的 create；改为隔离 fake-indexeddb 安装合法正式状态 |
| 同一定向第二次 | 42 | 1 | 0 | 测试直接把 revision1 的选中草稿当初始草稿；改为先保存初始CAS，再保存选中候选 |
| 同一定向第三次 | 43 | 0 | 0 | 真实 Repository 休眠恢复、来源／草稿、锁及CAS、SSR真实组件均通过 |
| 新名录双端首轮 | 9 | 5 | 0 | 两项筛选可访问标签不明确；一项未限定手机双弹窗关闭按钮；两项新页未等待游戏界面渲染 |
| 新名录、重启、重要性、私密档案双端第二轮 | 22 | 2 | 0 | 仅重启后模型链未完成；测试没有恢复默认 sessionStorage 的 Mock 凭证，未改生产凭证策略 |
| 实际 Chromium 关闭／重启专项复测 | 2 | 0 | 0 | 新会话提供 Mock 凭证后，正常三阶段、资料补齐、Commit与撤回通过 |
| 完整 Vitest 首批 | 2982 | 0 | 0 | 包含原2976项与新增6项 |
| 首次完整相关双端118项 | 114 | 4 | 0 | 旧 game/npc-memory 用姓名正则同时命中查看与新星标按钮，改为精确操作名 |
| 任务关联补齐后的相关定向36项 | 32 | 4 | 0 | 两项空世界夹具还保留指向被移除人物的任务，Zod正确拒绝；两项旧World概览断言未进入现有详情。修正夹具及导航，不改生产校验 |
| 后续120项双端批次 | 118 | 2 | 0 | 桌面World返回按钮是手机专用却被无条件点击；手机撤回一次在变量保存仍进行中时超过原5秒等待。保留Trace与原断言，分别复测 |
| 旧game双端修正复测 | 8 | 0 | 0 | 现有PC／手机返回路径分别定位，历史旧史料与七面板阅读／焦点断言保留 |
| 原撤回文件隔离复测 | 18 | 0 | 0 | 未改原5秒断言，桌面／手机各9；原单次保存等待超时未再次复现 |
| 最终源码定向 | 43 | 0 | 0 | 含旧退役人物来源姓名映射及正式Schema验证 |
| 最终完整Vitest | 2982 | 0 | 0 | 最后只读姓名映射后重新完整执行，非沿用旧批次 |
| 最终提示词检查 | 93 | 0 | 0 | Prompt未修改，原协议仍通过 |
| 最终120项双端 | 120 | 0 | 0 | desktop 60/60、mobile 60/60；完整工程结束后单独执行，仍使用原断言与超时；无重试、无flaky |

最终 TypeScript、ESLint、生产构建与差异检查通过，构建保留既有大于500kB chunk提示。未为此扩大代码拆分范围。

初次 TypeScript 发现删除旧 NPC 分支后 RecordList import 未使用，已移除；未放松 noUnusedLocals 或 ESLint。所有失败日志、JSON报告与 Chromium Trace 保存于独立工作区，未把真实玩家资料放入夹具。

浏览器覆盖真实 React 点击、保存反馈、完整候选、跨标签过期视图、阶段请求忙、部分 IndexedDB 写入后失败回滚、未确认好感、未知地址、三种电话状态、关系跳转、七字段休眠恢复、零请求星标、刷新与 Chromium 磁盘用户目录关闭重启、正常三阶段、待完善状态清除、撤回和输入恢复。

重启专项不是仅复制 React 状态或 StorageState：它退出第一个 Chromium 进程，再用同一临时 userDataDir 启动第二个进程。测试使用独立目录、虚构资料与 Mock 凭证，结束后删除临时目录。默认会话密钥不承诺跨进程保留；测试仅在重启后手动提供 Mock 凭证用于接下来的模型网络拦截。

## 界面截图

均为真实 React／Chromium，不是静态设计稿；文件在 `docs/assets/npc-v2-batch5/`。

- desktop-roster.png / mobile-roster.png：统一名录。
- desktop-profile.png / mobile-profile.png：人物详情与星标。
- desktop-detail.png / mobile-detail.png：记忆与可读来源。

## 兼容边界与第六批

正式 V9 未升级，V6/V7/V8及旧撤回快照仍走主干既有迁移。旧联系人、初始同伴、历史身份、组织、任务、事件、统一记忆和休眠资料未迁移或删除。星标不会推进正式时钟、回合或 revision；独立管理计数与草稿CAS仍由原 Repository 管理。

- 未调用真实付费模型；Mock不能证明真实模型资料补齐的质量或内容，也不代表真实费用测量。
- 只做搜索、筛选、选择与星标，不开发拨号、人物图片、关系图谱、新的管理规则或新的记忆系统。
- 名录／记忆采用现有20条分页。超大长期存档的 playerView 构建仍读取完整正式资料，不以本批UI分页冒充上下文或存储节省；万人名录与真实移动设备软键盘压力留第六批进一步测量。
- 未增加跨标签实时广播；其他标签的修改在本次CAS冲突／重新读取后同步，不能把当前仍未刷新的卡片当作新的正式真值。
- 第六批承接真实长线联调、长期容量与真机阅读验收。不得因此改变第四批四级上下文或在UI中复制新的NPC真值。

保持 Draft，等待审查；不合并、不部署，不修改真实玩家存档。

## 实际修改文件

- `docs/NPC_V2_BATCH5.md`
- `docs/assets/npc-v2-batch5/desktop-detail.png`
- `docs/assets/npc-v2-batch5/desktop-profile.png`
- `docs/assets/npc-v2-batch5/desktop-roster.png`
- `docs/assets/npc-v2-batch5/mobile-detail.png`
- `docs/assets/npc-v2-batch5/mobile-profile.png`
- `docs/assets/npc-v2-batch5/mobile-roster.png`
- `e2e/game.spec.ts`
- `e2e/helpers/npcRoster.ts`
- `e2e/npc-directory-persistence.spec.ts`
- `e2e/npc-directory.spec.ts`
- `e2e/npc-importance.spec.ts`
- `e2e/npc-memory.spec.ts`
- `e2e/world-handoff.spec.ts`
- `e2e/world-observer.spec.ts`
- `e2e/xianggui-private-profile.spec.ts`
- `src/app/App.tsx`
- `src/app/styles.css`
- `src/tests/fixtures/npcRoster.ts`
- `src/tests/npc-roster.test.ts`
- `src/ui/game/GameScreen.tsx`
- `src/ui/game/npcManagement.ts`
- `src/ui/game/useNpcManagement.ts`
- `src/ui/panels/NpcPanel.tsx`
- `src/ui/panels/Panels.tsx`

## 最终执行命令

```sh
npm test -- --reporter=json --outputFile=/workspace/npc5-full-delivery.json
npm run prompts:check
npm run typecheck
npm run lint
npm run build
CI=1 CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/npc-directory.spec.ts e2e/npc-directory-persistence.spec.ts e2e/npc-importance.spec.ts e2e/npc-context-tiers.spec.ts e2e/npc-unified-memory.spec.ts e2e/npc-v2-foundation.spec.ts e2e/npc-memory.spec.ts e2e/xianggui-private-profile.spec.ts e2e/turn-undo.spec.ts e2e/undo-summary-recovery.spec.ts e2e/world-handoff.spec.ts e2e/game.spec.ts e2e/game-window.spec.ts e2e/memory.spec.ts e2e/world-observer.spec.ts --project=desktop --project=mobile --reporter=json
git diff --check
```

完整回归全部使用Mock。没有运行与人物UI无关的全量Chromium，也没有调用真实付费API。截图由上述真实浏览器生成；测试自动改写的其他旧界面截图会恢复，不混入本次PR。
