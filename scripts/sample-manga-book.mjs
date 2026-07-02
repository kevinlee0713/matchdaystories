// Manga-book sampler: push the card toward an authentic Japanese manga-page look.
// Generates (a) a multi-panel B&W manga PAGE (4:3) and (b) a single dramatic panel (21:9),
// then renders 3 manga-book layouts. Writes out/manga/*.png + index.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMIC_STYLES, comicPrompt, generateComicImage } from '../lib/img/comic_card.mjs';
import { layoutMangaPage, layoutMangaSplash, layoutMangaFurniture } from '../lib/img/card_layouts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'manga');
mkdirSync(OUT, { recursive: true });

const article = {
  sportKey: 'football', sportLabel: '축구', sportEmoji: '⚽', date: '2026.06.29',
  headline: '캐나다, 월드컵 16강 진출!',
  summary: '캐나다가 남아공을 꺾고 월드컵 사상 첫 16강에 올랐다. 후반 추가시간 유스타키오의 극장골이 결승골이 됐다.',
  scene: 'soccer players in plain kits at the climax of a dramatic last-minute World Cup goal on a rain-soaked pitch — one player sliding on his knees with both arms raised in triumph, teammates rushing in to celebrate, the beaten goalkeeper on the ground by the net, stadium floodlights',
  accent: '#E4002B',
};

// A multi-panel manga PAGE prompt (the strongest "manga book" signal).
const mangaPagePrompt = (scene) =>
  `An authentic black-and-white Japanese shonen MANGA PAGE composed of 3 to 4 dynamic panels of ` +
  `varying sizes separated by clean white gutters, telling this moment in sequence: ${scene}. ` +
  `${COMIC_STYLES.shonen} Heavy screentone shading, dramatic camera angles, foreshortening, focus ` +
  `lines and speed lines, big impactful close-up plus wide panels. Generic anonymous athletes — NO ` +
  `real faces, NO team logos. Do NOT render any readable text, letters, numbers, or speech bubbles ` +
  `(leave all captions/bubbles empty). It must clearly look like a page torn from a manga book.`;

console.log('1) generating multi-panel manga PAGE (4:3)…');
const page = await generateComicImage(mangaPagePrompt(article.scene), process.env, { aspectRatio: '4:3' });
console.log('   ', page.source);
writeFileSync(path.join(OUT, '_page-4x3.png'), page.buffer);

console.log('2) generating single dramatic panel (21:9)…');
const panel = await generateComicImage(comicPrompt({ sportKey: article.sportKey, scene: article.scene, style: 'shonen' }));
console.log('   ', panel.source);
writeFileSync(path.join(OUT, '_panel-21x9.png'), panel.buffer);

const jobs = [
  ['manga-page', () => layoutMangaPage({ pageBuffer: page.buffer, ...article })],
  ['manga-splash', () => layoutMangaSplash({ comicBuffer: panel.buffer, ...article })],
  ['manga-furniture', () => layoutMangaFurniture({ comicBuffer: panel.buffer, ...article })],
];
const done = [];
for (const [name, fn] of jobs) {
  process.stdout.write(`▶ ${name} … `);
  const card = await fn();
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, card.buffer);
  console.log(`✅ ${card.width}x${card.height}`);
  done.push({ name, file });
}
writeFileSync(path.join(OUT, 'index.md'),
  ['# Manga-book layout samples (shonen)', '', ...done.map((d) => `## ${d.name}\n![${d.name}](${path.basename(d.file)})\n`)].join('\n'));
console.log(`\n=== ${done.length} manga-book card(s) -> ${OUT} ===`);
