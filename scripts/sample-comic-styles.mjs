// Style sampler: render the SAME article + SAME scene in several art styles so you can pick one.
// Only the art style changes between cards. Writes out/styles/<style>.png + out/styles/index.md.
//   node scripts/sample-comic-styles.mjs            # all presets
//   node scripts/sample-comic-styles.mjs webtoon shonen flat   # a subset
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMIC_STYLES, comicPrompt, generateComicImage, renderComicCard } from '../lib/img/comic_card.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'styles');
mkdirSync(OUT, { recursive: true });

// Fixed sample (same story for every style) — a clear, dynamic football scene.
const article = {
  sportKey: 'football',
  date: '2026.06.29',
  headline: '캐나다, 월드컵 16강 진출!',
  summary: '캐나다가 남아공을 꺾고 월드컵 사상 첫 16강에 올랐다. 후반 추가시간 유스타키오의 극장골이 결승골이 됐다.',
  scene: 'three soccer players in plain kits celebrating a dramatic last-minute goal on a rain-soaked pitch, one sliding on his knees with both arms raised in triumph, the beaten goalkeeper on the ground by the net behind them, stadium floodlights glowing',
};

const styles = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(COMIC_STYLES);
console.log(`rendering ${styles.length} style(s): ${styles.join(', ')}\n`);

const done = [];
for (const style of styles) {
  if (!COMIC_STYLES[style]) { console.log(`⚠ unknown style "${style}" — skipping`); continue; }
  process.stdout.write(`▶ ${style} … `);
  const { buffer: comic, source } = await generateComicImage(comicPrompt({ sportKey: article.sportKey, scene: article.scene, style }));
  const card = await renderComicCard({
    sportKey: article.sportKey, date: article.date, headline: article.headline, summary: article.summary, comicBuffer: comic,
  });
  const file = path.join(OUT, `${style}.png`);
  writeFileSync(file, card.buffer);
  console.log(source.startsWith('placeholder') ? `(${source})` : '✅');
  done.push({ style, file });
}

const md = ['# Comic style samples (same story, style only changes)', '',
  ...done.map((d) => `## ${d.style}\n${COMIC_STYLES[d.style]}\n\n![${d.style}](${path.basename(d.file)})\n`)].join('\n');
writeFileSync(path.join(OUT, 'index.md'), md);
console.log(`\n=== ${done.length} style card(s) -> ${OUT} ===`);
