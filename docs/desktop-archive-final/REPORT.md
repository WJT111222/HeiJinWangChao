# 桌面档案柜最终批施工报告

本批只将桌面地图与设置迁入已合并的档案柜体系。手机保持原界面；前四批面板只做必要的导航回归适配，没有重新设计其内容。

基线为重新 fetch 的 `origin/main`：`73ad3262b6436c4802230951894e89d0256476c2`，交付分支 `codex/desktop-map-settings`。最终提交 SHA 随 Draft PR 和交付消息提供，可通过 `git rev-parse HEAD` 核对。未合并、部署、发布或修改生产配置。

## 设计与实现

设计依据为用户确认 ZIP 中的 `heijin-panels.html`、`PANELS_HANDOFF.md` 第五／六节及 `s5-map.png`／`s6-ai.png`。仓库已有的[设计原文及哈希清单](../desktop-npc-cabinet/design/manifest.json)保持不变。

| 确认设计 | React 实现与核对 |
| --- | --- |
| 暖纸、纸纹、朱砂方印、分节卡、深色主屏 | 复用 ArchivePanel 与 archive.css；提取共享 ArchiveHeader，不改变其他资料字段 |
| 地图左树、右示意及详情 | 独立滚动；树／示意／面包屑／下级按钮同步；当前地点标记与精确 ID 关联 |
| 地点层级示意 | 只按真实 parentId 分组，四城江河为设计装饰，其他根中性；无坐标和移动行为 |
| 设置左目录、右表单、底部保存 | 五个真实分类；渠道卡和四条路由；长表单内部滚动；中等桌面改为紧凑排版 |
| 游戏内非模态、首页模态 | 同一 ArchivePanel 接口，共享暖纸表单与标题；游戏用 dialog.show()，首页／手机用 showModal() |
| dock、Esc、回焦、二次确认 | dock 保持可操作；游戏正文与行动 inert；原确认保持原生模态及 Esc 优先级 |
| 手机不改版 | 390×844 相同数据下，地图及五类设置 7 张截图与未修改 main 像素相同 |

[HTML／React 对照页](comparison.html) · [整张对照图](screenshots/comparison.png)

### 真实数据与演示稿的差异

- 正式地点仅有 ID、名称和父级；没有添加类型、背景、归属、描述、坐标或推测行政层级。完整真实字段在「地点资料」展开查看。
- 海外特殊根使用「层级根地点」，不强称城市；人物常驻信息保留知情提示，资产沿用既有主角资产投影。
- 正式 Schema 原已拒绝缺失父级和循环关系，本批未放宽。UI 投影对这些异常输入安全降级，单元测试同时验证 Schema 拒绝规则未改变。
- 设置保留 main 的服务直连、凭证风险、费用说明、原渠道选择器与完整状态反馈，因此表单位置与较短的演示稿不同。
- 演示稿的密钥明文切换未加入；沿用当前密码输入。七项写作偏好、已有禁用的后续功能、现行分类、默认值与字段范围全部以 main 为准。
- 没有复制不存在的「通用阅读设置」或存档导入／导出入口。原存档馆操作仍在原位置。

详见[设置项完整保留清单](SETTINGS_INVENTORY.md)和[地点兼容性记录](MAP_COMPATIBILITY.md)。

## 设置与数据安全

设置仍使用原 SettingsPanel、AiConnections、MemorySummarySettings、PromptInspector 及唯一维护控制器。没有改动配置 Schema、凭证 Vault、模型路由、maxOutputTokens、COT、请求冻结、校验或费用语义。

为避免桌面／手机容器切换清除待保存密钥，设置使用稳定的原生 dialog 与表单实例，仅切换 show／showModal。跨 901／900／390px 的新测试验证密码输入 DOM 身份、值与掩码保持，并验证二次确认打开时双向切换后原生模态优先级、焦点及 body 滚动锁；无明文凭证截图或新日志。新凭证测试关闭 trace，凭证运行时合成，所有内容断言只输出布尔结果。

桌面 dock 离开未保存的 AI／记忆设置时，交由现有确认弹窗明确继续编辑或放弃。普通浏览、搜索、选择和跨面板导航不写入正式存档或草稿；设置只有原有明确操作才保存。NPC 星标例外不变。

本批未修改 GameState、IndexedDB、正式 Schema、Repository、领域规则、提示词资源、模型协议、三阶段结算、撤回、公告 JSON、开局城市、时间或天气。没有存档迁移，新旧配置兼容仍走原实现。

