import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorldbookLibraryPanel } from '../ui/settings/WorldbookLibrary';
import { MAX_ENABLED_BOOKS } from '../services/storage/worldbookLibrary';

// 交互流程（导入 → 自动启用 → 关闭 → 删除）需要真实 IndexedDB 与 DOM，在浏览器中验证；这里只检查首屏结构与文案。
test('世界书管理首屏：说明、正文接入提示、导入按钮与启用计数，读取中不显示空状态', () => {
  const html = renderToStaticMarkup(<WorldbookLibraryPanel />);
  expect(html).toContain('导入酒馆（SillyTavern）世界书');
  expect(html).toContain('启用状态对所有存档生效');
  expect(html).toContain('正文接入还在进行中');
  expect(html).toContain('>导入世界书</button>');
  expect(html).toContain('accept=".json,application/json"');
  expect(html).toContain(`已启用 0 / ${MAX_ENABLED_BOOKS} 本`);
  expect(html).toContain('正在读取书库');
  expect(html).not.toContain('还没有导入任何世界书');
  expect(html).toContain('Sticky / Cooldown');
});
