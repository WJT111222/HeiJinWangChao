# 主角背包 V2 开发与验证报告

## 基线与范围

- 开发基线：最新 `main@66dca1e8022db4d1e56c8e5b3ee21e746953833a`（PR #68 合并后）。
- 独立分支：`codex/protagonist-inventory-v2`。
- 本轮只改背包阅读、物品可选资料及其既有 Variables 写入路径；没有改变三阶段顺序、模型路由、自动结算、存档事务、CAS、记忆或事件规则。
- 未调用真实模型、图片生成或估价 API。所有模型回归均为 Mock。未修改真实玩家存档，不合并、不主动部署生产环境。

## 页面改造

此前物品栏将 `playerView.items` 中的世界物品全部列为大卡片，附带原始持有人资料和整份经济记录。现在只展示 `ownerRef.kind === 'protagonist'` 且 `ownerRef.id === protagonist.id` 的物品；其他页面的世界观察投影没有改变。无主物品、NPC 物品、组织物品都不会进入背包。

桌面左侧为六项筛选，右侧为自适应网格；手机使用顶部横向滚动筛选及双列网格。计数按物品实体种数计算，数量只显示在格子右上角。点击格子在同一资料弹窗内进入详情，关闭按钮仍在固定标题区，内容内部滚动；返回恢复筛选及原格子的键盘焦点。不是多层嵌套弹窗。

网格只显示图标、名称、数量、装备和任务角标。详情显示描述、数量、单件参考价值、当前状态及适用附加资料，不展示持有人、空位置、内部 ID 或维护说明。图标为本地 SVG，不发起图片请求。

| 筛选 | 稳定细类映射 |
| --- | --- |
| 全部 | 全部主角实际持有物品 |
| 衣物穿戴 | `top`、`bottom`、`shoes`、`accessory` |
| 电子设备 | `device` |
| 证件文件 | `document` |
| 工具与武器 | `tool`、`weapon` |
| 生活用品与杂物 | `other` |

只新增 `tool`，原八类保留。不会根据“手机”“工具”等名称猜分类，也不会自动将旧 `other` 改成 `tool`。装备来自正式 `currentWear` 槽位，任务角标来自明确的可选 `questItem`，没有重复的装备状态或从名称猜测任务用途。

## 数据与写入契约

`ImportantItemSchema` 新增三个可选字段：

| 字段 | 类型与语义 |
| --- | --- |
| `description` | 字符串；独立外观、背景和功能描述，与原 `conditionText` 当前状态分开 |
| `referenceValue` | 非负安全整数人民币分，或 `null`；单件参考价，不是购买总价或交易指令 |
| `questItem` | 布尔值；可选任务用途标记 |

原 `name/category/quantity/conditionText/ownerRef/locationId` 及归属校验保留。`itemDetails` 继续复用原有字符串记录，没有引入第二套物品数据库或可任意覆盖存档的对象补丁。

| 类型 | `itemDetails` 建议字符串键 |
| --- | --- |
| 衣物 | `material`、`size`、`warmth`、`protection`、`wearFeatures` |
| 设备 | `brandModel`、`functions`、`batteryText`、`operationText` |
| 文件 | `contents`、`issuer`、`signatureStatus`、`validUntil`、`purpose` |
| 工具/武器 | `purpose`、`functionCondition`、`durabilityText`、`reserveText` |
| 生活用品 | `purpose`、`shelfLife`、`remainingText`、`effectText` |

这些是可扩展的资料约定，不是事实审批规则或必填清单。值仍为字符串，未知属性省略，不新增百分比计算、耐久引擎或复杂日期规则。Prompt 与 UI 共用 `domain/items/details.ts` 的映射；详情只显示本类适用的约定字段，同时保留旧档及新物品的自定义字符串键。已知属于其他类别的约定键不展示，但不删除存档原值；任意自定义属性的语义是否合适仍由模型负责。

新增五条精确映射（文本目录由 68 条变为 73 条，仍为 24 类领域命令）：

| 文本路径（均为 `set`） | 领域执行 |
| --- | --- |
| `items[id].description` | `UpdateItem.changes.description` |
| `items[id].referenceValue` | `UpdateItem.changes.referenceValue` |
| `items[id].itemDetails` | `UpdateItem.changes.itemDetails`，整记录替换 |
| `items[id].category` | `UpdateItem.changes.category` |
| `items[id].questItem` | `UpdateItem.changes.questItem` |

