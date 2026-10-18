# UI 模块

`creation/` 是五步向导及资料转换；`game/` 是三栏界面；`panels/` 提供玩家可见数据投影和七个独立资料面板；`settings/` 保存四类本地偏好。`Dialog.tsx` 统一弹窗焦点、键盘及滚动行为。

正式状态只从 M1 `SaveRepository` 读取，创建资料先经 M1 Schema 校验再入库。界面不执行领域命令，不持有第二套装备状态，也不调用 AI。详细边界及可见性处理见根目录 `M2-DEVELOPMENT.md`。
