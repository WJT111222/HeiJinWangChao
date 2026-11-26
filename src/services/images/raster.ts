// Signature recognition and ZIP central/local header handling adapted from MoRanJiangHu imageTasks.
export const maxPictureBytes = 16 * 1024 * 1024;
export async function bounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('响应超过容量上限');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('接口返回空响应');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('响应超过容量上限');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function rasterMime(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > maxPictureBytes) throw new Error('图片为空或超过 16 MiB');
  const starts = (sig: number[]) => sig.every((v, i) => bytes[i] === v);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (/^GIF8[79]a/.test(head)) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp';
  throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 位图');
}
// Read dimensions before passing the file to a browser decoder. A small compressed
// image may otherwise request a bitmap far larger than the encoded body.
export function rasterSize(bytes: Uint8Array) {
  const mime = rasterMime(bytes),
    v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0;
  if (mime === 'image/png' && bytes.length >= 33 && v.getUint32(12) === 0x49484452) {
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (mime === 'image/gif' && bytes.length >= 13) {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
  } else if (mime === 'image/webp' && bytes.length >= 30) {
    const tag = v.getUint32(12);
    if (tag === 0x56503858) {
      width = 1 + (v.getUint32(24, true) & 0xffffff);
      height = 1 + (v.getUint32(26, true) >>> 8);
    }
    if (tag === 0x56503820) {
      width = v.getUint16(26, true) & 0x3fff;
      height = v.getUint16(28, true) & 0x3fff;
    }
    if (tag === 0x5650384c) {
      const bits = v.getUint32(21, true);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
  } else if (mime === 'image/jpeg') {
    for (let off = 2; off + 9 <= bytes.length && bytes[off] === 255;) {
      if (bytes[off + 1] === 255) {
        off++;
        continue;
      }
      const tag = bytes[off + 1],
        length = v.getUint16(off + 2);
      if (length < 2 || off + length + 2 > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(tag)) {
        height = v.getUint16(off + 5);
        width = v.getUint16(off + 7);
        break;
      }
      off += 2 + length;
    }
  }
  if (!width || !height || width * height > 16777216) throw new Error('图片尺寸无效或超过 1600 万像素');
  return { mime, width, height } as const;
}
export function checkDimensions(bytes: Uint8Array) {
  return rasterSize(bytes).mime;
}
export function encode(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return btoa(parts.join(''));
}
export function decode(value: string) {
  const raw = value.replace(/^data:image\/(?:png|jpeg|webp|gif);base64,/i, '').replace(/\s/g, '');
  if (raw.length > Math.ceil(maxPictureBytes / 3) * 4) throw new Error('图片超过 16 MiB');
  let binary: string;
  try {
    binary = atob(raw);
  } catch {
    throw new Error('图片 Base64 格式无效');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  rasterMime(bytes);
  return bytes;
}
export async function unpack(bytes: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true),
    u32 = (at: number) => view.getUint32(at, true);
  async function extract(local: number, method: number, packed: number, plain: number) {
    if (
      local + 30 > bytes.length ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) & 1 ||
      u16(local + 8) !== method ||
      plain > maxPictureBytes
    )
      throw new Error('ZIP 目录无效或图片过大');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > bytes.length || !packed) throw new Error('ZIP 图片数据不完整');
    const slice = bytes.subarray(start, start + packed);
    const result =
      method === 0
        ? slice
        : method === 8
          ? await bounded(
              new Response(new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'))),
              maxPictureBytes,
            )
          : undefined;
    if (!result || result.length !== plain) throw new Error('ZIP 压缩格式或图片长度无效');
    rasterMime(result);
    return result;
  }
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 65557); end--) {
    if (u32(end) !== 0x06054b50) continue;
    let at = u32(end + 16);
    for (let index = 0; index < Math.min(u16(end + 10), 1024) && at + 46 <= end; index++) {
      if (u32(at) !== 0x02014b50) break;
      const n = u16(at + 28),
        next = at + 46 + n + u16(at + 30) + u16(at + 32);
      if (next > end) break;
      if (/\.(png|jpe?g|gif|webp)$/i.test(new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + n))))
        return extract(u32(at + 42), u16(at + 10), u32(at + 20), u32(at + 24));
      at = next;
    }
    break;
  }
  if (bytes.length >= 30 && u32(0) === 0x04034b50 && !(u16(6) & 8))
    return extract(0, u16(8), u32(18), u32(22));
  throw new Error('ZIP 未找到可读取的图片');
}
