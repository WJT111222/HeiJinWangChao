import { describe, expect, it } from 'vitest';
import { compileSafeRegex } from '../domain/worldbook/safeRegex';

/** 同一正则、同一文本：安全子集的判断必须与原生 RegExp.test 一致（原生正则只在测试里用作对照）。 */
function agree(source: string, flags: string, inputs: readonly string[]) {
  const safe = compileSafeRegex(source, flags);
  if (!safe.ok) throw new Error(`应在安全子集内：/${source}/${flags}（${safe.reason}）`);
  for (const input of inputs) {
    const expected = new RegExp(source, flags).test(input);
    if (safe.test(input) !== expected) throw new Error(`/${source}/${flags} 对 ${JSON.stringify(input)}：期望 ${expected}`);
  }
}

const INPUTS = ['', 'abc', 'ABC', 'aac', 'a\nb', 'b\na', 'cat dog', 'concat', 'colour color', '码头12号', '港口', '张三李四',
  'x.y', 'xay', '  ', ' ', 'Aa', '中', 'path/to', '\b', 'aaaa', 'ab ab', '\u0001码头', 'K', 'k', 'ſ', 'İ', 'i', '_x_', '-', ']'];

describe('安全子集与原生正则逐一对照', () => {
  const patterns: Array<[string, string]> = [
    ['abc', ''], ['a.c', ''], ['^abc', ''], ['abc$', ''], ['a|b', ''], ['(ab)+', ''], ['a*b', ''], ['a+?b', ''],
    ['a{2}', ''], ['a{2,}', ''], ['a{1,3}b', ''], ['[abc]', ''], ['[^abc]', ''], ['[a-z]+', ''], ['[\\d]+', ''],
    ['\\d{2}', ''], ['\\w+\\s\\w+', ''], ['\\bcat\\b', ''], ['\\Bat', ''], ['x\\.y', ''], ['码头\\d+号', ''],
    ['港口|码头', ''], ['(?:张|李)(三|四)', ''], ['[一-龥]+', ''], ['^\\s*$', ''], ['colou?r', ''], ['[]', ''], ['[^]', ''],
    ['a[-b]', ''], ['[a-]', ''], ['\\x41', ''], ['\\u4e2d', ''], ['\\t', ''], ['(a+)+$', ''], ['(.*)*x', ''], ['\\/to', ''],
    ['[\\b]', ''], ['a|', ''], ['(|a)b', ''], ['()', ''], ['.', ''], ['^', ''], ['$', ''], ['(?<name>a)b', ''], [']', ''],
    ['abc', 'i'], ['[a-c]+', 'i'], ['k', 'i'], ['K', 'i'], ['[k]', 'i'], ['[^k]', 'i'], ['\\w', 'i'], ['i', 'i'], ['[İ]', 'i'],
    ['^b', 'm'], ['a$', 'm'], ['^a$', 'm'], ['a.b', 's'], ['a.b', ''], ['abc', 'g'], ['abc', 'y'], ['\\u0001码头', 'y'], ['码头', 'y'],
    ['_x_', ''], ['\\b_', ''], ['\\-', ''], ['\\]', ''],
  ];
  for (const [source, flags] of patterns) it(`/${source}/${flags}`, () => agree(source, flags, INPUTS));

  it('随机生成的 3000 个正则与随机文本全部一致', () => {
    let seed = 12345;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const atoms = ['a', 'b', '.', '\\d', '\\w', '\\s', '[ab]', '[^a]', '\\b', '^', '$', '中', '[a-c]'];
    const gen = (depth: number): string => {
      const parts: string[] = [];
      const count = 1 + rand(3);
      for (let k = 0; k < count; k++) {
        let atom = depth < 3 && rand(4) === 0 ? `(${gen(depth + 1)}${rand(3) === 0 ? `|${gen(depth + 1)}` : ''})` : atoms[rand(atoms.length)];
        if (!['\\b', '^', '$'].includes(atom)) atom += ['', '', '*', '+', '?', '{1,2}', '*?'][rand(7)];
        parts.push(atom);
      }
      return parts.join('');
    };
    const texts = Array.from({ length: 12 }, () => Array.from({ length: rand(9) }, () => 'ab1 中\n_'[rand(7)]).join(''));
    let checked = 0;
    for (let k = 0; k < 3000; k++) {
      const source = gen(0);
      const flags = ['', 'i', 'm', 's', 'y'][rand(5)];
      try { new RegExp(source, flags); } catch { continue; }
      agree(source, flags, texts);
      checked++;
    }
    expect(checked).toBeGreaterThan(2500);
  }, 30_000); // 3000 个正则逐一对照：CI 上约 4.4～5.7 秒，默认 5 秒超时过紧；断言不变。
});

describe('不在子集内的写法：不运行，给出原因', () => {
  it('原因分类', () => {
    const cases: Array<[string, string, string]> = [
      ['a', 'u', 'unicode_flag'], ['(?=a)', '', 'lookaround'], ['(?<!a)b', '', 'lookaround'], ['(a)\\1', '', 'backreference'],
      ['\\k<x>', '', 'backreference'], ['\\p{L}', '', 'unsupported_escape'], ['\\cA', '', 'unsupported_escape'], ['\\01', '', 'unsupported_escape'],
      ['a{', '', 'unsupported_syntax'], ['[\\d-z]', '', 'unsupported_syntax'], ['a{1001}', '', 'too_large'],
      ['(a{1,100}){1,100}', '', 'too_large'], ['a'.repeat(1001), '', 'too_long'],
    ];
    for (const [source, flags, reason] of cases) expect(compileSafeRegex(source, flags)).toEqual({ ok: false, reason });
  });
});

