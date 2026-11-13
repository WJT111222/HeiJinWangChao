import { describe, it, expect } from 'vitest';
import { splitFeedback } from '../ui/Feedback';

describe('反馈文案分行不改变原文、错误码或操作后果', () => {
  it.each([
    '撤回未完成，存档未部分修改。请重新读取存档后检查恢复点。',
    '连接测试成功，已收到模型文本响应；游戏回合未运行。',
    '安全失败码：variables_schema',
    '原始记忆仍保留;重新生成可能产生费用。',
    '第一行。\n第二行；第三行。',
    '',
  ])('%s', text => {
    const [lead, detail] = splitFeedback(text);
    expect(lead + detail).toBe(text);
    if (detail) expect(lead).toMatch(/[。；;]$/);
  });
});
