# PR #165 日间可读性整改与验收

本轮三项缺陷均已修复。最终本轮范围内 **38个独立 Chromium 场景通过，0失败、0跳过**；Node 24完整工程检查通过。只推原 `feat/day-appearance` 分支，不新建PR，不合并、不部署、不发布。

## 基线和同步

- 审查锚点：`aaf5e1e54c4552b26eccefa7741e3c68c7ad0b19`。
- 开工与交付前确认的 main：`e0e2b446136b9589bf60094d9975a807ab06fbdf`。
- 先合入main，得到修复前对照 `2f77a6fa4859cb7ac3eeb588ca0c4e862a0a6972`；#163、#164均完整保留。
- 收尾时远端另有作者提交 `627b11506a15bd2829abada7a1d36387643d6ee8`，仅更新 `announcements/current.json`。原样同步后为 `942d6e53f041e45afc4e4a39879c1ec495aeb024`，没有改写该公告，也没有审改或发布其内容。公告工作流只在main push或手动触发；本轮未触发。
- 最终HEAD见本PR与交付消息。本报告及证据随同一分支提交。远端公告同步后，完整check和原有六项外观冒烟再次通过；样式源文件与此前完整矩阵相同。

## 三项修复

本轮新增生产改动仅在 `src/ui/game/day-appearance.css`，没有修改 `city-night.css`、`mobile-game.css` 或对白渲染函数。

### P1：对白、姓名、引号与历史淡化

主角对白改用深墨正文色；主角姓名、头像和引号使用更深的古铜色，保留2px强调线和轻暖色气泡。NPC保留原有1px线。阅读区辅助字也使用足够深的墨色。

历史回合原有父级透明度仍保留，正文局部使用更深的颜色补偿透明合成，避免当前回合达标而历史仍不达标。没有更改其他城市铭牌的原有淡化、几何或配色。

初次修正后，手机历史对白实测仍仅4.37:1，PC历史哈尔滨小字4.26:1；后续进一步调整了对应色值。扩充引号测试还发现PC上海／广州在较暗的实际渐变区域仅约3.93–3.97:1，已收紧阅读区古铜色，保留4.5:1断言。

### P2：哈尔滨铭牌

只在日间、哈尔滨身份下设置不透明钢青底、实心浅色数字和回目／副标题。保留冰拱轮廓、边缘高光、霜纹及原有缩放。历史牌底加深以补偿整体透明度。

日间哈尔滨的草稿灰度滤镜和预览淡出动画停用，防止文字再次变灰或周期性淡至不可读；现有「草稿／预览」文案继续表示未结算。正常动效环境也断言牌面不再使用淡出动画。其余城市和夜间哈尔滨不变。

`.p-cn` 在正式组件中是中文回目，`.p-sub` 是TURN编号，本轮保留真实内容；没有为了“城市名称”要求虚构新的铭牌字段。城市品牌仍读取原固定开局城市。

### P2：深色工作流边界

同时恢复夜间变量与实际 `color`，并覆盖手机非模态 `.workflow-floating-drawer`，使PC标题和手机「行动输入」都得到匹配背景的文字色。日间打开深色浮层时，辅助灰字略提亮以达到目标对比度。

日间主界面按钮的覆盖明确排除原生Dialog和工作流内容，避免主界面的白字金按钮规则侵入深色工作流。纸页自身的变量继续优先，不使用全局 `!important`。原有Dialog、焦点、开关、事件处理和业务禁用条件均未改变。

## 对比度证据

以下为同一合成存档、同一浏览器、同一测量方法的修复前后比较；因此可能与上轮单点采样略有不同。完整数据：[配对量测](evidence/contrast-pairs.json)，[207条覆盖记录](evidence/contrast-records.json.gz)。

| 对象 | PC 修复前 → 后 | 手机修复前 → 后 |
| --- | ---: | ---: |
| 当前主角对白 | 1.09 → **11.21** | 1.02 → **10.50** |
| 哈尔滨当前TURN小字 | 1.50 → **7.11** | 1.51 → **7.68** |
| 哈尔滨历史TURN小字 | 1.22 → **4.67** | 1.27 → **5.01** |
| 工作流标题 | 1.27 → **15.26** | 14.91 → **14.91**（原内层已正常） |
| 手机「行动输入」 | 不适用 | 1.24 → **14.91** |

最终矩阵中：

- 四城当前／历史主角对白最低 **5.00:1**。
- 主角与NPC姓名最低 **4.97:1**；主角引号最低 **5.23:1**。
- 哈尔滨数字／回目／TURN小字，覆盖当前、历史、草稿、真实SSE预览，最低 **4.67:1**。
- 工作流标题、正文、辅助说明、启用按钮及焦点／hover／错误状态等指定记录最低 **5.97:1**。
- 普通文字按4.5:1断言，大字按WCAG AA适当阈值判定。禁用控件保留原禁用条件并采集样式；不把WCAG豁免的禁用文字伪装成AA通过。

