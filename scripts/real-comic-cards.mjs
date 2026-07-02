// END-TO-END (real data): pull today's real sports news off the RSS feeds, cluster same-event
// reports, synthesize 2+ sources into one original article, then render a COMIC CARD per story.
// Follows the pipeline stages (discover → tag → cluster → fulltext-enrich → synthesize → card),
// powered entirely by GEMINI_API_KEY. Writes out/real/*.png + out/real/index.md.
//
//   node scripts/real-comic-cards.mjs            # default: up to 3 cards
//   MAX_CARDS=5 node scripts/real-comic-cards.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDiscover } from '../pipeline/discover.mjs';
import { clusterEvents } from '../pipeline/cluster.mjs';
import { synthesizeEvent } from '../pipeline/synthesize.mjs';
import { liveFulltext } from '../lib/fulltext.mjs';
import { geminiLLM } from '../lib/llm/gemini.mjs';
import { deriveComicScene, comicPrompt, generateComicImage, renderComicCard } from '../lib/img/comic_card.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'real');
mkdirSync(OUT, { recursive: true });
const MAX_CARDS = Number(process.env.MAX_CARDS || 3);
const MIN_SOURCES = 2;
const SPORT_LABEL = { football: '축구', baseball: '야구', basketball: '농구' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const today = (process.env.SNB_NOW || new Date().toISOString()).slice(0, 10).replace(/-/g, '.');

if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
const llm = geminiLLM();
const fulltext = liveFulltext();

console.log('1) discover (real RSS feeds) + entity tagging…');
const raw = await liveDiscover(process.env, llm).discover();
console.log(`   ${raw.length} items across feeds`);

console.log('2) cluster same-event reports…');
const events = clusterEvents(raw, { bucketHours: 24 });
// Keep events with >= 2 DISTINCT outlets (the multi-source requirement = "조합").
const multi = events
  .map((ev) => ({ ev, outlets: new Set(ev.sources.map((s) => (s.outlet || '').toLowerCase())) }))
  .filter((x) => x.outlets.size >= MIN_SOURCES)
  .sort((a, b) => b.outlets.size - a.outlets.size || b.ev.sources.length - a.ev.sources.length)
  .map((x) => x.ev);
console.log(`   ${events.length} clusters, ${multi.length} multi-source (>= ${MIN_SOURCES} outlets)`);
if (!multi.length) { console.error('No multi-source events today — try again later or widen recencyHours.'); process.exit(2); }

const cards = [];
for (const ev of multi) {
  if (cards.length >= MAX_CARDS) break;
  const outlets = [...new Set(ev.sources.map((s) => s.outlet))];
  console.log(`\n▶ [${ev.sportKey}] ${ev.sources[0].title}`);
  console.log(`   sources: ${outlets.join(', ')}`);

  // 3) enrich each source with full text (robots-gated) so synthesis has more real facts.
  for (const s of ev.sources) {
    const ft = await fulltext.get(s.url).catch(() => null);
    if (ft) s.text = ft;
  }

  // 4) synthesize 2+ sources -> one original KO+EN article.
  let result;
  try { result = await synthesizeEvent({ event: ev, llm, minSources: MIN_SOURCES }); }
  catch (e) { console.log(`   ⚠ synth error: ${e.message}`); continue; }
  if (result.ineligible) { console.log(`   ⊘ ineligible: ${result.reason}`); continue; }
  const article = result.article;
  console.log(`   ✎ KO: ${article.titleKo}`);

  // 5) card text (headline + key-content summary, KO).
  const { headline, summary } = await llm.comicCard({ article, lang: 'ko' });

  // 6) comic scene FROM the article -> cartoon -> composite card.
  const scene = await deriveComicScene({ sportKey: ev.sportKey, headline, summary });
  console.log(`   🎬 scene: ${scene.slice(0, 90)}…`);
  const { buffer: comic, source } = await generateComicImage(comicPrompt({ sportKey: ev.sportKey, scene }));
  console.log(`   🖼️ cartoon: ${source}`);
  const card = await renderComicCard({ sportKey: ev.sportKey, sportLabel: SPORT_LABEL[ev.sportKey], date: today, headline, summary, comicBuffer: comic });

  const name = `${cards.length + 1}-${ev.sportKey}-${slug(headline)}`;
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, card.buffer);
  console.log(`   ✅ ${file}`);
  cards.push({ name, file, headline, summary, sportKey: ev.sportKey, outlets, titleKo: article.titleKo, sources: ev.sources.map((s) => s.url) });
}

// index for review
const md = ['# Real comic cards — ' + today, '',
  ...cards.map((c, i) => [
    `## ${i + 1}. [${SPORT_LABEL[c.sportKey]}] ${c.headline}`,
    `![card](${path.basename(c.file)})`,
    `- **요약:** ${c.summary}`,
    `- **출처(${c.outlets.length} 매체):** ${c.outlets.join(', ')}`,
    `- 원기사 링크: ${c.sources.join(' · ')}`, '',
  ].join('\n'))].join('\n');
writeFileSync(path.join(OUT, 'index.md'), md);
console.log(`\n=== ${cards.length} comic card(s) written to ${OUT} ===`);
