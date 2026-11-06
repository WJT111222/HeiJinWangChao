# AI 独立模型选择与未保存保护

## 问题与本轮边界

基线：`main@48590ac766fbe1b4043ce2a4e1aaea311d96b648`。本轮独立分支处理 AI 设置，未修改 Story / Variables / World 执行器、Prompt、游戏 Schema、事务或付费授权。

用户确认复选框恢复勾选发生在**未点击「保存 AI 配置」**后关闭设置。原实现将编辑留在 `AiConnections` 的组件状态，关闭或切换设置分类会卸载组件；再次打开读取的是之前已保存的配置。已保存配置的独立路由解析原本正确，不能将本次问题描述成浏览器持久化或生成路由故障。

同时确认另一条可复现问题：启用「跟随正文」会丢弃该阶段的独立选择；取消跟随后直接填入正文渠道和空模型 ID，实际可能使用正文渠道默认模型。这不符合玩家对各阶段独立设置的预期。

## 修改后的行为

- 正文、变量、动态世界和记忆维护可以分别选择渠道与模型。原默认值保留；「跟随正文」仍是玩家的显式选择。
- 启用跟随后保存原独立选择，关闭跟随时恢复原渠道与模型，包括空模型 ID 所表达的「使用渠道默认模型」。跨保存和刷新同样有效。
- 旧跟随配置没有独立选择时，关闭跟随后明确留空，提示玩家选择；不会默默复制正文配置。未配置的路由仍由原请求预检拒绝。
- 保存仍是显式操作。唯一的「保存 AI 配置」按钮放在路由区域后的吸底保存栏，显示未保存、失败或成功状态。
- 未保存时关闭设置、按 Escape 或离开 AI 分类，先显示「继续编辑／放弃本次修改」。继续编辑保留本次状态；只有明确放弃才丢弃。保存失败不会解除保护。
- API 密钥编辑也参与未保存提醒，但记忆独立选择的字段中只有渠道 ID 和模型 ID。
- 删除正在使用的独立渠道后，相关阶段保持独立模式并提示重新选择；不会自行切回正文。删除跟随模式中备份的渠道，只清除失效备份，不改变已明确选择的跟随模式。
- 浏览器刷新／离开注册 `beforeunload` 提醒。浏览器是否显示原生确认取决于平台、交互与进程退出方式，不能承诺移动系统强杀时保存未提交编辑。已经显式保存的配置可刷新恢复。

## 配置与生命周期

`heijin.ai.v1` 的 `follow-story` 路由增加一个可选字段：

```json
{
  "mode": "follow-story",
  "independent": { "channelId": "variables-channel", "modelId": "variables-model" }
}
```

只使用现有 `direct` Schema 验证 ID、模型格式和渠道引用，不新增密钥副本或第二套路由库。正在使用的路由解析及请求快照不变：跟随时使用正文；独立时使用本阶段。已有请求仍使用冻结快照。

新代码可以直接读取没有 `independent` 的旧 V1 配置，不在读取时改写存储；缺少旧版 memory 路由的默认语义保留。不涉及 GameState / TurnDraft 迁移。

**降级边界：** 早于本修复的版本使用严格配置 Schema，不能识别带有 `independent` 的新跟随配置。回滚旧前端或长期未刷新的旧标签页并非双向兼容，需先更新页面；本轮没有放松旧 Schema 或擅自擦除配置。此限制不影响新版本读取旧配置，也不涉及游戏存档和密钥记录。

`AiConnections` 仍是 AI 编辑状态的唯一所有者。`SettingsPanel` 只接收 dirty 状态并保护分类切换；`App` 接收同一个状态并保护设置关闭。确认弹窗复用现有 `Dialog`，没有新增生成控制器或维护 Hook。

## 复现与回归

修改生产代码前，新增的三个桌面浏览器用例均失败，分别证明：

1. 保存跟随并刷新后取消跟随，原独立模型未恢复。
2. 旧配置没有独立选择时，取消跟随被填为正文渠道。
3. 未保存关闭或切换分类，没有保留编辑的确认步骤。

修复后上述用例在 desktop/mobile 共 **6/6** 通过。随后补齐最终测试：

- 新增 Vitest **20 项**：三阶段备份／恢复、旧配置、默认模型语义、请求快照、删除渠道、严格字段和引用验证。
- 新增 Playwright **8 个场景 × 2 项目 = 16 项**：保存／刷新、空选择、关闭／分类保护、Escape／放弃／密钥、非法配置／写入失败、真实 Mock 路由、窄屏保存栏、删除渠道。
- 四路路由测试实际调用现有 `runStageRequest`（Story/Variables/World）及 Memory 客户端，Mock 断言四个请求各自的 URL 和模型；不只检查 UI 复选框。
- 原 `ai-client.test.ts`、`memory-compression.test.ts` 的删除渠道断言更新为「保持独立、等待配置并拒绝请求」，替代旧自动跟随行为；其他断言未削弱。全量工程初跑发现记忆测试仍断言旧的自动跟随行为，核对调用链后按新的显式选择规则修正断言，没有修改记忆维护逻辑。

## 验证记录

所有模型请求均使用 Mock，无真实付费 API。以下均为本分支本次执行，不能与历史诊断结果相加。

| 检查 | 结果 |
| --- | --- |
| `vitest run` 定向：路由持久化、AI Client、模型列表缓存 | 61/61 通过 |
| AI 设置定向 Chromium：路由持久化、模型选择、AI 设置 | desktop 17/17 + mobile 17/17，共 34/34 通过 |
| `npm run prompts:check` | 82/82 通过 |
| 单独 `npm run lint`、`npm run typecheck` | 通过 |
| `npm run check`（Lint、全部 Vitest、类型检查、生产构建） | 最终结果待完整执行完成后填写 |
| 完整 desktop/mobile Chromium | 最终结果待完整执行完成后填写 |
| `git diff --check` | 当前通过，交付前再核对 |

完整浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test --project=desktop --project=mobile
```

本地运行增加 line/json reporter 仅用于准确统计和保留日志，不筛选、跳过或重试失败用例。新增保存栏测试产生 `ai-route-save-bar.png` 桌面与移动截图，验证保存按钮和未保存提示可触达且没有横向溢出。

## 文件清单

- `src/services/ai/configuration.ts`：独立选择备份、恢复和删除渠道语义。
- `src/ui/settings/AiConnections.tsx`：复选框、保存栏、说明、dirty 与刷新提示。
- `src/ui/settings/SettingsPanel.tsx`：分类切换保护及 dirty 传递。
- `src/ui/settings/UnsavedAiChanges.tsx`：共用离开确认。
- `src/app/App.tsx`：首页／游戏设置关闭保护。
- `src/app/styles.css`：保存栏的有限布局样式。
- `src/tests/ai-route-persistence.test.ts`、`src/tests/ai-client.test.ts`、`src/tests/memory-compression.test.ts`：配置与路由回归。
- `e2e/ai-route-persistence.spec.ts`：桌面／移动设置与实际 Mock 请求回归。
- 本报告。

## 费用与未验证边界

勾选、取消勾选、恢复配置、打开关闭设置均未新增生成请求。显式保存后的模型列表 GET、手动连接测试和游戏生成保持已有规则。本轮不增加收费调用、自动恢复或重试。

不把 Mock 通过表述为供应商实机验证；未调用真实平台。多标签页同时编辑 AI 配置仍沿用原来的最后一次显式保存语义，未在本轮新增跨页编辑锁。未主动部署生产环境；PR 预览环境由现有 Cloudflare 自动流程部署（实际状态以 PR 检查为准）。
