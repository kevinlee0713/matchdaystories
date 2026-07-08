// Sample: 4-cut story manga card (Instagram 1080x1350) with Korean speech bubbles + manga-title.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deriveFourBeats, fourCutPrompt, renderFourCutCard } from '../lib/img/fourcut.mjs';
import { generateComicImage } from '../lib/img/comic_card.mjs';

mkdirSync('out/4cut', { recursive: true });
const article = {
  sportKey: 'football', date: '2026.07.06', eventType: 'match_result',
  headline: '캐나다, 월드컵 첫 16강 진출',
  summary: '캐나다가 남아공을 1-0으로 꺾고 월드컵 본선 사상 첫 16강에 올랐다. 후반 추가시간 유스타키오의 극장골이 결승골이 됐다.',
};

console.log('1) deriving 4-beat story…');
const beats = await deriveFourBeats(article);
beats.forEach((b, i) => console.log(`  컷${i + 1}: "${b.dialogue}" — ${b.scene.slice(0, 60)}`));

console.log('2) generating 4-panel art (no text)…');
const { buffer: art, source } = await generateComicImage(fourCutPrompt(beats), process.env, { aspectRatio: '1:1' });
console.log('  art:', source);

console.log('3) composing card…');
const card = await renderFourCutCard({
  sportKey: article.sportKey, date: article.date, headline: article.headline,
  mangaBuffer: art, dialogues: beats.map((b) => b.dialogue),
});
writeFileSync('out/4cut/sample-4cut-card.png', card.buffer);
console.log(`  ✅ out/4cut/sample-4cut-card.png  ${card.width}x${card.height}`);
