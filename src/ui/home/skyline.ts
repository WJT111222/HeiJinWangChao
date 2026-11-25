// Deterministic decorative geometry from the supplied heijin-home.html. No player data enters SVG.
export type City = 'cq'|'sh'|'hrb'|'gz'|'bj'|'hz'|'cs'|'sy';
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
  /* 北京：远处商务区 + 城楼（双重檐、红墙门洞） + 胡同坡屋顶 + 长街车灯 */
  bj(r: () => number) { const L = 600;
    const far = clear(towers(r, 0, W, 128, 30, 92, 12, 26, '#1e1919'), L - 190, L + 190);
    const zun = `<path d="M940 128 V44 Q944 30 952 26 Q960 30 964 44 V128Z" fill="#231c1c" stroke="#C65F57" stroke-opacity=".22"/>`;
    let roofs = '';
    for (let x = -10; x < W;) { const w = 34 + r() * 30; if (x + w < L - 170 || x > L + 170) roofs += `<path d="M${x.toFixed(0)} 140 V129 L${(x + 7).toFixed(0)} 121 H${(x + w - 7).toFixed(0)} L${(x + w).toFixed(0)} 129 V140Z" fill="#130e0e"/>`; x += w + 4; }
    const gate = `<g fill="#2b1a18" stroke="#C65F57" stroke-opacity=".28"><path d="M${L-160} 140 L${L-148} 98 H${L+148} L${L+160} 140Z"/><rect x="${L-96}" y="88" width="192" height="10"/><rect x="${L-82}" y="70" width="164" height="18"/>`
      + `<path d="M${L-112} 74 Q${L-86} 68 ${L-74} 60 H${L+74} Q${L+86} 68 ${L+112} 74Z"/><rect x="${L-60}" y="48" width="120" height="13"/><path d="M${L-88} 51 Q${L-64} 44 ${L-54} 36 H${L+54} Q${L+64} 44 ${L+88} 51Z"/><rect x="${L-46}" y="33" width="92" height="3"/></g>`
      + `<g fill="#0d0909">${[-90, -30, 30, 90].map(d => `<path d="M${L+d-9} 140 V124 Q${L+d} 114 ${L+d+9} 124 V140Z"/>`).join('')}</g>`
      + `<g fill="#f2c46b">${[-64, -32, 0, 32, 64].map(d => `<rect x="${L+d-2}" y="76" width="4" height="6" rx="1.5"/>`).join('')}</g>`;
    return far + zun + roofs + gate + `<rect y="140" width="${W}" height="20" fill="#100c0c"/><rect y="140" width="${W}" height="1" fill="#C65F57" opacity=".25"/>`
      + `<g style="animation:home-train 8s linear infinite"><rect x="0" y="150" width="140" height="1.5" fill="#f2c46b" opacity=".55"/><rect x="40" y="153" width="90" height="1" fill="#C65F57" opacity=".6"/></g>`; },
  /* 杭州：层叠远山 + 楼阁塔 + 细长宝塔 + 断桥 + 湖面倒影 */
  hz(r: () => number) { const P = 450, ws = [44, 38, 32, 26, 20];
    const hills = `<path d="M0 116 C90 86 170 96 260 80 S420 60 520 92 S700 104 820 82 S1020 62 1200 90 V160 H0Z" fill="#182019"/><path d="M0 128 C120 112 230 118 330 104 S520 112 640 122 S900 106 1200 116 V160 H0Z" fill="#121813"/>`;
    const city = towers(r, 900, W, 124, 14, 46, 10, 20, '#111611');
    const tiers = ws.map((w, i) => { const y = 104 - i * 13; return `<rect x="${P-w/2}" y="${y-9}" width="${w}" height="9"/><path d="M${P-w/2-8} ${y-9} Q${P} ${y-14} ${P+w/2+8} ${y-9} L${P+w/2+4} ${y-7} H${P-w/2-4}Z"/>`; }).join('');
    const pagoda = `<g fill="#232d25" stroke="#9EBB86" stroke-opacity=".25">${tiers}<rect x="${P-1}" y="28" width="2" height="12"/></g>`;
    const thin = `<path d="M796 86 L800 50 L801 40 L802 50 L806 86Z" fill="#232d25" stroke="#9EBB86" stroke-opacity=".25"/>`;
    const bridge = `<path d="M600 128 Q660 108 720 128" fill="none" stroke="#2b372d" stroke-width="5"/><path d="M540 129 H600 M720 129 H780" stroke="#2b372d" stroke-width="4"/>`;
    const lake = `<rect y="130" width="${W}" height="30" fill="#0c110e"/>` + river(r, 30, 134, '#9EBB86', .28)
      + `<g opacity=".07" transform="translate(0 236) scale(1 -1)"><g fill="#9EBB86">${ws.map((w, i) => `<rect x="${P-w/2}" y="${104-i*13-9}" width="${w}" height="9"/>`).join('')}</g></g>`;
    const mist = `<g fill="#cfe0cf">${[[300, 98, 260, 7], [720, 90, 300, 8], [520, 114, 380, 6], [960, 108, 260, 6]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" opacity=".035"/><ellipse cx="${x}" cy="${y}" rx="${rx*.6}" ry="${ry*.5}" opacity=".035"/>`).join('')}</g>`;
    return hills + city + pagoda + thin + bridge + lake + mist; },
  /* 长沙：岳麓山 + 江心洲树影 + 江东高楼与双塔 + 湘江 + 烟花 */
  cs(r: () => number) {
    const hill = `<path d="M0 108 C60 70 140 54 220 62 S330 92 380 118 V160 H0Z" fill="#1b1622"/>`;
    const city = clear(towers(r, 560, W, 122, 30, 100, 12, 24, '#1a1520'), 836, 912) + towers(r, 600, W, 122, 20, 60, 10, 18, '#120f17');
    const twin = `<g fill="#211a29" stroke="#B58BC9" stroke-opacity=".28"><path d="M846 122 V18 L862 10 V122Z"/><path d="M884 122 V30 L900 24 V122Z"/></g><g fill="#B58BC9" opacity=".7"><rect x="853" y="22" width="2" height="2"/><rect x="891" y="34" width="2" height="2"/></g>`;
    const water = `<rect y="122" width="${W}" height="38" fill="#0e0b12"/>` + river(r, 36, 126, '#B58BC9', .26);
    const isle = `<path d="M300 134 C360 128 520 126 700 131 C560 136 400 137 300 134Z" fill="#141019"/><g fill="#141019">${Array.from({length:14}, (_, i) => `<circle cx="${330+i*26+r()*8|0}" cy="${130-r()*3|0}" r="${5+r()*4|0}"/>`).join('')}</g>`;
    const burst = (cx: number, cy: number, c: string, d: number) => `<g class="firework" style="transform-origin:${cx}px ${cy}px;animation-delay:${d}s" fill="${c}">${Array.from({length:14}, (_, k) => { const a = k / 14 * Math.PI * 2;
      return `<circle cx="${(cx+Math.cos(a)*22).toFixed(1)}" cy="${(cy+Math.sin(a)*22).toFixed(1)}" r="1.3"/><circle cx="${(cx+Math.cos(a)*12).toFixed(1)}" cy="${(cy+Math.sin(a)*12).toFixed(1)}" r=".9"/>`; }).join('')}</g>`;
    return hill + city + twin + water + isle + burst(470, 48, '#ffd9a0', 0) + burst(560, 30, '#d9b4ec', 1.8) + burst(420, 24, '#ffe9c4', 3.4); },
  /* 三亚：海平线 + 鹿回头山与鹿影 + 海湾低层酒店 + 椰树 + 月光与浪 */
  sy(r: () => number) { const D = 410, Y = 66;
    const moon = `<circle cx="840" cy="30" r="12" fill="#e9fbf8" opacity=".75"/><circle cx="840" cy="30" r="26" fill="#63C2D0" opacity=".08"/>`;
    const hill = `<path d="M220 118 C280 86 350 70 420 74 S520 98 570 118Z" fill="#142022"/>`;
    const deer = `<g fill="#1f3236" stroke="#63C2D0" stroke-opacity=".35" stroke-width=".8"><ellipse cx="${D}" cy="${Y}" rx="12" ry="5"/><path d="M${D+9} ${Y-2} L${D+14} ${Y-13} L${D+9} ${Y-15} L${D+5} ${Y-10}Z"/></g>`
      + `<g stroke="#1f3236" stroke-width="2"><path d="M${D-9} ${Y+3} V${Y+12} M${D-4} ${Y+4} V${Y+13} M${D+5} ${Y+4} V${Y+13} M${D+9} ${Y+3} V${Y+12}"/></g>`
      + `<path d="M${D+7} ${Y-15} L${D+3} ${Y-24} M${D+7} ${Y-15} L${D-1} ${Y-21} M${D+9} ${Y-15} L${D+11} ${Y-25}" stroke="#2c4549" stroke-width="1.4" fill="none"/>`;
    const hotels = towers(r, 590, 1000, 118, 10, 34, 18, 40, '#162326');
    const sea = `<rect y="118" width="${W}" height="42" fill="#0b1517"/><rect y="118" width="${W}" height="1" fill="#63C2D0" opacity=".35"/>` + river(r, 40, 124, '#63C2D0', .28) + `<rect x="826" y="120" width="28" height="30" fill="#e9fbf8" opacity=".05"/>`;
    const waves = `<g class="waves" fill="none" stroke="#e9fbf8" stroke-opacity=".22" stroke-width="1">${Array.from({length:22}, (_, i) => `<path d="M${i*60} 152 q15 -5 30 0 t30 0"/>`).join('')}</g>`;
    const palm = (x: number, h: number, lean: number) => `<g fill="none" stroke="#18292c" stroke-linecap="round"><path d="M${x} 160 Q${x+lean*.4} ${160-h*.6} ${x+lean} ${160-h}" stroke-width="4"/>${[-1, -.5, 0, .5, 1].map(k => `<path d="M${x+lean} ${160-h} q${26*k} ${-8+Math.abs(k)*4} ${40*k} ${10+Math.abs(k)*10}" stroke-width="3"/>`).join('')}<path d="M${x+lean} ${160-h} q-6 -14 4 -20" stroke-width="3"/></g>`;
    return moon + hill + deer + hotels + sea + waves + palm(300, 92, 14) + palm(352, 68, -10) + palm(880, 98, -16) + palm(930, 72, 8); },
};
const seeds = { cq: 7, sh: 31, hrb: 53, gz: 97, bj: 113, hz: 131, cs: 151, sy: 173 };
/** 自定义城市的通用剪影：按区划代码种子确定，有无远山、江面与楼群疏密都由种子决定，同一城市每次相同。 */
export function customSkyline(seed: number, extra = '') {
  const r = rng(seed % 2147483646 || 7);
  const hasRiver = r() > .35, hasHills = r() > .5;
  const hills = hasHills ? `<path d="M0 ${110+r()*10|0} C200 ${80+r()*20|0} 400 ${96+r()*14|0} 600 ${88+r()*16|0} S1000 ${82+r()*20|0} 1200 ${100+r()*10|0} V160 H0Z" fill="#14130f"/>` : '';
  const back = towers(r, 0, W, 136, 18, 62, 12, 30, '#1b1915'), front = towers(r, 0, W, 138, 10, 40 + r() * 40, 14, 34, '#0f0e0c');
  const ground = `<rect y="140" width="${W}" height="20" fill="#0d0c0a"/>` + (hasRiver ? river(r, 26, 143, '#B59A73', .25) : '');
  return `<svg viewBox="0 0 ${W} 160" preserveAspectRatio="xMidYMax slice" ${extra}>${hills + back + front + ground}</svg>`;
}
export const skyline = (c: City, extra = '', ambientSnow = true) => {
  const geometry = SKY[c](rng(seeds[c]));
  // Home keeps its original snowfall. In-game weather is exclusively weatherText-driven.
  return `<svg viewBox="0 0 ${W} 160" preserveAspectRatio="xMidYMax slice" ${extra}>${ambientSnow ? geometry : geometry.replace(/<g fill="#dfe8ef"[\s\S]*?<\/g>/, '')}</svg>`;
};
export const CITY = {
  cq:['重庆','CHONGQING · 29°33′N','山城 · 江雾 · 轻轨'], sh:['上海','SHANGHAI · 31°14′N','外滩 · 霓虹 · 江风'],
  hrb:['哈尔滨','HARBIN · 45°45′N','冰雪 · 圆顶 · 长街'], gz:['广州','GUANGZHOU · 23°07′N','早茶 · 榕荫 · 珠江'],
  bj:['北京','BEIJING · 39°54′N','权力 · 人脉 · 底蕴'], hz:['杭州','HANGZHOU · 30°16′N','江南 · 科技 · 新贵'],
  cs:['长沙','CHANGSHA · 28°12′N','霓虹 · 娱乐 · 烟火'], sy:['三亚','SANYA · 18°15′N','海风 · 度假 · 奢华'],
};
export const ORDER: readonly City[] = ['cq','sh','hrb','gz','bj','hz','cs','sy'];


export function saveCity(title: string): City | undefined { return ORDER.find(c => title.trim().endsWith('· '+CITY[c][0]) || title.trim().endsWith('·'+CITY[c][0])); }

// Ticket decorations share the cover's existing city names, latitude and imagery.
// Longitude and seal are decorative metadata, never location hierarchy or save data.
export const CITY_TICKET_META = {
  cq: {longitude:'106°33′E', seal:'渝', tint:'#7FA7A0'},
  sh: {longitude:'121°29′E', seal:'沪', tint:'#8E9BD8'},
  hrb: {longitude:'126°38′E', seal:'冰', tint:'#A9C3D8'},
  gz: {longitude:'113°15′E', seal:'穗', tint:'#D08A6A'},
  bj: {longitude:'116°24′E', seal:'京', tint:'#C65F57'},
  hz: {longitude:'120°09′E', seal:'杭', tint:'#9EBB86'},
  cs: {longitude:'112°56′E', seal:'夜', tint:'#B58BC9'},
  sy: {longitude:'109°31′E', seal:'鹿', tint:'#63C2D0'},
};
/** 自定义城市统一的暖铜色。 */
export const CUSTOM_CITY_TINT = '#B59A73';
