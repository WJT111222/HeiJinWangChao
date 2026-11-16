# 正文阶段独立流式开关

开工基线：`main@6d6d0d135cf1dfd5cfcdeb01ff971ea7229f57ff`；验收期间无冲突快进同步至最新 `main@6ebda9797feedf530fa4ce78d1afe8cf6477578e`（#168，仅日间CSS与其E2E，不计入本PR差异）。独立分支 `feat/story-stream-toggle`；Node 24.19.0，真实 React + Chromium154，所有模型请求使用本地 HTTP Mock 或注入 Mock。

## 行为与边界

设置 → 运行新增「正文生成 · 流式传输」，对应 `runtime.streamStory`，默认true，旧设置缺字段时也为true。读取旧设置不会自动写回或重置其他偏好；显式保存后刷新保留选择。变量和世界的两个既有流式开关仍独立，默认值不变。

开启时沿用原有SSE逐字预览。关闭时传给AiClient的stream为false，走既有JSON读取、正文解析、校验和CAS草稿保存。等待期间只显示“正在等待完整正文”；即使完整JSON已经到达，在草稿保存成功前也不提前显示正文或思考。保存成功后由原来的onSaved/onDraft回调展示完整正文。

`readingPhase='waiting'`只是内存中的展示状态；协调器仅同步进度类型，没有改执行逻辑。取消、超时、失败摘要、Web Locks、迟到检查和原子结算保持原样；HTTP500仍按现有协调器最多尝试两次，两次使用同一个已快照的传输偏好。没有新增自动请求、模式探测或静默换模式重发。开关在运行中更改只影响后续请求。

未修改GameState、TurnDraft、Repository、AiClient、供应商适配器、正文Schema或Prompt。只新增本地设置字段，不升级设置版本或游戏存档。

## 修改文件

- `src/ui/settings/model.ts`：本地设置默认值及旧字段缺失兼容。
- `src/ui/settings/SettingsPanel.tsx`：独立开关和简短说明。
- `src/workflows/storyStage.ts`：读取本次快照的传输偏好；非流式保存完成前保持等待投影。
- `src/workflows/turnCoordinator.ts`：仅进度类型增加waiting。
- `src/ui/game/StoryStreamReading.tsx`、`GameScreen.tsx`：等待状态和准确的临时展示标签。
- `src/tests/story-stream-toggle.test.ts`、`story-stream-reading.test.tsx`、`e2e/story-stream-toggle.spec.ts`：对应回归。

## 验证范围

真实Repository单测覆盖OpenAI/DeepSeek/Gemini/Anthropic完整JSON、截断/过滤/未知结束信号拒绝、非法JSON/正文拒绝、保存前隐藏、进行中偏好快照、取消和迟到、超时、缺少Web Locks零请求、CAS过期拒绝及既有500两次尝试。

PC1440×1000与手机412×839各8项Chromium：两种模式分别成功、手动失败和取消；旧设置/三个开关独立保存、放弃与刷新；非流式超时。通过真实HTTP连接先发送SSE或不完整JSON片段，再补齐响应：JSON未完整及未保存时只显示等待，SSE原有预览正常。成功流程仅Story→Variables→World各1次，正式回合只增加1次；刷新零额外模型POST；失败/取消保留正式状态。

### 真实截图

| 视图 | PC | 手机 |
| --- | --- | --- |
| 独立运行设置 | [截图](evidence/desktop-runtime-settings.png) | [截图](evidence/mobile-runtime-settings.png) |
| 原有流式片段 | [截图](evidence/desktop-streaming.png) | [截图](evidence/mobile-streaming.png) |
| 等待完整正文 | [截图](evidence/desktop-waiting-full-story.png) | [截图](evidence/mobile-waiting-full-story.png) |

### 原始批次记录

- 修改前：2项测试失败，另有1次未及时观察的Promise拒绝（原严格设置Schema拒绝新字段）。新增拒绝观察后继续保留相同断言。
- 首轮既有/新增定向：147通过，0失败。
- 扩充协议矩阵批：206通过、1失败；Gemini合成夹具误将未知结束原因写成SAFETY，修正夹具保留未知值，不修改生产结束校验。
- 修正后定向：55通过，0失败；后续Web Locks/CAS两项纳入完整工程检查。
- Chromium最终独立批：16通过，0失败/跳过，retries=0。

上述批次分别记录，不拼接成一次全绿。原始日志在 `evidence/raw-logs.tar.gz`，截图及SHA-256清单保存在同目录。

## 限制

本轮不调用付费模型；Mock验证协议、请求次数与事务行为，不代表供应商一定支持特定模式或生成质量。手机为Chromium设备模拟。沿用既有供应商响应和正文校验规则，不补造截断内容、不把失败转换为成功。

保持Draft，不合并、不部署，等待审查。

## 最终工程成绩

最终基线为上述6ebda97。Node24执行：

| 命令/批次 | 实际结果 | 退出码 |
| --- | --- | --- |
| `npm ci` | 按锁文件成功安装 | 0 |
| 同步后完整 `npm run check` | 166文件、4016项Vitest通过，0失败/跳过；文件名、Lint、TypeScript、命令目录、生产Build通过 | 0 |
| 同步后 `npm run prompts:check` | 93通过，0失败/跳过 | 0 |
| 同步后PC/手机Chromium | 各8项，共16通过，0失败/跳过 | 0 |
| `git diff --check` | 通过 | 0 |

同步前完整check同为4016通过，浏览器16通过；各批日志单独保留，不累加成8032项或32项单次成绩。构建有主包超过500kB的非阻断提示，本次不做拆包。没有全量浏览器测试、付费模型请求、合并或部署。
