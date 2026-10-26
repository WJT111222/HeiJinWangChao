# M8-P0C-1：文本变量指令解析器

## 基线与交付范围

开发基线为远端最新 `main@afb60c6b86ddc8add40e258911c8e8aa0eda07e8`（PR #33 已合并），分支 `codex/m8-p0c1-text-command-parser`。

本轮只实现“文本→命令块→操作/路径/JSON值→AST”。不替换现有变量请求，不生成或执行DomainCommand，不读写GameState、TurnDraft或任何存档，不调用AI，不修改Prompt/Manifest、Schema、迁移、协议、收费授权或UI。没有复制参考仓库的业务实现；中性样本只借鉴thinking/说明/命令三区块格式，虚构人物周岚和许舟一起旅行。

## 新文件与依赖方向

- `src/parsers/variableText/common.ts`：类型、只读上限、安全错误、位置计算。
- `src/parsers/variableText/block.ts`：`extractCommandBlock`。
- `src/parsers/variableText/path.ts`：`parseVariablePath`。
- `src/parsers/variableText/value.ts`：`parseJsonValue`及内部流式边界扫描。
- `src/parsers/variableText/index.ts`：公开入口`parseVariableText`及类型/辅助函数导出。
- `src/tests/variable-text-parser.test.ts`：固定文本与安全边界测试。
- 本开发报告。

模块只引用同目录纯函数，无React、DOM、数据库、AI Client或业务领域依赖。现有业务代码不导入新模块；没有新增运行时入口，也没有新增依赖。`readJsonValue`是内部词法辅助，公开入口从index导出。解析均同步，错误使用结果联合类型而不是泄露原生JSON异常。

## 公开接口及完整AST

```typescript
type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };
type VariableOperation = 'set' | 'add' | 'push';
type PathNode =
  | { kind: 'root'; name: string }
  | { kind: 'field'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'id'; id: string };
interface ParsedVariablePath {
  nodes: [Extract<PathNode, {kind: 'root'}>,
    ...Exclude<PathNode, {kind: 'root'}>[]];
}
interface SourcePosition { offset: number; line: number; column: number }
interface SourceSpan { start: SourcePosition; end: SourcePosition }
type ParsedVariableCommand = {
  path: ParsedVariablePath;
  source: SourceSpan;
} & (
  | { operation: 'add'; value: number }
  | { operation: 'set' | 'push'; value: JsonValue }
);
type ParseErrorCode =
  | 'input_type' | 'missing_block' | 'block_structure' | 'command_syntax'
  | 'unknown_operation' | 'forbidden_operation' | 'path_syntax' | 'unsafe_path'
  | 'json_value' | 'add_number' | 'limit_exceeded';
type ParserLimit = 'inputLength' | 'commandCount' | 'pathLength'
  | 'pathDepth' | 'valueLength' | 'jsonDepth' | 'blockDepth';
interface ParseError {
  code: ParseErrorCode;
  commandIndex: number | null;
  position: SourcePosition;
  message: string;
  limit?: ParserLimit;
}
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };
interface CommandBlock { text: string; source: SourceSpan }

declare function parseVariableText(text: string): ParseResult<ParsedVariableCommand[]>;
declare function extractCommandBlock(text: string): ParseResult<CommandBlock>;
declare function parseVariablePath(text: string): ParseResult<ParsedVariablePath>;
declare function parseJsonValue(text: string): ParseResult<JsonValue>;
```

行列与命令序号从1开始；offset和column按UTF-16单元计算，end独占，CRLF计作一个换行。完整文本解析的source及错误位置以原始整份回复为准，单独路径/值函数相对其输入。区块提取或单独路径/值解析尚无可靠命令序号时，`commandIndex=null`，不猜测。错误只含固定消息、代码、位置、序号和上限种类，不包含原始操作名、路径、值或整份响应。

## 语法与区块提取