### 测量方法与边界

`e2e/helpers/readabilityContrast.ts` 读取实际computed paint，再让Chromium渲染两张同几何局部截图：一张隐藏字形，保留真实背景；另一张以该文字的paint绘制内部色样。浏览器本身处理渐变、半透明、祖先透明度、滤镜和叠层，随后比较内部采样点，取最差值。

这不是仅比较颜色深浅，也不把透明CSS颜色直接当成有效背景。测试隐藏字形的临时样式只用于截图且立即移除；没有进入产品CSS。流式光标属于装饰，采样时隐藏，避免把光标自身同色像素当成正文对比度。

测量使用完整覆盖的前景paint，按WCAG不把抗锯齿边缘当作独立前景色，也不依赖文字阴影提高成绩。旧冰刻透明数字以描边paint作名义测量，不能据此认证细描边字形本身；复杂霜纹、冰拱、缩放和阴影还结合真实截图人工核对。本轮不宣称全站／所有天气／所有屏幕均已做可访问性认证。

## 夜间与其他城市

[夜间对照数据](evidence/night-comparison.json)：四城×PC／手机共8组，最终实际像素差均为 **0**；关键computed颜色、背景、透明度、滤镜、缩放、描边、阴影严格相等。

新增截图比较器校准时，在修复前版本与其自身比较也出现过极少量1/255色阶差，因此比较器限定最多1个RGB单位且不超过0.01%像素，同时要求关键样式严格相等。这个限度没有用来遮掩改色；最终8组实测均为0差异。没有放宽任何原有业务断言。

重庆、上海、广州的日间牌面、数字、中文回目、副标题样式也与修复前严格比较一致。所有正式数据、固定开局城市、当前位置、时钟、星期和天气逻辑均未修改。

## 测试结果

环境：Node **24.19.0**、npm **11.9.0**、Chromium **154.0.8037.57**、Playwright **1.64.1**，真实项目依赖与正式运行器。

| 检查／最终批次 | 实际结果 | 退出码 |
| --- | --- | ---: |
| `npm ci --cache /workspace/.npm` | 安装143个包成功 | 0 |
| `npm run check`，最终同步后 | ESLint、163文件／**3980项Vitest**、TypeScript、catalog、文件名检查、Build全部通过 | 0 |
| `npm run prompts:check` | **93通过**（完整Vitest的子集，不重复计数） | 0 |
| 主要Chromium矩阵 | **30通过，0失败／跳过** | 0 |
| 旧设置专门兼容 | **2通过，0失败／跳过** | 0 |
| #163／#164既有相关回归 | **6通过，0失败／跳过** | 0 |
| 取消原子状态加强断言 | **2通过**，与主要矩阵重叠，不加总 | 0 |
| 同步远端公告后外观冒烟 | **6通过**，与主要矩阵重叠，不加总 | 0 |
| `git diff --check`／暂存差异检查 | 通过 | 0 |

最终本轮共 **38个独立浏览器场景**，没有把开发期重跑或同步后重复冒烟加总为独立通过。没有运行约700项完整E2E。构建有大chunk提示，退出码为0，未扩展至打包优化。

### 矩阵覆盖

- 四城×双端：主角、NPC、旁白、姓名、引号、当前／历史；日间、夜间、跟随系统与系统实时切换。
- 哈尔滨：普通、历史、正式合法Story草稿、实际单次SSE请求中的未完成预览。SSE保持打开后检查，再主动取消；不改变已有流式阅读和解析逻辑。
- 工作流：待生成、生成中、失败、已完成；PC与手机标题、普通文本、辅助字、按钮、焦点、hover、禁用状态、错误信息及真实诊断入口。
- 纸页：人物档案、NPC世界资料、设置；确认没有被夜间变量误伤。
- 设置：三选一即时保存、刷新恢复、跟随系统；未保存运行值和提示词值不被外观切换覆盖；存储失败回退。
- 旧设置：真实删除display字段后重载，默认夜间，不自动回写，其他提示词／运行／流式偏好保持；主动选日间后仍保留这些偏好。
- #163：人物与世界目录上拉、收起、长内容、七分类、二级入口、只读状态。
- #164：自动失败摘要、复制、清空、刷新、原文生命周期；无Web Locks不发请求与过期草稿保护，双端各2项。

本轮最后范围内没有旧E2E失败，无需将无关失败归因于main。没有沿用作者此前“45项失败”的口头判断，也没有删除或弱化既有六项外观测试和主干业务断言。

### 红到绿与工具修正

修改生产CSS前，正式Chromium三项定向测试全部按预期失败：主角浅字、哈尔滨透明底、PC标题黑字。原始记录在 `logs/red.log.gz`、`evidence/red.json.gz` 及 `traces/before-*.zip`。

