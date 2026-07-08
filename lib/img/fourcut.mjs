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
// Keep bubbles sparse (operator: "only where needed"): at most `max` dialogues, preferring shout
// lines (!/?) and later (climax/result) panels; blank the rest so the art carries them.
function capBubbles(beats, max = 2) {
  const has = (b) => b.dialogue && String(b.dialogue).trim();
  const shout = (b) => /[!?！？]/.test(b.dialogue || '');
  const keep = beats.map((b, i) => ({ b, i })).filter((x) => has(x.b))
    .sort((a, b) => (shout(b.b) - shout(a.b)) || (b.i - a.i)).slice(0, max).map((x) => x.i);
  return beats.map((b, i) => (keep.includes(i) ? b : { ...b, dialogue: '' }));
}

export async function deriveFourBeats({ sportKey, headline, summary = '', eventType = 'other' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const fb = [
    { scene: `${s.label} athletes set the scene for: "${headline}"`, dialogue: '오늘 경기, 시작된다' },
    { scene: `the key build-up moment of: "${headline}"`, dialogue: '분위기가 심상치 않아' },
    { scene: `the decisive moment of: "${headline}"`, dialogue: '바로 지금!' },
    { scene: `the outcome / reaction of: "${headline}"`, dialogue: '해냈다!' },
  ];
  if (!key) return capBubbles(fb);
  const instruction =
    `You are a manga storyboard writer for a ${s.label} sports-news webtoon (article type: ${eventType}). ` +
    `Turn the news below into a dramatic FOUR-panel STORY (setup → build-up → climax → result), depicting ` +
    `ONLY what actually happened (never invent a result). For EACH of the 4 panels give: "scene" = one ` +
    `concrete English description of the art (real action/people, believable setting, generic anonymous ` +
    `athletes, NO real-person faces, NO team logos, NO text), and "dialogue" = a SHORT Korean speech-bubble ` +
    `line (<= 12 chars) ONLY when a panel truly needs a spoken line for the story; otherwise set ` +
    `"dialogue" to "" (empty) — the artwork alone should carry panels that don't need words. Aim for ` +
    `about 1-2 bubbles total across the 4 panels, not one per panel. ` +
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
    if (arr.length >= 4) return capBubbles(arr.slice(0, 4).map((b, i) => ({ scene: b.scene || fb[i].scene, dialogue: b.dialogue ?? '' })));
    return capBubbles(fb);
  } catch { return capBubbles(fb); }
}

// The no-text 4-panel art prompt (2x2). We overlay the bubbles ourselves.
export function fourCutPrompt(beats) {
  return `A black-and-white Japanese shonen MANGA PAGE, EXACTLY 4 panels in a clean 2x2 grid with white gutters, telling a short story. `
    + beats.map((b, i) => `Panel ${i + 1}: ${b.scene}.`).join(' ')
    + ` ${COMIC_STYLES.shonen} Heavy screentone, dramatic angles, foreshortening, speed lines. Generic anonymous athletes, NO real-person faces, NO team logos. `
    + `IMPORTANT: leave the UPPER portion of EACH panel relatively empty (open sky / plain background) to fit a caption. Render absolutely NO text anywhere — NO speech bubbles, NO captions, and NO scoreboards, banners, signage, or advertising boards containing any letters or numbers (keep such surfaces blank or out of frame).`;
}

// Spiky "shout" bubble outline (manga emphasis) — a star-burst around an ellipse.
function spikyPath(cx, cy, rx, ry, spikes = 18, depth = 0.16) {
  let d = '';
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const out = i % 2 === 0;
    const x = cx + Math.cos(a) * rx * (out ? 1 : 1 - depth);
    const y = cy + Math.sin(a) * ry * (out ? 1 : 1 - depth);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d + 'Z';
}

