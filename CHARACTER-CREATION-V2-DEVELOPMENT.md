# 主角创角系统 V2 第一轮开发报告

## 基线与范围

- 基线：`main@9df66da671565b90f8b34ecc34b863a351a66e98`，PR #70 合并后的 V6。
- 分支：`codex/character-creation-v2`。
- 只改基本信息、外貌/性格模板、职业选择与主角职业档案。城市、背景、同伴、经济、事件、物品、模型路由、三阶段顺序及存档事务未重构。

## 页面和模板

过去：性别自由输入；外貌/性格无模板；16 个职业大卡片全部展开；职业技能是一段能力说明；确认与人物档案只有职业名称、技能。

现在：

- 性别只有男性、女性两项，继续验证姓名、非负整数年龄；正式主角保存所选中文值，NPC Schema 不变。
- 外貌、性格各有默认「自由选择」及六套完整文字模板，采用已有主题选择器。选择模板填入对应文本，可继续编辑；跨步骤和刷新保存当前编辑。模板名称不进入正式人格属性，不限制行动。自由选择保留当前文字，选择另一预设才会替换该栏。
- 自由职业为默认选项。五个方向每个恰好六职业，只展开当前方向的六个按钮。方向导航不改变已选职业。
- 30 套职业独立撰写：介绍 120–129 字、长期影响 119–130 字，技能 3–5 项独立字符串。没有用职业名称拼接同一段通用说明。
- 自定义名称、介绍、每行一项的技能、长期影响独立填写。离开自由选择时保存其草稿，返回时恢复，不套用预设技能。预设之间切换保留玩家编辑过的技能；自动技能随预设变化。自定义与预设技能分开，避免交叉污染。
- 确认页和游戏人物档案复用 `ProfessionProfile`，完整显示职业介绍、技能和长期影响。移动端职业按钮两列，长说明改为标签在上、正文在下，无横向溢出。

截图（浏览器 Mock 实测）：

| 页面 | 桌面 | 手机 |
| --- | --- | --- |
| 基本信息 | [桌面](docs/screenshots/character-creation-v2/desktop-basics.png) | [手机](docs/screenshots/character-creation-v2/mobile-basics.png) |
| 预设职业 | [桌面](docs/screenshots/character-creation-v2/desktop-professions.png) | [手机](docs/screenshots/character-creation-v2/mobile-professions.png) |
| 自定义职业 | [桌面](docs/screenshots/character-creation-v2/desktop-custom.png) | [手机](docs/screenshots/character-creation-v2/mobile-custom.png) |

## 正式数据流

```text
CreationWizard → 自动保留的创角表单
  → buildCreationState → SaveRepository.create → GameState.protagonist
  → Story 开局/普通回合的 SAVE_STATE（开局另有 CREATION_PROFILE）
  → Variables 当前 SAVE_STATE → 文本命令 → UpdateProtagonist → projectTurn
  → World 的 PROTAGONIST_PROFILE（取同一候选投影）
  → 既有自动 Commit 与保存/重载
```

正式主角仅新增两个可选字符串：`professionDescription`、`professionLongTermImpact`。名称仍用 `profession`，技能仍用 `skills: string[]`，没有第二套职业技能数据库。未改变 V6 版本、迁移、CAS、候选/正式状态边界及回执机制。

既有 Story 和 Variables 已传递完整主角对象，无须复制模板到上下文。World 原先只收到受保护主角 ID，现补只读 `PROTAGONIST_PROFILE`：ID、姓名、职业四项资料；从 `projectTurn` 的结果读取，不扩大 NPC 私人资料访问。

模板不会自动创建收入、余额、企业、资质、执法权限、物品或其他资产；这些仍由原有开局和领域流程处理。

## 后续合法维护

复用 `UpdateProtagonist`，新增精确文本路径：

```text
set protagonist.professionDescription = "在琴行处理日常调音与维护。"
set protagonist.professionLongTermImpact = "长期与演奏者协作。"
```

同时改职业时推荐同一对象命令：

```text
set protagonist = {"profession":"调音师","professionDescription":"在琴行调音。","professionLongTermImpact":"积累演奏者联系与听音经验。"}
```

只更改名称且确实不同，会清空旧职业介绍/影响；同一命令内提供的新资料正常保存。也可先改名称、随后补新资料，全部沿原命令顺序执行。相同名称不清空说明；技能不因职业名称变化被删除。若先写说明、再在后面的独立命令改名，前述说明会被清空，因此 Prompt 明确建议同步对象更新。这是数据关联处理，不对职业文字进行语义判断。

