import { announcement } from './ui/notices/announcement';
import { parseAnnouncement } from './services/notices/announcement';

interface Env {
  ANNOUNCEMENTS?: { get(key: string): Promise<string | null> };
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (path !== '/api/announcement') return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
    let remote;
    try {
      const raw = await env.ANNOUNCEMENTS?.get('current');
      if (raw) remote = parseAnnouncement(raw);
    } catch { /* Binding, KV or JSON errors use the same safe local fallback. */ }
    return Response.json(remote ?? announcement, { headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Announcement-Source': remote ? 'kv' : 'builtin',
    } });
  },
};
