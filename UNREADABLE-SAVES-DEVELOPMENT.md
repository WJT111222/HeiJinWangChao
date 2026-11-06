# 无法读取存档的列表隔离、原始导出与确认删除

## 基线与范围

- 基线：`main@3c3bc37c86280b444e71816229fefd8ab29b8ed8`（PR #63 已合并）。
- 分支：`codex/unreadable-save-management`。
- 运行代码冻结提交：`450d22715d62a09cfd3a4b412613a2f74d322d43`。
- 仅修改存档列表与记录管理。不修改 GameState、TurnDraft、回执 Schema、数据库版本、既有迁移、AI、三阶段、领域执行和正式回合提交。

## 原因与修复前复现

原 `SaveRepository.list()` 对 `getAll()` 的所有记录调用 `migrateSave()`。任意一条记录抛错，整份 Promise 失败；首页把这当作列表加载失败，无法管理这条记录。原删除入口也依赖 `readState()` 成功，因此无法删除不支持版本或损坏的 GameState。

先补三个 fake-indexeddb 测试：旧代码 **2 失败、1 通过**。两个正常存档加 `schemaVersion: 99` 的记录会抛 `FUTURE_VERSION`，缺少有效版本且主键为数字的记录会抛 `CORRUPT_SAVE`，都使整张列表失败。数据库整体错误原本就正确拒绝，该断言保留。

## 列表与主键

`list()` 在同一个只读事务中获取主键和原始值，逐条进行既有读取校验，返回 `status: readable | unreadable` 的列表摘要。

- 单条解析异常只影响该卡片，正常存档依旧可读取、选择和继续。
- 坏记录的标题、内容 ID、有效保存时间尽可能显示；缺少标题使用“未命名存档”，缺少时间显示“保存时间无法读取”，不填入现实时间。
- `storageKey` 保留真正的 IndexedDB 主键。它与内容里的 `saveId` 明确区分，即使主键不是领域 ID、内容误指另一存档，也不会操作别的记录。
- IndexedDB 请求和事务都在单条解析的 catch 之外；整体读取失败仍明确报存储错误，不当作空列表或坏记录。
- 现有迁移只用于列表内存校验，不写库；没有恢复废弃字段或新增旧版兼容规则。
- “继续游戏”和提示词检查页的存档选择仅选择可读取摘要；后者只调整列表消费方式，不改变 Prompt 或请求。

## 原始导出

`exportRaw(storageKey)` 在覆盖 `saves`、`drafts`、`turnReceipts` 的同一个只读事务里读取一致快照，不调用 `migrateSave`、GameStateSchema、草稿或回执 Schema。

文件是 JSON 包装，记录原始主键和值：

```json
{
  "format": "heijin-raw-save",
  "version": 1,
  "records": {
    "saves": [{"key": "broken", "value": {"saveId": "broken", "schemaVersion": 99}}],
    "drafts": [],
    "turnReceipts": []
  }
}
```

包装版本不是游戏存档版本。未知字段、数组顺序、正文换行、旧格式与未来版本原样保留；缺少草稿或回执时数组为空，不制造记录。关联草稿按实际主键读取，回执按现有 `saveId` 索引取得其实际复合主键。不会把其他存档、localStorage 设置或凭证库导出。

现有 `rerollStory`/阶段尝试会保存值为 JavaScript `undefined` 的对象属性。JSON 没有此值：文件额外记录 `undefinedFields` 路径，例如 `['records', 'drafts', 0, 'value', 'world']`。原对象不修改，不填 null，也不静默遗漏这项信息。普通 JSON 数据没有这项附加元数据。

Date、Map、BigInt、非有限数字、循环引用等无法在本 JSON 格式中原样表示的数据会明确停止导出，不伪装成完整文件。未增加导入或自动修复功能。下载提示为“已发起下载，请检查浏览器下载记录”，不假定玩家已将文件保存到磁盘。

## 确认删除与失败处理

- 坏记录提供“删除存档”，确认框列出名称和实际记录 ID，明确永久删除且无法撤销，建议先导出。取消不调用删除。
- `deleteUnreadable(storageKey)` 在同一个读写事务里重读所选记录。如果已变为可读取存档，拒绝删除并要求刷新重新选择。
- 删除对应正式记录、同主键草稿和该存档回执，任一步失败整笔回滚。正常删除仍先检查领域 ID 和预期 revision，复用相同的三表删除步骤。
- 不根据不可信内容 `saveId` 扩大删除范围，不自动清理其他存档或孤立数据。
- 事务完成后立即移除卡片、刷新列表、清除相关错误与最近选择。刷新若另行失败，明确提示列表访问错误，不谎称已经成功的删除回滚。
- 单条读取失败留在卡片；导出错误留在卡片；删除错误留在可取消的确认框。数据库整体错误可关闭全局红色提示，列表保留存储不可用说明。关闭提示本身不重新请求，也不再次自动弹回。

