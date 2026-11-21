import { describe, expect, it } from 'vitest';
import { formatKeys, parseKeys } from '../domain/worldbook/keyText';
import { cleanKeys } from '../domain/worldbook/release';
import { runWorldbookTrigger } from '../domain/worldbook/trigger';
import { EMPTY_TIMED_STATE } from '../domain/worldbook/timedEffects';
import { benchEntry } from './support/worldbookScanBench';

/** 编辑框里的关键词文本：玩家在原文后追加内容，再解析回来。 */
const appendThenParse = (keys: string[], appended: string) => parseKeys(`${formatKeys(keys)}${appended}`);

describe('关键词编辑：格式化与解析互逆，不破坏正则', () => {
  it('含逗号量词的正则在追加普通关键词后保持完整', () => {
    expect(appendThenParse(['/街角[0-9]{1,2}/'], '，茶楼')).toEqual(['/街角[0-9]{1,2}/', '茶楼']);
    expect(appendThenParse(['/街角[0-9]{1,2}/'], ', 茶楼')).toEqual(['/街角[0-9]{1,2}/', '茶楼']);
  });

  it('字符类里的逗号、斜杠，量词 {2,}，转义斜杠，带标志的正则', () => {
    const keys = ['/[，,、]号/', '/a{2,}/i', '/路[/|]口/', '/a\\/b,c/g', '/x{1,3}y/su'];
    expect(parseKeys(formatKeys(keys))).toEqual(keys);
    expect(appendThenParse(keys, '、新词')).toEqual([...keys, '新词']);
  });

  it('普通关键词里的逗号、顿号、反斜杠用转义保留', () => {
    const keys = ['甲,乙', '丙，丁', '戊、己', '尾巴\\', 'a\\b', 'c\\\\d', '\\,'];
    const text = formatKeys(keys);
    expect(parseKeys(text)).toEqual(keys);
    expect(text).toContain('甲\\,乙');
    // 玩家手写的转义逗号
    expect(parseKeys('张三\\,李四，王五')).toEqual(['张三,李四', '王五']);
  });

  it('不是完整正则的斜杠开头文本按普通关键词处理，原样保留', () => {
    const keys = ['/a/b/', '/ab/ c', '/未闭合', '/x/,y', '//'];
    expect(parseKeys(formatKeys(keys))).toEqual(keys);
  });

  it('首尾空白、空项、重复项：与匹配时的处理一致（匹配本来就去掉首尾空白、跳过空项）', () => {
    expect(parseKeys(' 李四 ，，茶楼，李四\n码头')).toEqual(cleanKeys(['李四', '茶楼', '李四', '码头']));
  });

  it('随机关键词往返：解析(格式化(k)) 等于 k 整理后的结果', () => {
    const alphabet = ['a', '/', '\\', ',', '，', '、', '[', ']', '{', '}', '1', '2', ' ', '街', 'i', '\n', '|', '(', ')'];
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 3000; round++) {
      const keys = Array.from({ length: 1 + rand(4) }, () => Array.from({ length: 1 + rand(10) }, () => alphabet[rand(alphabet.length)]).join(''));
      expect(parseKeys(formatKeys(keys)), JSON.stringify(keys)).toEqual(cleanKeys(keys));
    }
  });

  it('追加关键词前后，原关键词的匹配结果不变', () => {
    const keys = ['/街角[0-9]{1,2}/', '茶楼'];
    const run = (k: string[], text: string) => runWorldbookTrigger({
      books: [{ bookId: 'b', versionId: 'v', entries: [benchEntry({ entryId: 'e', keys: k, content: '街角设定' })] }],
      messages: [text], contextTokens: 32_000, storyRemainingTokens: 4_000, trigger: 'normal', messageCount: 1,
      timedState: EMPTY_TIMED_STATE, seed: 's', settings: {},
    }).activated.length;
    const edited = appendThenParse(keys, '，码头');
    for (const text of ['他走到街角12', '街角7的灯', '茶楼里', '街角', '街角123号']) expect(run(edited, text)).toBe(run(keys, text));
    expect(run(edited, '码头')).toBe(1);
  });
});
