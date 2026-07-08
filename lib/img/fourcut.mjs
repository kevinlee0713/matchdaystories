// 4-cut (4컷) STORY manga card (Instagram 1080x1350). The news becomes a 4-panel story; GEMINI draws
// the art AND the speech bubbles (integrated, natural manga bubbles), but image models GARBLE Korean,
// so we DETECT the bubbles (Gemini vision) and overlay the CORRECT Korean text — keeping the AI-drawn
// bubble outline. Text never clips: font auto-shrinks to fit, and if the bubble is too small the white
// backing grows to the text (the bubble may be exceeded — text legibility wins). No summary text; the
// headline sits at the bottom like a manga title.
import sharp from 'sharp';
import { parseJsonLoose } from '../llm/client.mjs';
import { generateComicImage, COMIC_STYLES } from './comic_card.mjs';

export const CARD_W = 1080, CARD_H = 1350;
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrapKo = (t, n) => { const o = []; let c = ''; for (const ch of String(t)) { c += ch; if (c.length >= n) { o.push(c); c = ''; } } if (c) o.push(c); return o.length ? o : [t]; };

const SPORT = {
  football: { emoji: '⚽', label: '축구' }, baseball: { emoji: '⚾', label: '야구' },
  basketball: { emoji: '🏀', label: '농구' }, volleyball: { emoji: '🏐', label: '배구' },
};
const sportOf = (k) => SPORT[k] ?? { emoji: '📰', label: '스포츠' };

// Keep bubbles sparse (operator: "only where needed"): at most `max`, preferring shout (!/?) and
// later (climax/result) panels; blank the rest so the art carries them.
function capBubbles(beats, max = 2) {
  const has = (b) => b.dialogue && String(b.dialogue).trim();
  const shout = (b) => /[!?！？]/.test(b.dialogue || '');
  const keep = beats.map((b, i) => ({ b, i })).filter((x) => has(x.b))
    .sort((a, b) => (shout(b.b) - shout(a.b)) || (b.i - a.i)).slice(0, max).map((x) => x.i);
  return beats.map((b, i) => (keep.includes(i) ? b : { ...b, dialogue: '' }));
}

