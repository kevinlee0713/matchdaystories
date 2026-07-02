// Comic card-news renderer — turns ONE article into a single square card that embeds a
// cartoon/comic illustration (생성형 이미지) above an edited headline + key points.
//
// Two parts:
//   1) generateComicImage(prompt, env)  → calls Gemini image model, returns a PNG Buffer of the
//      cartoon panel. Falls back to a deterministic placeholder panel if no key / API error
//      (so the card pipeline never hard-fails on the illustration — AC#3 spirit).
//   2) renderComicCard({...})           → composites cartoon + text into a 1080x1080 PNG (sharp).
//
// The cartoon is the eye-catch; the headline/points carry the verified facts. Source attribution
// stays off the card (clean teaser) and on the blog article (copyright footer), matching cardnews.mjs.
import sharp from 'sharp';
import { parseJsonLoose } from '../llm/client.mjs';

export const CARD_W = 1080;
export const CARD_H = 1080;

const SPORT = {
  football:   { accent: '#22C55E', emoji: '⚽', label: '축구' },
  baseball:   { accent: '#F59E0B', emoji: '⚾', label: '야구' },
  basketball: { accent: '#EF4444', emoji: '🏀', label: '농구' },
  volleyball: { accent: '#3B82F6', emoji: '🏐', label: '배구' },
};
const sportOf = (k) => SPORT[k] ?? { accent: '#3B82F6', emoji: '📰', label: '스포츠' };

const FONT = "'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic','Apple SD Gothic Neo',sans-serif";

// Likeness mode: when ON (default, operator choice), the toon depicts the REAL athletes named in
// the article, matching their real-life appearance. When COMIC_LIKENESS=0, fall back to anonymous
// figures (safer re: right-of-publicity). Team logos + text are ALWAYS excluded (trademark safety).
const likenessOn = () => process.env.COMIC_LIKENESS !== '0';
const figureClause = () => likenessOn()
  ? 'Depict the SPECIFIC real athletes/people named, capturing their real-life likeness (face, build, hair, skin tone) as closely as possible. Plain kits only — NO team logos, NO text/letters/numbers.'
  : 'Generic anonymous athletes (NO real-person faces, NO real team logos, NO text/letters in the image).';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// CJK-aware wrap (chars for CJK, words otherwise).
