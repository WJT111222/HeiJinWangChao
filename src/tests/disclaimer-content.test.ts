import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { disclaimer } from '../ui/notices/disclaimer';

// 独立夹具直接摘自审查定稿，不从生产数据反向生成预期文本。
const approved = readFileSync(new URL('./fixtures/disclaimer-v1.md', import.meta.url), 'utf8');

it('免责声明逐段完整等于审查定稿：开头、六章、落款及强调均不缩写', () => {
  const paragraph = (value: { text: string; emphasis?: boolean }) => value.emphasis ? `**${value.text}**` : value.text;
  const blocks = [
    '# 黑金王朝\n## 游玩须知与免责声明', `**18+${disclaimer.ageNotice}**`,
    ...disclaimer.intro.map(paragraph),
    ...disclaimer.sections.flatMap(section => [`### ${section.title}`, ...section.paragraphs.map(paragraph)]),
    '---', ...disclaimer.closing.map(paragraph),
  ];
  expect(`${blocks.join('\n\n')}\n`).toBe(approved);
  expect(disclaimer.sections).toHaveLength(6);
});
