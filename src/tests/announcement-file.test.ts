import { describe, expect, it } from 'vitest';
import raw from '../../announcements/current.json?raw';
import { parseAnnouncement } from '../services/notices/announcement';

// 合并后会被自动写入 Cloudflare KV；这里保证不合法的公告过不了 npm run check。
describe('announcements/current.json', () => {
  it('passes the same validation the Worker and client use', () => {
    const announcement = parseAnnouncement(raw);
    expect(announcement).toBeDefined();
    expect(announcement?.version).not.toMatch(/^builtin-/);
  });
});