function wrap(text, limitCJK, limitLatin) {
  const isCJK = /[　-鿿가-힯]/.test(text);
  if (isCJK) {
    const lim = limitCJK, out = []; let cur = '';
    for (const ch of String(text)) { cur += ch; if (cur.length >= lim) { out.push(cur); cur = ''; } }
    if (cur) out.push(cur); return out.length ? out : [text];
  }
  const lim = limitLatin, words = String(text).split(' '), out = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (t.length > lim && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out.length ? out : [text];
}

// ── 1) cartoon generation via Gemini image model ───────────────────────────────────────────────
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

// Derive the comic SCENE from the ACTUAL article (so the cartoon always depicts the news, not a
// generic stock pose). An art-director LLM step turns headline+summary into one vivid, brand-neutral
// English scene. Falls back to a headline-keyword template if no key / API error.
export async function deriveComicScene({ sportKey, headline, summary = '' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const fallback = `${s.label} athletes in the moment described by: "${headline}"`;
  if (!key) return fallback;
  const instruction =
    `You are an art director for a ${s.label} sports-news webtoon. Read the article below and write ` +
    `ONE vivid English sentence describing a CONCRETE comic scene that DEPICTS THIS SPECIFIC NEWS EVENT — ` +
    `show real people/athletes physically doing the action in a believable sports setting (stadium, pitch, ` +
    `pressroom, etc.). Do NOT use abstract metaphors, floating typography, glowing symbols, or numbers as ` +
    `imagery. Use generic anonymous figures — NO real names, NO real-person faces, NO team logos, NO text. ` +
    `Output ONLY the sentence.\n\n` +
    `Headline: ${headline}\nSummary: ${summary}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: instruction }] }], generationConfig: { temperature: 0.7 } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

// The cartoon is generated at this aspect ratio so it fits the card panel WITHOUT cropping
// (generate-to-fit, never generate-then-crop). 21:9 is the widest panoramic Gemini supports.
export const COMIC_ASPECT = '21:9';

// Selectable art styles. Each value is the visual-style sentence injected into the prompt; the
// scene + brand-neutral rules stay constant so only the look changes. Default = 'webtoon'.
export const COMIC_STYLES = {
  webtoon: 'Korean webtoon style: bold clean ink outlines, flat vivid cel-shading, halftone dot textures, light speed-lines, energetic dynamic pose.',
  shonen: 'Japanese shonen manga style: dramatic high-contrast black-and-white line art with screentone shading, intense action speed-lines, sharp dynamic foreshortening.',
  american: 'American superhero comic-book style: heavy bold inks, dramatic cross-hatching, chiseled muscular anatomy, Ben-Day halftone dots, saturated primary colors, explosive action.',
  flat: 'Modern flat vector editorial illustration: clean geometric shapes, minimal or no outlines, bold limited color palette, smooth subtle gradients, contemporary sports-magazine look.',
  caricature: 'Playful caricature cartoon style: exaggerated big-head proportions, bouncy expressive faces, humorous lively energy, bright colors, thick rounded outlines.',
  watercolor: 'Loose watercolor sports illustration: painterly color washes, expressive ink-brush linework, splashes of pigment, sense of motion, fine-art feel.',
  popart: 'Retro 1960s pop-art comic style: heavy Ben-Day dots, limited bold primary palette, vintage halftone print look, strong black outlines.',
};
export const DEFAULT_COMIC_STYLE = 'webtoon';

// Per-article-type storyboard guidance, so the two panels match what ACTUALLY happened (a preview
// must NOT show a goal that hasn't been played; a transfer shows a signing, not a match action).
const BEAT_GUIDANCE = {
  match_result: 'A match that WAS played. Beat 1 = the decisive on-field action actually described (the goal/shot/key play). Beat 2 = the players celebrating or reacting to the final result.',
  game: 'A game that WAS played. Beat 1 = the decisive play actually described. Beat 2 = the players/crowd reacting to the result.',
  transfer: 'A player MOVE — NOT a match. Beat 1 = a signing/unveiling moment (player shaking hands with a club official, holding up a plain new jersey at a presentation, or a contract signing at a desk). Beat 2 = fans or teammates reacting, or the player posing in the new kit. Do NOT depict a match goal or game action.',
  signing: 'A signing — NOT a match. Beat 1 = the unveiling/contract-signing moment. Beat 2 = reaction (fans, club staff, the player presented). Do NOT depict a match goal.',
  injury: 'An injury story. Beat 1 = a player going down injured with medical staff attending on the pitch. Beat 2 = concerned teammates / the impact (an empty position, a worried bench). Do NOT depict a goal or celebration.',
  sacking: 'A managerial exit. Beat 1 = a manager departing / a tense press conference / an empty dugout. Beat 2 = players or fans reacting. Do NOT depict a match goal.',
  preview: 'This match has NOT been played yet — depict ANTICIPATION, never a result. Beat 1 = the key players or managers sizing each other up before kickoff, or a coach pointing out tactics, or teams lining up in the tunnel. Beat 2 = the tense pre-match atmosphere and what is at stake (a packed stadium, focused faces). Do NOT invent a goal, score, or celebration.',
  other: 'Beat 1 = the key subject/action of the story. Beat 2 = the reaction or consequence. Only depict things the article actually states.',
};

// Derive the TWO most important visual MOMENTS of the article → the two manga panels (2컷), tuned to
// the article TYPE so non-action stories (transfer/preview/injury) get the right beats — not a goal.
export async function deriveTwoBeats({ sportKey, headline, summary = '', eventType = 'other' }, env = process.env) {
  const s = sportOf(sportKey);
  const key = env.GEMINI_API_KEY;
  const guidance = BEAT_GUIDANCE[eventType] || BEAT_GUIDANCE.other;
  const isResult = eventType === 'match_result' || eventType === 'game';
  const fb = {
    beat1: `${s.label}: ${isResult ? `the decisive action of: "${headline}"` : `the key moment of a ${eventType} story: "${headline}"`}`,
    beat2: `${s.label}: the reaction/consequence of: "${headline}"`,
  };
  if (!key) return fb;
  const peopleClause = likenessOn()
    ? `NAME the key athlete(s)/people explicitly and describe their real-life appearance (build, hair, ` +
      `skin tone, distinctive features) so the artist can capture their likeness. Plain kits — NO team logos, NO text.`
    : `Use generic anonymous athletes — NO real names, NO real-person faces, NO team logos, NO text/numbers.`;
  const instruction =
    `You are a manga storyboard artist for a ${s.label} sports-news page. The article TYPE is ` +
    `"${eventType}". STORYBOARD GUIDANCE: ${guidance}\n\n` +
    `From the article below, describe the TWO panels as concrete English comic-panel scenes that ` +
    `match the guidance and ONLY depict what actually happened (never invent a result). ${peopleClause} ` +
    `Output ONLY JSON: {"beat1":"...","beat2":"..."}\n\n` +
    `Headline: ${headline}\nSummary: ${summary}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: instruction }] }], generationConfig: { temperature: 0.7 } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
    const out = parseJsonLoose(text);
    return { beat1: out.beat1 || fb.beat1, beat2: out.beat2 || fb.beat2 };
  } catch {
    return fb;
  }
}

