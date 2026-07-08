// 4-cut (4컷) STORY manga card. The news becomes a 4-panel story: Gemini draws the art (no text,
// upper space left blank), and WE overlay CORRECT Korean speech bubbles (image models garble
// Korean). No summary text — the card is header + 4-panel manga (bubbles) + a manga-title headline.
// Instagram portrait 1080x1350.
import sharp from 'sharp';
import { parseJsonLoose } from '../llm/client.mjs';
import { generateComicImage, COMIC_STYLES } from './comic_card.mjs';

export const CARD_W = 1080, CARD_H = 1350;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrapKo = (t, n) => { const o = []; let c = ''; for (const ch of String(t)) { c += ch; if (c.length >= n) { o.push(c); c = ''; } } if (c) o.push(c); return o.length ? o : [t]; };
// Balanced 1-or-2-line split for a short bubble line: break at the space nearest the middle so
// punctuation never orphans onto its own line.
function wrapBubble(t) {
  const chars = [...String(t).trim()];
  if (chars.length <= 11) return [chars.join('')];
  const mid = Math.floor(chars.length / 2);
  let idx = -1, best = 1e9;
  for (let i = 0; i < chars.length; i++) if (chars[i] === ' ') { const d = Math.abs(i - mid); if (d < best) { best = d; idx = i; } }
  if (idx < 0) idx = mid;
  return [chars.slice(0, idx).join('').trim(), chars.slice(idx).join('').trim()];
}

const SPORT = {
  football: { emoji: '⚽', label: '축구', accent: '#22C55E' }, baseball: { emoji: '⚾', label: '야구', accent: '#F59E0B' },
  basketball: { emoji: '🏀', label: '농구', accent: '#EF4444' }, volleyball: { emoji: '🏐', label: '배구', accent: '#3B82F6' },
};
const sportOf = (k) => SPORT[k] ?? { emoji: '📰', label: '스포츠', accent: '#E4002B' };