// LLM: turn the article into a 4-beat STORY. Each beat = { scene (English, for the artist),
// dialogue (short Korean bubble line or '') }. Bubbles used sparingly. Type-aware.
export async function deriveFourBeats({ sportKey, headline, summary = '', eventType = 'other' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const fb = [
    { scene: `${s.label} athletes set the scene for: "${headline}"`, dialogue: '' },
    { scene: `the key build-up moment of: "${headline}"`, dialogue: '' },
    { scene: `the decisive moment of: "${headline}"`, dialogue: '바로 지금!' },
    { scene: `the outcome / reaction of: "${headline}"`, dialogue: '해냈다!' },
  ];
  if (!key) return capBubbles(fb);
  const instruction =
    `You are a manga storyboard writer for a ${s.label} sports-news webtoon (article type: ${eventType}). ` +
    `Turn the news below into a dramatic FOUR-panel STORY (setup → build-up → climax → result), depicting ` +
    `ONLY what actually happened (never invent a result). For EACH of the 4 panels give: "scene" = one ` +
    `concrete English description of the art (real action/people, believable setting, generic anonymous ` +
    `athletes, NO real-person faces, NO team logos), and "dialogue" = a SHORT Korean speech-bubble line ` +
    `(<= 12 chars) ONLY when a panel truly needs a spoken line; otherwise "" — the artwork alone should ` +
    `carry wordless panels. Aim for about 1-2 bubbles total across the 4 panels, not one per panel. ` +
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

// Prompt: 4 seamless quarters, with AI-drawn speech bubbles ONLY in dialogue panels (text will be
// garbled — we replace it). No gutters (we impose uniform ones), no other text/SFX/signage.
export function fourCutPrompt(beats) {
  return `A black-and-white Japanese shonen MANGA PAGE, EXACTLY 4 equal panels in a 2x2 grid — each `
    + `scene fills exactly one quarter of the square EDGE-TO-EDGE with NO gutters and NO borders between `
    + `panels (seamless quarters), telling a short story. `
    + beats.map((b, i) => `Panel ${i + 1}: ${b.scene}${b.dialogue ? `, with ONE clean white speech bubble containing the line "${b.dialogue}" in the upper part of the panel` : ', with NO speech bubble'}.`).join(' ')
    + ` ${COMIC_STYLES.shonen} Heavy screentone, dramatic angles, speed lines. Generic anonymous athletes, `
    + `NO real-person faces, NO team logos. Draw a speech bubble ONLY in the panels specified above, and NO `
    + `other bubbles, NO sound-effect text, NO scoreboards/banners/signage with letters or numbers.`;
}

// Detect speech balloons in the manga image via Gemini vision. Returns [[ymin,xmin,ymax,xmax], ...]
// normalized 0-1000 (Google detection convention).
export async function detectBubbles(imgBuf, env = process.env) {
  const key = env.GEMINI_API_KEY;
  if (!key) return [];
  const b64 = imgBuf.toString('base64');
  const prompt = 'Detect every speech balloon (white dialogue bubble) in this manga image. Return ONLY a '
    + 'JSON array; each item {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000. Ignore small sound-effect marks.';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const arr = parseJsonLoose(json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim());
    return (Array.isArray(arr) ? arr : []).map((b) => b.box_2d || b.box || b).filter((b) => Array.isArray(b) && b.length === 4);
  } catch { return []; }
}

// Fit Korean text to a bubble box (px). Shrinks the font to fit; if it can't fit even at the floor
// size, grows the white backing to the text so it NEVER clips (the bubble outline may be exceeded).
// Don't leave a 1-char line (e.g. a lone "!") — merge it into the previous line.
const fixOrphan = (lines) => { if (lines.length > 1 && [...lines[lines.length - 1]].length === 1) { lines[lines.length - 2] += lines[lines.length - 1]; lines.pop(); } return lines; };
function fitBubble(w, h, text) {
  const iw = w * 0.84, ih = h * 0.84;
  for (let fs = 38; fs >= 22; fs -= 2) {
    const per = Math.max(1, Math.floor(iw / (fs * 0.62)));
    const lines = fixOrphan(wrapKo(text, per));
    const tw = Math.max(...lines.map((l) => l.length)) * fs * 0.62;
    if (lines.length * fs * 1.16 <= ih && tw <= iw) return { fs, lines, wW: w * 0.92, wH: h * 0.9 };
  }
  const fs = 22, per = Math.max(4, Math.floor(iw / (fs * 0.62)));
  const lines = fixOrphan(wrapKo(text, per).slice(0, 4));
  const tw = Math.max(...lines.map((l) => l.length)) * fs * 0.62, th = lines.length * fs * 1.16;
  return { fs, lines, wW: Math.max(w * 0.92, tw + 28), wH: Math.max(h * 0.9, th + 22) };
}

// Overlay the CORRECT Korean into the detected bubbles: match bubbles to dialogues by reading order
// (top row L→R, bottom row L→R), white out each interior, and place auto-fit text.
async function overlayDetectedBubbles(imgBuf, boxes, dialogues) {
  const dl = (dialogues || []).map((d) => (d || '').trim()).filter(Boolean);
  if (!dl.length || !boxes?.length) return imgBuf;
  const m = await sharp(imgBuf).metadata();
  const W = m.width, H = m.height;
  let bx = boxes.map(([ymin, xmin, ymax, xmax]) => {
    const x = xmin / 1000 * W, y = ymin / 1000 * H, w = (xmax - xmin) / 1000 * W, h = (ymax - ymin) / 1000 * H;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, area: w * h };
  });
  bx.sort((a, b) => b.area - a.area);
  bx = bx.slice(0, dl.length);
  bx.sort((a, b) => (a.cy < H / 2 ? 0 : 1) - (b.cy < H / 2 ? 0 : 1) || a.cx - b.cx);
  const els = [];
  bx.forEach((b, i) => {
    const d = dl[i]; if (!d) return;
    const { fs, lines, wW, wH } = fitBubble(b.w, b.h, d);
    const lh = fs * 1.16;
    const cx = b.cx.toFixed(0);
    els.push(`<ellipse cx="${cx}" cy="${b.cy.toFixed(0)}" rx="${(wW / 2).toFixed(0)}" ry="${(wH / 2).toFixed(0)}" fill="#fff" stroke="#111" stroke-width="3"/>`);
    lines.forEach((l, k) => {
      const ty = (b.cy - (lines.length - 1) * lh / 2 + k * lh + fs * 0.35).toFixed(0);
      els.push(`<text x="${cx}" y="${ty}" font-family="${FONT}" font-size="${fs.toFixed(0)}" font-weight="800" fill="#111" text-anchor="middle">${esc(l)}</text>`);
    });
  });
  if (!els.length) return imgBuf;
  return sharp(imgBuf).composite([{ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${els.join('')}</svg>`), top: 0, left: 0 }]).png().toBuffer();
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

// Compose the Instagram-portrait card: 4-panel manga (uniform gutters, corrected Korean bubbles) +
// bottom manga-title headline. opts: { sportKey, date, headline, mangaBuffer, bubbles, dialogues, accent }
export async function renderFourCutCard({ sportKey, date = '', headline, mangaBuffer, bubbles, dialogues, accent }) {
  accent = accent || '#E4002B';
  const MW = CARD_W;
  const sq0 = await sharp(mangaBuffer).resize({ width: MW, height: MW, fit: 'cover', position: 'attention' }).png().toBuffer();
  const sq1 = await sharp(sq0).composite([{ input: Buffer.from(gutterSvg(MW)), top: 0, left: 0 }]).png().toBuffer();
  const manga = await overlayDetectedBubbles(sq1, bubbles, dialogues);
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
