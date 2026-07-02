// Card LAYOUT variants — different ways to arrange the same comic image + headline + summary into
// a 1080x1080 card. The art style of the cartoon is independent (see comic_card.mjs COMIC_STYLES);
// these control composition/typography only. All take the same opts and return { buffer, ... }.
//
// opts: { comicBuffer, headline, summary, date, sportLabel, sportEmoji, accent }
// Designed with a manga/shonen flavor (halftone screentone, speed lines, bold type, accent slash).
import sharp from 'sharp';

export const CARD_W = 1080, CARD_H = 1080;
const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, limitCJK, limitLatin) {
  const isCJK = /[　-鿿가-힯]/.test(text);
  if (isCJK) { const out = []; let c = ''; for (const ch of String(text)) { c += ch; if (c.length >= limitCJK) { out.push(c); c = ''; } } if (c) out.push(c); return out.length ? out : [text]; }
  const words = String(text).split(' '), out = []; let c = '';
  for (const w of words) { const t = c ? `${c} ${w}` : w; if (t.length > limitLatin && c) { out.push(c); c = w; } else c = t; } if (c) out.push(c);
  return out.length ? out : [text];
}
function fitSummary(summary, limitCJK, limitLatin, maxLines) {
  const all = wrap(summary || '', limitCJK, limitLatin), lines = all.slice(0, maxLines);
  if (all.length > maxLines && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[\s.,·]*$/, '') + '…';
  return lines;
}
// Halftone dot screentone pattern (manga texture).
const halftone = (id, color = '#000', op = 0.08, step = 14, r = 2) =>
  `<pattern id="${id}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="${color}" fill-opacity="${op}"/></pattern>`;
// Speed lines radiating from (cx,cy) within radius — shonen energy.
function speedLines(cx, cy, rIn, rOut, n, color, op) {
  let s = '';
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const c = Math.cos(a), si = Math.sin(a); s += `<line x1="${(cx + c * rIn).toFixed(1)}" y1="${(cy + si * rIn).toFixed(1)}" x2="${(cx + c * rOut).toFixed(1)}" y2="${(cy + si * rOut).toFixed(1)}" stroke="${color}" stroke-opacity="${op}" stroke-width="${(i % 2 ? 2 : 4)}"/>`; }
  return s;
}
// Scale comic to a target width, return { buf, w, h } with NO cropping.
async function fitWidth(comicBuffer, w) {
  const buf = await sharp(comicBuffer).resize({ width: w, fit: 'inside' }).png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width, h: m.height };
}
const meta = async (buffer) => { const m = await sharp(buffer).metadata(); return { buffer, width: m.width, height: m.height, format: m.format }; };

