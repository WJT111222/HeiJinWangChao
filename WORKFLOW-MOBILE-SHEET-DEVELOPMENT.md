# PR #120 手机工作流最终交互整改

## 当前产品行为（2026-11-13）

基线 PR HEAD `bd0ddd72a4333a2d4a5f18a4f061ae0ad3401354`，main `ee1aac3d60485467e223549b83456eb0f073dbe4`。本轮依玩家最终决定使用**工作流专属非模态抽屉**；上一轮“先关闭模态才能输入/发送”的设计已废止，不代表本次行为。

手机≤900px打开抽屉后，可以真实点击输入框、编辑并发送。抽屉保持显示并更新阶段状态；业务不允许发送时，仍由原条件禁用按钮。关闭再打开回到第一层。Esc、×、上方暗区和拖动条均可关闭并恢复触发条焦点。

两层导航和阶段内容沿用已验收组件：三阶段、独立开关、运行诊断、只读绑定输入；详情包含概览、候选、原文、校验结果及Story叙事规划。完整候选仍须主动展开，不回退旧卡片。

## 最小实现与隔离

- `MobileWorkflowDrawer.tsx` 只接收inputRef、onClose和已有children，无法发起生成或写存档。以Portal渲染到body，局部复用游戏主题；ARIA为非模态dialog，`aria-modal=false`，不调用showModal、不设置inert、不锁body。
- 只在 `GameScreen.tsx` 手机入口替换容器，外加一条import。**send/阶段生成/恢复/取消/结算函数体和禁用条件均没有改动。** PC分支、WorkflowPanel内容、路由、Schema、领域、存储、Prompt完全不动。
- 用行动行真实上沿减6px作为抽屉底边；ResizeObserver监测行动行/输入框/行动台，监听window与visualViewport resize/scroll。顶部暗区只覆盖抽屉上方，底部完全不拦截输入与导航。拖动裁剪于该边界之内。
- Pointer capture仅用于拖动条，拖动不会穿透到发送按钮；短拖回弹、长拖关闭。键盘可通过“行动输入”按钮把焦点送到原输入框，再Tab到原发送按钮，无焦点陷阱，保留可见焦点样式。
- Esc遇到原生 `dialog:modal` 或档案时不处理，先由最上层弹窗处理；嵌套设置关闭后工作流仍开着。
- CSS只在≤900px及工作流专属类中生效。没有修改通用Dialog、#122手机框架CSS/手势、App菜单、状态/世界抽屉、#121公告/KV/Worker、其他确认框或业务权限。
- 已检查开放的手机第二批PR #123：其通用Dialog、Feedback、MobileDiagnostics、RequestUsage等未在本轮修改，也没有擅自合入未合并分支。共同涉及GameScreen时，本轮仅一条入口替换，便于后续保留双方内容。

## 实际交互证据

- 三种手机尺寸390×844、392×640、392×420均真实click输入，再keyboard.type（不是只fill）；长文字增高后抽屉仍在行动行之上，发送按钮可见。键盘进入输入与Tab到发送也验证。
- 不关闭抽屉，真实点击发送；生成中状态为busy、发送按原规则禁用、抽屉仍可见。取消→恢复→World错误→嵌套设置Esc→只恢复World→正式结算和刷新一致。
- 上述取消/失败链路严格5次Mock（被取消Story、恢复Story、Variables、失败World、恢复World），第一次正式revision只+1。随后再次打开抽屉，不关闭直接编辑发送：恰好Story/Variables/World三次，第二次revision只+1。合计8次全部对应玩家明确操作，没有自动重试/重复结算。
- 查看、编辑但不发送、四种关闭方式、跨900px展示均不改变正式状态/候选，也不调用模型。
- 将拖动条拖至**已启用的发送按钮位置**后释放，仅关闭抽屉，输入保持、0请求、正式状态完全相同；既有业务守卫未用作掩盖误触（测试先断言发送按钮enabled）。
- 变量JSON主动展开、原文/诊断读取、返回第一层及焦点沿用既有逻辑。对外层抽屉只改变其非模态ARIA预期，未削弱其他隐私/候选/存档断言。

## 截图及PC严格对照

真实Chromium React页面，截图暂停CSS动画以稳定对照：

- [390×844](docs/pr120-integration/screenshots/390x844.png)
- [392×640](docs/pr120-integration/screenshots/392x640.png)
- [392×420](docs/pr120-integration/screenshots/392x420.png)
- [短视口抽屉打开、已输入并可发送](docs/pr120-integration/screenshots/send-open-392x420.png)
- [901px](docs/pr120-integration/screenshots/901x900.png)
- [1440px](docs/pr120-integration/screenshots/1440x900.png)

PC与整改前bd0ddd7图像用RGB逐像素核对：1440px零差异；901px仅18个边缘像素、差异包围框(277,494)-(484,762)，最大通道差4级，无尺寸差异。详见 `nonmodal-desktop-comparison.json`。早先RGBA的bbox检查会忽略alpha相同的RGB差异，已改为RGB比较并更正结论；**不再宣称901px像素完全相同**。生产PC渲染分支、WorkflowPanel及原PC CSS没有任何变化，整合截图中PC页签/Esc仍通过。

## 本轮独立测试批次

Node v24.19.0，同锁文件依赖，全部AI请求Mock。未运行700项完整E2E，未重新执行上一轮8项整批/33项单测或全量Vitest。

|批次|实际结果|
|---|---|
|非模态首次交互|3通过、0失败、1桌面预期跳过，45.7秒|
|增加长输入/正常三阶段精确计数|3通过、0失败、1桌面预期跳过，50.1秒|
|受影响390手机骨架及工作流专用兼容|2通过、0失败/跳过，16.3秒|
|拖动越过已启用发送按钮增强|1失败：测试在断言回焦前fill清空输入，自行移动了焦点；不是生产回焦失败|
|修正清空动作在回焦断言之后|1通过、0失败/跳过，27.7秒|

请求/结算/输入保持断言均保留。各批独立记录，不相加冒充一次全绿。TypeScript、Lint、生产构建、差异检查实际通过；构建仅已有大chunk体量警告。结果见 `docs/pr120-integration/nonmodal-validation.json`。

## 边界

392×420与visualViewport监听是浏览器模拟，不等于真实iOS/Android键盘、输入法/安全区体验。#123尚未合入，本轮不处理其通用交互；未来合并应保留本专属容器和两层业务内容。没有真实付费AI、没有合并或部署，交九代目最终审查。

上一轮模态整合的测试/失败记录仍保留在Git历史及 `validation.json`，属于历史方案，不能作为当前非模态交互的验证。