describe('线性时间：对抗输入也很快', () => {
  it('嵌套重复、重叠分支在 2 万字文本上都在 1 秒内完成', () => {
    const text = `${'a'.repeat(20_000)}!`;
    for (const source of ['(a+)+$', '(a|a)*b', '(.*)*x', '(a*)*b', '^(\\w+\\s?)*$']) {
      const safe = compileSafeRegex(source, '');
      expect(safe.ok).toBe(true);
      if (!safe.ok) continue;
      const started = Date.now();
      expect(safe.test(text)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });
});

describe('忽略大小写的 Unicode 对照（独立审查 P2-3）', () => {
  /** 拉丁扩展、希腊、西里尔、亚美尼亚、格鲁吉亚、切罗基、罗马数字、圈字母、全角等区段的全部 UTF-16 码元。 */
  const RANGES: Array<[number, number]> = [
    [0x0000, 0x058f], [0x10a0, 0x10ff], [0x13a0, 0x13ff], [0x1c80, 0x1cbf], [0x1d00, 0x1dbf], [0x1e00, 0x1fff],
    [0x2100, 0x218f], [0x24b0, 0x24ff], [0x2c00, 0x2d2f], [0xa640, 0xa7ff], [0xab70, 0xabbf], [0xff00, 0xff5f],
  ];
  const SAMPLE: string[] = [];
  for (const [lo, hi] of RANGES) for (let c = lo; c <= hi; c++) SAMPLE.push(String.fromCharCode(c));
  const hex = (c: string) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  const tricky = [
    'µ', 'μ', 'Μ', 'ς', 'σ', 'Σ', 'ǅ', 'Ǆ', 'ǆ', 'ǈ', 'ǋ', 'ǲ', 'K', 'k', 'K', 's', 'ſ', 'ß', 'ẞ', 'İ', 'ı', 'i', 'I',
    'ϐ', 'β', 'ϑ', 'θ', 'ϕ', 'φ', 'ϰ', 'κ', 'ϱ', 'ρ', 'ϵ', 'ε', 'ͅ', 'ι', 'ι', 'ᾳ', 'Ω', 'ω', 'Å', 'å',
    'ẛ', 'ꭰ', 'Ꭰ', 'ᏸ', 'Ａ', 'ａ', 'Ā', 'ā', 'Ç', 'ç', 'ÿ', 'Ÿ', 'ᲀ', 'в', 'ᲈ', 'ꙋ',
  ];

  it('单个特殊字符：与原生 RegExp 在各区段全部码元上的判断一致', () => {
    for (const c of tricky) {
      agree(hex(c), 'i', SAMPLE);
      agree(`[${hex(c)}]`, 'i', SAMPLE);
      agree(`[^${hex(c)}]`, 'i', SAMPLE);
    }
  });

  it('字符类范围与内置类：与原生 RegExp 一致', () => {
    const classes = ['[À-ÿ]', '[Ā-ſ]', '[ǄǅǆǇ-ǌ]', '[Ͱ-Ͽ]', '[α-ω]', '[Α-Ω]', '[а-я]', '[Ⅰ-ⅿ]', '[ⓐ-ⓩ]', '[ᏸ-ᏽ]', '[ꭰ-ꮿ]',
      '[ａ-ｚ]', '[a-z]', '[^a-z]', '[A-Z]', '\\w', '\\W', '[\\w]', '[^\\W]', '[\\s\\S]', '[ⰰ-ⱟ]', '[ႠჅ]', '[k-k]', '[\\u2126\\u212a]'];
    for (const source of classes) agree(source, 'i', SAMPLE);
  });

  it('多字符文本：特殊大小写映射（ß、ſ、İ、开尔文符号等）', () => {
    const inputs = ['STRASSE', 'straße', 'STRAẞE', 'ſtraße', 'İstanbul', 'istanbul', 'ISTANBUL', 'ıstanbul', 'Kelvin', 'kelvin',
      'ΣΟΦΙΑ', 'σοφια', 'σοφιας', 'ǅungla', 'ǆungla', 'ǄUNGLA', 'µm', 'μm', 'ΜM', 'ᲀᲁ', 'ВД'];
    for (const source of ['straße', 'STRASSE', 'ſtraße', 'İstanbul', 'istanbul', 'kelvin', '\\u212aelvin', 'σοφιας', 'ΣΟΦΙΑΣ',
      'ǆungla', 'ǅ\\w+', 'µm', '[µ]m', 'вд', '[в][д]', '^\\u1c80', '(?:ß|ss)+']) agree(source, 'i', inputs);
  });

  it('全部 65536 个码元：几个大小写等价类较大的字符逐一对照', () => {
    const all = Array.from({ length: 0x10000 }, (_, c) => String.fromCharCode(c));
    for (const c of ['µ', 'ǅ', 'Ǆ', 'K', 'θ', 'Σ', 'ᲀ', 'в']) agree(hex(c), 'i', all);
  });
});
