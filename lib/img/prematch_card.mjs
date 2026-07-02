// Pre-match intelligence card (①) — REAL sharp render. A 1080x1080 card that packages, for an
// upcoming match: the matchup, competition/kickoff, recent form (W/D/L), a key injury, and a
// synthesized "what to watch" line. This is the differentiator news sites don't produce: not
// "what happened" but "what it means" for the next match.
import sharp from 'sharp';

export const CARD_W = 1080;
export const CARD_H = 1080;

const SPORT_ACCENT = { football: '#22C55E', baseball: '#F59E0B', basketball: '#EF4444' };
const accentFor = (k) => SPORT_ACCENT[k] ?? '#3B82F6';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";

// Render a single W/D/L form string as colored pills, returns SVG fragment at (x,y).
function formPills(form, x, y) {
  const colors = { W: '#22C55E', D: '#9CA3AF', L: '#EF4444', 승: '#22C55E', 무: '#9CA3AF', 패: '#EF4444' };
  const size = 34, gap = 8;
  return Array.from(String(form)).slice(0, 6).map((ch, i) =>
    `<rect x="${x + i * (size + gap)}" y="${y}" width="${size}" height="${size}" rx="7" fill="${colors[ch] ?? '#6B7280'}"/>` +
    `<text x="${x + i * (size + gap) + size / 2}" y="${y + size - 9}" font-family="${FONT}" font-size="20" font-weight="800" fill="#0A1024" text-anchor="middle">${esc(ch)}</text>`
  ).join('');
}

function wrap(text, limit) {
  const isCJK = /[　-鿿가-힯]/.test(text);
  if (isCJK) {
    const out = []; let cur = '';
    for (const ch of String(text)) { cur += ch; if (cur.length >= limit) { out.push(cur); cur = ''; } }
    if (cur) out.push(cur);
    return out.length ? out : [text];
  }
  const words = String(text).split(' '); const out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (t.length > limit && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

export async function renderPrematchCard({ sportKey, sportLabel, competition, kickoff, home, away, homeForm, awayForm, injury, whatToWatch }) {
  const accent = accentFor(sportKey);
  const watchLines = wrap(whatToWatch ?? '', 22).slice(0, 3);
  const watchEls = watchLines.map((l, i) =>
    `<text x="64" y="${812 + i * 52}" font-family="${FONT}" font-size="40" font-weight="700" fill="#E5E7EB">${esc(l)}</text>`).join('');

  const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A1024"/><stop offset="60%" stop-color="#0E1733"/><stop offset="100%" stop-color="#14204A"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="18%" r="60%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.38"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="14" height="${CARD_H}" fill="${accent}"/>

  <text x="64" y="120" font-family="${FONT}" font-size="34" font-weight="800" fill="${accent}">${esc(sportLabel)} · 경기 전 인텔</text>
  <text x="64" y="172" font-family="${FONT}" font-size="30" font-weight="600" fill="#9CA3AF">${esc(competition || '')}  ${esc(kickoff || '')}</text>

  <text x="64" y="320" font-family="${FONT}" font-size="76" font-weight="800" fill="#ffffff">${esc(home)}</text>
  <text x="64" y="392" font-family="${FONT}" font-size="40" font-weight="700" fill="${accent}">VS</text>
  <text x="64" y="468" font-family="${FONT}" font-size="76" font-weight="800" fill="#ffffff">${esc(away)}</text>

  <text x="64" y="560" font-family="${FONT}" font-size="28" font-weight="700" fill="#9CA3AF">최근 폼 (${esc(home)})</text>
  ${formPills(homeForm ?? '', 64, 578)}
  <text x="64" y="664" font-family="${FONT}" font-size="28" font-weight="700" fill="#9CA3AF">최근 폼 (${esc(away)})</text>
  ${formPills(awayForm ?? '', 64, 682)}

  <text x="64" y="762" font-family="${FONT}" font-size="30" font-weight="700" fill="#FCA5A5">🚑 ${esc(injury || '주요 결장 없음')}</text>

  <text x="64" y="780" font-family="${FONT}" font-size="0" fill="#000"> </text>
  ${watchEls}
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, format: meta.format };
}