更新了主角 init/update 两个变量组说明及 Manifest 哈希，文本目录从 73 增为 75 条；没有重写主模板或改变请求协议。普通类型、引用、版本和原子模拟规则全部保留。

## 兼容边界

- 新字段可选，不要求重建现有 V6 存档；缺少字段的个人档案显示「未填写」，读取不会自动补写模板。
- 创角表单增加选择状态及自定义草稿，仅属于本地表单；正式存档只保存最终人物描述，不保存整套模板或选择状态。
- 未做旧性别自由文本创角表单迁移；继续创角时需选择男性/女性。NPC 性别与现有正式主角资料不会被自动改写。
- 自定义职业只要求合法的非空名称，介绍、技能与长期影响可留空；没有任意技能数量上限、职业等级或剧情审批。

## 测试与修复记录

新增 `character-creation-v2.test.tsx` 61 项：模板结构、30 职业资料、可编辑文本保存、自定义隔离、确认/档案完整展示、IndexedDB 重载、各阶段实际 Composer、字段/对象更新、Commit 重验、精确重放及非法字段拒绝。

原 `m2` 两组参数测试各由 16 职业扩展到 30，新增 28 个执行用例。原16职业/自由性别/单段技能断言按本轮产品要求调整；没有删除事务或经济安全断言。开局人生集成测试另外验证职业资料经过真实协调器的六次 Mock 请求及两个正式回合仍保持完整。

新增浏览器三场景，桌面/手机各执行一次：全部外貌/性格模板、全部30职业、自由职业保留/创建/档案/刷新、键盘与窄屏。更新六个既有浏览器文件的创角操作：性别改为单选，教师先选职业方向，原断言继续保留。

开发中发现并处理：

1. 旧测试仍断言16职业、73路径及使用自由性别字符串，按新协议更新为30职业、75路径与明确性别选择。
2. 新回归错误地要求开局后的健康/位置也不改变，改为只检查职业四项资料，原合法初始化和经济断言保留。
3. 新重放测试曾直接使用旧模拟计划，正确触发版本冲突；现在同时断言旧计划拒绝、重新编译的精确重放幂等。
4. 浏览器测试第一次加载因 Node JSON 导入属性缺失未执行，修正测试模块导入。
5. 浏览器第二批2通过/4失败：带初始文字的 textarea 包含在 label 内，精确标签定位混入正文。为涉及的新编辑控件添加明确 `aria-label`，第三批6/6通过。
6. 截图复核发现原全局 label 的纵向排列让职业按钮偏高，局部改为横向排列，并加宽手机职业详情正文。重新运行受影响浏览器集合确认。
7. 新提交测试初次使用非初始状态创建存档，被 `INITIAL_VERSION` 正确拒绝；改为从新开局走候选到正式 Commit。只修测试夹具，没有放宽领域规则。

8. 续跑时已提交代码、报告和截图都在，远端确认分支为 `8934b01a0130f29a022af417a2060d92c063aa28`，main 仍是本报告基线。上轮临时控制台日志未保留，但 Playwright `.last-run.json` 及 Trace 留下两项失败：桌面/手机的“设置、历史检索及创角长页仍可滚动”。原因是默认自由职业下没有预设的“个人技能与专长”框；测试现在确认默认自由选择，并检查对应“内置职业技能”，保留页面滚动断言。没有修改业务逻辑或降低领域校验。
9. 本轮重跑126项，首次结果125通过、1失败（桌面端多次协议失败恢复）。Trace确认用例等待的泛用 `schema_fields` 命中了旧 Variables 错误，提前替换尚未返回的 World Mock，最终已结算却继续找恢复按钮。现在等待属于“动态世界”的本次 `schema_fields`，并核对请求顺序，才修改下一份 Mock。首次修正尝试等待 `timelineCandidates.0`，两个定向用例失败：V6 将该废弃字段按根结构拒绝，不返回该字段路径；因此改为定位实际 World 错误条目。没有调整产品规则、等待时限或跳过断言。
10. 在上述测试时序修正后，重新核实工程检查、提示词检查及同一组126项浏览器回归。日志与 JSON 汇总保存在工作区 `character-creation-v2-verification/`，首批失败日志及 Trace 留在 `batch-one/`，不以历史成绩替代本轮结果。

### 本轮最终验证（2026-11-08，全部 Mock）

受测代码提交为 `aed8ce478b2bd188bc4a4797f05a6d8fb6adedb7`。最终交付再提交本报告与六张截图，不改变受测代码。