`set items[id]`（AcquireItem）、`set items[id].purchase`（PurchaseItem）直接复用扩展后的同一 Schema。既有数量增减/归零、TransferItem、LoseItem、SetEquipment 未改语义。`itemDetails` 的 `set` 是整记录替换，Prompt 明确要求保留仍有效的旧资料；不支持 `items[id].itemDetails.xxx` 任意深层赋值。

### 成功示例

在 `hero` 是主角、现金已知且足够的状态下，以下命令购买价为 2500 分，参考价为 12000 分：

```text
<thinking>记录本回合购入的外套及其资料。</thinking>
<说明>扣除实际购买价，记录单件参考价值和衣物状态。</说明>
<命令>
set items[coat].purchase = {"account":"cash","price":2500,"item":{"name":"防寒外套","category":"top","quantity":1,"conditionText":"袖口轻微磨损，拉链完好","description":"黑色加厚防寒外套，适合冬季通勤。","referenceValue":12000,"ownerRef":{"kind":"protagonist","id":"hero"},"itemDetails":{"material":"棉布","size":"L","warmth":"适合冬季"}}}
set protagonist.currentWear = {"topItemId":"coat","accessoryItemIds":[]}
set items[coat].referenceValue = 11000
</命令>
```

只扣购买价 2500 分，后续参考价变化不产生资金流水。身份证等不可交易物品的参考价应省略或为 `null`，不能虚构普通市价；程序不根据物品名称做价格语义判定。

### 失败示例

在已有 `coat` 的状态下，下面第二条命令不是整数分，整批拒绝，第一条状态也不写入：

```text
<thinking>更新物品资料。</thinking>
<说明>记录外套变化。</说明>
<命令>
set items[coat].conditionText = "洗净"
set items[coat].referenceValue = 12.5
</命令>
```

负值、字符串、超过安全整数的金额也拒绝；非法地点、错误所有权、不兼容的已装备类别和任意深路径继续拒绝。参考价 `0` 是明确的零估值，只有缺失或 `null` 显示“待估价”，两者不混淆。

## 实际生成、投影与提交

```text
原 Variables Composer（items init/update + TEXT_COMMAND_CATALOG）
 → 原三标签文本解析
 → 精确路径映射为现有领域命令
 → 原整批内存模拟
 → 原草稿候选保存
 → World 读取同一候选投影
 → 原 commitTurn 原子复核提交
 → IndexedDB 重载
 → 背包只读过滤、分类和详情
```

更新了共享命令说明及物品组 init/update，刷新 Manifest 三个文本资源的内容哈希和版本 `1.7.0-inventory-v2`。测试直接检查实际 `composePrompt()` 的开局/普通 Variables 组装结果，不只检查源 Markdown。没有更改 Story、World Prompt 或输出协议，没有增加模型请求；全链路测试每回合仍为原 Story/Variables/World 三次 Mock 请求。

## 旧档与安全边界

- 不增加 Schema 版本，不改迁移函数，不重写旧物品。V1–V5 读取测试保留数量、类别、所有权及装备。
- 新字段缺失仍合法。缺失参考价显示“待估价”；描述优先用新 `description`，否则只读回退 `itemDetails.description/描述/物品描述`，再无资料显示“暂无描述”。不把状态冒充描述，不写回回退值。
- 无 ownerRef 的旧物品不能可靠证明主角持有，因此不自动收入背包，不修补归属。
- 单批失败不返回部分正式状态；Story 重 Roll、revision 冲突、重复命令和精确重放继续走原防护。
- 这里保证旧档由新版本读取；不承诺带新字段或 `tool` 的新档能被更老程序反向读取。旧程序的严格 Schema 可能拒绝这些新字段。

## 测试与失败记录

先添加 5 个最小回归并在旧代码运行，5 个均失败：新物品字段/tool 不被 Schema 接受，新增精确路径不能执行，旧物品栏混入非主角物品及世界经济资料，缺少六筛选入口。随后才实施对应变更。

扩展测试过程中修正了一个测试设置错误：普通回合草稿搭配了 opening Story，现有合法性校验正确拒绝；改为匹配的回合类型，没有放宽规则。

新增浏览器测试首跑 4 项失败：物品栏按钮原有编号前缀使新测试的精确文本定位不匹配。改为在“世界资料”导航内定位按钮，并使用原删除 API 要求的 expectedRevision 重新设置空背包夹具。没有删除业务断言或更改产品规则。复跑 4/4 通过。

