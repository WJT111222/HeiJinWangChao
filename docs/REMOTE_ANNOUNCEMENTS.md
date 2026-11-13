# Cloudflare 云端公告操作说明

## 首次配置（需管理员授权后执行）

管理员已确认创建 `HEIJIN_ANNOUNCEMENTS` 并保存测试公告 `current`。本 PR 已按管理员提供的信息写入真实 Namespace ID `0a998f91824b45dba8dfe52896a89b99`，绑定名为 `ANNOUNCEMENTS`。本轮仅更新仓库配置，没有部署、访问或修改 Cloudflare 资源；线上绑定生效与公告内容仍须在授权部署后验证。异常或缺失绑定时 API 和前端均使用内置公告。

1. 在 Cloudflare 控制台 **Workers & Pages → KV**（部分界面位于 Storage & databases）创建 Namespace，名称 `HEIJIN_ANNOUNCEMENTS`，复制实际 Namespace ID。
2. 在现有 `heijinwangchao` Worker 的 Settings → Bindings 中添加 KV Namespace，变量名 **`ANNOUNCEMENTS`**，选择上面的 Namespace。绑定修改本身可能需要控制台保存/部署确认。
3. 真实 ID 已同步进仓库 `wrangler.jsonc` 顶层，后续源码部署将使用以下绑定；如果将来更换 Namespace，需同步更新仓库配置：

```json
"kv_namespaces": [
  { "binding": "ANNOUNCEMENTS", "id": "0a998f91824b45dba8dfe52896a89b99" }
]
```

4. 在该 Namespace 中创建 **`current`** 键，值类型为文本，填写完整 JSON：

```json
{
  "version": "notice-2026-11-13-1",
  "title": "王朝公告",
  "theme": "《黑金王朝》版本更新",
  "updates": ["本次更新内容一。", "本次更新内容二。"],
  "message": "感谢大家的支持。"
}
```

`version` 是管理员维护的公告标识，不改变游戏产品版本或“今日不再弹出”逻辑。

5. 经审查授权后，用原有构建/部署流程一次性发布：Node24 下 `npm ci`、`npm run build`，再部署现有 `wrangler.jsonc`。配置仍是 Static Assets：只有 `/api/*` 由 Worker 优先处理，普通静态文件继续由 `dist` 服务。`ASSETS` 是静态资源绑定，`ANNOUNCEMENTS` 是 KV 绑定，两者不要混用。
6. 打开 `https://heijinwangchao.de5.net/api/announcement` 检查 JSON；响应头 `X-Announcement-Source: kv` 表示读取合法 KV，`builtin` 表示使用备用数据。再刷新游戏，关闭免责声明或手动打开王朝公告核对全文。不要通过清除游戏存档来验证。

## 以后发布公告：合并 PR 自动发布（推荐）

公告内容放在仓库的 `announcements/current.json`。修改它的 PR 合并到 `main` 后，GitHub Actions「发布王朝公告」会自动：

1. 用与 Worker、客户端相同的 `parseAnnouncement` 校验文件，不合法就停止，线上不变；
2. 写入 KV Namespace（ID 取自 `wrangler.jsonc`）的 `current` 键；
3. 轮询 `https://heijinwangchao.de5.net/api/announcement` 约两分钟，确认版本已更新。KV 同步慢时只给警告，不算失败。

不需要重新构建或部署游戏。`npm run check` 中的 `announcement-file.test.ts` 也会校验这个文件，PR 阶段就能发现格式错误。

**回滚**：在 GitHub 上对该 PR 点 Revert 并合并，旧内容会被自动写回。

**手动补发**：Actions → 发布王朝公告 → Run workflow，会把 main 上当前的文件再写一次。

### 一次性配置（管理员）

1. Cloudflare 控制台 → My Profile → API Tokens → Create Token → Custom token，权限只给 **Account · Workers KV Storage · Edit**，Account Resources 选本账号。
2. 复制账号 ID（Workers & Pages 概览页右侧 Account ID）。
3. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，添加：
   - `CLOUDFLARE_API_TOKEN`：上一步的 Token
   - `CLOUDFLARE_ACCOUNT_ID`：账号 ID

