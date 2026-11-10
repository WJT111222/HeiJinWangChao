# 开局包 V1

基线：`main@947110ceeb751801c043ceeab1b5c9ce5cc47033`。分支：`feat/creation-opening-packs-v1`。

## 数据与调用路径

原五步创角仍以 `CreationSchema` 为正式表单协议，`App.changeForm()` 将当前草稿保存到 `heijin.creation.v1`，`createProfileSave()` 负责原有正式建档及开局草稿。本次不改变这些路径。

新增 `src/ui/creation/openingPacks.ts`：

- `OpeningSettingsSchema` 从完整 `CreationSchema` 排除 `version`、`saveId`、`worldClock`、`openingTimePending`、`step`。其余玩家表单字段完整保存，包括 `customProfile`、职业分类、技能模式、外貌/性格模板、关闭同伴后仍留在表单中的资料。
- `OpeningPackSchema` 为独立版本 1 文档：`{ version, id, name, settings }`。每份包使用 UUID，名称不是身份；同名包可以独立存在。
- 每份包独立存于 `heijin.opening-pack.v1:<UUID>`，复用 `readDocument` / `writeDocument`，没有共享数组或索引，不触碰 IndexedDB 或原草稿键。
- `openingSettings()` 先验证完整表单结构及原有第1～4步要求，然后提取可编辑字段。自由文本不 trim、摘要、截断或按行归一化；只有包名称去首尾空白并限制80字符。
- `applyOpeningPack()` 通过 `newCreation()` 重建当前身份和开局待定时钟，恢复完整设置并令 `step=5`。Zod 解析产生独立对象，后续编辑不会反写原包。

`OpeningPacks.tsx` 只连接 `CreationWizard` 的 `onChange`。第五步保存不调用 `onCreate`；第一步套用也不创建正式存档、不调用模型。套用之后走原 `App.changeForm()` 自动保存机制。只有原「确认并创建存档」按钮进入现有建档和自动开局流程。

## 操作与保护

- 第一、第五步分别提供「我的开局包」「保存为开局包」，复用现有 `Dialog`、黑金样式和键盘焦点处理。
- 套用前总是明确确认替换当前创角草稿；取消不改变表单。套用确认时重新读取目标，避免使用已被其他页面删除的缓存包。
- 新建始终创建独立 ID；覆盖需要先选择「覆盖：…」，再独立确认。重命名与删除针对指定 ID；删除有永久删除确认。
- 逐份读取损坏或不受支持的包，显示无法读取数量并保留原始数据，其他合法包仍可使用。存储本身不可访问则显示操作失败，不将其当作空列表。
- 单份 localStorage 写入或删除失败会抛出异常，UI 不显示成功。不会清空整个包库、其他包、设置或创角草稿。
- 名称与表单采用严格白名单 Schema，不读取或复制 AI 配置、凭证、GameState、正式运行数据。
- 原有未完成草稿的恢复规则不变：返回首页再进入会继续原步骤；可点击「基本信息」选择包。完成一次正式建档后，下一次新创角正常从第一步开始，可直接套用旧包。

## 第五步核对

保留原人物、职业、城市、背景和同伴核对；补充模板选择和可展开的「完整职业表单」，展示原始技能文本、自动/手动模式、职业分类、自定义职业字段及切换职业时保留的 `customProfile`。长文本在核对区内部滚动，不删除后续文字；开局偏好仍在原 textarea 中完整可编辑。

没有改动 GameState V6、正式存档/草稿 Schema、IndexedDB 结构、Prompt、AI 路由、三阶段、Commit、撤回、NPC 或记忆系统。旧创角草稿不需要迁移；旧客户端不认识独立新键，不会因新包改变正式存档读取。

## 验证记录

所有模型相关测试使用本地 Mock；新增开局包完整 UI 流程拦截外部请求并断言0次。未调用真实付费 API、未访问玩家真实存档。

- 首轮定向 Vitest：73项，71通过、2失败。发现可选字段被提取为显式 `undefined` 的键差异，改为仅提取实际存在的字段；另一个测试误用 `playerInput`，修正为现有草稿字段 `userInput`。
- 定向复测：`npx vitest run src/tests/opening-packs.test.tsx src/tests/character-creation-v2.test.tsx`，73/73通过，0失败、0跳过；其中新增12项。
- 新功能浏览器首轮：桌面4、手机4，共8/8通过，0失败、0跳过。
- 工程及扩展浏览器结果如下，各批次分别统计，不累加为一次结果。