人工截图检查还观察到手机详情标题偶发上移：关闭按钮 DOM 可见性断言（包括截图后断言）仍通过，不能把它描述为稳定复现的不可关闭故障。为避免焦点驱动祖先滚动，最终将背包内部焦点改为 `preventScroll`，只主动重置详情内容滚动、返回时恢复原列表位置；没有改全局 Dialog。这个局部变更后重新执行背包 desktop/mobile 4 项，全部通过，重新截图检查标题与关闭按钮完整可见，并重新运行工程检查。后续实机仍需留意移动浏览器焦点行为。

新增工程测试 33 项：`inventory-v2.test.tsx` 31 项；`live-text-turn.test.ts` 2 项真实开局/普通回合链路。保留全部原测试，只同步文本目录新增映射数量断言。新增 E2E 为 2 个场景 × desktop/mobile = 4 项。

最终验证结果在下表记录；提示词测试已包含在全量工程测试中，不能重复相加。

| 命令 | 本轮结果 |
| --- | --- |
| `npx vitest run src/tests/inventory-v2.test.tsx src/tests/live-text-turn.test.ts src/tests/economy-item-text.test.ts` | 3 文件、163 项通过 |
| `npm run check` | Lint、78 文件/2377 项工程测试、TypeScript、生产构建全部通过；保留原 2344 项，新增 33 项 |
| `npm run prompts:check` | 3 文件、82 项通过 |
| 相关 Chromium desktop/mobile（完整命令见下） | `7ffc866` 上同一批 52/52 通过：desktop 26、mobile 26，0 失败、0 跳过（3.8 分钟） |
| 局部焦点调整后：`CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/inventory-v2.spec.ts --project=desktop --project=mobile` | 最终背包 UI 复测 4/4 通过：desktop 2、mobile 2，0 失败、0 跳过（20.9 秒）；与上行包含重复场景，不累计成 56 个独立用例 |
| `git diff --check` | 通过 |

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test \
  e2e/inventory-v2.spec.ts e2e/game.spec.ts e2e/variable-runtime.spec.ts \
  e2e/automatic-settlement.spec.ts e2e/opening-life.spec.ts \
  --project=desktop --project=mobile
```

范围覆盖创角/开局、Variables、自动结算、背包分类/详情/键盘焦点、长内容滚动、手机横向溢出、刷新和旧资料回退。新浏览器测试比较完整 `loadGame()`（含正式存档、草稿）前后相等，并拦截/统计阅读操作期间的所有 POST，确认不改数据、不产生 AI 请求。未执行整个项目所有 E2E 文件；本次执行上述受影响范围。

生产构建保留 Vite 的大于 500 kB 分块体积提示，构建成功；本轮没有顺带重做代码分包。

## 截图

- [桌面网格](docs/screenshots/inventory-v2/desktop-grid.png)
- [桌面详情](docs/screenshots/inventory-v2/desktop-detail.png)
- [手机网格](docs/screenshots/inventory-v2/mobile-grid.png)
- [手机详情](docs/screenshots/inventory-v2/mobile-detail.png)

截图由本地 Chromium Mock 存档生成，不包含用户真实资料或凭证。

## 修改文件

- 数据/字段约定：`src/domain/items/schema.ts`、`src/domain/items/details.ts`。
- 领域映射/目录/安全错误路径：`src/domain/variableCommands.ts`、`src/executors/variableText/{compile,catalog,diagnostics}.ts`。
- UI：`src/ui/panels/{InventoryPanel.tsx,inventory.ts,Panels.tsx,playerView.ts}`、`src/ui/game/GameScreen.tsx`（仅物品弹窗类名）、`src/app/styles.css`。
- Prompt：`prompts/shared/07_command_output.md`、`prompts/variableGroups/items/{init,update}.md`、`prompts/manifest.json`。
- 测试：`src/tests/inventory-v2.test.tsx`、`src/tests/live-text-turn.test.ts`、`src/tests/text-prompt-readiness.test.ts`、`e2e/inventory-v2.spec.ts`。
- 报告与四张截图：本文件、`docs/screenshots/inventory-v2/*.png`。

## 剩余限制

尚未经过真实模型或真实手机浏览器验证。Mock 能证明字段契约、执行、原子提交和界面交互，不能证明任意模型都会合理估价或填写语义合适的资料。参考价与任务标记由模型依据上下文提供，程序只做类型、引用和领域约束，不新增事实审查。

专属资料沿用字符串，不计算电量、耐久或保质期；自定义键的语义适用性不由 UI 猜测。没有实现自动估价、交易市场、负重、图片生成、堆叠拆分转送或战斗属性系统。新增其他普通物品只需使用已有类别及资料，不需要逐物品改 UI。
