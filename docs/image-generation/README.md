# 黑金王朝 1.0 文生图

在「设置 → 文生图」启用并配置图片接口。主角和 NPC 的档案提供头像、半身照及全身立绘，地图详情、物品栏和车辆提供各自的图片槽位。已结算的正文回合可以手动生成插画。关闭总开关会隐藏档案入口并保留图库。设置中的图片管理器可以浏览当前存档，也可在首页选择其他存档。

已选图片会出现在对应的档案和回合末尾，现役家庭成员详情支持独立居家照。位置清单、截图、存档兼容和长档实测见[展示与家庭兼容](展示与家庭兼容.md)。

多个标签页编辑设置时，不同字段会自动合并。同一字段出现冲突时可逐项选择本页或其他页面的值。关闭一项自动生成规则会取消对应的等待任务，已经开始的任务可继续完成，也可手动取消。[配置保存、数据库升级与封板验收](封板复审.md)

## 接口与费用

| 后端 | 配置与请求 | 回包与限制 |
|---|---|---|
| OpenAI 兼容 | 基础地址可含 /v1，默认提交 images/generations，附模型、尺寸、n=1；负向要求以自然语言拼接。自定义 chat/completions 路径走非流式消息格式 | 支持 b64_json、base64、嵌套图片字段、URL、二进制以及消息中的 Markdown 图片。带 task_id 的兼容服务使用同源 tasks 查询。自定义服务实际支持的尺寸、模型和路径由服务决定 |
| NovelAI | ai/generate-image，一张样本；可配置模型、采样器、步数、种子、CFG、噪声计划。4 系列使用 v4_prompt 与 v4_negative_prompt，其他模型使用 negative_prompt | 原生位图或 ZIP 中首张支持的图片。支持普通 ZIP 的 stored 和 deflate，以及包含明确大小的本地文件头。加密 ZIP、ZIP64 和破损文件不在兼容范围 |
| ComfyUI | 粘贴 API 格式工作流。适配常见文本编码、latent、采样节点与上游占位符。POST prompt 后用对应 prompt_id 查询 history，再通过 view 读取 output | 模型、节点、工作流运算量由玩家的服务器决定。使用浏览器取消本次提交、查询和下载；服务器已开始的工作流可能继续运行。不会中断其他人的队列 |
| SD WebUI | sdapi/v1/txt2img，分别设置 prompt 和 negative_prompt，一次一张；支持 steps、cfg_scale、sampler_name、scheduler、seed 和可选 checkpoint 覆盖 | 解析 images 数组。服务端需启用 API，并允许游戏网页跨域访问。扩展脚本、私有插件参数未验收 |

浏览器只访问玩家配置的服务和响应指定的图片地址。图片下载省略认证头、Cookie 和 Referer，拒绝重定向。连接测试只查询接口信息；NovelAI 官方图像域使用官方账户 API 查询订阅。跨域许可、服务端模型安装和账户权限会影响实际可用性。

| 操作 | 请求行为 |
|---|---|
| 直接生成／手动重绘 | 至多 1 次生图提交 |
| 启用词组转化器 | 先提交 1 次独立文本请求，转换成功后才提交生图 |
| 提取形象锚点 | 点击后发出 1 次独立文本请求，玩家确认保存后只更新本地锚点 |
| 自动任务 | 四个触发开关分别授权。有效新结算进入队列；已有对应图片、重复回执和未结算候选不会产生首次生图 |
| 上传、预览、收藏、改名、导入导出 | 0 次模型调用 |

同源标签页通过 Web Locks 串行执行生成任务，文本转换与生图提交之间至少间隔 10 秒。单个运行任务超时为 10 分钟。ComfyUI 和异步 OpenAI 的状态查询及结果下载可产生额外 HTTP 请求。任务取消会中止浏览器请求，供应商可能已计费。失败与页面崩溃均不自动重发。崩溃遗留的任务在重新进入该存档并启用功能后核对锁状态，保留为任务记录。

## 数据格式与恢复