// LLM: turn the article into a 4-beat STORY. Each beat = { scene (English, for the artist),
// dialogue (short Korean line for a speech bubble) }. Type-aware so non-action news still works.
export async function deriveFourBeats({ sportKey, headline, summary = '', eventType = 'other' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const fb = [
    { scene: `${s.label} athletes set the scene for: "${headline}"`, dialogue: '오늘 경기, 시작된다' },
    { scene: `the key build-up moment of: "${headline}"`, dialogue: '분위기가 심상치 않아' },
    { scene: `the decisive moment of: "${headline}"`, dialogue: '바로 지금!' },
    { scene: `the outcome / reaction of: "${headline}"`, dialogue: '해냈다!' },
  ];
  if (!key) return fb;
  const instruction =
    `You are a manga storyboard writer for a ${s.label} sports-news webtoon (article type: ${eventType}). ` +
    `Turn the news below into a dramatic FOUR-panel STORY (setup → build-up → climax → result), depicting ` +
    `ONLY what actually happened (never invent a result). For EACH of the 4 panels give: "scene" = one ` +
    `concrete English description of the art (real action/people, believable setting, generic anonymous ` +
    `athletes, NO real-person faces, NO team logos, NO text), and "dialogue" = one SHORT Korean speech-` +
    `bubble line (<= 14 chars, natural, punchy — what a player/announcer would say). ` +
    `Output ONLY JSON: [{"scene":"...","dialogue":"..."},{...},{...},{...}] (exactly 4).\n\n` +
    `Headline: ${headline}\nSummary: ${summary}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: instruction }] }], generationConfig: { temperature: 0.8 } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const out = parseJsonLoose(json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim());
    const arr = Array.isArray(out) ? out : (out.panels ?? out.beats ?? []);
    if (arr.length >= 4) return arr.slice(0, 4).map((b, i) => ({ scene: b.scene || fb[i].scene, dialogue: b.dialogue || fb[i].dialogue }));
    return fb;
  } catch { return fb; }
}

// The no-text 4-panel art prompt (2x2). We overlay the bubbles ourselves.
export function fourCutPrompt(beats) {
  return `A black-and-white Japanese shonen MANGA PAGE, EXACTLY 4 panels in a clean 2x2 grid with white gutters, telling a short story. `
    + beats.map((b, i) => `Panel ${i + 1}: ${b.scene}.`).join(' ')
    + ` ${COMIC_STYLES.shonen} Heavy screentone, dramatic angles, foreshortening, speed lines. Generic anonymous athletes, NO real-person faces, NO team logos. `
    + `IMPORTANT: leave the UPPER portion of EACH panel relatively empty (open sky / plain background) to fit a caption, and render absolutely NO text, NO letters, NO numbers, and NO speech bubbles anywhere.`;
}

// One comic speech bubble (ellipse + tail) with Korean text centered at (cx,cy).
function bubbleSvg(cx, cy, text) {
  const lines = wrapBubble(text).slice(0, 3);
  const fs = 34, lh = 42;
  const w = Math.max(...lines.map((l) => l.length)) * fs * 0.64 + 48;
  const h = lines.length * lh + 34;
  const rx = w / 2, ry = h / 2;
  const ty = cy + ry - 4;
  const tail = `M ${cx - 16} ${ty} L ${cx + 16} ${ty} L ${cx - 6} ${ty + 32} Z`;
  const textEls = lines.map((l, i) =>
    `<text x="${cx}" y="${cy - (lines.length - 1) * lh / 2 + i * lh + fs * 0.35}" font-family="${FONT}" font-size="${fs}" font-weight="800" fill="#111" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<path d="${tail}" fill="#fff" stroke="#111" stroke-width="4"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="#111" stroke-width="4"/>${textEls}`;
}

// Overlay one bubble per panel (2x2), in the upper area of each panel.
async function overlayBubbles(imgBuf, dialogues) {
  const m = await sharp(imgBuf).metadata();
  const W = m.width, H = m.height, pw = W / 2, ph = H / 2;
  const pos = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${
    dialogues.slice(0, 4).map((d, i) => {
      const [c, r] = pos[i];
      return bubbleSvg(Math.round(c * pw + pw * (c === 0 ? 0.35 : 0.65)), Math.round(r * ph + ph * 0.19), d);
    }).join('')}</svg>`;
  return sharp(imgBuf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// Compose the final Instagram-portrait card: header + 4-panel manga(bubbles) + manga-title headline.
// opts: { sportKey, sportLabel?, date, headline, mangaBuffer, dialogues, accent? }
export async function renderFourCutCard({ sportKey, sportLabel, date = '', headline, mangaBuffer, dialogues, accent }) {
  const s = sportOf(sportKey);
  const label = sportLabel || s.label;
  accent = accent || '#E4002B';
  const HEAD = 96;          // top strip
  const MW = CARD_W;        // manga full width
  const MTOP = HEAD;
  const manga = await sharp(await overlayBubbles(mangaBuffer, dialogues))
    .resize({ width: MW, height: MW, fit: 'cover', position: 'attention' }).png().toBuffer(); // square 2x2
  const MBOT = MTOP + MW;   // manga bottom
  // manga-title headline (bottom slab)
  const hLines = wrapKo(headline, 16).slice(0, 2);
  const titleY = MBOT + 60;
  const titleEls = hLines.map((l, i) =>
    `<text x="56" y="${titleY + i * 74}" font-family="${FONT}" font-size="60" font-weight="900" fill="#fff" filter="url(#ts)">${esc(l)}</text>`).join('');
  const bg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="ts"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="rgba(0,0,0,.6)"/></filter></defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="#141210"/>
    <!-- top strip -->
    <rect x="40" y="26" rx="26" width="${210}" height="52" fill="${accent}"/>
    <text x="66" y="62" font-family="${FONT}" font-size="30" font-weight="900" fill="#fff">${esc(s.emoji)} ${esc(label)}</text>
    <text x="${CARD_W - 44}" y="62" font-family="${FONT}" font-size="26" font-weight="700" fill="#c9c2b5" text-anchor="end">${esc(date)}</text>
    <!-- manga-title slab bottom -->
    <rect x="0" y="${MBOT}" width="${CARD_W}" height="${CARD_H - MBOT}" fill="#141210"/>
    <rect x="0" y="${MBOT}" width="14" height="${CARD_H - MBOT}" fill="${accent}"/>
    <rect x="56" y="${MBOT + 22}" width="120" height="8" fill="${accent}"/>
    ${titleEls}
  </svg>`;
  const base = await sharp(Buffer.from(bg)).png().toBuffer();
  const buffer = await sharp(base).composite([{ input: manga, top: MTOP, left: 0 }]).png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, format: meta.format };
}
