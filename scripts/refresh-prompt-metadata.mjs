import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import process from 'node:process';

// 显式维护命令；check 不运行此脚本，不掩盖正文或注册信息漂移。
const root = new URL('../prompts/', import.meta.url);
const manifestUrl = new URL('manifest.json', root);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
for (const module of manifest.modules) {
  const url = new URL(module.path, root);
  if (!url.href.startsWith(root.href)) throw new Error(`提示词路径越界：${module.path}`);
  const bytes = await readFile(url);
  const content = bytes.toString('utf8');
  module.characters = Array.from(content).length;
  module.contentSha256 = createHash('sha256').update(bytes).digest('hex');
  module.placeholders = [
    ...new Set([...content.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map((match) => match[1])),
  ].sort();
}
await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`已刷新 ${manifest.modules.length} 项资源的字符数、hash 和占位符元数据。\n`);