- 只接受顶层唯一的精确`<命令>…</命令>`，不要求整份回复是JSON。thinking、说明及其他合法简单标签区块作为不透明内容，其内部的命令示例不计入唯一性、更不解析。
- 标签是简单协议分隔符，不是HTML/XML通用文档解析器；外围同名标签允许有限嵌套，必须闭合。带属性/自闭合等不受支持标签在顶层返回结构错误，不借此放出内部命令。
- 命令块里JSON引号及反斜杠状态会阻止把字符串中的`<命令>`、`</命令>`等当成分隔符。实际的重复、嵌套、错配或未闭合标签拒绝。
- 命令格式为小写`set|add|push 路径 = JSON值`。操作与路径之间需要空格或Tab，头部在同一行；等号之后的对象/数组可跨多行，任意合法JSON值都可用于set/push，add仅允许有限数字。
- 多条命令用LF、CRLF或CR分隔；允许缩进和空行。JSON对象/数组内部换行不分割命令；值扫描跟踪字符串、转义和容器栈，再调用原生JSON.parse。没有eval、Function或动态JS执行。
- 不支持分号分隔、同一行多命令、注释、Markdown围栏、单引号字符串、JS对象字面量、表达式或尾随脚本。值后出现额外内容整块失败。
- 唯一的空命令块成功返回空数组，表示明确无变化；缺少命令块是错误。标签与JSON引号同时损坏时，先遇到的安全词法/结构错误优先；未闭合字符串可能使结束标签被视为字符串数据，从而报告结构错误，不尝试猜测修复。

## 路径规则

根/点字段使用Unicode字母或下划线起始，后续允许字母、组合标记、数字及下划线。方括号中的规范非负十进制整数是index，范围0～Number.MAX_SAFE_INTEGER；无前导零。其余合法ID按字面值解析为id，允许字母/数字/下划线起始及后续字母、数字、组合标记、下划线、点、冒号、连字符，兼容数字起始UUID与现有稳定ID风格；纯小数形式拒绝。ID不执行JS，例如`[globalThis]`只是一枚名为globalThis的ID，不是全局引用；不把`[1e3]`计算成索引1000。

`__proto__`、`prototype`、`constructor`在根、字段、ID段均精确拒绝。拒绝空段、缺失括号、带引号索引、负索引、运算符、函数调用、转义字段、空格及表达式。不做URL解码、Unicode规范化或字段别名转换。带点/冒号的ID在AST中仍是一个不透明id节点，未来不得再次拆成属性链。

例：`社交[npc_001].记忆`生成root社交→id npc_001→field记忆；`社交[0].记忆`的中间节点则是index 0。通过语法不代表真实路径存在、索引有效、角色属性获准或拥有写权限。环境/角色/社交/经验值均仅为样本，不写入任何正式Schema。

## 错误与资源上限

| 代码 | 含义 |
| --- | --- |
| input_type | 非文本输入，不强制调用toString |
| missing_block | 无顶层命令块，其他区块里的示例不算 |
| block_structure | 重复/嵌套/不闭合/错配或不支持的标签结构 |
| command_syntax | 缺等号、缺操作分隔符或头部格式不完整 |
| unknown_operation | 非set/add/push操作 |
| forbidden_operation | delete/splice/eval/Function/function等明确禁止操作 |
| path_syntax | 路径语法、索引范围、括号或表达式非法 |
| unsafe_path | 原型相关危险路径段 |
| json_value | JSON语法不合法、值后有多余内容或任意层数字非有限 |
| add_number | add使用字符串/对象/数组/null/布尔值 |
| limit_exceeded | 超过下列上限，由limit字段区分 |

| 上限 | 固定值 |
| --- | --- |
| 整份输入inputLength | 262144 UTF-16单元，包括忽略内容 |
| 命令数commandCount | 128 |
| 单条路径pathLength | 1024 UTF-16单元 |
| 路径节点pathDepth | 32，包含root |
| 单值valueLength | 65536 UTF-16单元，包含容器内空白 |
| JSON容器jsonDepth | 32，字符串中的括号不计 |
| 外围同名标签blockDepth | 32 |

