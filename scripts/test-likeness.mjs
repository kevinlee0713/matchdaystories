// PROTOTYPE — prove real-athlete likeness via reference-photo image-to-image.
// Baseline (text-only) vs reference-photo (image->image) so we can eyeball whether feeding
// a real photo makes the manga character recognizable. Photo source here = Wikipedia summary
// image (free-licensed) just for the test; the real pipeline will use the news article's own
// lead photo. Usage: node --env-file-if-exists=.env scripts/test-likeness.mjs [name...]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(process.cwd(), 'out', 'likeness');
fs.mkdirSync(OUT, { recursive: true });
const KEY = process.env.GEMINI_API_KEY;
const IMG_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
if (!KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['고우석', '류현진'];

async function wikiPhoto(name) {
  // 1) Wikipedia REST summary (ko then en) — clean lead portrait when the page has one.
  for (const lang of ['ko', 'en']) {
    try {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (!res.ok) continue;
      const j = await res.json();
      const src = j.originalimage?.source || j.thumbnail?.source;
      if (src) return src;
    } catch { /* try next lang */ }
  }
  // 2) Wikidata P18 (image) via the label — catches athletes whose wiki page lacks an infobox photo.
  for (const lang of ['ko', 'en']) {
    try {
      const s = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json&type=item&limit=1&origin=*`);
      const sj = await s.json();
      const id = sj?.search?.[0]?.id;
      if (!id) continue;
      const e = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${id}&property=P18&format=json&origin=*`);
      const ej = await e.json();
      const file = ej?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (file) return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=768`;
    } catch { /* try next */ }
  }
  return null;
}

async function genFromText(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { imageConfig: { aspectRatio: '1:1' } } }),
  });
  if (!res.ok) throw new Error(`text-gen ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = await res.json();
  const img = (j?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!img) throw new Error('no image part (text)');
  return sharp(Buffer.from(img.inlineData.data, 'base64')).png().toBuffer();
}

async function genFromPhoto(photoBuf, instruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMG_MODEL}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: 'image/png', data: photoBuf.toString('base64') } },
        { text: instruction },
      ] }],
      generationConfig: { imageConfig: { aspectRatio: '1:1' } },
    }),
  });
  if (!res.ok) throw new Error(`photo-gen ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = await res.json();
  const img = (j?.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!img) throw new Error('no image part (photo)');
  return sharp(Buffer.from(img.inlineData.data, 'base64')).png().toBuffer();
}

const SCENE = 'a baseball player in uniform, dynamic pitching pose, stadium background';
const MANGA = 'black-and-white Japanese shonen manga style, bold ink line art, screentone shading, high contrast';
const textPrompt = (name) => `A ${MANGA} illustration of ${name}, a Korean professional baseball player. ${SCENE}. Single character, portrait framing.`;
const photoPrompt = `Redraw the person in this photograph as a ${MANGA} character. CRITICAL: preserve their real facial likeness — face shape, eyes, nose, eyebrows, jawline, and hairstyle — so viewers recognize the SAME person. ${SCENE}.`;

for (const name of names) {
  console.log(`\n=== ${name} ===`);
  const photoUrl = await wikiPhoto(name);
  console.log('  wiki photo:', photoUrl || '(none)');

  // baseline: text-only
  try {
    const b = await genFromText(textPrompt(name));
    const bp = path.join(OUT, `${name}_A_textonly.png`);
    fs.writeFileSync(bp, b);
    console.log('  ✅ text-only  →', bp);
  } catch (e) { console.log('  ❌ text-only:', e.message); }

  // reference-photo: image->image
  if (photoUrl) {
    try {
      const pr = await fetch(photoUrl);
      const photoBuf = await sharp(Buffer.from(await pr.arrayBuffer())).resize(768, 768, { fit: 'inside' }).png().toBuffer();
      fs.writeFileSync(path.join(OUT, `${name}_0_photo.png`), photoBuf);
      const c = await genFromPhoto(photoBuf, photoPrompt);
      const cp = path.join(OUT, `${name}_B_fromphoto.png`);
      fs.writeFileSync(cp, c);
      console.log('  ✅ from-photo →', cp);
    } catch (e) { console.log('  ❌ from-photo:', e.message); }
  } else {
    console.log('  ⏭ no wiki photo — skipping reference-photo test');
  }
}
console.log(`\nDone. Compare *_A_textonly vs *_B_fromphoto (and *_0_photo original) in ${OUT}`);
