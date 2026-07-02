// Layout sampler: generate ONE shonen comic image, then render it in every LAYOUT so you can
// compare composition/typography only (same image, same text). Writes out/layouts/*.png + index.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comicPrompt, generateComicImage } from '../lib/img/comic_card.mjs';
import { LAYOUTS } from '../lib/img/card_layouts.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'layouts');
mkdirSync(OUT, { recursive: true });

const article = {
  sportKey: 'football', sportLabel: '축구', sportEmoji: '⚽', date: '2026.06.29',
  headline: '캐나다, 월드컵 16강 진출!',
  summary: '캐나다가 남아공을 꺾고 월드컵 사상 첫 16강에 올랐다. 후반 추가시간 유스타키오의 극장골이 결승골이 됐다.',
  scene: 'three soccer players in plain kits celebrating a dramatic last-minute goal on a rain-soaked pitch, one sliding on his knees with both arms raised in triumph, the beaten goalkeeper on the ground by the net behind them, stadium floodlights glowing',
  accent: '#E4002B', // shonen energy
};

console.log('generating ONE shonen comic image (reused across all layouts)…');
const { buffer: comicBuffer, source } = await generateComicImage(comicPrompt({ sportKey: article.sportKey, scene: article.scene, style: 'shonen' }));
console.log('  cartoon:', source);
writeFileSync(path.join(OUT, '_shared-panel.png'), comicBuffer);

const done = [];
for (const [name, fn] of Object.entries(LAYOUTS)) {
  process.stdout.write(`▶ ${name} … `);
  const card = await fn({ comicBuffer, ...article });
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, card.buffer);
  console.log(`✅ ${card.width}x${card.height}`);
  done.push({ name, file });
}

const md = ['# Card layout samples (same shonen image + text, layout only changes)', '',
  ...done.map((d) => `## ${d.name}\n![${d.name}](${path.basename(d.file)})\n`)].join('\n');
writeFileSync(path.join(OUT, 'index.md'), md);
console.log(`\n=== ${done.length} layout(s) -> ${OUT} ===`);
