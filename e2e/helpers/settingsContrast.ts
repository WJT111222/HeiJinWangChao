import type { Locator } from '@playwright/test';

// Browser computed styles, including ancestor group opacity. Paper texture is
// checked separately against Chromium screenshots in the development evidence.
export async function settingsTextContrast(root: Locator) {
  return root.evaluate(host => {
    type Color = [number, number, number, number];
    const parse = (value: string): Color => {
      const parts = value.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number);
      return parts ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : [0, 0, 0, 0];
    };
    const over = (a: Color, b: Color): Color => {
      const alpha = a[3] + b[3] * (1 - a[3]);
      return alpha ? [0, 1, 2].map(i => (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha).concat(alpha) as Color : [0, 0, 0, 0];
    };
    const luminance = (color: Color) => color.slice(0, 3).reduce((sum, v, i) => {
      const c = v / 255;
      return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
    }, 0);
    const rows = [];
    for (const element of host.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility !== 'visible' || element.closest('[hidden],[aria-hidden="true"]') || element.matches(':disabled') || element.closest('[aria-disabled="true"]') || style.clipPath === 'inset(50%)') continue;
      if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'password'].includes(element.type)) continue;
      const directText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent?.trim()).filter(Boolean).join(' ');
      const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      const text = directText || (input ? element.value : '');
      const placeholder = input && !element.value && element.getAttribute('placeholder');
      if (!text && !placeholder) continue;
      const paint = placeholder ? getComputedStyle(element, '::placeholder') : style;
      let foreground = parse(paint.webkitTextFillColor || paint.color);
      let background: Color = [0, 0, 0, 0];
      const ancestors = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const parent = getComputedStyle(node);
        const bg = parse(parent.backgroundColor);
        foreground = over(foreground, bg);
        background = over(background, bg);
        const opacity = Number(parent.opacity) * (node === element && placeholder ? Number(paint.opacity) : 1);
        foreground[3] *= opacity;
        background[3] *= opacity;
        ancestors.push({ tag: node.tagName, classes: node.className, color: parent.color, background: parent.backgroundColor, opacity: Number(parent.opacity) });
      }
      foreground = over(foreground, [255, 255, 255, 1]);
      background = over(background, [255, 255, 255, 1]);
      const ratio = (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.667 && Number(style.fontWeight) >= 700);
      const icon = /^[↑↓←→›×◇⚙]+$/.test(text);
      rows.push({ text: (placeholder || text).slice(0, 90), tag: element.tagName, classes: element.className, color: paint.color, foreground, background, opacity: style.opacity, fontSize: style.fontSize, fontWeight: style.fontWeight, ratio, threshold: large || icon ? 3 : 4.5, ancestors });
    }
    const contrast = (a: Color, b: Color) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const backgroundOf = (element: Element | null): Color => {
      let background: Color = [0, 0, 0, 0];
      for (let node = element; node; node = node.parentElement) background = over(background, parse(getComputedStyle(node).backgroundColor));
      return over(background, [255, 255, 255, 1]);
    };
    const controls = [];
    for (const element of host.querySelectorAll('.toggle input,.pm-switch,.ai-sw,input:not([type=checkbox]):not([type=radio]),textarea,select,.select-trigger,.ai-field')) {
      if (!element.getClientRects().length || element.matches(':disabled') || element.closest('[hidden]')) continue;
      const style = getComputedStyle(element), background = backgroundOf(element), outside = backgroundOf(element.parentElement);
      const toggle = element.matches('.toggle input,.pm-switch,.ai-sw');
      if (toggle) {
        const thumb = over(parse(getComputedStyle(element, '::after').backgroundColor), background);
        controls.push({ classes: element.className, kind: 'switch', checked: element instanceof HTMLInputElement ? element.checked : element.previousElementSibling?.matches(':checked'), boundaryRatio: contrast(background, outside), thumbRatio: contrast(thumb, background) });
      } else if (Math.max(...[style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(parseFloat)) > 0) {
        const border = over(parse(style.borderTopColor), background);
        controls.push({ classes: element.className, kind: 'field', boundaryRatio: contrast(border, outside), thumbRatio: contrast(border, background) });
      }
    }
    return { rows, failures: rows.filter(row => row.ratio < row.threshold), controls,
      controlFailures: controls.filter(control => control.boundaryRatio < 3 || control.thumbRatio < 3) };
  });
}