| 批次/命令 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| 定向 Vitest 复测（上述2文件） | 73 | 0 | 0 |
| `npm run check` 中完整 Vitest（105文件） | 2888 | 0 | 0 |
| `npm run prompts:check`（3文件） | 93 | 0 | 0 |
| Chromium 扩展主批次 desktop | 20 | 0 | 0 |
| Chromium 扩展主批次 mobile | 20 | 0 | 0 |
| 最终补强流程定向复测（desktop 1 + mobile 1） | 2 | 0 | 0 |

扩展主批次命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/opening-packs.spec.ts e2e/character-creation-v2.spec.ts e2e/opening-life.spec.ts e2e/opening-time.spec.ts --project=desktop --project=mobile --reporter=json
```

该批次40/40通过，0失败、0跳过，无自动重试；包含开局自动三阶段、时间初始化、失败后恢复、刷新不重发与下一回合行为。完整工程检查的 ESLint、TypeScript 和 Vite 生产构建均通过。构建仍有已有的500kB分包体积提醒，本轮不扩张为代码拆分任务。

随后仅对补强的「完成正式建档后，再次从第一步套用」断言执行两端定向复测：2/2通过，0失败、0跳过。命令为 `CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/opening-packs.spec.ts --grep '完整五步保存' --project=desktop --project=mobile --reporter=json`。随后再次运行 Lint、TypeScript 和 `git diff --check`，均通过；未重复全量 Vitest 或无关 Chromium 测试。

新增单元覆盖完整字段、约4万字符级长文本、职业切换/手动技能/同伴、同名独立管理/显式覆盖、fresh saveId/step5/时钟、损坏隔离、读写/配额/删除失败、修改不反写、fake-indexeddb 正式建档和开局偏好草稿隔离。浏览器覆盖实际手动五步、保存、套用取消和确认、返回职业修改、刷新、原建档、再次新创角、管理操作及存储异常。

## 修改文件

- `src/ui/creation/openingPacks.ts`：版本化协议、本地单包存储、全量提取与套用。
- `src/ui/creation/OpeningPacks.tsx`：保存、选择、确认替换、重命名、删除及显式覆盖。
- `src/ui/creation/CreationWizard.tsx`：两个入口、第五步完整核对。
- `src/app/styles.css`：仅包管理与核对区的布局、长文本滚动。
- `src/tests/opening-packs.test.tsx`：12项单元/真实 Repository 集成测试。
- `e2e/opening-packs.spec.ts`：4种场景，desktop/mobile各4项。
- `docs/OPENING_PACKS_V1.md` 及下方6张截图：本报告与真实双端预览。

已自查完整源码差异；现有创角模型、App 草稿/建档逻辑与正式存储代码均无改动。旧创角回归自动生成的其他截图已还原，不混入本 PR。

## 真实浏览器截图

| 界面 | 桌面 | 手机 |
| --- | --- | --- |
| 第一步选择 | [查看](opening-packs/screenshots/desktop-select.png) | [查看](opening-packs/screenshots/mobile-select.png) |
| 第五步全页/长文本 | [查看](opening-packs/screenshots/desktop-review.png) | [查看](opening-packs/screenshots/mobile-review.png) |
| 第五步视口 | [查看](opening-packs/screenshots/desktop-review-viewport.png) | [查看](opening-packs/screenshots/mobile-review-viewport.png) |

## 限制

包仅存当前浏览器本地，受 localStorage 配额、浏览器权限及用户清理站点数据影响；V1没有导入、导出、云同步或损坏包自动修复。损坏原文保留，但不提供不经验证套用。不同标签页对同一个包的显式修改仍采用浏览器同步存储的最后一次成功写入，不提供协同编辑；独立记录避免修改一份包重写整个库。

没有新增模型请求，也未用 Mock 结果宣称真实模型生成质量已验证。正式建档后原本已启用的自动开局授权与费用提示仍保持原行为。
