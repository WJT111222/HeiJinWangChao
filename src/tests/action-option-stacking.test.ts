import { describe, expect, it } from 'vitest';
import { appendActionOption, includesActionOption } from '../ui/game/actionOptions';

describe('行动建议叠加到输入框', () => {
  it('输入为空时直接填入', () => {
    expect(appendActionOption('', '先去泊位看货')).toBe('先去泊位看货');
    expect(appendActionOption('  \n', '先去泊位看货')).toBe('先去泊位看货');
  });
  it('已有内容时用中文逗号接在后面，玩家自己写的文字原样保留', () => {
    expect(appendActionOption('先去泊位看货', '打电话给调度科')).toBe('先去泊位看货，打电话给调度科');
    expect(appendActionOption('我把烟掐了 ', '追问老周货主是谁')).toBe('我把烟掐了，追问老周货主是谁');
  });
  it('已有内容以标点或换行结尾时直接接上，不重复加逗号', () => {
    expect(appendActionOption('我把烟掐了。', '追问老周货主是谁')).toBe('我把烟掐了。追问老周货主是谁');
    expect(appendActionOption('先去泊位看货，', '打电话给调度科')).toBe('先去泊位看货，打电话给调度科');
    expect(appendActionOption('先看看\n', '打电话给调度科')).toBe('先看看\n打电话给调度科');
  });
  it('已经包含的建议不会重复添加，空建议不改变输入', () => {
    expect(appendActionOption('先去泊位看货，打电话给调度科', '先去泊位看货')).toBe('先去泊位看货，打电话给调度科');
    expect(appendActionOption('先去泊位看货', '  ')).toBe('先去泊位看货');
  });
  it('已选中状态按是否包含判断', () => {
    expect(includesActionOption('先去泊位看货，打电话给调度科', '打电话给调度科')).toBe(true);
    expect(includesActionOption('先去泊位看货', '打电话给调度科')).toBe(false);
    expect(includesActionOption('任何内容', '')).toBe(false);
  });
});
