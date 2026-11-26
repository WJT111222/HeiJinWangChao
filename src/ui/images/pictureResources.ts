import { decode, rasterSize } from '../../services/images/raster';
import type { Picture } from '../../services/images/model';
import type { ImageLibrary } from '../../services/images/library';

type Original = { file: Blob; width: number; height: number };
type Resource = { refs: number; url?: string; promise: Promise<string | undefined> };
// One cache per mounted save instance. Only small thumbnails survive their last reader.
export class PictureResources {
  private entries = new Map<string, Resource>();
  private sources = new Map<string, Promise<Original>>();
  private running = 0;
  private waiting: (() => void)[] = [];
  constructor(
    private lib: ImageLibrary,
    private saveId: string,
    private instance?: string,
  ) {}

  private async blob(p: Picture) {
    let reading = this.sources.get(p.id);
    if (!reading) {
      reading = this.lib.file(this.saveId, p.id, { instance: this.instance }).then((data) => {
        if (!data) throw Error('图片资源缺失');
        const bytes = decode(data);
        const { width, height, mime } = rasterSize(bytes);
        if (mime !== p.mime || bytes.length !== p.bytes) throw Error('图片资源不匹配');
        return { file: new Blob([bytes], { type: mime }), width, height };
      });
      this.sources.set(p.id, reading);
    }
    try {
      return await reading;
    } finally {
      if (this.sources.get(p.id) === reading) this.sources.delete(p.id);
    }
  }

  private async thumbnail(source: Original) {
    const options =
      source.width >= source.height
        ? { resizeWidth: Math.min(256, source.width) }
        : { resizeHeight: Math.min(256, source.height) };
    const bitmap = await createImageBitmap(source.file, options);
    try {
      // Use decoded orientation (including JPEG EXIF) for the final aspect ratio.
      const ratio = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('无法创建缩略图');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(Error('无法生成缩略图'))), 'image/webp', 0.84),
      );
    } finally {
      bitmap.close();
    }
  }

  acquire(p: Picture, original = false) {
    const key = (original ? 'full/' : 'thumb/') + p.id;
    let entry = this.entries.get(key);
    if (!entry) {
      const fresh: Resource = { refs: 0, promise: Promise.resolve(undefined) };
      this.entries.set(key, fresh);
      fresh.promise = Promise.resolve().then(async () => {
        if (this.running >= 2) await new Promise<void>((ok) => this.waiting.push(ok));
        this.running++;
        try {
          if (!fresh.refs) return;
          const source = await this.blob(p);
          if (!fresh.refs) return;
          const blob = original ? source.file : await this.thumbnail(source);
          if (!fresh.refs || this.entries.get(key) !== fresh) return;
          fresh.url = URL.createObjectURL(blob);
          return fresh.url;
        } finally {
          this.running--;
          this.waiting.shift()?.();
        }
      });
      entry = fresh;
    } else {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    entry.refs++;
    const held = entry;
    return {
      promise: held.promise,
      release: () => {
        if (--held.refs || this.entries.get(key) !== held) return;
        if (original || !held.url) this.drop(key, held);
        while (this.entries.size > 24) {
          const idle = [...this.entries].find(([, r]) => !r.refs);
          if (!idle) break;
          this.drop(...idle);
        }
      },
    };
  }
  private drop(key: string, r: Resource) {
    this.entries.delete(key);
    if (r.url) URL.revokeObjectURL(r.url);
  }
  clear() {
    for (const [key, r] of this.entries) this.drop(key, r);
  }
}