// ── Layout 1: MANGA PANEL (light paper) ─────────────────────────────────────────────────────────
// Warm paper + halftone, thick black double-framed panel, bold black title with an accent slash,
// summary on paper, speed-line burst in a corner. Very manga.
export async function layoutMangaPanel({ comicBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const PX = 70, PY = 235, PW = CARD_W - PX * 2;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW);
  const headLines = wrap(headline, 15, 28).slice(0, 2);
  let ty = PY + PH + 78;
  const headEls = headLines.map((l, i) => `<text x="${PX}" y="${ty + i * 76}" font-family="${FONT}" font-size="66" font-weight="900" fill="#141414">${esc(l)}</text>`).join('');
  ty += headLines.length * 76 + 6;
  const sumLines = fitSummary(summary, 30, 60, Math.max(1, Math.floor((CARD_H - 70 - ty) / 46)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX}" y="${ty + i * 46}" font-family="${FONT}" font-size="31" font-weight="500" fill="#444">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>${halftone('ht', '#000', 0.07)}</defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="#F6F2E9"/>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#ht)"/>
    ${speedLines(CARD_W - 60, 120, 30, 320, 40, '#000', 0.05)}
    <rect x="${PX}" y="70" width="20" height="64" fill="${accent}"/>
    <text x="${PX + 34}" y="118" font-family="${FONT}" font-size="46" font-weight="900" fill="#141414">${esc(sportLabel)}</text>
    <text x="${CARD_W - PX}" y="118" font-family="${FONT}" font-size="30" font-weight="700" fill="#8A8478" text-anchor="end">${esc(date)}</text>
    <rect x="${PX}" y="152" width="${PW}" height="6" fill="#141414"/>
    <!-- black manga frame -->
    <rect x="${PX - 8}" y="${PY - 8}" width="${PW + 16}" height="${PH + 16}" fill="#141414"/>
    <rect x="${PX - 2}" y="${PY - 2}" width="${PW + 4}" height="${PH + 4}" fill="#fff"/>
    <rect x="${PX}" y="${ty - headLines.length * 76 - 6 - 92}" width="120" height="14" fill="${accent}"/>
    ${headEls}${sumEls}
  </svg>`;
  const top = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(top).composite([{ input: buf, top: PY, left: PX }]).png().toBuffer());
}

// ── Layout 2: MAGAZINE (dark, title-first) ──────────────────────────────────────────────────────
// Masthead rule + tracked caps kicker, big title at TOP, comic panel below, summary band with a
// left accent bar. Editorial / premium.
export async function layoutMagazine({ comicBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const PX = 60;
  const headLines = wrap(headline, 16, 30).slice(0, 2);
  const titleTop = 168;
  const headEls = headLines.map((l, i) => `<text x="${PX}" y="${titleTop + i * 70}" font-family="${FONT}" font-size="62" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  const PY = titleTop + headLines.length * 70 + 28, PW = CARD_W - PX * 2;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW);
  let sy = PY + PH + 70;
  const sumLines = fitSummary(summary, 30, 60, Math.max(1, Math.floor((CARD_H - 64 - sy) / 48)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX + 26}" y="${sy + i * 48}" font-family="${FONT}" font-size="32" font-weight="500" fill="#C9D2E2">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0%" stop-color="#101522"/><stop offset="100%" stop-color="#0A0E18"/></linearGradient></defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
    <rect x="${PX}" y="64" width="${CARD_W - PX * 2}" height="3" fill="#33405C"/>
    <text x="${PX}" y="112" font-family="${FONT}" font-size="30" font-weight="800" letter-spacing="6" fill="${accent}">SPORTS · ${esc(sportLabel)}</text>
    <text x="${CARD_W - PX}" y="112" font-family="${FONT}" font-size="28" font-weight="700" fill="#8693AC" text-anchor="end">${esc(date)}</text>
    ${headEls}
    <rect x="${PX}" y="${sy - 56}" width="6" height="${sumLines.length * 48 + 8}" fill="${accent}"/>
    ${sumEls}
  </svg>`;
  // panel frame
  const frame = Buffer.from(`<svg width="${PW + 12}" height="${PH + 12}" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="${PW + 8}" height="${PH + 8}" rx="10" fill="none" stroke="#33405C" stroke-width="4"/></svg>`);
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: PX }, { input: frame, top: PY - 6, left: PX - 6 }]).png().toBuffer());
}

// ── Layout 3: OVERLAY BANNER (dark, stacked depth) ──────────────────────────────────────────────
// Comic panel high, an accent headline banner overlapping the panel's bottom edge (sticker depth),
// category tab on the panel's top-left, summary below.
export async function layoutOverlayBanner({ comicBuffer, headline, summary, date, sportLabel, sportEmoji = '', accent = '#E4002B' }) {
  const PX = 48, PY = 150, PW = CARD_W - PX * 2;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW);
  const headLines = wrap(headline, 17, 32).slice(0, 2);
  const bannerY = PY + PH - 18; // overlaps panel bottom
  const bannerH = headLines.length * 66 + 44;
  const headEls = headLines.map((l, i) => `<text x="${PX + 34}" y="${bannerY + 60 + i * 66}" font-family="${FONT}" font-size="54" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  let sy = bannerY + bannerH + 64;
  const sumLines = fitSummary(summary, 30, 60, Math.max(1, Math.floor((CARD_H - 60 - sy) / 48)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX + 4}" y="${sy + i * 48}" font-family="${FONT}" font-size="32" font-weight="500" fill="#C9D2E2">${esc(l)}</text>`).join('');
  const tagW = 150 + sportLabel.length * 8;
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0E1320"/><stop offset="100%" stop-color="#161D30"/></linearGradient>
      <filter id="sh"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="rgba(0,0,0,0.5)"/></filter></defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
    <text x="${CARD_W - PX}" y="112" font-family="${FONT}" font-size="30" font-weight="700" fill="#7E8AA6" text-anchor="end">${esc(date)}</text>
    <text x="${PX}" y="112" font-family="${FONT}" font-size="40" font-weight="900" fill="#fff">${esc(sportEmoji)} ${esc(sportLabel)} 뉴스</text>
    <!-- accent banner (drawn after panel via second pass) -->
    <g id="banner"></g>
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  // Build banner + tag + frame overlay (above the panel).
  const overlay = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="sh"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="rgba(0,0,0,0.55)"/></filter></defs>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="10" fill="none" stroke="#fff" stroke-width="4"/>
    <rect x="${PX + 14}" y="${PY - 14}" width="${tagW}" height="48" rx="8" fill="${accent}"/>
    <text x="${PX + 30}" y="${PY + 19}" font-family="${FONT}" font-size="28" font-weight="900" fill="#fff">${esc(sportLabel)} HOT</text>
    <rect x="${PX}" y="${bannerY}" width="${PW}" height="${bannerH}" rx="6" fill="${accent}" filter="url(#sh)"/>
    <rect x="${PX}" y="${bannerY}" width="10" height="${bannerH}" fill="#fff" fill-opacity="0.5"/>
    ${headEls}${sumEls}</svg>`;
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: PX }, { input: Buffer.from(overlay), top: 0, left: 0 }]).png().toBuffer());
}

// ── Layout 4: SIDE STRIPE (dark, asymmetric/dynamic) ────────────────────────────────────────────
// Left accent stripe with vertical sport label, comic panel offset right, big dramatic title,
// halftone + speed-line corner.
export async function layoutSideStripe({ comicBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const STRIPE = 96, PX = STRIPE + 40, PY = 150, PW = CARD_W - PX - 56;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW);
  const headLines = wrap(headline, 14, 26).slice(0, 3);
  let ty = PY + PH + 76;
  const headEls = headLines.map((l, i) => `<text x="${PX}" y="${ty + i * 72}" font-family="${FONT}" font-size="60" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  ty += headLines.length * 72 + 4;
  const sumLines = fitSummary(summary, 28, 56, Math.max(1, Math.floor((CARD_H - 60 - ty) / 46)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX}" y="${ty + i * 46}" font-family="${FONT}" font-size="31" font-weight="500" fill="#C2CADA">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0C111C"/><stop offset="100%" stop-color="#141B2C"/></linearGradient>
      ${halftone('ht2', '#fff', 0.05)}</defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
    <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="url(#ht2)"/>
    ${speedLines(40, CARD_H - 40, 20, 300, 36, '#fff', 0.045)}
    <rect x="0" y="0" width="${STRIPE}" height="${CARD_H}" fill="${accent}"/>
    <text x="${STRIPE / 2}" y="${CARD_H / 2}" font-family="${FONT}" font-size="58" font-weight="900" fill="#fff" text-anchor="middle" transform="rotate(-90 ${STRIPE / 2} ${CARD_H / 2})">${esc(sportLabel)} · SPORTS</text>
    <text x="${PX}" y="116" font-family="${FONT}" font-size="30" font-weight="700" fill="#7E8AA6">${esc(date)}</text>
    <rect x="${PX}" y="${PY + PH + 18}" width="110" height="10" fill="${accent}"/>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" rx="10" fill="none" stroke="#fff" stroke-width="4"/>
    ${headEls}${sumEls}
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: PX }]).png().toBuffer());
}

