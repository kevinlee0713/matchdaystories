// 4-cut (4컷) STORY manga card (Instagram 1080x1350). The news becomes a WORDLESS 4-panel story told
// by the ART ALONE — NO speech bubbles. Image models garble any Korean they draw (scoreboards, signs,
// SFX), so after generation we run a Gemini image-EDIT pass to strip all text (see removeImageText).
// The card = clean 4-panel manga (uniform gutters) + a bottom manga-title headline.
import sharp from 'sharp';
import { parseJsonLoose } from '../llm/client.mjs';
import { COMIC_STYLES } from './comic_card.mjs';

export const CARD_W = 1080, CARD_H = 1350;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrapKo = (t, n) => { const o = []; let c = ''; for (const ch of String(t)) { c += ch; if (c.length >= n) { o.push(c); c = ''; } } if (c) o.push(c); return o.length ? o : [t]; };

const SPORT = { football: { label: '축구' }, baseball: { label: '야구' }, basketball: { label: '농구' }, volleyball: { label: '배구' } };
const sportOf = (k) => SPORT[k] ?? { label: '스포츠' };

// LLM: turn the article into a WORDLESS 4-beat visual story (setup → build-up → climax → result).
// Returns [{ scene }] × 4 (concrete English art descriptions). Type-aware; never invents a result.
export async function deriveFourBeats({ sportKey, headline, summary = '', eventType = 'other' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const fb = [
    { scene: `${s.label} athletes set the scene for: "${headline}"` },
    { scene: `the key build-up moment of: "${headline}"` },
    { scene: `the decisive moment of: "${headline}"` },
    { scene: `the outcome / reaction of: "${headline}"` },
  ];
  if (!key) return fb;
  const instruction =
    `You are a manga storyboard writer for a ${s.label} sports-news webtoon (article type: ${eventType}). ` +
    `Turn the news below into a dramatic WORDLESS FOUR-panel visual story (setup → build-up → climax → ` +
    `result) told by imagery alone, depicting ONLY what actually happened (never invent a result). For ` +
    `EACH of the 4 panels give "scene" = one concrete English description of the art (real action/people, ` +
    `believable setting, generic anonymous athletes, NO real-person faces, NO team logos, NO text). ` +
    `Output ONLY JSON: [{"scene":"..."},{"scene":"..."},{"scene":"..."},{"scene":"..."}] (exactly 4).\n\n` +
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
    if (arr.length >= 4) return arr.slice(0, 4).map((b, i) => ({ scene: b.scene || fb[i].scene }));
    return fb;
  } catch { return fb; }
}

// Prompt: 4 seamless quarters (we impose uniform gutters), WORDLESS — no speech bubbles, no text.
export function fourCutPrompt(beats) {
  return `A black-and-white Japanese shonen MANGA PAGE, EXACTLY 4 equal panels in a 2x2 grid — each `
    + `scene fills exactly one quarter of the square EDGE-TO-EDGE with NO gutters and NO borders between `
    + `panels (seamless quarters), telling a WORDLESS story through imagery alone. `
    + beats.map((b, i) => `Panel ${i + 1}: ${b.scene}.`).join(' ')
    + ` ${COMIC_STYLES.shonen} Heavy screentone, dramatic angles, foreshortening, speed lines. Generic `
    + `anonymous athletes, NO real-person faces, NO team logos. Render absolutely NO text anywhere — NO `
    + `speech bubbles, NO captions, NO scoreboards/banners/signage with letters or numbers (blank surfaces).`;
}

// Uniform 2x2 gutters + panel borders imposed by US (Gemini's own gutters are uneven).
function gutterSvg(S) {
  const c = S / 2, G = 22, hg = G / 2, b = 3;
  const q = [[0, 0, c - hg, c - hg], [c + hg, 0, S - (c + hg), c - hg], [0, c + hg, c - hg, S - (c + hg)], [c + hg, c + hg, S - (c + hg), S - (c + hg)]];
  return `<svg width="${S}" height="${S}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${c - hg}" width="${S}" height="${G}" fill="#fff"/>
    <rect x="${c - hg}" y="0" width="${G}" height="${S}" fill="#fff"/>
    ${q.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#111" stroke-width="${b}"/>`).join('')}
  </svg>`;
}

// Compose the Instagram-portrait card: clean 4-panel manga (uniform gutters) + bottom manga-title.
export async function renderFourCutCard({ sportKey, date = '', headline, mangaBuffer, accent }) {
  accent = accent || '#E4002B';
  const MW = CARD_W;
  const sq0 = await sharp(mangaBuffer).resize({ width: MW, height: MW, fit: 'cover', position: 'attention' }).png().toBuffer();
  const manga = await sharp(sq0).composite([{ input: Buffer.from(gutterSvg(MW)), top: 0, left: 0 }]).png().toBuffer();
  const MBOT = MW, slabH = CARD_H - MBOT;
  const hLines = wrapKo(headline, 16).slice(0, 3);
  const titleY = MBOT + Math.max(56, (slabH - hLines.length * 70) / 2 + 40);
  const titleEls = hLines.map((l, i) => `<text x="56" y="${titleY + i * 70}" font-family="${FONT}" font-size="56" font-weight="900" fill="#fff">${esc(l)}</text>`).join('');
  const bg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${CARD_W}" height="${CARD_H}" fill="#141210"/>
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
