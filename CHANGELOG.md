# Changelog / 项目变更记录

> 这里按**已合并 PR 和项目负责人确认的产品里程碑**记录。1.0 Beta 以 GitHub 预发布（pre-release）`v1.0.0-beta` 标记；1.0 正式版尚未发行。下面较早的“V1.0 可玩里程碑”是 2026-10-24 的历史口径，不代表当时打过 Tag 或重新部署。

## 1.0 Beta（2026-11-14 · 预发布 `v1.0.0-beta`）

面向社区公开试玩的测试版本。相对 0.9 开发里程碑（[#90](https://github.com/WJT111222/HeiJinWangChao/pull/90)），主要变化如下。

### 存档备份
- 存档可以导出为备份文件，并在另一个浏览器或设备上导入：电脑端在存档馆，手机端在车票上。备份不含 AI 密钥、渠道和设置（[#126](https://github.com/WJT111222/HeiJinWangChao/pull/126)、[#136](https://github.com/WJT111222/HeiJinWangChao/pull/136)）。
- 导入前先预览；会覆盖本机存档时，列出两边的回合数和保存时间，并要求再确认一次。多份备份默认只勾选本机没有的存档。
- 存档馆和车票会显示每份存档的备份状态；玩了 5 回合以上还没备份过的存档会有提醒。

### 首页与创角
- 电脑端改为四城封面加「存档馆」；手机端改为发车屏和横滑车票，每份存档一张票（[#106](https://github.com/WJT111222/HeiJinWangChao/pull/106)、[#125](https://github.com/WJT111222/HeiJinWangChao/pull/125)）。
- 五步创角：手机端改为「人生车票」，电脑端改为人物档案式布局；开局包可以完整复用五步创角的设置（[#95](https://github.com/WJT111222/HeiJinWangChao/pull/95)、[#130](https://github.com/WJT111222/HeiJinWangChao/pull/130)、[#134](https://github.com/WJT111222/HeiJinWangChao/pull/134)、[#137](https://github.com/WJT111222/HeiJinWangChao/pull/137)）。

### 游戏界面
- 电脑端「城市长夜」主界面：画面氛围跟随开局城市，每回合记录当时的时间和地点（[#107](https://github.com/WJT111222/HeiJinWangChao/pull/107)、[#108](https://github.com/WJT111222/HeiJinWangChao/pull/108)）。
- 手机端改为沉浸阅读加底部行动台，状态、世界资料和工作流从底部抽屉打开，抽屉开着也能输入发送（[#120](https://github.com/WJT111222/HeiJinWangChao/pull/120)、[#122](https://github.com/WJT111222/HeiJinWangChao/pull/122)、[#123](https://github.com/WJT111222/HeiJinWangChao/pull/123)）。
- 每回合结算后可以查看「本回合变化」，金额精确到分，并能跳到对应档案（[#118](https://github.com/WJT111222/HeiJinWangChao/pull/118)、[#133](https://github.com/WJT111222/HeiJinWangChao/pull/133)）。
- 三阶段详情合并为一个面板，提示和确认弹窗统一样式（[#109](https://github.com/WJT111222/HeiJinWangChao/pull/109)、[#117](https://github.com/WJT111222/HeiJinWangChao/pull/117)）。
- 「提示词管理」改为分类清单、原文页和「高级」三层（[#124](https://github.com/WJT111222/HeiJinWangChao/pull/124)）。

### 资料档案柜
- 人物、势力、物品与资产、世界事件、历史、记忆、地图和设置统一为纸色档案柜，电脑端和手机端使用同一套档案（[#110](https://github.com/WJT111222/HeiJinWangChao/pull/110)、[#111](https://github.com/WJT111222/HeiJinWangChao/pull/111)、[#112](https://github.com/WJT111222/HeiJinWangChao/pull/112)、[#113](https://github.com/WJT111222/HeiJinWangChao/pull/113)、[#114](https://github.com/WJT111222/HeiJinWangChao/pull/114)、[#131](https://github.com/WJT111222/HeiJinWangChao/pull/131)）。
- NPC V2：统一人物名录、按姓名／别名／职业搜索、★ 重要人物、人物与记忆去重，以及长期保留规则（[#96](https://github.com/WJT111222/HeiJinWangChao/pull/96)、[#97](https://github.com/WJT111222/HeiJinWangChao/pull/97)、[#98](https://github.com/WJT111222/HeiJinWangChao/pull/98)、[#99](https://github.com/WJT111222/HeiJinWangChao/pull/99)、[#100](https://github.com/WJT111222/HeiJinWangChao/pull/100)、[#101](https://github.com/WJT111222/HeiJinWangChao/pull/101)、[#102](https://github.com/WJT111222/HeiJinWangChao/pull/102)）。
- 势力组织：状态更新、稳定关联和双端势力档案（[#103](https://github.com/WJT111222/HeiJinWangChao/pull/103)）。

### 公告
- 王朝公告改为从线上读取，修改随 PR 合并自动发布；「今日不再弹出」只对当时看到的那一版有效，当天有新公告仍会提醒（[#121](https://github.com/WJT111222/HeiJinWangChao/pull/121)、[#129](https://github.com/WJT111222/HeiJinWangChao/pull/129)、[#132](https://github.com/WJT111222/HeiJinWangChao/pull/132)）。

### 稳定性
- World 和 Variables 的命令说明补充了字段层级、时间窗口、事件更新等常见出错点的指引；修复了新建 NPC、同轮新建地点等校验误判（[#94](https://github.com/WJT111222/HeiJinWangChao/pull/94)、[#104](https://github.com/WJT111222/HeiJinWangChao/pull/104)、[#115](https://github.com/WJT111222/HeiJinWangChao/pull/115)、[#116](https://github.com/WJT111222/HeiJinWangChao/pull/116)、[#119](https://github.com/WJT111222/HeiJinWangChao/pull/119)）。
- 版本号统一为 1.0 Beta：`package.json` 为 `1.0.0-beta`，游戏界面显示 `V1.0 Beta`（[#128](https://github.com/WJT111222/HeiJinWangChao/pull/128)）。存档结构仍是 GameState Schema V9，IndexedDB 结构版本为 4，备份文件格式为 v1。

### 已知限制
- 存档只保存在当前浏览器里，清除网站数据会丢失进度，请定期导出备份。
- 真实模型的长篇游玩、各家服务地址的兼容性和手机真机体验仍在验收，这正是本次公开试玩要收集的反馈。
- 自动测试以 Mock 和 Chromium 为主，不等于联网实测或百回合压力测试。
- 生成和连接测试可能产生费用，请在操作前确认用量。

## V1.0 可玩里程碑（项目负责人确认；2026-10-24 文档同步）

- 核心单人开放世界文字游戏已具备创角、三阶段 AI、候选审阅、原子正式结算与连续回合（M0～M4-P5）。
- 公共短/中/长期记忆和历史检索、NPC 私有记忆总结、时间预检与事件中断已合并（M5-P1～P4）。
- [PR #22](https://github.com/WJT111222/HeiJinWangChao/pull/22)：动态世界任务终态、合法成果交接、非联系人 NPC 安全退场及历史信息边界。
- [PR #23](https://github.com/WJT111222/HeiJinWangChao/pull/23)：原创开局 9 步/普通回合 15 步规划、项目 Thinking 与原生公开内容隔离、输出档位和请求用量。
- [PR #25](https://github.com/WJT111222/HeiJinWangChao/pull/25)：渠道自动获取模型、四阶段模型选择、同渠道缓存及 UI 主题适配。
- [PR #27](https://github.com/WJT111222/HeiJinWangChao/pull/27)：模型列表同源候选、解析与模型 ID、受限分页和安全诊断；真实中转兼容及最终加固仍需单独验证。
- **产品规则变更**：开局不再强制发生重大灾难、不公或复仇；NPC 完整活跃档案也并非一律永久保留，符合 PR #22 规则时可安全退场。

### 当前已知限制 / 未完成验收

- 部分接口地址不能正确列模型或列表不全；已合并主体及后续加固状态见 [任务书](docs/API-MODEL-LIST-COMPATIBILITY.md)。
- 自动测试主要是 Mock 和 Chromium 浏览器场景；不等于所有接口的实际联网验收或百回合长期压力测试。
- 浏览器本地 IndexedDB 数据不能视为云备份；生产入口与完整恢复保障需要分别验证（存档导入导出已在 1.0 Beta 上线）。
- M7 UI/UX 全面改版及 Issue #6/#24 未来玩法尚未交付。

## 早期开发（历史记录）

- M0～M1：TypeScript 工程、领域 Schema、游戏状态、多存档和事务。
- M2：三栏 UI、五步创角与资料界面。
- M3：提示词资源/组装、三种 AI 协议、请求检查和提示词配置。
- M4：正文、变量、动态世界候选，自动协调及正式回合结算。
- M5：历史与记忆、时间事件、任务终态、原创规划与模型选择。

具体实现与审核见 [仓库已合并 PR](https://github.com/WJT111222/HeiJinWangChao/pulls?q=is%3Apr+is%3Amerged) 和对应 `M*-DEVELOPMENT.md`。