开发期记录也保留：历史透明合成与引号对比度不足是真实问题，继续修正CSS后通过；预览初期定位用了正式对白class，而现行流式组件仍是单独的prose段落，已修正测试定位，没有改渲染逻辑；光标导致的1:1测量假象改为忽略明确装饰。夜间自比较量化问题记录于 `night-self.*`。所有批次原始日志在 [logs](logs/)，没有添加skip或自动重试。

## 数据与请求保护

[保护源码核对](evidence/source-verification.json) 证明GameState、TurnDraft、Repository、三阶段、对白／流式渲染、Dialog、手机手势、#164失败摘要与main相同。GameScreen相对main只有原PR的日间CSS导入。

纯阅读／切换外观前后，Repository正式状态和草稿相同。四城普通浏览实测POST为0；工作流运行／失败场景各只发一次本机Mock请求，取消后不保存候选，不推进正式状态，没有自动重试。没有使用真实玩家存档或真实API Key。

所有源码修复只影响日间展示，没有恢复主动「重新Roll」，没有改变Schema、协议、Prompt、模型路由、CAS、Commit、Undo或Memory维护。远端公告原样保留，但未执行公告发布或生产部署。

## 截图与人工核对

所有截图来自真实React＋合成GameState，不是静态设计图。手机主要矩阵为390×844（Pixel 7 DPR，文件像素更高），PC为1440×1000。

| 场景 | PC | 手机 |
| --- | --- | --- |
| 重庆当前正文 | [截图](screenshots/desktop-chongqing-day-current.png) | [截图](screenshots/mobile-chongqing-day-current.png) |
| 上海当前正文 | [截图](screenshots/desktop-shanghai-day-current.png) | [截图](screenshots/mobile-shanghai-day-current.png) |
| 哈尔滨当前正文 | [截图](screenshots/desktop-harbin-day-current.png) | [截图](screenshots/mobile-harbin-day-current.png) |
| 广州当前正文 | [截图](screenshots/desktop-guangzhou-day-current.png) | [截图](screenshots/mobile-guangzhou-day-current.png) |
| 哈尔滨修复前 | [截图](screenshots/desktop-paired-before-reading.png) | [截图](screenshots/mobile-paired-before-reading.png) |
| 哈尔滨历史牌 | [截图](screenshots/desktop-harbin-past-plate.png) | [截图](screenshots/mobile-harbin-past-plate.png) |
| 哈尔滨草稿 | [截图](screenshots/desktop-harbin-story-draft.png) | [截图](screenshots/mobile-harbin-story-draft.png) |
| 哈尔滨真实流式预览 | [截图](screenshots/desktop-harbin-live-preview.png) | [截图](screenshots/mobile-harbin-live-preview.png) |
| 待生成工作流 | [截图](screenshots/desktop-workflow-pending.png) | [截图](screenshots/mobile-workflow-pending.png) |
| 失败工作流 | [截图](screenshots/desktop-workflow-failed.png) | [截图](screenshots/mobile-workflow-failed.png) |
| 诊断 | [截图](screenshots/desktop-failed-diagnostics.png) | [截图](screenshots/mobile-failed-diagnostics.png) |
| 纸页人物 | [截图](screenshots/desktop-day-profile-paper.png) | [截图](screenshots/mobile-day-profile-paper.png) |

其余夜间、系统模式、已完成／生成中工作流、NPC、设置及配对截图全部在 [screenshots](screenshots/)。人工核对确认：对白保留区别；哈尔滨仍为带霜纹冰拱而非通用方块；各状态数字和TURN可辨；工作流标题与操作清楚；纸页仍为纸页配色。

## 剩余覆盖边界

没有执行真实iPhone／WebKit、Firefox或其他操作系统字体与色彩配置；没有遍历所有天气、任意缩放和更窄屏幕。复杂背景结论限于本次真实像素采样与列出的截图，不伪造其他环境对比度，也不宣称全站AA。

## 本轮修改文件

- `src/ui/game/day-appearance.css`：三项修复及必要历史／辅助字对比度补偿。
- `e2e/day-readability.spec.ts`：四城双端矩阵、实际配对、状态／设置／隔离与夜间比较。
- `e2e/helpers/dayReadability.ts`：合法合成档案、草稿和本机Mock配置。
- `e2e/helpers/readabilityContrast.ts`：浏览器实际合成采样与严格夜间差量。
- `playwright.day-readability.config.ts`：明确范围、专属端口、零重试、修复前对照。
- `docs/day-appearance-readability/`：报告、日志、测量、截图和红测trace。

原PR的外观设置实现保留；合入main和远端公告属于同步已有提交。完整本轮清单和证据哈希随报告交付。完成后停止，等待十二代目复审。
