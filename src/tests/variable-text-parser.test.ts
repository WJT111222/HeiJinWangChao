import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extractCommandBlock, parseJsonValue, parseVariablePath, parseVariableText, variableTextLimits } from '../parsers/variableText';
import type { ParseErrorCode, ParseResult } from '../parsers/variableText';
const wrap = (body: string) => `<命令>\n${body}\n</命令>`;
function success<T>(result: ParseResult<T>) {
  if (!result.ok) throw new Error(`意外解析错误: ${result.error.code}`);
  return result.value;
}
function rejected(result: ParseResult<unknown>, code: ParseErrorCode) {
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(result).not.toHaveProperty('value');
  if (result.ok) throw new Error('必须失败');
  return result.error;
}
afterEach(() => vi.unstubAllGlobals());

describe('完整AI风格文本：仅解析顶层命令块', () => {
  const text = `<thinking>
这里是分析，示例不是操作：<命令>delete 危险 = 1</命令>
</thinking>
<说明>
本回合经过35分钟，虚构角色周岚与许舟一起旅行。
命令示例：set 角色.当前精力 = 0
</说明>
<命令>
set 环境.时间 = "2026:03:26:21:05"
set 角色.当前精力 = 117
add 角色.金钱 = -30
push 社交[npc_001].记忆 = {"内容":"今晚一起赶路"}
</命令>`;
  it('保留四条真实命令、路径类型和全局来源，不解析分析或说明', () => {
    const commands = success(parseVariableText(text));
    expect(commands.map((c) => c.operation)).toEqual(['set', 'set', 'add', 'push']);
    expect(commands.map((c) => c.value)).toEqual(['2026:03:26:21:05', 117, -30, { 内容: '今晚一起赶路' }]);
    expect(commands[3].path.nodes).toEqual([{ kind: 'root', name: '社交' }, { kind: 'id', id: 'npc_001' }, { kind: 'field', name: '记忆' }]);
    expect(commands[0].source.start).toEqual({ line: 9, column: 1, offset: text.indexOf('set 环境') });
    expect(text.slice(commands[0].source.start.offset, commands[0].source.end.offset)).toBe('set 环境.时间 = "2026:03:26:21:05"');
  });
  it('命令示例只在其他区块时返回缺失，不把示例当作顶层命令', () => {
    rejected(parseVariableText('<thinking><命令>set x = 1</命令></thinking><说明><命令>set y = 2</命令></说明>'), 'missing_block');
  });
  it('其他平衡区块也作为不透明内容，外围普通文本无效', () => {
    const input = '<示例><命令>set fake = 1</命令></示例>\nset also_fake = 2\n' + wrap('set 真实 = 3') + '\nadd fake = 9';
    expect(success(parseVariableText(input)).map((c) => c.value)).toEqual([3]);
  });
  it('前后空白、CRLF、空行、缩进、制表符和等号两侧空格', () => {
    const commands = success(parseVariableText(' \r\n<命令>\r\n\tset 角色.状态\t= true\r\n\r\n add 角色.数字 = -2\r\n</命令>\r\n'));
    expect(commands).toHaveLength(2);
    expect(commands[0].source.start).toMatchObject({ line: 3, column: 2 });
    expect(commands[1].source.start).toMatchObject({ line: 5, column: 2 });
  });
  it('唯一空命令块可明确表示没有变化，不与缺少命令块混淆', () => expect(success(parseVariableText(wrap(' \n\t')))).toEqual([]));
  it('根域通用，不绑定演示角色/环境/社交或现有GameState', () => {
    expect(success(parseVariableText(wrap('set 自定义域.自定义字段 = null')))[0].path.nodes[0]).toEqual({ kind: 'root', name: '自定义域' });
  });
});

