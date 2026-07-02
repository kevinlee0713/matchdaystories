// Card-news image renderer — REAL local logic (sharp + SVG), ported & adapted from
// VOBET generate-post.mjs (generateBrandedBg + compositeHeaderImage + splitTitleLines).
// Produces a 1080x1080 square card suitable for Telegram sendPhoto. Deterministic =>
// guarantees a valid PNG (AC#3). No external network/secret dependency.
import sharp from 'sharp';

export const CARD_W = 1080;
export const CARD_H = 1080;

const SPORT_ACCENT = {
  football: '#22C55E',
  baseball: '#F59E0B',
  basketball: '#EF4444',
};

function accentFor(sportKey) {
  return SPORT_ACCENT[sportKey] ?? '#3B82F6';
}

const escapeXml = (t) =>
  String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// CJK-aware title line splitting (ported from VOBET splitTitleLines, L905).
export function splitTitleLines(title, maxCharsPerLine = null) {
  const isCJK = /[　-鿿가-힯]/.test(title);
  if (!isCJK) {
    const limit = maxCharsPerLine ?? 22;
    const words = String(title).split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (test.length > limit && current) { lines.push(current); current = word; }
      else current = test;
    }
    if (current) lines.push(current);
    return lines.length ? lines : [title];
  }
  const limit = maxCharsPerLine ?? 13;
  const lines = [];
  let current = '';
  for (const ch of String(title)) {
    current += ch;
    if (current.length >= limit) { lines.push(current); current = ''; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [title];
}

const FONT_STACK = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";

// Build a transparent-background SVG containing ONLY the title text (white).
// Used both for compositing and as the input to the glyph-smoke pixel check.
export function titleLayerSvg(title) {
  const lines = splitTitleLines(title);
  const lineH = 92;
  const blockH = lines.length * lineH;
  const startY = Math.round((CARD_H - blockH) / 2) + lineH * 0.7;
  const textEls = lines
    .map(
      (line, i) =>
        `<text x="${CARD_W / 2}" y="${Math.round(startY + i * lineH)}" font-family="${FONT_STACK}" font-size="72" font-weight="800" fill="#ffffff" text-anchor="middle" filter="url(#ts)">${escapeXml(line)}</text>`
    )
    .join('\n');
  return `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="ts"><feDropShadow dx="0" dy="2" stdDeviation="7" flood-color="rgba(0,0,0,0.85)"/></filter></defs>
  ${textEls}
</svg>`;
}

function backgroundSvg(sportKey, sportLabel) {
  const accent = accentFor(sportKey);
  return `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A1024"/>
      <stop offset="60%" stop-color="#0E1733"/>
      <stop offset="100%" stop-color="#14204A"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="22%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="14" height="${CARD_H}" fill="${accent}"/>
  <rect x="64" y="120" width="120" height="10" rx="5" fill="${accent}"/>
  <text x="64" y="${CARD_H - 64}" font-family="${FONT_STACK}" font-size="40" font-weight="800" fill="#ffffff" fill-opacity="0.16">${escapeXml(sportLabel || '')}</text>
</svg>`;
}

// Card-news content SVG: edited headline + key-point bullets + source footer (a real summary
// card, not the full article). Falls back to title-only if no points are given.
function contentSvg({ sportKey, sportLabel, headline, points = [], sources = [] }) {
  const accent = accentFor(sportKey);
  const headLines = splitTitleLines(headline, /[　-鿿가-힯]/.test(headline) ? 12 : 24).slice(0, 3);
  const headStartY = 300;
  const headLineH = 88;
  const headEls = headLines.map((l, i) =>
    `<text x="64" y="${headStartY + i * headLineH}" font-family="${FONT_STACK}" font-size="66" font-weight="800" fill="#ffffff" filter="url(#ts)">${escapeXml(l)}</text>`).join('\n');

  // Bullets start below the headline block.
  let y = headStartY + headLines.length * headLineH + 70;
  const bulletEls = [];
  for (const p of points.slice(0, 3)) {
    const isCJK = /[　-鿿가-힯]/.test(p);
    const wrapped = splitTitleLines(p, isCJK ? 18 : 38).slice(0, 2);
    bulletEls.push(`<circle cx="80" cy="${y - 14}" r="9" fill="${accent}"/>`);
    wrapped.forEach((wl, i) => {
      bulletEls.push(`<text x="110" y="${y + i * 50}" font-family="${FONT_STACK}" font-size="40" font-weight="600" fill="#E5E7EB">${escapeXml(wl)}</text>`);
    });
    y += wrapped.length * 50 + 36;
  }

  // Source attribution is intentionally NOT rendered on the card (per operator request). The
  // blog article (.md / WordPress) keeps the source footer for copyright safety; the card is a
  // clean visual teaser.
  return `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="ts"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="rgba(0,0,0,0.8)"/></filter></defs>
  <rect x="64" y="120" width="120" height="10" rx="5" fill="${accent}"/>
  <text x="64" y="188" font-family="${FONT_STACK}" font-size="44" font-weight="800" fill="${accent}">${escapeXml(sportLabel || '')}</text>
  ${headEls}
  ${bulletEls.join('\n')}
  <rect x="0" y="${CARD_H - 10}" width="${CARD_W}" height="10" fill="${accent}"/>
</svg>`;
}

// Render the card -> { buffer, width, height, format }. Always returns a valid PNG.
// Accepts either { headline, points, sources } (card-news) or { title } (legacy/title-only).
export async function renderCardNews({ title, headline, points, sources, sportKey, sportLabel, lang }) {
  const head = headline || title;
  const bg = await sharp(Buffer.from(backgroundSvg(sportKey, sportLabel))).png().toBuffer();
  const overlay = (points && points.length)
    ? contentSvg({ sportKey, sportLabel, headline: head, points, sources })
    : titleLayerSvg(head);
  const buffer = await sharp(bg)
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, format: meta.format, lang, title: head, sportKey };
}
