/**
 * 世界书正则关键词的“安全子集”匹配器（阶段 B）。
 *
 * 不调用 JavaScript RegExp 执行匹配：先把正则解析成受限语法树，再编译为 Thompson NFA，
 * 用状态集合同步推进（每个位置只处理一次每个状态），耗时与 文本长度 × 状态数 成正比，
 * 嵌套重复（如 (a+)+）也不会出现回溯爆炸。
 *
 * 支持：字面字符、. 、[] 字符类（含范围与取反）、\d \D \w \W \s \S、\t \n \r \v \f \0 \xHH \uHHHH、
 * 语法字符转义、分组（捕获组按非捕获处理，命名组同样）、|、* + ? {m} {m,} {m,n}（含惰性写法）、^ $ \b \B，
 * 标志 i m s g y（g 不影响单次判断；y 只从文本开头匹配）。
 * 不支持（不运行，报告“暂不支持”）：u / v 标志、前后瞻、反向引用、\p、\c、八进制、其他字母转义、
 * 超长或展开后过大的正则。判断结果与 JavaScript 非 Unicode 模式的 RegExp.test 一致（测试中做差分对照）。
 * 忽略大小写按规范的 Canonicalize 与大小写等价类判断，大小写数据取自运行环境的 String.prototype.toUpperCase。
 */
export type SafeRegexReason =
  | 'unicode_flag' | 'too_long' | 'lookaround' | 'backreference' | 'unsupported_escape'
  | 'unsupported_syntax' | 'too_large';
/** size：NFA 状态数。单次判断最多处理 文本长度 × size 个状态步，用于扫描工作量计费。 */
export type SafeRegex = { ok: true; test: (text: string) => boolean; size: number } | { ok: false; reason: SafeRegexReason };

export const SAFE_REGEX_LIMITS = { maxSourceChars: 1_000, maxStates: 5_000, maxRepeat: 1_000, maxNesting: 50 } as const;

class Unsupported extends Error {
  constructor(readonly reason: SafeRegexReason) { super(reason); }
}

type Pred = (c: number) => boolean;
type AssertKind = '^' | '$' | 'b' | 'B';
type Node =
  | { t: 'pred'; p: Pred }
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number }
  | { t: 'assert'; kind: AssertKind };

const isLineTerminator = (c: number) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) => c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;
const isSpace = (c: number) => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0
  || c === 0x1680 || c >= 0x2000 && c <= 0x200a || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f
  || c === 0x3000 || c === 0xfeff;

/**
 * JavaScript 非 Unicode 模式忽略大小写时的规范化（ECMAScript 规范 Canonicalize，rer.[[IgnoreCase]] 且非 Unicode）：
 * 取 toUpperCase 的结果；结果不是单个码元时保持原字符；非 ASCII 字符不会规范化成 ASCII。
 */
function canonicalize(c: number): number {
  const upper = String.fromCharCode(c).toUpperCase();
  if (upper.length !== 1) return c;
  const cu = upper.charCodeAt(0);
  return c >= 128 && cu < 128 ? c : cu;
}

/**
 * 大小写等价类：规范化结果相同的全部码元。按需建立一次（遍历 65536 个码元，约 10 毫秒）。
 * 只记录成员多于一个的类；查不到即只有字符自己。
 */
let canonOf: Uint16Array | undefined;
let classesByCanon: Map<number, number[]> | undefined;
function caseClass(c: number): readonly number[] | undefined {
  if (!canonOf || !classesByCanon) {
    const table = new Uint16Array(0x10000);
    const shared = new Set<number>();
    for (let code = 0; code < 0x10000; code++) {
      table[code] = canonicalize(code);
      if (table[code] !== code) shared.add(table[code]);
    }
    const classes = new Map<number, number[]>();
    for (let code = 0; code < 0x10000; code++) {
      const canon = table[code];
      if (!shared.has(canon)) continue;
      let members = classes.get(canon);
      if (!members) classes.set(canon, members = []);
      members.push(code);
    }
    canonOf = table;
    classesByCanon = classes;
  }
  return classesByCanon.get(canonOf[c]);
}

