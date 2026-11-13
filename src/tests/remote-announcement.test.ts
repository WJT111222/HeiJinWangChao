import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { announcement } from '../ui/notices/announcement';
import { announcementMaxBytes, parseAnnouncement } from '../services/notices/announcement';
import { loadAnnouncement, loadAnnouncementWithSource } from '../services/notices/client';
const remote = { version: 'test-1', title: '王朝公告', theme: '合成更新', updates: ['新的内容'], message: '感谢支持' };
const assets = { fetch: vi.fn(async () => new Response('asset')) };
const request = (method = 'GET', path = '/api/announcement') => new Request(`https://game.invalid${path}`, { method });
afterEach(() => vi.useRealTimers());
describe('remote announcement contract and read-only Worker', () => {
  it('returns valid KV text and never serves API from SPA', async () => {
    const get = vi.fn(async () => JSON.stringify(remote));
    const response = await worker.fetch(request(), { ANNOUNCEMENTS: { get }, ASSETS: assets });
    expect(await response.json()).toEqual(remote); expect(get).toHaveBeenCalledExactlyOnceWith('current');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Announcement-Source')).toBe('kv');
  });
  it.each([null, '{broken', '{}', JSON.stringify({ ...remote, updates: [] }), JSON.stringify({ ...remote, extra: true }), 'a'.repeat(announcementMaxBytes + 1)])('falls back for invalid/missing KV %s', async raw => {
    const response = await worker.fetch(request(), { ANNOUNCEMENTS: { get: async () => raw }, ASSETS: assets });
    expect(await response.json()).toEqual(announcement);
    expect(response.headers.get('X-Announcement-Source')).toBe('builtin');
  });
  it('handles absent binding and KV outage', async () => {
    for (const binding of [undefined, { get: async () => { throw new Error('private failure'); } }]) {
      expect(await (await worker.fetch(request(), { ANNOUNCEMENTS: binding, ASSETS: assets })).json()).toEqual(announcement);
    }
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('rejects %s without accessing KV', async method => {
    const get = vi.fn(); const result = await worker.fetch(request(method), { ANNOUNCEMENTS: { get }, ASSETS: assets });
    expect(result.status).toBe(405); expect(result.headers.get('Allow')).toBe('GET'); expect(get).not.toHaveBeenCalled();
  });
  it('preserves static assets and rejects unknown API paths', async () => {
    expect(await (await worker.fetch(request('GET', '/game.js'), { ASSETS: assets })).text()).toBe('asset');
    expect((await worker.fetch(request('GET', '/api/other'), { ASSETS: assets })).status).toBe(404);
  });
  it('enforces lengths, types and Unicode byte limit', () => {
    for (const value of [{ ...remote, title: ' ' }, { ...remote, version: 1 }, { ...remote, updates: Array(21).fill('x') }, { ...remote, message: 'x'.repeat(2001) }, { ...remote, updates: Array(20).fill('汉'.repeat(2000)) }]) expect(parseAnnouncement(JSON.stringify(value))).toBeUndefined();
  });
});
describe('non-blocking browser fetch fallback', () => {
  it.each([200, 503])('uses response safely (status %s)', async status => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(remote), { status }));
    expect(await loadAnnouncement(fetcher)).toEqual(status === 200 ? remote : announcement);
    expect(fetcher).toHaveBeenCalledWith('/api/announcement', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
  });
  it('handles offline, invalid JSON, absent fields and oversized streams', async () => {
    expect(await loadAnnouncement(async () => { throw new Error('offline'); })).toEqual(announcement);
    for (const text of ['invalid', '{}', 'x'.repeat(announcementMaxBytes + 1)]) expect(await loadAnnouncement(async () => new Response(text))).toEqual(announcement);
  });
  it('aborts a stalled request within the independent timeout', async () => {
    vi.useFakeTimers();
    const pending = loadAnnouncement(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await vi.advanceTimersByTimeAsync(3000); expect(await pending).toEqual(announcement);
  });
});
describe('公告来源：只有服务端明确的 kv 才算远程公告', () => {
  const reply = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);
  it('X-Announcement-Source: kv 且内容合法 → kv', async () => {
    expect(await loadAnnouncementWithSource(reply(JSON.stringify(remote), { headers: { 'X-Announcement-Source': 'kv' } })))
      .toEqual({ announcement: remote, source: 'kv' });
  });
  it('服务端回退到它自己的旧版内置公告（版本与本页不同）→ builtin，仍正常展示', async () => {
    const stale = { ...announcement, version: 'builtin-0.9', theme: '旧版内置公告' };
    expect(await loadAnnouncementWithSource(reply(JSON.stringify(stale), { headers: { 'X-Announcement-Source': 'builtin' } })))
      .toEqual({ announcement: stale, source: 'builtin' });
  });
  it('未标明来源或来源值不认识 → unknown', async () => {
    expect((await loadAnnouncementWithSource(reply(JSON.stringify(remote)))).source).toBe('unknown');
    expect((await loadAnnouncementWithSource(reply(JSON.stringify(remote), { headers: { 'X-Announcement-Source': 'KV ' } }))).source).toBe('unknown');
  });
  it.each([
    ['HTTP 503', reply(JSON.stringify(remote), { status: 503, headers: { 'X-Announcement-Source': 'kv' } })],
    ['非法 JSON', reply('{broken', { headers: { 'X-Announcement-Source': 'kv' } })],
    ['不合法公告', reply(JSON.stringify({ ...remote, extra: true }), { headers: { 'X-Announcement-Source': 'kv' } })],
    ['超长', reply('x'.repeat(announcementMaxBytes + 1), { headers: { 'X-Announcement-Source': 'kv' } })],
    ['离线', async () => { throw new Error('offline'); }],
  ] as const)('%s → 本页内置公告，来源 fallback', async (_label, fetcher) => {
    expect(await loadAnnouncementWithSource(fetcher)).toEqual({ announcement, source: 'fallback' });
  });
  it('超时 → fallback', async () => {
    vi.useFakeTimers();
    const pending = loadAnnouncementWithSource(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toEqual({ announcement, source: 'fallback' });
  });
});