| IndexedDB V8 对象仓库 | 主键及内容 |
|---|---|
| imageFiles | [saveId, pictureId]，独立位图资源，以 Base64 保存；单张原始文件上限 16 MiB |
| imageCollections | saveId，图片用途、资源引用、当前选择、标题、收藏和人物形象锚点 |
| imageJobs | [saveId, jobId]，任务状态与来源身份；索引支持同一主体及用途的去重 |
| imageVersions | saveId，图库变更版本，供备份提醒及覆盖确认使用 |

所有图片均使用独立资源身份；收藏与当前选择共用同一条资源记录。图库容量按原始文件字节累计，IndexedDB 的实际占用还包括编码和索引。写入图片与元数据在同一个事务提交。删除图片同步移除收藏，正常删除存档会回收该档案所有图片、锚点和任务。不可读存档的原始导出不含图片，存在关联图片时会保护原数据。

有图库版本的完整备份使用 heijin-backup V3，在对应 saves 条目携带 images，保存所属存档 ID、创建时间、资源和关联。备份仍受原有 256 MiB 文件限制。已清空的图库可显式导出空集合。未使用图片的存档沿用 V2，历史节点单独导出保持 V1。在设置中取消「普通存档备份包含图片」可导出轻量备份。缺失 images 表示该文件未携带图片集合；覆盖已有相同存档身份时保留本机图库。导入验证身份、位图类型、尺寸、大小、资源 ID、用途和引用，复核比较时的图库版本，连同进度及小剧场原子写入。旧客户端会拒绝未来备份版本。

当前关联同时检查稳定实体 ID、相关正式回合 ID 和可用的实体身份信息。人物与物品不会因名称相同而重新绑定。回溯后仍可导出旧图片，已离开当前时间线的关联显示为「历史关联」。异步保存额外比较存档 ID、创建时间和导入／回溯实例。已有真实年龄及外貌作为生成输入，锚点和转换结果仅属于图片库。

## 代码来源及维护

上游基线、逐文件依赖与排除范围见 [迁移审计](审计.md) 和 [源文件清单](upstream.tsv)。许可与鸣谢见 [第三方来源](../../THIRD_PARTY_NOTICES.md)。

| 文件或目录 | 改动 |
|---|---|
| src/services/images/promptTokens.ts | 从 imageTasks.ts 提取结构化人物词组解析、思考块清洗、带权重词组去重、NAI 权重语法及单段序列化 |
| src/services/images/comfyWorkflow.ts、sizes.ts | 迁移 comfyWorkflowTools.ts 的节点与旧式占位符规范化，以及 imageSizeOptions.ts 的尺寸和方向 |
| src/services/images/protocol.ts、raster.ts | 从 imageTasks.ts 的四条请求分支、返回字段识别、ComfyUI 状态轮询与 ZIP 目录处理适配到浏览器直连、限量读取和受控解压 |
| src/services/images/config.ts、model.ts、library.ts、queue.ts | 王朝配置、最小资料投影、来源身份、图库、任务及费用控制 |
| src/ui/images | 共用设置、档案操作、图片管理器和相册 |
| src/ui/game、src/ui/panels、src/ui/settings/SettingsPanel.tsx | 现有档案与设置入口；GameScreen 已结算回调派发独立任务 |
| src/services/storage、src/ui/home、src/app/App.tsx | V8 库升级、备份兼容、资源回收与备份状态刷新 |
| src/services/ai/credentials.ts | 在已有脱敏流程中识别独立图像和文本密钥 |
| src/tests/image-generation.test.ts、e2e/image-generation.spec.ts、e2e/automatic-settlement.spec.ts | 协议、恢复、队列、费用、真实 Chromium 界面和主线联动 Mock 测试 |
| 现有备份、历史存档、不可读存档与未来版本测试 | 跟随数据库及备份版本更新测试夹具 |
| announcements/current.json、THIRD_PARTY_NOTICES.md | 正式版公告条目与作者鸣谢 |

合流时请核对最新 release/1.0 的数据库与备份版本，保留小剧场的版本标记、两阶段覆盖确认和旧客户端 versionchange 处理；并行专项若也增加对象仓库，需在一个升级分支中创建各自仓库。图像配置独立于文学预设、领域命令和主线 AI 路由。预期的正式结算顺序仍为 Story → Variables → World → 原子提交。

验收范围、原始终端输出及双端截图见[验收记录](验收.md)。
