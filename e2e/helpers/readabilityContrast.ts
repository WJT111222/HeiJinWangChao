import type { Locator, Page } from '@playwright/test';

/** Test-only paint probes. Chromium composites the real gradient, backdrop,
 * ancestor opacity and filters twice: without glyphs, then with a solid swatch
 * of their computed paint. This avoids pretending a translucent CSS token is
 * the effective background. Anti-aliasing is not WCAG foreground paint. */
export async function paintedContrast(page: Page, locator: Locator, pseudo: string | null = null) {
  await locator.scrollIntoViewIfNeeded();
  const paint = await locator.evaluate((el, pseudo) => {
    const style = getComputedStyle(el, pseudo), rect = el.getBoundingClientRect();
    const fill = style.webkitTextFillColor || style.color;
    const strokeOnly = /rgba\([^)]*,\s*0\)/.test(fill) || fill === 'transparent';
    const html = el as HTMLElement;
    const scale = html.offsetHeight ? Math.min(1, rect.height / html.offsetHeight) : 1;
    const size = parseFloat(style.fontSize) * scale;
    return { color: strokeOnly ? style.webkitTextStrokeColor : fill, strokeOnly,
      fontSize: size, weight: style.fontWeight, text: el.textContent?.trim().slice(0, 100),
      background: style.background, opacity: style.opacity,
      large: size >= 24 || (size >= 18.667 && Number(style.fontWeight) >= 700), pseudo };
  }, pseudo);
  await locator.evaluate(el => el.setAttribute('data-paint-probe', 'active'));
  const hide = '[data-paint-probe], [data-paint-probe] *{ -webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;}[data-paint-probe] .caret{visibility:hidden!important;}';
  try {
    const background = await locator.screenshot({ animations: 'disabled', scale: 'css', style: hide });
    const foreground = await locator.screenshot({ animations: 'disabled', scale: 'css', style: `${hide}[data-paint-probe]{box-shadow:inset 0 0 0 9999px ${paint.color}!important;}` });
    const pixels = await page.evaluate(async ({ background, foreground }) => {
      async function decode(base64: string) {
        const binary = atob(base64), data = Uint8Array.from(binary, c => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
        return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
      }
      const bg = await decode(background), fg = await decode(foreground);
      if (bg.width !== fg.width || bg.height !== fg.height) throw new Error('Paint probe geometry changed');
      const luminance = (rgb: number[]) => rgb.reduce((sum, value, i) => {
        const v = value / 255; return sum + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
      }, 0);
      const xInset = Math.max(1, Math.min(8, Math.floor(bg.width / 4))), yInset = Math.max(1, Math.min(8, Math.floor(bg.height / 4)));
      let min = Infinity, worst: { foreground: number[]; background: number[]; x: number; y: number } | undefined, samples = 0;
      for (let y = yInset; y < bg.height - yInset; y += 2) for (let x = xInset; x < bg.width - xInset; x += 2) {
        const i = (y * bg.width + x) * 4, a = [...fg.data.slice(i, i + 3)], b = [...bg.data.slice(i, i + 3)];
        const l1 = luminance(a), l2 = luminance(b), ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        samples++; if (ratio < min) { min = ratio; worst = { foreground: a, background: b, x, y }; }
      }
      if (!samples) throw new Error('Paint probe has no interior samples');
      return { ratio: min, worst, samples };
    }, { background: background.toString('base64'), foreground: foreground.toString('base64') });
    return { ...paint, ...pixels, threshold: paint.large ? 3 : 4.5 };
  } finally { await locator.evaluate(el => el.removeAttribute('data-paint-probe')); }
}

/** PNG quantization check, not a perceptual tolerance: at most one RGB unit and
 * 0.01% pixels, plus the caller's exact computed-style fingerprint assertion. */
export async function screenshotDifference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(async ({ a, b }) => {
    async function pixels(base64: string) {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const x = await pixels(a), y = await pixels(b);
    if (x.width !== y.width || x.height !== y.height) throw new Error('Night screenshot dimensions changed');
    let maxChannelDelta = 0, differentPixels = 0;
    for (let i = 0; i < x.data.length; i += 4) {
      const delta = Math.max(...[0, 1, 2, 3].map(n => Math.abs(x.data[i + n] - y.data[i + n])));
      maxChannelDelta = Math.max(maxChannelDelta, delta); if (delta) differentPixels++;
    }
    return { maxChannelDelta, differentPixels, differentRatio: differentPixels / (x.width * x.height) };
  }, { a: a.toString('base64'), b: b.toString('base64') });
}
