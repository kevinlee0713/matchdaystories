// Real-athlete LIKENESS support for the 4-cut card. Image models can't reproduce a specific
// person from a NAME alone (esp. Korean-league players), but they CAN when given a reference
// PHOTO (image-to-image). This module (1) decides whether a story has a single protagonist and
// who it is, then (2) fetches a clean portrait of that person from free-licensed sources
// (Wikipedia REST → Wikidata P18). The photo is fed to Gemini as a reference so the manga
// protagonist RESEMBLES the real athlete. Team/multi-person stories → no photo → generic art.
import sharp from 'sharp';

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const cache = new Map(); // athlete name -> Buffer | null (null = looked up, no photo)

// B) Who is the SINGLE main athlete this story centers on? Returns { name, single }.
// name is null when the story is about a team / match / several people equally (→ generic art).
export async function primaryAthlete({ headline, summary = '', sportKey }, env = process.env) {
  const key = env.GEMINI_API_KEY;
  if (!key) return { name: null, single: false };
  const prompt =
    `From this ${sportKey || 'sports'} news, identify the SINGLE main athlete (one person) the story ` +
    `centers on. If it is about a team, a match between teams, or several people equally with no single ` +
    `protagonist, answer NONE. Give the person's REAL full name as commonly written (Korean players in ` +
    `Hangul). Reply with ONLY the name or NONE — no other words.\n\nHeadline: ${headline}\nSummary: ${summary}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const j = await res.json();
    const t = (j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
    if (!t || /^none\b/i.test(t) || t.length > 40) return { name: null, single: false };
    return { name: t.replace(/["'.]/g, '').trim(), single: true };
  } catch { return { name: null, single: false }; }
}

// A) Portrait URL: Wikipedia REST summary (ko→en) then Wikidata P18 (image claim) via label search.
async function portraitUrl(name) {
  for (const lang of ['ko', 'en']) {
    try {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
      if (!res.ok) continue;
      const j = await res.json();
      const src = j.originalimage?.source || j.thumbnail?.source;
      if (src) return src;
    } catch { /* try next lang */ }
  }
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

async function downloadPortrait(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'SportsNewsBlog/0.2 (+manga likeness reference)' } });
    if (!r.ok) return null;
    return await sharp(Buffer.from(await r.arrayBuffer())).resize(768, 768, { fit: 'inside' }).png().toBuffer();
  } catch { return null; }
}

// Resolve a reference portrait for the story's protagonist. Returns { buf, name } or null (→ generic art).
// Cached per name so repeated athletes across a run cost one lookup. Fail-soft everywhere.
export async function resolveAthletePhoto({ article, event }, env = process.env) {
  const headline = article.titleKo || article.titleEn || '';
  const summary = (article.bodyKo || article.bodyEn || '').replace(/\s+/g, ' ').slice(0, 300);
  const { name, single } = await primaryAthlete({ headline, summary, sportKey: article.sport }, env);
  if (!single || !name) return null;
  if (cache.has(name)) { const buf = cache.get(name); return buf ? { buf, name } : null; }
  const url = await portraitUrl(name);
  const buf = url ? await downloadPortrait(url) : null;
  cache.set(name, buf);
  return buf ? { buf, name } : null;
}
