// Deterministic decorative geometry from the supplied heijin-home.html. No player data enters SVG.
export type City = 'cq'|'sh'|'hrb'|'gz';
const rng = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const W = 1200;
function towers(r: () => number, x0: number, x1: number, base: number, hMin: number, hMax: number, wMin: number, wMax: number, fill: string) {
  let s = '', x = x0;
  while (x < x1) {
    const w = wMin + r() * (wMax - wMin), h = hMin + r() * (hMax - hMin);
    s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`;
    if (h > 30) for (let k = 0; k < Math.floor(h / 14); k++) if (r() > .55)
      s += `<rect class="w" x="${(x + 3 + r() * (w - 7)).toFixed(1)}" y="${(base - h + 7 + k * 13).toFixed(1)}" width="2" height="3" fill="#F2DDA0"/>`;
    x += w + 2 + r() * 5;
  }
  return s;
}
const river = (r: () => number, n: number, y: number, c: string, o: number) => `<g fill="${c}" opacity="${o}">${Array.from({length:n},()=>`<rect x="${(r()*W).toFixed(0)}" y="${y+r()*12|0}" width="${8+r()*24|0}" height="1"/>`).join('')}</g>`;
const clear = (svg: string, a: number, b: number) => svg.replace(/<rect (class="w" )?x="([\d.]+)"[^>]*\/>/g, (m, _w, x) => (+x > a && +x < b) ? '' : m);
const SKY = {
  cq(r: () => number) { return `<path d="M0 118 C120 70 260 96 400 62 S660 40 800 72 S1020 58 1200 76 V160 H0Z" fill="#17211e"/>` + towers(r, 10, W, 112, 20, 70, 10, 22, '#1a2421')
    + `<path d="M0 140 C160 110 320 128 480 100 S860 92 1200 110 V160 H0Z" fill="#111816"/>` + towers(r, 30, W - 10, 130, 30, 95, 12, 24, '#0c100f')
    + `<line x1="0" y1="120" x2="${W}" y2="96" stroke="#2e3a36" stroke-width="2"/>` + `<g fill="#2e3a36">${Array.from({length:10},(_, i)=>{const x=60+i*120;return `<rect x="${x}" y="${120-x*0.02}" width="3" height="40"/>`}).join('')}</g>`
    + `<g style="animation:home-train 11s linear infinite"><rect x="0" y="105" width="90" height="8" rx="2" fill="#9cc7be" opacity=".8" transform="rotate(-1.1)"/></g>`
    + `<rect y="146" width="${W}" height="14" fill="#0b1211"/>` + river(r, 26, 148, '#7FA7A0', .25); },
  sh(r: () => number) { const L = 560; return towers(r, 0, W, 140, 25, 75, 10, 20, '#1a1f2e') + clear(towers(r, 0, W, 140, 35, 95, 12, 26, '#0d1018'), L - 30, L + 260)
    + `<g fill="#232a3e" stroke="#8E9BD8" stroke-opacity=".25"><rect x="${L}" y="16" width="4" height="124"/><circle cx="${L+2}" cy="60" r="11"/><circle cx="${L+2}" cy="98" r="15"/><rect x="${L-8}" y="98" width="20" height="42"/>`
    + `<path d="M${L+120} 140 V26 L${L+142} 14 L${L+164} 26 V140Z"/><path d="M${L+200} 140 V40 Q${L+212} 22 ${L+224} 40 V140Z"/></g><rect x="${L+135}" y="22" width="14" height="10" fill="#141824"/>`
    + `<rect y="140" width="${W}" height="20" fill="#0b0d14"/>` + river(r, 34, 143, '#8E9BD8', .3); },
  hrb(r: () => number) { const L = 580; return towers(r, 0, W, 140, 18, 50, 18, 34, '#1b2128') + clear(towers(r, 0, W, 140, 25, 60, 20, 40, '#0e1216'), L - 50, L + 50)
    + `<g fill="#242c35" stroke="#A9C3D8" stroke-opacity=".22"><path d="M${L-32} 140 V92 H${L+32} V140Z"/><path d="M${L-15} 92 C${L-15} 70 ${L} 64 ${L} 46 C${L} 64 ${L+15} 70 ${L+15} 92Z"/><rect x="${L-1}" y="34" width="2" height="14"/>`
    + [-38, 24].map(d => `<path d="M${L+d} 140 V104 H${L+d+14} V140Z"/><path d="M${L+d+3} 104 C${L+d+3} 96 ${L+d+7} 94 ${L+d+7} 88 C${L+d+7} 94 ${L+d+11} 96 ${L+d+11} 104Z"/>`).join('') + `</g>`
    + `<rect y="140" width="${W}" height="20" fill="#121820"/><rect y="140" width="${W}" height="1" fill="#A9C3D8" opacity=".25"/>`
    + `<g fill="#dfe8ef" opacity=".55" style="animation:home-snow 7s linear infinite">${Array.from({length:80},()=>`<circle cx="${(r()*W).toFixed(0)}" cy="${(r()*150-10).toFixed(0)}" r="${(0.6+r()*1.1).toFixed(1)}"/>`).join('')}</g>`; },
  gz(r: () => number) { const L = 640; return towers(r, 0, W, 140, 22, 70, 10, 22, '#221d19') + clear(towers(r, 0, W, 140, 35, 90, 12, 24, '#120f0d'), L - 30, L + 40)
    + `<path d="M${L-8} 140 Q${L+10} 70 ${L-4} 8 L${L+22} 8 Q${L+8} 70 ${L+32} 140Z" fill="#2b231d" stroke="#D08A6A" stroke-opacity=".3"/><rect x="${L+8}" y="0" width="2" height="8" fill="#D08A6A"/>`
    + `<g fill="#0f110d">${Array.from({length:18},(_, i)=>`<circle cx="${30+i*66+r()*20|0}" cy="${130+r()*6|0}" r="${10+r()*8|0}"/>`).join('')}</g>`
    + `<rect y="140" width="${W}" height="20" fill="#110e0c"/>` + river(r, 30, 143, '#D08A6A', .3); },
};
const seeds = { cq: 7, sh: 31, hrb: 53, gz: 97 };
export const skyline = (c: City, extra = '', ambientSnow = true) => {
  const geometry = SKY[c](rng(seeds[c]));
  // Home keeps its original snowfall. In-game weather is exclusively weatherText-driven.
  return `<svg viewBox="0 0 ${W} 160" preserveAspectRatio="xMidYMax slice" ${extra}>${ambientSnow ? geometry : geometry.replace(/<g fill="#dfe8ef"[\s\S]*?<\/g>/, '')}</svg>`;
};
export const CITY = {
  cq:['重庆','CHONGQING · 29°33′N','山城 · 江雾 · 轻轨'], sh:['上海','SHANGHAI · 31°14′N','外滩 · 霓虹 · 江风'],
  hrb:['哈尔滨','HARBIN · 45°45′N','冰雪 · 圆顶 · 长街'], gz:['广州','GUANGZHOU · 23°07′N','早茶 · 榕荫 · 珠江'],
};
export const ORDER: readonly City[] = ['cq','sh','hrb','gz'];


export function saveCity(title: string): City | undefined { return ORDER.find(c => title.trim().endsWith('· '+CITY[c][0]) || title.trim().endsWith('·'+CITY[c][0])); }

// Ticket decorations share the cover's existing city names, latitude and imagery.
// Longitude and seal are decorative metadata, never location hierarchy or save data.
export const CITY_TICKET_META = {
  cq: {longitude:'106°33′E', seal:'渝', tint:'#7FA7A0'},
  sh: {longitude:'121°29′E', seal:'沪', tint:'#8E9BD8'},
  hrb: {longitude:'126°38′E', seal:'冰', tint:'#A9C3D8'},
  gz: {longitude:'113°15′E', seal:'穗', tint:'#D08A6A'},
};