// Two-cut (2컷) manga-page prompt: two side-by-side panels for the two beats. Used by the manga-page
// layout. Brand-neutral, no readable text in the art.
export function mangaPageTwoCutPrompt({ beat1, beat2 }) {
  return `An authentic black-and-white Japanese shonen MANGA PAGE with EXACTLY TWO panels of similar ` +
    `size arranged SIDE BY SIDE, separated by a clean vertical white gutter. LEFT panel: ${beat1}. ` +
    `RIGHT panel: ${beat2}. ${COMIC_STYLES.shonen} Heavy screentone shading, dramatic angles, ` +
    `foreshortening, speed lines and focus lines for impact. ${figureClause()} ` +
    `Render NO readable text, NO letters, NO numbers, NO speech bubbles (leave the art clean). ` +
    `It must clearly look like two panels from a manga book.`;
}

// Build a consistent house-style comic prompt. The SCENE (article-derived) drives the content so the
// cartoon is always tied to the news. Brand-neutral: generic figures, no real faces/logos/text.
// `style` = a COMIC_STYLES key OR a custom style sentence.
export function comicPrompt({ sportKey, scene, style = DEFAULT_COMIC_STYLE }) {
  const s = sportOf(sportKey);
  const styleLine = COMIC_STYLES[style] || style || COMIC_STYLES[DEFAULT_COMIC_STYLE];
  return [
    `A single-panel WIDE PANORAMIC (21:9) illustration about ${s.label} (sports news).`,
    `Art style — ${styleLine}`,
    scene ? `It MUST depict this exact scene: ${scene}.` : '',
    figureClause(),
    `Compose the ENTIRE action inside the wide frame with comfortable margins — do NOT let any head, ` +
    `limb, ball, or key subject get cut off at the edges. Clean background.`,
  ].filter(Boolean).join(' ');
}

export async function generateComicImage(prompt, env = process.env, { aspectRatio = COMIC_ASPECT } = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) return { buffer: await placeholderPanel(), source: 'placeholder(no-key)' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { imageConfig: { aspectRatio } } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData?.data);
    if (!img) throw new Error('no image part in response');
    const raw = Buffer.from(img.inlineData.data, 'base64');
    const buffer = await sharp(raw).png().toBuffer(); // normalize to PNG
    return { buffer, source: GEMINI_IMAGE_MODEL };
  } catch (err) {
    return { buffer: await placeholderPanel(), source: `placeholder(${err.message})` };
  }
}

