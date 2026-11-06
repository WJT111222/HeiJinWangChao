import { describe, expect, it } from 'vitest';
import { parseStoryReading } from '../ui/game/storyReading';

describe('正文阅读投影：只解释明确标签，不修改模型原文', () => {
  it('旁白与多角色按原顺序分段，完整姓名才对应主角', () => {
    const raw = '【旁白】秋雨停了。\n【吴杰涛】“你还没走？”\n【吴杰】“我等雨停。”\n【旁白】门外传来脚步。\n【吴杰涛】“走吧。”';
    const blocks = parseStoryReading(raw, '吴杰');
    expect(blocks.map(block => block.kind === 'dialogue' ? [block.speaker, block.isProtagonist] : block.kind))
      .toEqual(['narration', ['吴杰涛', false], ['吴杰', true], 'narration', ['吴杰涛', false]]);
    expect(blocks.map(block => block.text).join('')).toBe(raw.replace(/【(?:旁白|吴杰涛|吴杰)】/g, ''));
    expect(raw).toContain('【旁白】');
  });
  it('支持独占一行标签、缩进、CRLF、多行内容和连续旁白', () => {
    const blocks = parseStoryReading('【旁白】\r\n第一行。\r\n第二行。\r\n  【旁白】第三行。\n【林舟】\n“第一句。\n第二句。”', '林舟');
    expect(blocks.map(block => block.kind)).toEqual(['narration', 'narration', 'dialogue']);
    expect(blocks[0].text).toBe('\r\n第一行。\r\n第二行。\r\n');
    expect(blocks[1].text).toBe('  第三行。\n');
    expect(blocks[2]).toMatchObject({ speaker: '林舟', isProtagonist: true, text: '\n“第一句。\n第二句。”' });
  });
  it('尚未建档的角色也能展示；别名及姓名前后缀不会冒充主角', () => {
    const blocks = parseStoryReading('【小舟】“你好。”\n【林舟远】“你好。”\n【老林舟】“你好。”\n【陌生访客】“你好。”\n【林舟】“你好。”', '林舟');
    expect(blocks.map(block => block.kind === 'dialogue' && block.isProtagonist)).toEqual([false, false, false, false, true]);
  });
  it('段内标签、引语中的标签以及HTML作为普通文字完整保留', () => {
    const text = '她指着【出口】说：“【林舟】不是这里的标牌。”\n<script>alert(1)</script>';
    expect(parseStoryReading(`【旁白】${text}`, '林舟')).toEqual([{ kind: 'narration', text }]);
  });
  it.each(['旧档第一段。\n\n第二段。', '【未闭合', '【】正文', '【 林舟 】“保留原样。”', '【林\n舟】文字', '【旁白】', '【林舟】\n   '])('无法识别或空标签内容保留为普通段落：%s', raw => {
    expect(parseStoryReading(raw, '林舟')).toEqual([{ kind: 'plain', text: raw }]);
  });
  it('混合旧正文、有效标签、损坏标签不丢字', () => {
    expect(parseStoryReading('旧正文。\n【林舟】“你好。”\n【】无法识别\n【旁白】雨停了。', '林舟'))
      .toEqual([{ kind: 'plain', text: '旧正文。\n' }, { kind: 'dialogue', speaker: '林舟', isProtagonist: true, text: '“你好。”\n' }, { kind: 'plain', text: '【】无法识别\n' }, { kind: 'narration', text: '雨停了。' }]);
  });
  it('空正文安全返回；重复解析确定且输入不变', () => {
    expect(parseStoryReading('', '林舟')).toEqual([]);
    const source = Object.freeze({ narrative: '【旁白】你好。\n【林舟】“明天见。”' });
    const before = JSON.stringify(source);
    expect(parseStoryReading(source.narrative, '林舟')).toEqual(parseStoryReading(source.narrative, '林舟'));
    expect(JSON.stringify(source)).toBe(before);
  });
});
