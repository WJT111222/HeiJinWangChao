# 黑金王朝 · 手机端设计包

## 范围与原则

- **适用宽度：** 只针对 ≤900px（`compactSidebars`）。电脑端仍以 `heijin-desktop-design.zip` 为准。
- **只改外观：** 功能、数据、存档 Schema、AI 格式都不变，只改外观和容器。
- **文件用法：** 每份设计稿用手机打开时全屏显示，在电脑上打开时显示在机身框里，右侧是演示控制。演示控制不需要实现。
- **iframe 依赖：** 部分设计稿用 iframe 引用其他设计稿当背景，所以请把所有文件放在同一个文件夹里打开。

## 文件

| 设计稿 | 内容 | 交接文档 |
|---|---|---|
| heijin-mobile.html | 游戏主界面：城市胶囊、沉浸阅读、行动台、底部抽屉框架、世界资料、NPC 示例、三阶段 | MOBILE_MAIN_HANDOFF.md |
| heijin-mobile-home.html | 开场（车票）：封面和存档馆合成一屏 | MOBILE_HOME_HANDOFF.md |
| heijin-mobile-creation.html | 创建角色（空白车票）与开局包 | MOBILE_CREATION_HANDOFF.md |
| heijin-mobile-notices.html | 游玩须知与王朝公告 | MOBILE_NOTICES_HANDOFF.md |
| heijin-mobile-panels.html | 地图 / 经济与资产 / 历史时间轴 / 物品栏 / 设置 | MOBILE_PANELS_HANDOFF.md |
| heijin-mobile-misc.html | 本回合变化 / 全局提示 / 小确认 / 游戏菜单 / 底部选择器 / 诊断 / 候选 | MOBILE_MISC_HANDOFF.md |

## 建议实现顺序

1. 主界面框架：底部抽屉、行动台、城市胶囊、游戏菜单
2. 提示与弹窗、底部选择器（后面的页面都要用到）
3. 开场（车票）→ 须知与公告 → 创建角色
4. 面板：NPC 式的通用模式，再做五个单独设计的面板
5. 本回合变化、诊断、候选

## 尚未设计

- **提示词管理：** 不在本轮范围。
- **平板竖屏（600–900px）：** 目前直接套用手机版。