## 测试与验证

新增 **27 项单元／fake-indexeddb 测试**和 **7 个浏览器场景**（桌面、移动各执行一次）。覆盖混合列表、通用元数据、未来版本、旧格式只读、不依赖 Schema 的完整导出、undefined 路径、非 JSON 错误、实际主键与伪造内容 ID、其他存档隔离、三表删除回滚、正常删除 revision、数据库不可用及重载。浏览器包含真实下载 JSON 内容核对、取消/确认、错误关闭、删除后刷新、正常游戏进入与创角入口；所有 POST 被 Mock 拦截并断言零次。

开发中，首次模拟同步 IDB 读失败暴露键请求的未处理拒绝，已改为同一事务内按序读取主键和值。首次浏览器运行因本机监听权限未能启动，无测试执行；启用本地浏览器所需网络权限后运行。移动初跑 13/14：一项测试未展开手机默认折叠的人物栏，导致姓名断言失败；使用项目已有 `openGameTools` 展开，保留姓名可见断言，复测 14/14。

最后审阅补充复合主键展示的唯一性：不能把 `['a', 'b']` 与 `['a, string:b']` 渲染成相同的 React 卡片 key。仅调整显示编码，不改变数据库操作主键，新增 1 项测试。该补充之后重新运行最终工程及浏览器批次，之前的 2256 项工程成绩不作为最终成绩。

早期定向存档／创角检查：3 个文件 **110/110** 通过（当时含 26 项新增测试），最终完整工程检查覆盖上述 27 项。

| 最终检查 | 实际结果 |
| --- | --- |
| `npm run check` | **72 文件，2257/2257 通过**（原有 2230 + 新增 27）；Lint、TypeScript、生产构建通过 |
| `npm run prompts:check` | **3 文件，82/82 通过**；是工程测试子集，不重复累加 |
| 相关 Chromium desktop | **27 通过，0 失败，0 跳过** |
| 相关 Chromium mobile | **27 通过，0 失败，0 跳过** |
| 最终浏览器批次 | **54/54 通过，约 4.1 分钟**；原有 40 项 + 新增 14 项执行 |
| `git diff --check` | 通过 |

最终浏览器命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test e2e/unreadable-saves.spec.ts e2e/game.spec.ts e2e/continuous-turns.spec.ts e2e/automatic-settlement.spec.ts e2e/prompt-inspector.spec.ts --project=desktop --project=mobile
```

执行的是相关浏览器文件，没有宣称全仓库 E2E 全部运行。覆盖新增记录管理及既有创角、连续十回合、自动结算、失败恢复、多个标签页、回滚和 Prompt 检查页。构建保留既有 >500 kB 分块提示，不影响成功。

以上最终结果在 `450d227` 代码上重新执行；之后仅补充本报告，没有再改运行代码或测试。所有模型响应使用 Mock，不进行真实付费验证。测试日志及最初移动端失败 Trace 保留在工作区 `/workspace/unreadable-save-verification/`。

## 修改文件

- `src/services/storage/saveRepository.ts`：独立列表、原始读取、按主键原子删除；正常删除版本检查保留。
- `src/services/storage/saveManagement.ts`：列表摘要、主键展示、JSON 导出序列化与不可表示值的明确错误。
- `src/ui/SaveCard.tsx`：复用原卡片展示，加入坏记录提示、下载入口和局部错误。
- `src/app/App.tsx`：选择可读取存档、存储错误状态、删除确认和完成刷新。
- `src/app/styles.css`：卡片长文字／主键换行。
- `src/ui/settings/PromptInspector.tsx`：从可读取摘要选择预览存档。
- `src/tests/unreadable-saves.test.ts`、`e2e/unreadable-saves.spec.ts`：新增回归。
- 本报告。

## 边界与剩余限制

没有恢复或修复任何坏记录，也没有新增迁移。当前列表的“可读取”沿用正式 GameState 读取校验，不保证另外损坏的草稿也能进入游戏；这种情况下原有 `loadGame` 仍安全失败。原始导出不包含浏览器设置和同伴 UI 档案，三类 IndexedDB 游戏记录才是本次范围。

如果整个 IndexedDB 无法打开，或对象仓库／索引本身损坏，当前页面不能绕过浏览器访问权限读取或删除记录；明确报错，不提供虚假备份。JSON 不可表示的特殊值采用明确拒绝，未实现通用二进制备份格式。浏览器 Mock 不等于已检查真实用户损坏文件；未访问或修改玩家存档。

保持 Draft，等待六代目复审；不自动合并、不主动部署生产环境、不调用付费模型。