## 修改说明

| 文件／组 | 用途 |
| --- | --- |
| `src/app/App.tsx` | 设置挂载与未保存关闭／dock 目的地交接，沿用原设置控制器 |
| `src/ui/ArchivePanel.tsx`、`ArchiveHeader.tsx` | 共用档案柜接口与标题；设置稳定宿主适配游戏／首页／手机 |
| `src/ui/Dialog.tsx` | 显式非模态选项、稳定表单、回焦；跨尺寸保留上层原生模态和滚动锁 |
| `src/ui/game/GameScreen.tsx` | 地图挂载、UI 状态缓存、dock 切换、设置打开时 inert／快捷键隔离 |
| `src/ui/panels/MapPanel.tsx`、`mapView.ts`、`src/ui/archive-map.css` | 只读地点森林投影、层级示意与完整详情、分段和桌面样式 |
| `src/ui/settings/SettingsPanel.tsx`、`AiConnections.tsx`、`MemorySummarySettings.tsx`、`settings-paper.css` | 桌面目录、渠道卡、路由、保存栏和纸色样式；原字段与操作保留 |
| `src/tests/map-archive.test.tsx`、`fixtures/mapArchive.ts` | 正式合成数据、异常输入防御、字段／ID／顺序与只读单测 |
| `e2e/archive-final.spec.ts` | 最终批五场景、双端矩阵、读写边界、密码与跨尺寸模态测试 |
| `e2e/archive-step3.spec.ts`、`archive-step4.spec.ts`、`desktop-cabinet.spec.ts` | 更新本批获准变化的地图容器／设置导航预期，保留业务断言 |
| `e2e/startup-notices.spec.ts`、`prompt-inspector.spec.ts` | 已在 main 复现的旧测试导航／天气 hover 竞争交互适配，保留全部数据断言 |
| `docs/desktop-archive-final/` | 本报告、设置清单、地点兼容记录、原始日志、截图与对照 |

## 验证

工程检查 3202 单测、93 提示词测试及构建通过；完整 Chromium 210 通过／6 平台跳过，最终设置追加回归 43 通过／1 平台跳过，均无未解决失败。运行环境与命令、详细成绩见[测试报告](TEST_REPORT.md)。源文件在各轮 Chromium 执行期间冻结并验证哈希一致。所有模型请求为 Mock，纯阅读测试拦截并断言外部请求数为零。

### 截图索引

| 场景 | 真实 React 截图 |
| --- | --- |
| 地图全貌与详情 | [1440](screenshots/map-1440.png)、[技术记录展开](screenshots/map-details-1440.png) |
| 五尺寸 | [1920](screenshots/map-1920.png)、[1280](screenshots/map-1280.png)、[1100](screenshots/map-1100.png)、[901](screenshots/map-901.png) |
| 大量与超长地点 | [大量地点 1100](screenshots/map-many-1100.png)、[长名称完整详情](screenshots/map-long-1100.png) |
| 设置总览 | [1440](screenshots/settings-1440.png)、[1100](screenshots/settings-1100.png)、[901](screenshots/settings-901.png) |
| AI 表单／路由 | [渠道编辑](screenshots/settings-channel-1440.png)、[四路路由](screenshots/settings-routes-1440.png)、[安全凭证编辑](screenshots/settings-credential-masked-desktop.png) |
| 其他四类设置 | [提示词](screenshots/settings-提示词-desktop.png)、[记忆](screenshots/settings-记忆-desktop.png)、[运行](screenshots/settings-运行-desktop.png)、[提示词管理](screenshots/settings-提示词管理-desktop.png) |
| 未修改 main 桌面 | [旧地图](screenshots/main-map-1440.png)、[旧设置](screenshots/main-settings-1440.png)，与新版使用同一正式夹具和 1440×900 视口 |
| 首页设置 | [桌面原生模态](screenshots/settings-home-desktop.png) |
| 手机原界面对照 | [地图](screenshots/map-mobile.png)、[设置](screenshots/settings-mobile.png)、[main 地图](screenshots/main-map-mobile.png)、[main 设置](screenshots/main-settings-mobile.png) |

全部截图为 Chromium 中实际 HTML／React 页面；演示稿截图仅作为对照，不进入游戏数据。截图是合成存档与虚构模型服务，没有真实玩家资料或生产凭证。

修改文件见 [FILES.txt](FILES.txt)。交付为独立 Draft PR，等待九代目复审及玩家视觉确认。