扫描有界，不递归执行输入；大数组的有限性遍历不通过函数参数展开，避免参数栈溢出。JSON.parse的IEEE-754精度/重复键最后值语义保留；不将其标为精确金融数据。JSON对象中的`__proto__`等键是普通自有数据，不会污染原型；本轮不执行深合并。未来执行器必须单独防护替换/合并对象中的危险键，不能将AST解析成功等同于执行许可。

## 成功与失败示例

```text
<thinking>周岚和许舟抵达车站，以下只是分析。</thinking>
<说明>记录一次普通旅行。</说明>
<命令>
set 自定义.时间 = "2026:03:26:21:05"
add 自定义.精力 = -2
push 关系[npc_001].记忆 = {
  "内容": "一起旅行",
  "地点": "车站"
}
</命令>
```

成功返回3条有来源位置的AST，操作分别set/add/push。不查任何存档字段。`add 自定义.精力 = "-2"`返回add_number；`set 自定义.__proto__ = {}`返回unsafe_path；第二条失败时没有第一条的部分成功结果，也没有候选写入。

## 测试与隔离证据

定向新增144项：三区块、单/多命令、set/add/push全部JSON类型、多行容器、Unicode/转义/精确标签字符串、类型化路径、注入、结构错误、安全诊断、全部资源上限边界、固定JSON语料往返、平坦大数组、确定性和不修改输入。文件级依赖审计及Mock fetch/indexedDB证明无外部服务/存储依赖；Node测试不需要浏览器环境。所有旧用例和旧业务文件保留。

初次定向检查133/135通过：一项样本行号预期误记为10（真实是9），另一项发现小数索引被误当稳定ID，已分别校准固定行号和收紧纯小数ID。随后补充9项安全/隔离用例，144/144通过。早期Lint两处冗余转义已修正，未降低规则或修改旧测试。

最终验证结果：

| 命令 | 实际结果 |
| --- | --- |
| `npx vitest run src/tests/variable-text-parser.test.ts` | 144/144通过 |
| `npm run prompts:check` | 82/82通过，原提示词资源未变 |
| `npm run check` | 41个测试文件、1433/1433通过；ESLint、TypeScript及Vite生产构建通过 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 290/290通过：桌面145、移动145；无跳过、无重试，17.1分钟 |
| `git diff --check`及暂存区检查 | 通过，无异常空白 |

原工程1289项测试全部保留，新增144项后合计1433项；提示词检查的82项是工程测试子集，不重复计入。全部290项原E2E保留。本模块无UI和业务接入，因此没有新增浏览器用例，浏览器检查用于验证既有功能未退化。构建保留原有大于500kB的分块体积警告，不属于本轮范围。所有AI场景使用现有Mock，没有调用真实付费模型，不能将此结果表述为真实模型验证。

## 后续执行器接口与风险（未实现）

后续应读取本模块AST，并另外实现：根域注册/白名单、稳定ID解析与实体存在性、禁止真实NPC使用可变索引、字段类型和读写权限、操作与字段兼容性、金额整数分与安全整数/余额边界、时间及知识归属、set根对象和push嵌套键防护、语义等价映射到DomainCommand及原子事务/CAS/幂等命令ID。

需要决定如何保留金融数字精度/拒绝重复JSON键，以及哪些实际字段可接受set/add/push；不可从本轮通用示例推导正式游戏属性。解析成功只代表语法及资源限制通过，不能证明情节真实、来源可信、目标属于当前回合或有权修改。原有AI工作流、文本输出约定、DomainCommand适配器和真实执行器均未接入，不会因本PR改善当前模型输出或改变任何正式游戏状态。

未调用真实付费模型，没有新增请求/收费场景。未主动部署生产环境；PR预览可由现有Cloudflare自动流程部署。不自动合并，也不开始下一阶段。
