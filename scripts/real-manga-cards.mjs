// END-TO-END (real data → final format): pull real sports news, synthesize 2+ sources, then render
// each story as a manga-page card (shonen, 2컷, no kanji, longer summary). This is the locked format.
//   node scripts/real-manga-cards.mjs            # up to 3 cards
//   MAX_CARDS=5 node scripts/real-manga-cards.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDiscover } from '../pipeline/discover.mjs';
import { clusterEvents } from '../pipeline/cluster.mjs';
import { synthesizeEvent } from '../pipeline/synthesize.mjs';
import { liveFulltext } from '../lib/fulltext.mjs';
import { geminiLLM } from '../lib/llm/gemini.mjs';
import { deriveTwoBeats, mangaPageTwoCutPrompt, generateComicImage } from '../lib/img/comic_card.mjs';
import { layoutMangaPage } from '../lib/img/card_layouts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'real-manga');
mkdirSync(OUT, { recursive: true });
const MAX_CARDS = Number(process.env.MAX_CARDS || 3);
const MIN_SOURCES = 2;
const SPORT_LABEL = { football: '축구', baseball: '야구', basketball: '농구' };
const ACCENT = '#E4002B';
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36);
const today = (process.env.SNB_NOW || new Date().toISOString()).slice(0, 10).replace(/-/g, '.');

if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
const llm = geminiLLM();
const fulltext = liveFulltext();

console.log('1) discover (real RSS) + tag …');
const raw = await liveDiscover(process.env, llm).discover();
console.log(`   ${raw.length} items`);

console.log('2) cluster + pick multi-source events …');
const events = clusterEvents(raw, { bucketHours: 24 });
const multi = events
  .map((ev) => ({ ev, outlets: new Set(ev.sources.map((s) => (s.outlet || '').toLowerCase())) }))
  .filter((x) => x.outlets.size >= MIN_SOURCES)
  .sort((a, b) => b.outlets.size - a.outlets.size || b.ev.sources.length - a.ev.sources.length)
  .map((x) => x.ev);
console.log(`   ${multi.length} multi-source events`);
if (!multi.length) { console.error('No multi-source events right now.'); process.exit(2); }

const cards = [];
for (const ev of multi) {
  if (cards.length >= MAX_CARDS) break;
  const outlets = [...new Set(ev.sources.map((s) => s.outlet))];
  console.log(`\n▶ [${ev.sportKey}] ${ev.sources[0].title}  (${outlets.join(', ')})`);

  for (const s of ev.sources) { const ft = await fulltext.get(s.url).catch(() => null); if (ft) s.text = ft; }

  let result;
  try { result = await synthesizeEvent({ event: ev, llm, minSources: MIN_SOURCES }); }
  catch (e) { console.log(`   ⚠ synth error: ${e.message}`); continue; }
  if (result.ineligible) { console.log(`   ⊘ ineligible: ${result.reason}`); continue; }
  const article = result.article;

  const { headline, summary } = await llm.comicCard({ article, lang: 'ko' });
  console.log(`   ✎ ${headline}  [${ev.eventType}]`);

  // two key beats (article-type aware) → 2-cut manga page (21:9 side-by-side panels)
  const { beat1, beat2 } = await deriveTwoBeats({ sportKey: ev.sportKey, headline, summary, eventType: ev.eventType });
  console.log(`   🎬 컷1: ${beat1.slice(0, 60)}… | 컷2: ${beat2.slice(0, 60)}…`);
  const { buffer: page, source } = await generateComicImage(mangaPageTwoCutPrompt({ beat1, beat2 }), process.env, { aspectRatio: '21:9' });
  console.log(`   🖼️ ${source}`);

  const card = await layoutMangaPage({ pageBuffer: page, headline, summary, date: today, sportLabel: SPORT_LABEL[ev.sportKey], accent: ACCENT });
  const file = path.join(OUT, `${cards.length + 1}-${ev.sportKey}-${slug(headline)}.png`);
  writeFileSync(file, card.buffer);
  console.log(`   ✅ ${file}`);
  cards.push({ file, headline, summary, sportKey: ev.sportKey, outlets, sources: ev.sources.map((s) => s.url) });
}

writeFileSync(path.join(OUT, 'index.md'),
  [`# Real manga-page cards — ${today}`, '',
    ...cards.map((c, i) => [
      `## ${i + 1}. [${SPORT_LABEL[c.sportKey]}] ${c.headline}`,
      `![card](${path.basename(c.file)})`,
      `- **요약:** ${c.summary}`,
      `- **출처(${c.outlets.length}):** ${c.outlets.join(', ')}`,
      `- 링크: ${c.sources.join(' · ')}`, '',
    ].join('\n'))].join('\n'));
console.log(`\n=== ${cards.length} manga-page card(s) -> ${OUT} ===`);
