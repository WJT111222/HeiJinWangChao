# 角色创建 AI 补全验收

## 入口与生成目标

| 步骤 | 按钮位置 | 提示词 | 默认生成目标 |
| --- | --- | --- | --- |
| 基本信息 | 外貌输入框右下方 | [appearance.md](../prompts/creation/appearance.md) | 150–200 字 |
| 基本信息 | 性格输入框右下方 | [personality.md](../prompts/creation/personality.md) | 150–200 字 |
| 职业与能力 → 自由选择 | 职业介绍输入框右下方 | [profession.md](../prompts/creation/profession.md) | 介绍 150–200 字、技能 4 项、长期影响 100–150 字 |
| 城市与背景 | 人物背景输入框右下方 | [background.md](../prompts/creation/background.md) | 300–500 字 |

点击时发送该字段已有内容和要求，背景补全也参考当前职业与性格。玩家可以直接在原输入框写明长度或技能数量。默认数字仅作为提示词目标。职业只填写名称即可生成，一次请求返回严格的三字段 JSON，解析全部通过后一次写入介绍、每行一项的技能和长期影响。职业名称继续由玩家填写。

## 请求和表单状态

补全读取点击时的正文路由、渠道、模型、协议兼容设置、温度、凭证和请求超时。使用现有 `AiClient` 进行一次非流式请求，按补全类型和显式的数字篇幅要求分配预算，已配置的渠道输出上限仍适用。补全正文不进入回合请求检查器。配置缺失、返回不完整或请求失败时就地提示，保留表单数据。相同入口在等待期间不可重复提交。编辑相关内容、换步骤或退出创角会使旧响应失效。生成成功的文字可以继续编辑和通过原创角草稿机制保存。

## 真实页面截图

Chromium 154。桌面 1440×1000，移动端为 Pixel 7 模拟视口 412×839。截图均来自真实 React 页面，内容为 Mock 夹具。

| 界面 | 桌面 | 手机 |
| --- | --- | --- |
| 外貌与性格 | [截图](screenshots/creation-ai-completion/desktop-basic.png) | [截图](screenshots/creation-ai-completion/mobile-basic.png) |
| 职业介绍、技能和影响 | [截图](screenshots/creation-ai-completion/desktop-profession.png) | [截图](screenshots/creation-ai-completion/mobile-profession.png) |
| 人物背景 | [截图](screenshots/creation-ai-completion/desktop-background.png) | [截图](screenshots/creation-ai-completion/mobile-background.png) |

Mock 检查的是组装后的实际请求、默认与玩家指定要求、字段写入、失败保留及请求次数。实际模型采用这些篇幅与技能数量的稳定程度尚未测试。

## 验证命令

- `npm ci` 使用项目锁文件安装依赖。正式环境为 Node 24.19.0。
- `npm run check` 覆盖文件名、ESLint、完整 Vitest、命令目录、TypeScript 与生产构建。
- `npm run prompts:check` 复核 93 项，保留六套回合主模板，并验证新增创角资源的哈希和加载范围。
- `npx playwright test e2e/creation-completion.spec.ts e2e/character-creation-v2.spec.ts e2e/opening-packs.spec.ts --workers=1` 覆盖桌面和手机各 9 项。开局包回归定位出背景输入框与新增按钮的无障碍名称都包含「人物背景（可选）」，调整按钮名称后原测试通过。
- `git diff --check` 检查提交差异。