describe('set、add、push及多行JSON边界', () => {
  it.each(['null', 'true', 'false', '0', '-0', '117', '1.25', '1e3', '-2E-2', '"中文与Unicode😀𠮷"', '{}', '[]'])('set支持JSON：%s', (json) => {
    expect(success(parseVariableText(wrap(`set 数据.字段 = ${json}`)))[0].value).toEqual(JSON.parse(json));
  });
  it.each(['0', '-0', '2', '-30', '0.125', '-2e3', '1e100'])('add支持有限JSON数：%s', (number) => {
    expect(success(parseVariableText(wrap(`add 计数.值 = ${number}`)))[0]).toMatchObject({ operation: 'add', value: JSON.parse(number) });
  });
  it.each(['"1"', 'null', 'true', '[]', '{}'])('add不接受非数字：%s', (json) => { rejected(parseVariableText(wrap(`add x = ${json}`)), 'add_number'); });
  it.each(['{"内容":"一起旅行","时间":"2026:03:26:21:05"}', '[1, "中文", null]', '"旅途记忆"', '42', 'false', 'null'])('push支持JSON元素：%s', (json) => {
    expect(success(parseVariableText(wrap(`push 记录[npc_001].记忆 = ${json}`)))[0].value).toEqual(JSON.parse(json));
  });
  it('对象/数组跨行且内嵌换行后继续下一条命令', () => {
    const commands = success(parseVariableText(wrap(`push 社交[npc_001].记忆 =
{
  "内容": "一起旅行",
  "详情": [
    {"地点": "车站", "已到达": true},
    [1, 2]
  ]
}
set 角色.备注 = "结束"`)));
    expect(commands).toHaveLength(2);
    expect(commands[0].value).toEqual({ 内容: '一起旅行', 详情: [{ 地点: '车站', 已到达: true }, [1, 2]] });
    expect(commands[1].value).toBe('结束');
  });
  it('字符串包含操作名、等号、尖括号、精确区块标签和转义引号，不形成命令', () => {
    const value = 'set x = 1；push y = {}；<命令></命令><thinking>文字</thinking>；"引号"；\\路径；\n换行';
    const commands = success(parseVariableText(wrap(`set 文本 = ${JSON.stringify(value)}\npush 数据 = {"内容":${JSON.stringify(value)}}`)));
    expect(commands.map((c) => c.value)).toEqual([value, { 内容: value }]);
  });
  it.each(['{"x": [1, {"y": "}"}]}', JSON.stringify(['[', ']', '\\', '"'])])('引号和括号不混淆：%s', (json) => expect(success(parseJsonValue(json))).toEqual(JSON.parse(json)));
  it('可以连续多个set和push，分号和同一行第二个命令不会偷偷执行', () => {
    expect(success(parseVariableText(wrap('set x = 1\nset y = 2\npush z = []')))).toHaveLength(3);
    rejected(parseVariableText(wrap('set x = 1; set y = 2')), 'json_value');
    rejected(parseVariableText(wrap('set x = {} set y = 2')), 'json_value');
  });
});

describe('路径节点及禁止访问', () => {
  it.each([
    ['环境.时间', [{ kind: 'root', name: '环境' }, { kind: 'field', name: '时间' }]],
    ['社交[0].当前位置', [{ kind: 'root', name: '社交' }, { kind: 'index', index: 0 }, { kind: 'field', name: '当前位置' }]],
    ['社交[npc_001].记忆', [{ kind: 'root', name: '社交' }, { kind: 'id', id: 'npc_001' }, { kind: 'field', name: '记忆' }]],
    ['角色.背包[2].数量', [{ kind: 'root', name: '角色' }, { kind: 'field', name: '背包' }, { kind: 'index', index: 2 }, { kind: 'field', name: '数量' }]],
    ['世界[123e4567-e89b].状态', [{ kind: 'root', name: '世界' }, { kind: 'id', id: '123e4567-e89b' }, { kind: 'field', name: '状态' }]],
    ['世界[同伴一][npc.key:1].属性', [{ kind: 'root', name: '世界' }, { kind: 'id', id: '同伴一' }, { kind: 'id', id: 'npc.key:1' }, { kind: 'field', name: '属性' }]],
  ])('%s生成有类型的路径节点', (path, nodes) => expect(success(parseVariablePath(String(path))).nodes).toEqual(nodes));
  it.each(['__proto__', 'prototype', 'constructor', '世界.__proto__', '世界[constructor]', '世界.prototype.状态'])('危险路径：%s', (path) => { rejected(parseVariableText(wrap(`set ${path} = 1`)), 'unsafe_path'); });
  it.each(['', '.字段', '根.', '根..字段', '根[]', '根[', '根]', '根[0', '根[0]]', '根[0]字段', '根[00]', '根[-1]', '根[1.5]', '根[9007199254740992]', '根["npc_001"]', '根[用户.id()]', '根[0+1]', '根[1;2]', '根[0][', '根.字段()', '根 字段', '根[ x ]', '根[1]..x', '根[0].', '根.字段＝值'])('非法或表达式路径：%s', (path) => { rejected(parseVariablePath(path), 'path_syntax'); });
});