配置前合并公告 PR，工作流会以「缺少 Secrets」失败，线上公告不变。

### 仍可在控制台直接改

控制台编辑 `current` 依然有效，但下一次修改 `announcements/current.json` 的合并会覆盖它。为免两边不一致，建议改完后把同样内容同步回仓库文件。

1. 先在管理员私有位置复制保存旧 `current` 值，用于回滚。
2. 控制台编辑同一 Namespace 的 `current`，替换完整 JSON，更新 `version`。
3. 保存后重新 GET 接口，检查版本与 `X-Announcement-Source`，再刷新游戏核对。
4. 出错时将备份的完整旧 JSON 写回 `current`，再按相同步骤验证。删除键或写入非法内容将安全使用内置公告，不会修复或更改玩家数据。

Cloudflare KV 最终一致，跨地区读缓存同步可能有延迟（常见约60秒或更久），不承诺所有玩家瞬时刷新。API 使用 `Cache-Control: no-store`；这不消除 KV 本身的缓存。客户端每次完整加载读取一次，页面内部导航/手动反复开关不额外请求；已加载页面需刷新才获取管理员下一版。当次迟到的合法响应可以更新已打开公告，弹窗不会被强制关闭。当天免打扰仍按原规则隐藏自动弹窗，手动入口始终可用。

## 格式与安全

六个字段均必需，拒绝额外字段：version 1–64字符、title 1–100、theme 1–300、message 1–2000；updates 1–20条，每条1–2000字符。文本不可全为空白，完整 JSON 不超过32KiB UTF-8。字数指 JavaScript 字符串长度。禁止把HTML当页面格式：所有内容只作为 React 文本展示，不解释标签、脚本或远程代码。

只提供 `GET /api/announcement`，POST/PUT/PATCH/DELETE/HEAD/OPTIONS 返回405，不读取或写入KV；其他API路径404。没有公开管理口、账号、密钥或写入端点。KV异常、缺失、非法值均返回原内置公告，不公开底层异常。客户端还会独立校验响应、限制大小，网络失败/超时（3秒）回退。游戏启动与弹窗立即可用，不等待接口。

Vite 日常开发不模拟生产KV，未 Mock 的 `/api/announcement` 会因返回非公告内容而回退；真实Worker行为由独立单测覆盖，Cloudflare首次绑定及线上验收需管理员在获授权部署后执行。

## 本轮工程记录

基线 main `d73b95d`。没有修改CSS、免责声明文字、preferences、存档、AI、NPC或任何游戏领域流程。只增加数据接入 prop 和 hook 状态；PC/手机继续复用原公告组件。

测试实际结果见本节完成记录；本地 Mock 不代表已部署或已确认真实KV绑定。

### 验证结果（2026-11-13）

- 定向Vitest：`remote-announcement.test.ts`、`notice-preferences.test.ts`，2文件33通过，0失败/跳过（最终批次516ms）。
- 定向Chromium：新远程公告两例及既有完整免责声明/顺序/手动查看三例，桌面和手机共10通过，0失败/跳过（43.4秒）。验证StrictMode下单页单请求、刷新读取新快照、远程HTML以纯文本显示且不执行、免打扰和手动查看、离线不阻断首页。没有运行全量E2E。
- Lint、TypeScript已通过；生产构建通过（退出码0），仅有现有的大于500kB chunk体量提醒；差异检查通过。原免责声明及preferences没有差异，CSS零改动。
- API测试直接调用真实Worker入口及KV Mock；Chromium Mock同源API，不代表真实Cloudflare已绑定、已部署或跨地区同步已验收。未新增依赖，Node24复用与锁文件一致的本地已安装依赖。

### 真实绑定配置补充（2026-11-13）

仅更新 `wrangler.jsonc` 与本说明。使用 TypeScript JSONC 解析器检查语法，并核对新增绑定之外所有配置项与上一提交完全一致；`main`、Static Assets、`ASSETS`、`run_worker_first` 等均保留。未重复运行完整测试，未部署或修改 Cloudflare 资源。
