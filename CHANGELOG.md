# Changelog / 项目变更记录

> 这里按**已合并 PR 和项目负责人确认的产品里程碑**记录。1.0 Beta 以 GitHub 预发布（pre-release）`v1.0.0-beta` 标记；1.0 正式版对应版本号 `v1.0.0`。下面较早的“V1.0 可玩里程碑”是 2026-10-24 的历史口径，不代表当时打过 Tag 或重新部署。

## 1.0（2026-11-28 · 正式版 `v1.0.0`）

本次更新加入游戏内手机，将变量记录拆成三个阶段，并开放新的城市、资产和文学设置。

### 游戏内手机

- 电脑端从顶栏、手机端从底部导航打开游戏内手机。通讯录保留已交换的号码，资产页可查存款、房产、车辆和贷款到期日；场外来信按游戏时间投递。 [#254](https://github.com/WJT111222/HeiJinWangChao/pull/254) [#255](https://github.com/WJT111222/HeiJinWangChao/pull/255)
- 回合之间可以私聊有号码的人。对方按身份、关系与已知情况回复，也可能已读不回。聊天期间游戏时钟暂停，记录随下一回合结算，也可点「结束聊天」单独结算。 [#259](https://github.com/WJT111222/HeiJinWangChao/pull/259)
- 可邀请联系人加入家庭群或工作群，并限制每轮回复人数。「小黑书」提供推荐、热榜、帖子、评论与楼中楼，和主角有关的帖子会进入通知。 [#260](https://github.com/WJT111222/HeiJinWangChao/pull/260)

### 变量记录拆成三段

- 「人物与实体」记录人物、组织、地点和关系，「主角与现场」记录钱物、时间与当场变化，「场外与网络」推进场外事件、来信和话题。三段可分别开关和分配模型；启用的阶段一起结算，恢复时可复用仍有效的上游候选。 [#250](https://github.com/WJT111222/HeiJinWangChao/pull/250) [#255](https://github.com/WJT111222/HeiJinWangChao/pull/255) [#260](https://github.com/WJT111222/HeiJinWangChao/pull/260) [#262](https://github.com/WJT111222/HeiJinWangChao/pull/262)

### 我的势力与后宫

- 主角可绑定一个主势力，查看职位、部门和成员，并区分势力实况与主角已经知道的信息。 [#218](https://github.com/WJT111222/HeiJinWangChao/pull/218)
- 后宫与家庭档案可记录成员地位、和谐度、成员关系、家庭规划、妊娠与子女。 [#219](https://github.com/WJT111222/HeiJinWangChao/pull/219)

### 房产与资产

- 全款或按揭购房可直接登记，按揭房与房贷关联结算。股份、收藏品、继承及受赠的资产也能登记到主角名下。 [#253](https://github.com/WJT111222/HeiJinWangChao/pull/253)

### 四座新城市

- 新增北京·帝都、杭州·钱塘、长沙·夜城、三亚·鹿城，也可自选中国大陆城市开局。 [#245](https://github.com/WJT111222/HeiJinWangChao/pull/245)

### 文学预设

- 《我即浪潮 1124》与潮汐控制台接管正文文风、人称和篇幅，变量记录与世界演化照常运行。断点续写会核对生成时的文学设置。 [#247](https://github.com/WJT111222/HeiJinWangChao/pull/247) [#252](https://github.com/WJT111222/HeiJinWangChao/pull/252) [#266](https://github.com/WJT111222/HeiJinWangChao/pull/266)

### 主世界书

- 两本官方主世界书可以分别启停；自建或导入的世界书也可设为主世界书。 [#249](https://github.com/WJT111222/HeiJinWangChao/pull/249)

### 文生图、小剧场与提示音

- 文生图默认关闭。启用后可为人物生成形象或把重要场景存进人生相册，图片可随存档备份。 [#248](https://github.com/WJT111222/HeiJinWangChao/pull/248)
- 王朝小剧场可在主线之外创作、续写、保存和改名，番外可随存档备份。回合生成完成后可播放提示音。 [#242](https://github.com/WJT111222/HeiJinWangChao/pull/242) [#244](https://github.com/WJT111222/HeiJinWangChao/pull/244)

### 设置全新分区

- 设置整理为七个分区。「模型分配」集中管理正文、三段变量、私聊、群聊、小黑书、记忆、小剧场和生图提示词。跨标签保存会检查设置冲突；电脑端的「设置」「返回首页」固定在右侧栏底部。 [#262](https://github.com/WJT111222/HeiJinWangChao/pull/262) [#263](https://github.com/WJT111222/HeiJinWangChao/pull/263) [#264](https://github.com/WJT111222/HeiJinWangChao/pull/264)

### 更新须知

- 更新前先导出备份。V10 存档会升级为 V11；旧版未结算草稿保留已生成的正文，从「人物与实体」开始重新记录变量。 [#254](https://github.com/WJT111222/HeiJinWangChao/pull/254) [#126](https://github.com/WJT111222/HeiJinWangChao/pull/126) [#250](https://github.com/WJT111222/HeiJinWangChao/pull/250)
- 文生图原有的「独立文本模型」不再使用。要沿用原服务，请在「渠道与密钥」添加渠道，再到「模型分配」指定给「生图提示词」。 [#262](https://github.com/WJT111222/HeiJinWangChao/pull/262)
- 开启全部三段变量后，每回合比原流程多一次请求。只翻看手机不调用模型；私聊每条调用一次，群聊先调度再按回复人数调用，小黑书展开未缓存话题时才调用。 [#250](https://github.com/WJT111222/HeiJinWangChao/pull/250) [#254](https://github.com/WJT111222/HeiJinWangChao/pull/254) [#259](https://github.com/WJT111222/HeiJinWangChao/pull/259) [#260](https://github.com/WJT111222/HeiJinWangChao/pull/260) [#262](https://github.com/WJT111222/HeiJinWangChao/pull/262)

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