/**
 * 忽略大小写：集合里存在与 c 规范化结果相同的字符即匹配（规范 CharacterSetMatcher 的定义）。
 * 必须遍历整个等价类，只看 c 自己的大小写形式不够（例如 µ、μ、Μ 同属一类，但 µ 的小写仍是 µ）。
 */
function folded(base: Pred): Pred {
  return (c) => {
    if (base(c)) return true;
    const members = caseClass(c);
    if (!members) return false;
    for (const m of members) if (m !== c && base(m)) return true;
    return false;
  };
}

const SYNTAX_CHARS = '^$\\.*+?()[]{}|/-';
const CLASS_ESCAPES: Record<string, Pred> = {
  d: isDigit, D: (c) => !isDigit(c), w: isWord, W: (c) => !isWord(c), s: isSpace, S: (c) => !isSpace(c),
};
const CONTROL_ESCAPES: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 };

class Parser {
  i = 0;
  constructor(private readonly src: string, private readonly ignoreCase: boolean, private readonly dotAll: boolean) {}

  parse(): Node {
    const node = this.alt(0);
    if (this.i !== this.src.length) throw new Unsupported('unsupported_syntax');
    return node;
  }
  private peek(offset = 0) { return this.src[this.i + offset]; }
  private literal(code: number): Node {
    const exact: Pred = (c) => c === code;
    return { t: 'pred', p: this.ignoreCase ? folded(exact) : exact };
  }
  private alt(depth: number): Node {
    const options = [this.seq(depth)];
    while (this.peek() === '|') { this.i++; options.push(this.seq(depth)); }
    return options.length === 1 ? options[0] : { t: 'alt', options };
  }
  private seq(depth: number): Node {
    const items: Node[] = [];
    while (this.i < this.src.length && this.peek() !== '|' && this.peek() !== ')') items.push(this.term(depth));
    return items.length === 1 ? items[0] : { t: 'seq', items };
  }
  private term(depth: number): Node {
    const atom = this.atom(depth);
    const q = this.quantifier();
    if (!q) return atom;
    if (atom.t === 'assert') throw new Unsupported('unsupported_syntax');
    return { t: 'rep', node: atom, min: q[0], max: q[1] };
  }
  private quantifier(): [number, number] | null {
    const c = this.peek();
    let range: [number, number] | null = null;
    if (c === '*') range = [0, Infinity];
    else if (c === '+') range = [1, Infinity];
    else if (c === '?') range = [0, 1];
    if (range) this.i++;
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));
      if (!m) throw new Unsupported('unsupported_syntax'); // 非量词的 { 在非 Unicode 模式下是字面字符，这里保守地不支持
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      if (min > max) throw new Unsupported('unsupported_syntax');
      if (min > SAFE_REGEX_LIMITS.maxRepeat || max !== Infinity && max > SAFE_REGEX_LIMITS.maxRepeat) throw new Unsupported('too_large');
      this.i += m[0].length;
      range = [min, max];
    }
    if (range && this.peek() === '?') this.i++; // 惰性写法不影响“是否匹配”
    return range;
  }
  private atom(depth: number): Node {
    const c = this.peek();
    switch (c) {
      case '(': {
        if (depth + 1 > SAFE_REGEX_LIMITS.maxNesting) throw new Unsupported('too_large');
        const rest = this.src.slice(this.i);
        if (/^\(\?(=|!|<=|<!)/.test(rest)) throw new Unsupported('lookaround');
        if (rest.startsWith('(?:')) this.i += 3;
        else if (rest.startsWith('(?<')) {
          const close = this.src.indexOf('>', this.i);
          if (close < 0) throw new Unsupported('unsupported_syntax');
          this.i = close + 1;
        } else if (rest.startsWith('(?')) throw new Unsupported('unsupported_syntax');
        else this.i += 1;
        const inner = this.alt(depth + 1);
        if (this.peek() !== ')') throw new Unsupported('unsupported_syntax');
        this.i++;
        // 包一层：分组整体可以加量词，即使里面只有断言（如 ($){1,2}）。
        return { t: 'seq', items: [inner] };
      }
      case '[': return this.charClass();
      case '.': this.i++; return { t: 'pred', p: this.dotAll ? () => true : (x) => !isLineTerminator(x) };
      case '^': this.i++; return { t: 'assert', kind: '^' };
      case '$': this.i++; return { t: 'assert', kind: '$' };
      case '\\': {
        const escaped = this.escape(false);
        if ('assert' in escaped) return { t: 'assert', kind: escaped.assert };
        if ('pred' in escaped) return { t: 'pred', p: this.ignoreCase ? folded(escaped.pred) : escaped.pred };
        return this.literal(escaped.code);
      }
      case ')': case '*': case '+': case '?': case '{': case '|':
        throw new Unsupported('unsupported_syntax');
      default:
        this.i++;
        return this.literal(c.charCodeAt(0));
    }
  }
  /** 读一个转义（this.i 指向反斜杠）。 */
  private escape(inClass: boolean): { code: number } | { pred: Pred } | { assert: AssertKind } {
    const n = this.peek(1);
    if (n === undefined) throw new Unsupported('unsupported_syntax');
    this.i += 2;
    if (CLASS_ESCAPES[n]) return { pred: CLASS_ESCAPES[n] };
    if (CONTROL_ESCAPES[n] !== undefined) return { code: CONTROL_ESCAPES[n] };
    if (n === 'b') return inClass ? { code: 8 } : { assert: 'b' };
    if (n === 'B') { if (inClass) throw new Unsupported('unsupported_escape'); return { assert: 'B' }; }
    if (n === '0') { if (isDigit(this.src.charCodeAt(this.i))) throw new Unsupported('unsupported_escape'); return { code: 0 }; }
    if (n >= '1' && n <= '9') throw new Unsupported(inClass ? 'unsupported_escape' : 'backreference');
    if (n === 'k') throw new Unsupported('backreference');
    if (n === 'x' || n === 'u') {
      const size = n === 'x' ? 2 : 4;
      const hex = this.src.slice(this.i, this.i + size);
      if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(hex)) throw new Unsupported('unsupported_escape');
      this.i += size;
      return { code: parseInt(hex, 16) };
    }
    if (SYNTAX_CHARS.includes(n)) return { code: n.charCodeAt(0) };
    throw new Unsupported('unsupported_escape');
  }
  private charClass(): Node {
    this.i++;
    let negate = false;
    if (this.peek() === '^') { negate = true; this.i++; }
    const ranges: Array<[number, number]> = [];
    const classes: Pred[] = [];
    const readAtom = (): { code: number } | { pred: Pred } => {
      if (this.peek() === '\\') {
        const escaped = this.escape(true);
        if ('assert' in escaped) throw new Unsupported('unsupported_escape');
        return escaped;
      }
      const code = this.src.charCodeAt(this.i);
      this.i++;
      return { code };
    };
    while (this.peek() !== ']') {
      if (this.i >= this.src.length) throw new Unsupported('unsupported_syntax');
      const first = readAtom();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined) {
        this.i++;
        const second = readAtom();
        if ('pred' in first || 'pred' in second) throw new Unsupported('unsupported_syntax');
        if (first.code > second.code) throw new Unsupported('unsupported_syntax');
        ranges.push([first.code, second.code]);
      } else if ('pred' in first) classes.push(first.pred);
      else ranges.push([first.code, first.code]);
    }
    this.i++;
    const base: Pred = (c) => ranges.some(([lo, hi]) => c >= lo && c <= hi) || classes.some((p) => p(c));
    const found = this.ignoreCase ? folded(base) : base;
    return { t: 'pred', p: negate ? (c) => !found(c) : found };
  }
}

