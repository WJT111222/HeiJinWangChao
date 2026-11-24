export const feedbackHeaders = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
};
export function feedbackJson(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, { status, headers: { ...feedbackHeaders, ...headers } });
}
export function sameOrigin(request: Request) {
  return request.headers.get('Origin') === new URL(request.url).origin
    && (!request.headers.has('Sec-Fetch-Site') || request.headers.get('Sec-Fetch-Site') === 'same-origin');
}
export class BodyTooLarge extends Error {}

export async function boundedText(request: Request, limit: number) {
  const length = request.headers.get('Content-Length');
  if (length !== null && Number(length) > limit) throw new BodyTooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return parts.join('') + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) throw new BodyTooLarge();
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