describe('严格结构、整块失败与安全错误', () => {
  it.each(['', 'set x = 1', '<thinking>set x = 1</thinking>'])('缺少命令块：%s', (text) => { rejected(parseVariableText(text), 'missing_block'); });
  it.each([
    '<命令>set x = 1', '</命令>', '<命令><命令>set x = 1</命令></命令>',
    '<命令></命令><命令></命令>', '<命令></说明>', '<命令>set x = 1</命令></命令>',
    '<命令 >set x = 1</命令>', '<命令', '<命令/>', '<thinking>未闭合',
    '<说明 属性="示例"><命令>set fake = 1</命令>', '<命令><说明>set x = 1</说明></命令>',
  ])('结构错误：%s', (text) => { rejected(parseVariableText(text), 'block_structure'); });
  it.each(['remove', 'SET', 'update', 'unknown'])('未知操作：%s', (op) => { rejected(parseVariableText(wrap(`${op} x = 1`)), 'unknown_operation'); });
  it.each(['delete', 'splice', 'eval', 'Function', 'function'])('禁止操作：%s', (op) => { rejected(parseVariableText(wrap(`${op} x = 1`)), 'forbidden_operation'); });
  it.each(['set x 1', 'set', 'set\nx = 1', 'push x\n= {}'])('缺少等号/非法头部：%s', (line) => { rejected(parseVariableText(wrap(line)), 'command_syntax'); });
  it.each(['{"a":}', '{"a":1,}', '[1,]', '{"a":[1}', 'undefined', 'NaN', 'Infinity', '1e400', '{"n":1e400}', '[1e400]', '+1', '01', '0x10', '(1)', "'文本'", '"\\x41"', '', '/*注释*/1'])('非法JSON或非有限数字：%s', (json) => { rejected(parseVariableText(wrap(`set x = ${json}`)), 'json_value'); });
  it('第二条失败不返回第一条成功AST，位置与序号保留且不输出敏感文本', () => {
    const secret = 'private-NPC-memory-and-API-Key';
    const input = `<thinking>${secret}</thinking>\r\n<命令>\r\nset 安全 = 1\r\nadd 数字 = "${secret}"\r\n</命令>`;
    const error = rejected(parseVariableText(input), 'add_number');
    expect(error).toMatchObject({ commandIndex: 2, position: { line: 4, column: 10 } });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain('安全');
  });
});

