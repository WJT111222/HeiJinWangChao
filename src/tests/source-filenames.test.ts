import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../scripts/check-source-filenames.mjs');
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'heijin-filenames-')); directories.push(root);
  for (const path of files) { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, 'export {};\n'); }
  return root;
}
function scan(root: string) {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('跨平台文件名检查（真实 Node CLI）', () => {
  it.each([
    ['foo.ts', 'Foo.tsx'], ['card.js', 'Card.jsx'], ['task.ts', 'task.js'],
    ['data.mts', 'Data.mjs'], ['data.cts', 'Data.cjs'], ['config.ts', 'Config.json'],
  ])('拒绝省略扩展名的歧义：%s + %s', (a, b) => {
    const result = scan(fixture(['src/' + a, 'src/' + b]));
    expect(result.status).toBe(1); expect(result.output).toContain('extensionless module collision');
    expect(result.output).toContain('src/' + a); expect(result.output).toContain('src/' + b);
  });
  it('保留正常资源、不同目录相同模块名及声明文件，不按扩展名盲目拦截', () => {
    const result = scan(fixture(['src/foo.ts', 'src/foo.css', 'src/foo.png', 'src/Foo.d.ts',
      'src/Foo.d.mts', 'src/sub/foo.tsx', 'src/bar.jsx', 'src/bar.svg']));
    expect(result.status).toBe(0); expect(result.output).toContain('No case-insensitive');
    expect(result.output).toContain('filesystem (Git unavailable)');
  });
  it('Git 索引保留的纯大小写冲突即使检出目录只有一份文件也被拒绝', () => {
    const root = fixture(['src/view.ts']);
    execFileSync('git', ['init', '-q', root]);
    const git = (args: string[], input?: string) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input });
    git(['config', 'core.ignorecase', 'false']);
    const object = git(['hash-object', '-w', '--stdin'], 'export {};\n').trim();
    for (const path of ['src/view.ts', 'src/View.ts']) git(['update-index', '--add', '--cacheinfo', '100644', object, path]);
    const result = scan(root);
    expect(result.status).toBe(1); expect(result.output).toContain('case-insensitive path collision');
    expect(result.output).toContain('src/View.ts'); expect(result.output).toContain('src/view.ts');
    expect(result.output).toContain('Git index + untracked files');
  });
  it('不同内容的大小写目录和资源路径冲突也从 Git 索引识别', () => {
    const root = fixture(['src/place/a.ts']); execFileSync('git', ['init', '-q', root]);
    const object = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: 'test', encoding: 'utf8' }).trim();
    for (const path of ['src/Place/b.ts', 'src/place/a.ts', 'src/icon.png', 'src/Icon.png'])
      execFileSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', '100644', object, path]);
    const result = scan(root); expect(result.status).toBe(1);
    expect(result.output).toContain('src/Place'); expect(result.output).toContain('src/place');
    expect(result.output).toContain('src/icon.png'); expect(result.output).toContain('src/Icon.png');
  });
  it('新未跟踪文件同样参与检查，而非只看已提交文件', () => {
    const root = fixture(['src/panel.ts', 'src/Panel.tsx']); execFileSync('git', ['init', '-q', root]);
    const result = scan(root); expect(result.status).toBe(1); expect(result.output).toContain('extensionless module collision');
  });
  it('不存在的源码目录失败，不把无法检查宣称成没有冲突', () => {
    const result = scan(join(fixture([]), 'missing'));
    expect(result.status).toBe(1); expect(result.output).toContain('could not read source directory');
  });
});