// ── Manga-book set: lean hard into authentic 日本 manga-page aesthetics ─────────────────────────
// Corner page-number furniture (manga pages are numbered).
const pageNo = (n, x, y, dark) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="26" font-weight="800" fill="${dark ? '#fff' : '#141414'}" fill-opacity="0.55">― ${n} ―</text>`;

// Layout 5: MANGA PAGE — the image IS a multi-panel B&W manga page (generated 4:3). The card adds
// only manga-page furniture: paper, a slanted title plate, a short caption, page number. Reads like
// a real torn-out manga page. Pass `pageBuffer` (a 4:3 multi-panel manga page).
export async function layoutMangaPage({ pageBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const PX = 70, PW = CARD_W - PX * 2, PY = 150;
  const { buf, h: PH } = await fitWidth(pageBuffer, PW);
  const headLines = wrap(headline, 16, 30).slice(0, 2);
  // Slanted black title plate overlapping the page's bottom-left (manga caption box).
  const plateY = PY + PH - 30, plateH = headLines.length * 64 + 36;
  const headEls = headLines.map((l, i) => `<text x="${PX + 30}" y="${plateY + 58 + i * 64}" font-family="${FONT}" font-size="50" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  let sy = plateY + plateH + 60;
  const sumLines = fitSummary(summary, 32, 64, Math.max(1, Math.floor((CARD_H - 70 - sy) / 44)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX}" y="${sy + i * 44}" font-family="${FONT}" font-size="30" font-weight="500" fill="#333">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>${halftone('htp', '#000', 0.06)}</defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="#F4F0E6"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#htp)"/>
    <text x="${PX}" y="116" font-family="${FONT}" font-size="34" font-weight="900" fill="#141414" letter-spacing="2">${esc(sportLabel)} · SPORTS</text>
    <text x="${CARD_W - PX}" y="116" font-family="${FONT}" font-size="28" font-weight="700" fill="#8A8478" text-anchor="end">${esc(date)}</text>
    <rect x="${PX}" y="132" width="${PW}" height="4" fill="#141414"/>
    <rect x="${PX - 6}" y="${PY - 6}" width="${PW + 12}" height="${PH + 12}" fill="#141414"/>
    ${pageNo('12', CARD_W / 2 - 24, CARD_H - 36, false)}
  </svg>`;
  const plate = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-2 ${PX} ${plateY})"><rect x="${PX - 6}" y="${plateY}" width="${Math.min(PW, 760)}" height="${plateH}" fill="#141414"/>
    <rect x="${PX - 6}" y="${plateY}" width="14" height="${plateH}" fill="${accent}"/>${headEls}</g>${sumEls}</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: PX }, { input: Buffer.from(plate), top: 0, left: 0 }]).png().toBuffer());
}

// Layout 6: MANGA SPLASH (chapter opening / 扉絵). Full-bleed-ish dramatic single panel, a manga
// logo-style outlined title, a 第1話 kicker, screentone, speed lines, page number.
export async function layoutMangaSplash({ comicBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const PX = 0, PY = 96, PW = CARD_W;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW); // full-bleed width
  const headLines = wrap(headline, 14, 26).slice(0, 2);
  const titleY = PY + PH + 70;
  // Outlined manga-logo title: white stroke behind, black fill — bold, slightly rotated.
  const headEls = headLines.map((l, i) => {
    const yy = titleY + i * 78;
    return `<text x="60" y="${yy}" font-family="${FONT}" font-size="72" font-weight="900" fill="#fff" stroke="#141414" stroke-width="10" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>` +
           `<text x="60" y="${yy}" font-family="${FONT}" font-size="72" font-weight="900" fill="#141414">${esc(l)}</text>`;
  }).join('');
  let sy = titleY + headLines.length * 78 + 30;
  const sumLines = fitSummary(summary, 34, 68, Math.max(1, Math.floor((CARD_H - 56 - sy) / 42)));
  const sumEls = sumLines.map((l, i) => `<text x="62" y="${sy + i * 42}" font-family="${FONT}" font-size="29" font-weight="600" fill="#E8E8E8">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>${halftone('hts', '#fff', 0.06, 12, 1.6)}</defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="#0B0B0E"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#hts)"/>
    ${speedLines(CARD_W / 2, PY + PH + 40, 40, 520, 56, '#fff', 0.05)}
    <rect x="0" y="${PY - 6}" width="${CARD_W}" height="6" fill="#141414"/>
    <rect x="60" y="${PY + PH + 16}" width="190" height="42" fill="${accent}"/>
    <text x="74" y="${PY + PH + 46}" font-family="${FONT}" font-size="26" font-weight="900" fill="#fff">第1話 · ${esc(sportLabel)}</text>
    <text x="${CARD_W - 40}" y="${PY - 22}" font-family="${FONT}" font-size="26" font-weight="700" fill="#9aa" text-anchor="end">${esc(date)}</text>
    ${headEls}${sumEls}
    ${pageNo('1', CARD_W - 90, CARD_H - 30, true)}
  </svg>`;
  const frame = Buffer.from(`<svg width="${CARD_W}" height="${PH}" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="${CARD_W - 6}" height="${PH - 6}" fill="none" stroke="#141414" stroke-width="6"/></svg>`);
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: 0 }, { input: frame, top: PY, left: 0 }]).png().toBuffer());
}

// Layout 7: MANGA FURNITURE — single wide panel but dressed as a manga page: paper+screentone,
// stacked double panel (offset shadow panel behind), focus lines behind a slanted title plate,
// SFX accent strokes, page number.
export async function layoutMangaFurniture({ comicBuffer, headline, summary, date, sportLabel, accent = '#E4002B' }) {
  const PX = 66, PY = 210, PW = CARD_W - PX * 2;
  const { buf, h: PH } = await fitWidth(comicBuffer, PW);
  const headLines = wrap(headline, 15, 28).slice(0, 2);
  const plateY = PY + PH + 40, plateH = headLines.length * 70 + 30;
  const headEls = headLines.map((l, i) => `<text x="${PX + 26}" y="${plateY + 56 + i * 70}" font-family="${FONT}" font-size="58" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  let sy = plateY + plateH + 56;
  const sumLines = fitSummary(summary, 32, 64, Math.max(1, Math.floor((CARD_H - 64 - sy) / 44)));
  const sumEls = sumLines.map((l, i) => `<text x="${PX}" y="${sy + i * 44}" font-family="${FONT}" font-size="30" font-weight="500" fill="#3a3a3a">${esc(l)}</text>`).join('');
  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg"><defs>${halftone('htf', '#000', 0.07)}</defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="#F5F1E7"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#htf)"/>
    ${speedLines(PX + 40, plateY + 30, 24, 360, 30, '#000', 0.06)}
    <rect x="${PX}" y="86" width="18" height="58" fill="${accent}"/>
    <text x="${PX + 30}" y="130" font-family="${FONT}" font-size="42" font-weight="900" fill="#141414">${esc(sportLabel)} 速報</text>
    <text x="${CARD_W - PX}" y="130" font-family="${FONT}" font-size="28" font-weight="700" fill="#8A8478" text-anchor="end">${esc(date)}</text>
    <rect x="${PX}" y="158" width="${PW}" height="5" fill="#141414"/>
    <!-- stacked shadow panel + main panel (double-frame manga look) -->
    <rect x="${PX + 12}" y="${PY + 12}" width="${PW}" height="${PH}" fill="#141414" fill-opacity="0.25"/>
    <rect x="${PX - 8}" y="${PY - 8}" width="${PW + 16}" height="${PH + 16}" fill="#141414"/>
    <rect x="${PX - 2}" y="${PY - 2}" width="${PW + 4}" height="${PH + 4}" fill="#fff"/>
    ${pageNo('23', CARD_W - PX - 40, CARD_H - 34, false)}
  </svg>`;
  const plate = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-1.5 ${PX} ${plateY})"><rect x="${PX - 4}" y="${plateY}" width="${Math.min(PW, 640)}" height="${plateH}" fill="#141414"/>
    <rect x="${PX - 4}" y="${plateY}" width="12" height="${plateH}" fill="${accent}"/>${headEls}</g>${sumEls}</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return meta(await sharp(base).composite([{ input: buf, top: PY, left: PX }, { input: Buffer.from(plate), top: 0, left: 0 }]).png().toBuffer());
}

export const LAYOUTS = {
  'manga-panel': layoutMangaPanel,
  magazine: layoutMagazine,
  'overlay-banner': layoutOverlayBanner,
  'side-stripe': layoutSideStripe,
};
