// Sample: turn ONE fixture article into a single comic card image.
// Usage: node scripts/sample-comic-card.mjs   (needs GEMINI_API_KEY for the real cartoon;
// falls back to a placeholder panel otherwise). Writes out/sample-comic-card.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { comicPrompt, deriveComicScene, generateComicImage, renderComicCard } from '../lib/img/comic_card.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
mkdirSync(OUT, { recursive: true });

// Sample article (football transfer, KO) — facts come pre-verified from the synth/fact-gate stage.
// summary = key content of the story (longer than a one-liner, shorter than the full article body).
const article = {
  sportKey: 'football',
  date: '2026.06.29',
  headline: '브라질 미드필더, 8천만 유로 이적 합의',
  summary:
    '유럽 명문 구단이 브라질 국가대표 미드필더 영입에 이적료 8천만 유로로 최종 합의했다. ' +
    '양측은 계약 조건에 서명했고, 메디컬 테스트가 이번 주 안에 진행될 예정이다.',
};

console.log('1) deriving comic scene from the article…');
const scene = await deriveComicScene({ sportKey: article.sportKey, headline: article.headline, summary: article.summary });
console.log('   scene:', scene);

console.log('2) generating cartoon via Gemini…');
const prompt = comicPrompt({ sportKey: article.sportKey, scene });
const { buffer: comicBuffer, source } = await generateComicImage(prompt);
console.log('   cartoon source:', source, `(${comicBuffer.length} bytes)`);
writeFileSync(path.join(OUT, 'sample-comic-panel.png'), comicBuffer);

console.log('3) compositing card…');
const card = await renderComicCard({
  sportKey: article.sportKey,
  date: article.date,
  headline: article.headline,
  summary: article.summary,
  comicBuffer,
});
const outPath = path.join(OUT, 'sample-comic-card.png');
writeFileSync(outPath, card.buffer);
console.log(`   ✅ ${outPath}  ${card.width}x${card.height} ${card.format}`);
