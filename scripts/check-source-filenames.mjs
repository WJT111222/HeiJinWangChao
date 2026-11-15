// Cross-platform source paths and extensionless module imports; no dependencies.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';
import process from 'node:process';

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..'));
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json']);
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', '.wrangler', '.vite']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function filesystemPaths(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && ignored.has(entry.name)) return [];
    const name = prefix + entry.name;
    return entry.isDirectory() ? filesystemPaths(join(directory, entry.name), name + '/') : [name];
  });
}
function sourcePaths() {
  try {
    // The index preserves both names even when Windows checkout coalesces them.
    // --others also checks new, untracked source files before a commit.
    const raw = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { paths: [...new Set(raw.split('\0').filter(Boolean))], mode: 'Git index + untracked files' };
  } catch {
    // Source archives without .git remain checkable.
    return { paths: filesystemPaths(root), mode: 'filesystem (Git unavailable)' };
  }
}
function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}
try {
  const { paths, mode } = sourcePaths(), names = new Map(), modules = new Map();
  for (const path of paths) {
    const parts = path.split('/');
    // Include directory names: src/Foo/a.ts + src/foo/b.ts also conflict.
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      add(names, prefix.toLowerCase(), prefix);
    }
    const extension = extname(path).toLowerCase();
    if (!extensions.has(extension) || /\.d\.[cm]?ts$/i.test(path)) continue;
    const stem = path.slice(0, -extension.length);
    add(modules, stem.toLowerCase(), path);
  }
  const issues = [];
  for (const [kind, groups] of [['case-insensitive path', names], ['extensionless module', modules]]) {
    for (const group of groups.values()) {
      if (group.size > 1) issues.push({ kind, paths: [...group].sort(compare) });
    }
  }
  issues.sort((a, b) => compare(a.paths[0], b.paths[0]) || compare(a.kind, b.kind));
  process.stdout.write(`Filename check: ${paths.length} paths; ${mode}.\n`);
  if (issues.length) {
    for (const issue of issues) process.stderr.write(`${issue.kind} collision:\n${issue.paths.map(path => '  ' + posix.normalize(path)).join('\n')}\n`);
    process.stderr.write(`${issues.length} collision group(s). Rename paths; keep component exports unchanged.\n`);
    process.exitCode = 1;
  } else process.stdout.write('No case-insensitive path or extensionless module collisions.\n');
} catch (error) {
  process.stderr.write(`Filename check could not read source directory: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