- `npm run check`：80 个文件、**2492 项测试通过**。其中新增专用测试61项、原参数测试扩展28项，共增加89项；原基线2403项保留，并按新UI协议更新相关输入断言。
- `npm run prompts:check`：3个文件、**82项通过**（属于工程测试的子集，不重复累计）。
- Lint / TypeScript / 生产构建：全部通过。Vite 提示入口 chunk 大于500 kB，属于非阻断体积提示，本轮未扩展到拆包优化。
- `git diff --check`：通过。
- 修正后的失败恢复场景定向复测：桌面、手机各1项，**2/2通过**；保留原存档不变、完整请求顺序、最终仅一次结算与重载断言。
- Chromium：以下8个完整相关文件的desktop/mobile批次，**126/126通过**，耗时8.7分钟，无grep/skip。桌面63通过、0失败、0跳过；手机63通过、0失败、0跳过。JSON汇总 `expected=126, unexpected=0, skipped=0, flaky=0`。

```bash
CHROMIUM_PATH=/usr/bin/chromium CI=1 \
  PLAYWRIGHT_JSON_OUTPUT_FILE=/workspace/character-creation-v2-verification/browser-results.json \
  npx playwright test \
  e2e/character-creation-v2.spec.ts e2e/game.spec.ts \
  e2e/action-workflow.spec.ts e2e/continuous-turns.spec.ts \
  e2e/opening-life.spec.ts e2e/opening-time.spec.ts \
  e2e/game-window.spec.ts e2e/automatic-settlement.spec.ts \
  --project=desktop --project=mobile --reporter=line,json
```

本轮工程日志、提示词日志与浏览器逐项日志分别保存于工作区 `character-creation-v2-verification/check.log`、`prompts.log`、`browser.log`。未运行无关的其他浏览器测试文件；未使用真实模型。

## 限制与费用

- 所有模型响应为 Mock；这证明资料传递、存储和事务行为，不代表真实模型必然遵守职业背景、写出优质剧情。
- 自定义文字仍按现有文本策略处理，不增加职业内容审查；职业资料变长会增加已有请求的上下文长度，但没有新增 AI 请求、重试或维护任务。
- 不开发职业履历/转职系统；职业长期影响是叙事背景而非确定收益或属性加成。
- 只运行受影响浏览器文件，不把定向结果描述成全部浏览器套件通过。
- 未主动部署生产环境；PR 预览如运行，由仓库现有自动流程处理。保持 Draft，等待审查。

## 修改文件

- `CHARACTER-CREATION-V2-DEVELOPMENT.md`
- `docs/screenshots/character-creation-v2/desktop-basics.png`
- `docs/screenshots/character-creation-v2/desktop-custom.png`
- `docs/screenshots/character-creation-v2/desktop-professions.png`
- `docs/screenshots/character-creation-v2/mobile-basics.png`
- `docs/screenshots/character-creation-v2/mobile-custom.png`
- `docs/screenshots/character-creation-v2/mobile-professions.png`
- `e2e/action-workflow.spec.ts`
- `e2e/automatic-settlement.spec.ts`
- `e2e/character-creation-v2.spec.ts`
- `e2e/continuous-turns.spec.ts`
- `e2e/game-window.spec.ts`
- `e2e/game.spec.ts`
- `e2e/opening-life.spec.ts`
- `e2e/opening-time.spec.ts`
- `prompts/manifest.json`
- `prompts/variableGroups/protagonist/init.md`
- `prompts/variableGroups/protagonist/update.md`
- `src/app/styles.css`
- `src/domain/protagonist/schema.ts`
- `src/domain/variableCommands.ts`
- `src/executors/variableText/compile.ts`
- `src/executors/variableText/diagnostics.ts`
- `src/prompts/context.ts`
- `src/tests/character-creation-v2.test.tsx`
- `src/tests/m2.test.ts`
- `src/tests/minimal-validation.test.ts`
- `src/tests/opening-initialization.test.ts`
- `src/tests/opening-life-workflow.test.ts`
- `src/tests/opening-time-review.test.ts`
- `src/tests/opening-time.test.ts`
- `src/tests/prompt-runtime.test.ts`
- `src/tests/text-prompt-readiness.test.ts`
- `src/ui/components/ProfessionProfile.tsx`
- `src/ui/creation/CreationWizard.tsx`
- `src/ui/creation/model.ts`
- `src/ui/creation/personTemplates.ts`
- `src/ui/creation/professions.json`
- `src/ui/game/GameScreen.tsx`
