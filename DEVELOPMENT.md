# 工程开发说明

M2 已实现入口、五步角色创建、三栏界面、七个资料面板和四类本地设置，见 [M2 开发与验收说明](M2-DEVELOPMENT.md)。M1 的领域与存档说明保留在 [M1-DEVELOPMENT.md](M1-DEVELOPMENT.md)。以下为 M0 初始化记录，启动命令仍适用。

本次仅完成工程初始化。正式依据为原有 `docs/` 开发文档、`prompts/docs/ASSEMBLY.md` 与 `prompts/manifest.json`；这些文件及提示词原文保持不变。

## 技术选择

- Node.js 24 LTS + npm，使用 `.nvmrc` 统一主版本，提交 `package-lock.json` 固定依赖。
- React 19 + TypeScript 5.9 严格模式：为后续多面板 UI 提供成熟组件体系，业务模型保持独立。
- Vite 8：本地开发、热更新、静态生产构建，无需服务端或真实 API。
- 原生 CSS：M0 页面体量很小，暂不引入 UI 库。
- ESLint 10 + typescript-eslint + EditorConfig：基础代码规范。
- Vitest 5 + fake-indexeddb：建立无 AI 的确定性测试环境。

当前仅根路径 `/` 一个页面，由 `src/app/App.tsx` 承载；后续出现多页面需求时再引入路由库。与技术计划建议目录的差异是：提示词文本继续保留在根目录 `prompts/`，`src/prompts/` 仅预留运行时代码，避免两份提示词真值。

## 启动与检查

```bash
nvm use
npm ci
npm run dev
```

打开终端输出的地址（默认 `http://localhost:5173`）。启动后显示“黑金王朝”、项目简介与 M0 状态。无需 `.env` 或任何密钥。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run typecheck` | TypeScript 类型检查，包含源码、测试及 Vite 配置 |
| `npm run lint` | 代码规范检查，警告视为失败 |
| `npm test` | 单次执行测试 |
| `npm run test:watch` | 监听测试 |
| `npm run build` | 类型检查并构建到 `dist/` |
| `npm run preview` | 本地预览生产构建（默认端口 4173） |
| `npm run check` | 规范检查、测试、类型检查与构建 |

## 目录与边界

```text
src/
  main.tsx          React 挂载入口
  app/              页面壳与基础样式；当前仅根页面
  ui/creation/      角色创建 UI 预留；其他面板按实际需求增加
  domain/           变量、人物、组织、时间、事件及记忆领域预留
  workflows/        AI 三阶段编排预留
  prompts/          提示词注册与组装代码预留
  services/
    ai/             AI 适配预留
    storage/        存档、快照与迁移预留
    validation/     输出与状态校验预留
  tests/            M0 存储测试环境
prompts/            已有提示词原文、清单、契约及示例，保持原样
docs/               已有正式开发依据，保持原样
```

未开发目录只存放说明或 `.gitkeep`，没有领域类型、假 API、空服务类或状态机占位实现。页面不读取游戏状态，也不自动写入数据库。

## M0 验收范围

IndexedDB 测试使用测试内独立数据库与最小样例，验证关闭重开后的数据读取及事务中止不留残余。`fake-indexeddb` 是测试模拟，不代表真实浏览器兼容性或完整游戏存档验收。运行时存档仓库、领域 Schema、迁移、跨对象原子提交仍属于 M1。

本次在 Node.js 24.19.0 / npm 11.9.0 环境执行并通过：

- `npm ci`：从锁文件安装成功。
- `npm run check`：ESLint 无警告，2 项存储测试通过，类型检查与生产构建成功。
- 开发服务器及生产预览的 Chromium 检查：1440×900、375×812 两种视口均返回 HTTP 200，React 正确显示标题，无横向溢出或页面脚本异常。
- 原有 70 个文件逐个 SHA-256 核对一致；`git diff --check` 通过。

## M1 准备建议

1. 按正式规范锁定六大变量组、四类组织的 Schema，统一对象 ID、游戏时间、事件和任务契约。
2. 明确唯一状态来源、`schemaVersion` 与 `revision`，再选择 IndexedDB 封装方案；确保正式状态、草稿与预览分离，设计迁移及单事务提交。
3. 优先补充购买物品、收入债务、NPC 归属与跨表事务失败回滚的纯程序测试。
4. 对齐 `prompts/docs/OUTPUT_CONTRACT.md` 中 `worldCommands` 的补充建议，记录待定契约；M1 不实现提示词组装或 AI 调用。

字数计数口径、记忆阈值及参考源码许可等后续问题保留到对应阶段核验。本次未接入 AI、未配置真实密钥，未实现 M1～M6 功能。