// A manga speech bubble with Korean text centered at (cx,cy). Exclamatory lines get a spiky shout
// bubble; calm lines get a rounded bubble. Thick ink outline + tail toward the panel centre.
function bubbleSvg(cx, cy, text, panelCx) {
  const lines = wrapBubble(text).slice(0, 3);
  const shout = /[!?！？]/.test(text);
  const fs = 34, lh = 42;
  const w = Math.max(...lines.map((l) => l.length)) * fs * 0.64 + (shout ? 66 : 50);
  const h = lines.length * lh + (shout ? 48 : 34);
  const rx = w / 2, ry = h / 2;
  const ty = cy + ry * (shout ? 0.86 : 1) - 4;
  const dir = panelCx != null && panelCx < cx ? -1 : 1; // tail points toward the speaker side
  const tail = `M ${cx - 16} ${ty} L ${cx + 16} ${ty} L ${cx + dir * 22} ${ty + 34} Z`;
  const shape = shout
    ? `<path d="${spikyPath(cx, cy, rx, ry)}" fill="#fff" stroke="#111" stroke-width="4" stroke-linejoin="round"/>`
    : `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="#111" stroke-width="4"/>`;
  const textEls = lines.map((l, i) =>
    `<text x="${cx}" y="${cy - (lines.length - 1) * lh / 2 + i * lh + fs * 0.35}" font-family="${FONT}" font-size="${fs}" font-weight="800" fill="#111" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<path d="${tail}" fill="#fff" stroke="#111" stroke-width="4"/>${shape}${textEls}`;
}

// Overlay bubbles ONLY on panels that have a dialogue line (empty = no bubble; the art carries it).
async function overlayBubbles(imgBuf, dialogues) {
  const m = await sharp(imgBuf).metadata();
  const W = m.width, H = m.height, pw = W / 2, ph = H / 2;
  const pos = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const els = (dialogues || []).slice(0, 4).map((d, i) => {
    if (!d || !String(d).trim()) return '';
    const [c, r] = pos[i];
    const panelCx = c * pw + pw / 2;
    return bubbleSvg(Math.round(c * pw + pw * (c === 0 ? 0.36 : 0.64)), Math.round(r * ph + ph * 0.2), String(d).trim(), panelCx);
  }).join('');
  if (!els) return imgBuf;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${els}</svg>`;
  return sharp(imgBuf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// Compose the final Instagram-portrait card: header + 4-panel manga(bubbles) + manga-title headline.
// opts: { sportKey, sportLabel?, date, headline, mangaBuffer, dialogues, accent? }
export async function renderFourCutCard({ sportKey, date = '', headline, mangaBuffer, dialogues, accent }) {
  accent = accent || '#E4002B';
  const MW = CARD_W;            // manga full width, starts at the very top (no sport strip)
  const manga = await sharp(await overlayBubbles(mangaBuffer, dialogues))
    .resize({ width: MW, height: MW, fit: 'cover', position: 'attention' }).png().toBuffer(); // square 2x2
  const MBOT = MW;             // manga bottom = 1080
  const slabH = CARD_H - MBOT; // bottom title slab (270)
  // manga-title headline (bottom slab), up to 3 lines
  const hLines = wrapKo(headline, 16).slice(0, 3);
  const titleY = MBOT + Math.max(56, (slabH - hLines.length * 70) / 2 + 40);
  const titleEls = hLines.map((l, i) =>
    `<text x="56" y="${titleY + i * 70}" font-family="${FONT}" font-size="56" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  const bg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CARD_W}" height="${CARD_H}" fill="#141210"/>
    <rect x="0" y="${MBOT}" width="${CARD_W}" height="${slabH}" fill="#141210"/>
    <rect x="0" y="${MBOT}" width="14" height="${slabH}" fill="${accent}"/>
    <rect x="56" y="${MBOT + 28}" width="120" height="8" fill="${accent}"/>
    ${titleEls}
    <text x="${CARD_W - 44}" y="${CARD_H - 30}" font-family="${FONT}" font-size="24" font-weight="700" fill="#8a857b" text-anchor="end">${esc(date)}</text>
  </svg>`;
  const base = await sharp(Buffer.from(bg)).png().toBuffer();
  const buffer = await sharp(base).composite([{ input: manga, top: 0, left: 0 }]).png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, format: meta.format };
}