describe('资源上限、确定性与无副作用', () => {
  it('输入最大长度允许，超过一单元明确拒绝（包含忽略区块）', () => {
    const suffix = wrap('set x = 1'), prefix = ' '.repeat(variableTextLimits.inputLength - suffix.length);
    expect(parseVariableText(prefix + suffix).ok).toBe(true);
    expect(rejected(parseVariableText(' ' + prefix + suffix), 'limit_exceeded').limit).toBe('inputLength');
  });
  it('128条允许，129条整块拒绝并报告第129条', () => {
    const lines = Array.from({ length: variableTextLimits.commandCount }, (_, i) => `set x = ${i}`);
    expect(success(parseVariableText(wrap(lines.join('\n'))))).toHaveLength(128);
    expect(rejected(parseVariableText(wrap([...lines, 'set x = 129'].join('\n'))), 'limit_exceeded')).toMatchObject({ commandIndex: 129, limit: 'commandCount' });
  });
  it('路径节点深度32允许，33拒绝；路径文本长度1024允许，1025拒绝', () => {
    expect(parseVariablePath(Array(32).fill('字段').join('.')).ok).toBe(true);
    expect(rejected(parseVariablePath(Array(33).fill('字段').join('.')), 'limit_exceeded').limit).toBe('pathDepth');
    expect(parseVariablePath('根'.repeat(1024)).ok).toBe(true);
    expect(rejected(parseVariablePath('根'.repeat(1025)), 'limit_exceeded').limit).toBe('pathLength');
  });
  it('JSON容器深度32允许，33拒绝；引号内括号不计深度', () => {
    expect(parseJsonValue('['.repeat(32) + '0' + ']'.repeat(32)).ok).toBe(true);
    expect(rejected(parseJsonValue('['.repeat(33) + '0' + ']'.repeat(33)), 'limit_exceeded').limit).toBe('jsonDepth');
    expect(parseJsonValue(JSON.stringify('['.repeat(40))).ok).toBe(true);
  });
  it('单值文本65536允许，超过一单元拒绝；多行空白也计入值预算', () => {
    expect(parseJsonValue(JSON.stringify('a'.repeat(65534))).ok).toBe(true);
    expect(rejected(parseJsonValue(JSON.stringify('a'.repeat(65535))), 'limit_exceeded').limit).toBe('valueLength');
    expect(rejected(parseJsonValue('[\n' + ' '.repeat(65536) + ']'), 'limit_exceeded').limit).toBe('valueLength');
  });
  it('外围同名嵌套标签深度32允许，33拒绝', () => {
    expect(extractCommandBlock('<thinking>'.repeat(32) + '</thinking>'.repeat(32) + wrap('')).ok).toBe(true);
    expect(rejected(extractCommandBlock('<thinking>'.repeat(33) + '</thinking>'.repeat(33) + wrap('')), 'limit_exceeded').limit).toBe('blockDepth');
  });
  it('重复解析相同AST；修改先前结果不污染下一次，也不改输入对象', () => {
    const fixture = Object.freeze({ reply: wrap('push 档案[npc_01].记录 = {"内容":"中性样例"}') });
    const snapshot = JSON.stringify(fixture), first = success(parseVariableText(fixture.reply));
    const second = success(parseVariableText(fixture.reply));
    expect(first).toEqual(second); expect(first).not.toBe(second);
    first[0].path.nodes.push({ kind: 'field', name: '改动' });
    expect(success(parseVariableText(fixture.reply))).toEqual(second);
    expect(JSON.stringify(fixture)).toBe(snapshot);
  });
  it('没有存档/网络/AI依赖，Node无浏览器环境仍能运行', () => {
    const network = vi.fn(() => { throw new Error('不允许网络'); }), database = vi.fn(() => { throw new Error('不允许数据库'); });
    vi.stubGlobal('fetch', network); vi.stubGlobal('indexedDB', { open: database });
    expect(parseVariableText(wrap('set x = 1')).ok).toBe(true);
    expect(network).not.toHaveBeenCalled(); expect(database).not.toHaveBeenCalled();
    const root = new URL('../parsers/variableText/', import.meta.url);
    for (const file of readdirSync(root).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, root), 'utf8');
      expect(source).not.toMatch(/from\s+['"](?!\.\/)/u);
      expect(source).not.toMatch(/\b(?:eval|Function|fetch)\s*\(|indexedDB\s*\.|localStorage\s*\.|console\s*\./u);
    }
  });
  it('JSON对象中的原型相关键保持普通数据，不发生原型污染，也不授权未来执行器深合并', () => {
    const result = success(parseVariableText(wrap('push x = {"__proto__":{"polluted":true},"constructor":"普通数据"}')));
    const value = result[0].value;
    if (!value || typeof value !== 'object') throw new Error('样例应为JSON对象');
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
  it('只读解析不要求真实字段存在，不授予传统RPG属性或NPC数字索引写权限', () => {
    const commands = success(parseVariableText(wrap('add 虚构域.经验值 = 100\nset 任意域[0].字段 = "数据"')));
    expect(commands).toHaveLength(2);
    expect(commands[1].path.nodes[1].kind).toBe('index');
  });
});

// 防止将解析器误当作宽松脚本解释器；所有后续执行权限仍由下一阶段决定。
describe('补充隔离与边界回归', () => {
  it.each(['根.\\u0063onstructor', '根[%5f%5fproto%5f%5f]', '根[globalThis]', '根[foo()];调用()'])('不解码或执行表达式：%s', (path) => {
    const result = parseVariablePath(path);
    // globalThis在方括号中只允许成为普通、不求值的稳定ID，而不是全局对象引用。
    if (path === '根[globalThis]') expect(success(result).nodes[1]).toEqual({ kind: 'id', id: 'globalThis' });
    else rejected(result, 'path_syntax');
  });
  it('未闭合JSON字符串含裸换行时明确失败，不接受后续合法命令为部分结果', () => {
    rejected(parseVariableText(wrap('set x = "未闭合\nset y = 2')), 'json_value');
  });
  it('平坦大数组也有界处理，不通过函数参数展开制造栈溢出', () => {
    const json = '[' + Array(30000).fill('0').join(',') + ']';
    const value = success(parseJsonValue(json));
    expect(Array.isArray(value) && value.length).toBe(30000);
  });
  it('错误路径和未知操作不回显名称，JSON原生异常也不外传', () => {
    const secret = 'sensitive_NPC_private_API_Key';
    for (const input of [wrap(`${secret} x = 1`), wrap(`set 根[${secret}()] = 1`), wrap(`set x = {"${secret}":}`)]) {
      const result = parseVariableText(input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it('非法非文本输入不被强制转字符串，不调用输入对象方法或修改对象', () => {
    const toString = vi.fn(() => { throw new Error('不应强制转换'); }), input = Object.freeze({ toString, private: '只读' });
    expect(Reflect.apply(parseVariableText, undefined, [input])).toMatchObject({ ok: false, error: { code: 'input_type' } });
    expect(Reflect.apply(parseVariableText, undefined, [null])).toMatchObject({ ok: false, error: { code: 'input_type' } });
    expect(toString).not.toHaveBeenCalled(); expect(input.private).toBe('只读');
  });
  it('固定JSON语料每个值都完整往返，不将字符串内标签或操作名二次解析', () => {
    const corpus = [null, false, 0, -7, 3.5, '', '😀', '"\\\\', '</命令>', 'set x = 1\npush y = []'];
    const values = [...corpus, ...corpus.map((value) => ({ 数据: value, 列表: [value] }))];
    const body = values.map((value, index) => `push 自定义[实体_${index}].数据 = ${JSON.stringify(value, null, 2)}`).join('\n');
    const commands = success(parseVariableText(wrap(body)));
    expect(commands.map((command) => command.value)).toEqual(values);
    expect(commands).toHaveLength(values.length);
  });
});