const SPLIT = 0, PRED = 1, ASSERT = 2, MATCH = 3;
interface State { type: number; eps?: number[]; p?: Pred; to?: number; kind?: AssertKind }

function compileNfa(root: Node): { states: State[]; start: number } {
  const states: State[] = [];
  const add = (state: State) => {
    if (states.length >= SAFE_REGEX_LIMITS.maxStates) throw new Unsupported('too_large');
    states.push(state);
    return states.length - 1;
  };
  const match = add({ type: MATCH });
  const build = (node: Node, next: number): number => {
    switch (node.t) {
      case 'pred': return add({ type: PRED, p: node.p, to: next });
      case 'assert': return add({ type: ASSERT, kind: node.kind, to: next });
      case 'seq': {
        let cur = next;
        for (let k = node.items.length - 1; k >= 0; k--) cur = build(node.items[k], cur);
        return cur;
      }
      case 'alt': {
        const split = add({ type: SPLIT, eps: [] });
        states[split].eps = node.options.map((option) => build(option, next));
        return split;
      }
      case 'rep': {
        let tail = next;
        if (node.max === Infinity) {
          const loop = add({ type: SPLIT, eps: [] });
          states[loop].eps = [build(node.node, loop), next];
          tail = loop;
        } else {
          for (let k = 0; k < node.max - node.min; k++) {
            const optional = add({ type: SPLIT, eps: [] });
            states[optional].eps = [build(node.node, tail), tail];
            tail = optional;
          }
        }
        for (let k = 0; k < node.min; k++) tail = build(node.node, tail);
        return tail;
      }
    }
  };
  return { states, start: build(root, match) };
}

