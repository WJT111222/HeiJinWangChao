// 发布前校验公告文件：与线上 Worker / 客户端使用同一个 parseAnnouncement。
// 用法：node scripts/check-announcement.mjs announcements/current.json
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { parseAnnouncement } from '../src/services/notices/announcement.ts';

const path = process.argv[2] ?? 'announcements/current.json';
const raw = await readFile(path, 'utf8');
const announcement = parseAnnouncement(raw);
if (!announcement) {
  process.stderr.write(`${path} 不是合法公告：需要 version/title/theme/updates/message 五个字段，updates 1–20 条，整体不超过 32KiB，且不能有多余字段。\n`);
  process.exit(1);
}
process.stdout.write(`${path} 校验通过：${announcement.version}，${announcement.updates.length} 条更新。\n`);
