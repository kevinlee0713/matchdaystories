// Verify per-panel generation + per-panel quality guard on cases that previously produced empty/cropped
// panels. Uses the real integrated path (liveCardImage.fourCut) and renders the final card to eyeball.
import fs from 'node:fs';
import path from 'node:path';
import { liveCardImage } from '../lib/img/card_image.mjs';
import { renderFourCutCard } from '../lib/img/fourcut.mjs';

const OUT = path.join(process.cwd(), 'out', 'likeness');
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  { sport: 'baseball', slug: 'ijh', titleKo: '이정후, 대수비 출전해 결승 2루타!',
    bodyKo: '이정후가 대수비로 경기에 나서 8회 우중간을 가르는 결승 2루타를 터뜨렸다. 벤치에서 기회를 기다리던 그는 교체 투입되자마자 2루타로 팀 승리를 이끌었다. 2루에서 두 팔을 들어올리며 포효했다.' },
  { sport: 'football', slug: 'shm', titleKo: '손흥민 극장 결승골, 토트넘 역전승',
    bodyKo: '손흥민이 후반 추가시간 왼발 감아차기 결승골을 터뜨리며 팀의 2-1 역전승을 이끌었다. 페널티 박스 외곽에서 수비수 두 명을 제치고 때린 슛이 골망 구석을 갈랐다.' },
];

for (const c of cases) {
  console.log(`\n=== ${c.titleKo} ===`);
  const t0 = process.hrtime.bigint();
  const { art, likeness } = await liveCardImage(process.env).fourCut({ article: c, event: { eventType: 'other' } });
  console.log('  likeness:', likeness || '(generic)');
  const card = await renderFourCutCard({ sportKey: c.sport, date: '2026.07.10', headline: c.titleKo, mangaBuffer: art });
  const p = path.join(OUT, `card_pp_${c.slug}.png`);
  fs.writeFileSync(p, card.buffer);
  console.log(`  ✅ ${card.width}x${card.height} in ${Number((process.hrtime.bigint() - t0) / 1000000n)}ms → ${p}`);
}