function runner(states: State[], start: number, multiline: boolean, sticky: boolean) {
  return (text: string): boolean => {
    const n = text.length;
    const seen = new Int32Array(states.length).fill(-1);
    let generation = 0, matched = false;
    const holds = (kind: AssertKind, pos: number) => {
      switch (kind) {
        case '^': return pos === 0 || multiline && isLineTerminator(text.charCodeAt(pos - 1));
        case '$': return pos === n || multiline && isLineTerminator(text.charCodeAt(pos));
        case 'b': case 'B': {
          const boundary = (pos > 0 && isWord(text.charCodeAt(pos - 1))) !== (pos < n && isWord(text.charCodeAt(pos)));
          return kind === 'b' ? boundary : !boundary;
        }
      }
    };
    const closure = (list: number[], from: number, pos: number) => {
      const stack = [from];
      while (stack.length) {
        const s = stack.pop()!;
        if (seen[s] === generation) continue;
        seen[s] = generation;
        const state = states[s];
        if (state.type === MATCH) matched = true;
        else if (state.type === PRED) list.push(s);
        else if (state.type === SPLIT) for (let k = state.eps!.length - 1; k >= 0; k--) stack.push(state.eps![k]);
        else if (holds(state.kind!, pos)) stack.push(state.to!);
      }
    };
    let current: number[] = [];
    closure(current, start, 0);
    for (let pos = 0; pos < n && !matched; pos++) {
      const c = text.charCodeAt(pos);
      const next: number[] = [];
      generation++;
      for (const s of current) if (states[s].p!(c)) closure(next, states[s].to!, pos + 1);
      if (!sticky) closure(next, start, pos + 1);
      current = next;
      if (!current.length && sticky) break;
    }
    return matched;
  };
}

/** 编译正则（source 与 flags 已由 classifyKey 确认是合法的 JavaScript 正则）。 */
export function compileSafeRegex(source: string, flags: string): SafeRegex {
  if (/[uv]/.test(flags)) return { ok: false, reason: 'unicode_flag' };
  if (source.length > SAFE_REGEX_LIMITS.maxSourceChars) return { ok: false, reason: 'too_long' };
  try {
    const root = new Parser(source, flags.includes('i'), flags.includes('s')).parse();
    const { states, start } = compileNfa(root);
    return { ok: true, test: runner(states, start, flags.includes('m'), flags.includes('y')), size: states.length };
  } catch (error) {
    if (error instanceof Unsupported) return { ok: false, reason: error.reason };
    throw error;
  }
}

export const SAFE_REGEX_REASON_TEXT: Record<SafeRegexReason, string> = {
  unicode_flag: '使用了 u / v 标志',
  too_long: `超过 ${SAFE_REGEX_LIMITS.maxSourceChars} 字`,
  lookaround: '使用了前瞻或后顾',
  backreference: '使用了反向引用',
  unsupported_escape: '使用了暂不支持的转义',
  unsupported_syntax: '使用了暂不支持的写法',
  too_large: '重复次数或嵌套过多',
};
