// Shared with the browser so an ineligible target never sends its credentials to the relay.
export function relayTarget(raw: string, origin: string, method: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === new URL(origin).hostname.toLowerCase().replace(/\.$/, '') ||
    /(^|\.)(localhost|local|internal|localdomain|arpa|workers\.dev|cloudflarestorage\.com|heijinwangchao\.de5\.net)$/.test(
      host,
    )
  )
    return;
  if (host.startsWith('[')) {
    // Accept public global unicast only; exclude transition and documentation ranges.
    if (!/^\[[23][\da-f]{3}:/.test(host) || /^\[(2002:|2001:(?:0:|:|db8:))/.test(host)) return;
  } else {
    if (!host.includes('.')) return;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || b === 0)) ||
        (a === 100 && b >= 64 && b < 128) ||
        (a === 198 && (b === 18 || b === 19))
      )
        return;
    }
  }
  if (
    method === 'GET' &&
    /\/models$/i.test(url.pathname) &&
    [...url.searchParams.keys()].every((key) => ['after', 'cursor', 'page'].includes(key))
  )
    return url;
  if (method === 'POST' && /\/chat\/completions$/i.test(url.pathname) && !url.search) return url;
}
