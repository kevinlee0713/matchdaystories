// Refined manga-page sampler: 2-panel (2컷) B&W manga page showing the article's TWO most important
// moments, NO kanji, a longer summary. Generates a few variants to pick from.
// Writes out/manga-page/*.png + index.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMIC_STYLES, generateComicImage } from '../lib/img/comic_card.mjs';
import { layoutMangaPage } from '../lib/img/card_layouts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'manga-page');
mkdirSync(OUT, { recursive: true });

const article = {
  sportKey: 'football', sportLabel: '축구', date: '2026.06.29',
  headline: '캐나다, 월드컵 16강 진출!',
  // longer summary (key content, ~3 sentences)
  summary: '캐나다가 남아공을 1-0으로 꺾고 월드컵 본선 사상 첫 16강 진출을 확정했다. ' +
    '0-0으로 팽팽하던 균형은 후반 추가시간 유스타키오의 극장골 한 방으로 깨졌다. ' +
    '캐나다는 조 2위로 토너먼트에 올라 다음 라운드에서 강호와 격돌한다.',
  accent: '#E4002B',
};

// The TWO most important beats of the story → exactly two panels.
const beat1 = 'a striker firing the ball past the diving goalkeeper into the net for a dramatic last-minute goal, rain falling, stadium floodlights';
const beat2 = 'the players erupting in celebration of qualifying — one sliding on his knees with both arms raised in triumph, teammates piling in';

const pagePrompt =
  `An authentic black-and-white Japanese shonen MANGA PAGE with EXACTLY TWO panels of similar size ` +
  `arranged SIDE BY SIDE, separated by a clean vertical white gutter. ` +
  `LEFT panel: ${beat1}. RIGHT panel: ${beat2}. ` +
  `${COMIC_STYLES.shonen} Heavy screentone shading, dramatic angles, foreshortening, speed lines and ` +
  `focus lines for impact. Generic anonymous athletes — NO real faces, NO team logos. ` +
  `Render NO readable text, NO letters, NO numbers, NO speech bubbles (leave the art clean). ` +
  `It must clearly look like two panels from a manga book.`;

const N = Number(process.argv[2] || 3);
const done = [];
for (let i = 1; i <= N; i++) {
  process.stdout.write(`▶ variant ${i}/${N} — generating 2-panel page … `);
  const page = await generateComicImage(pagePrompt, process.env, { aspectRatio: '21:9' });
  writeFileSync(path.join(OUT, `_page-${i}.png`), page.buffer);
  const card = await layoutMangaPage({ pageBuffer: page.buffer, ...article });
  const file = path.join(OUT, `manga-page-${i}.png`);
  writeFileSync(file, card.buffer);
  console.log(`✅ ${page.source}`);
  done.push({ i, file });
}
writeFileSync(path.join(OUT, 'index.md'),
  ['# Refined manga-page (2컷, no kanji, longer summary)', '',
    ...done.map((d) => `## variant ${d.i}\n![v${d.i}](${path.basename(d.file)})\n`)].join('\n'));
console.log(`\n=== ${done.length} variant(s) -> ${OUT} ===`);