// Deterministic fallback panel so the card still renders if image-gen is unavailable (21:9).
async function placeholderPanel(w = 1536, h = 672) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#1B2440"/>
    <text x="${w / 2}" y="${h / 2}" font-family="${FONT}" font-size="42" font-weight="800"
      fill="#5B6picture" fill-opacity="0.5" text-anchor="middle">🖼️ 만화 영역</text>
  </svg>`.replace('#5B6picture', '#5B6B9A');
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── 2) compose the card ────────────────────────────────────────────────────────────────────────
function backgroundSvg(accent, label, emoji, date) {
  return `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0A1024"/><stop offset="60%" stop-color="#0E1733"/><stop offset="100%" stop-color="#14204A"/>
      </linearGradient>
      <radialGradient id="glow" cx="80%" cy="14%" r="55%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.40"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
    <rect x="0" y="0" width="14" height="${CARD_H}" fill="${accent}"/>
    <!-- sport badge -->
    <rect x="56" y="56" rx="34" width="${260}" height="68" fill="${accent}"/>
    <text x="92" y="103" font-family="${FONT}" font-size="40" font-weight="900" fill="#0A1024">${esc(emoji)} ${esc(label)}</text>
    <text x="${CARD_W - 56}" y="103" font-family="${FONT}" font-size="34" font-weight="700" fill="#9FB0D6" text-anchor="end">${esc(date)}</text>
  </svg>`;
}

function textSvg({ accent, headline, summary, textTop }) {
  // Headline: up to 2 lines.
  const headLines = wrap(headline, 17, 32).slice(0, 2);
  const headLineH = 70;
  let y = textTop + 52;
  const headEls = headLines.map((l, i) =>
    `<text x="56" y="${y + i * headLineH}" font-family="${FONT}" font-size="56" font-weight="900" fill="#ffffff" filter="url(#ts)">${esc(l)}</text>`).join('\n');
  y += headLines.length * headLineH + 6;

  // Accent rule under the headline.
  const rule = `<rect x="56" y="${y}" width="120" height="7" rx="3" fill="${accent}"/>`;
  y += 44;

  // Summary: a real wrapped paragraph (key content, longer than a one-liner but not the full article).
  const sumLineH = 50;
  const maxLines = Math.max(1, Math.floor((CARD_H - 56 - y) / sumLineH)); // fit above the footer
  const allSum = wrap(summary || '', 27, 54);
  const sumLines = allSum.slice(0, maxLines);
  if (allSum.length > maxLines && sumLines.length) sumLines[sumLines.length - 1] = sumLines[sumLines.length - 1].replace(/[\s.,·]*$/, '') + '…';
  const sumEls = sumLines.map((l, i) =>
    `<text x="56" y="${y + i * sumLineH}" font-family="${FONT}" font-size="35" font-weight="500" fill="#D7DEEC">${esc(l)}</text>`).join('\n');

  return `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="ts"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="rgba(0,0,0,0.8)"/></filter></defs>
    ${headEls}
    ${rule}
    ${sumEls}
    <rect x="0" y="${CARD_H - 10}" width="${CARD_W}" height="10" fill="${accent}"/>
  </svg>`;
}

// opts: { sportKey, sportLabel?, date, headline, summary, comicBuffer }
export async function renderComicCard({ sportKey, sportLabel, date = '', headline, summary = '', comicBuffer }) {
  const s = sportOf(sportKey);
  const label = sportLabel || s.label;

  // Comic panel geometry: scale the cartoon to the panel WIDTH and keep its full height — NO
  // cropping (the image was generated at the panel's 21:9 ratio). PH follows the image's real
  // height so nothing in the scene is cut off.
  const PX = 40, PY = 142, PW = CARD_W - PX * 2; // width 1000
  const panel = await sharp(comicBuffer)
    .resize({ width: PW, fit: 'inside', withoutEnlargement: false })
    .png().toBuffer();
  const PH = (await sharp(panel).metadata()).height; // ~437 for a 21:9 source
  // Rounded white comic frame around the panel.
  const frame = Buffer.from(
    `<svg width="${PW + 16}" height="${PH + 16}" xmlns="http://www.w3.org/2000/svg">
       <rect x="2" y="2" width="${PW + 12}" height="${PH + 12}" rx="26" fill="none" stroke="#ffffff" stroke-width="6"/>
     </svg>`);

  const textTop = PY + PH + 14; // text region starts just below the comic panel
  const bg = await sharp(Buffer.from(backgroundSvg(s.accent, label, s.emoji, date))).png().toBuffer();
  const buffer = await sharp(bg)
    .composite([
      { input: panel, top: PY, left: PX },
      { input: frame, top: PY - 8, left: PX - 8 },
      { input: Buffer.from(textSvg({ accent: s.accent, headline, summary, textTop })), top: 0, left: 0 },
    ])
    .png().toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, format: meta.format };
}
