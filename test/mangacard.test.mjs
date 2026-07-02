// Manga-page card integration guard: the card layout must always produce a Telegram-valid
// 1080x1080 PNG, and the headline must pass glyph-smoke (the font-missing/tofu regression class).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMangaPage } from '../lib/img/card_layouts.mjs';
import { mockCardImage } from '../lib/img/card_image.mjs';
import { glyphSmoke } from '../lib/img/glyph_smoke.mjs';

test('manga-page renders a valid 1080x1080 PNG from a (placeholder) 2-cut page', async () => {
  const pageBuffer = await mockCardImage().page();
  const card = await layoutMangaPage({
    pageBuffer,
    headline: '캐나다, 월드컵 16강 진출!',
    summary: '캐나다가 남아공을 1-0으로 꺾고 월드컵 사상 첫 16강에 올랐다. 후반 추가시간 극장골이 결승골이 됐다.',
    date: '2026.06.29', sportLabel: '축구', accent: '#E4002B',
  });
  assert.equal(card.format, 'png');
  assert.equal(card.width, 1080);
  assert.equal(card.height, 1080);
  assert.ok(card.buffer.length > 1000, 'non-trivial PNG buffer');
});

test('glyph-smoke passes for a Korean manga headline (fonts present)', async () => {
  const smoke = await glyphSmoke('캐나다, 월드컵 16강 진출!');
  assert.ok(smoke.ok, smoke.reason);
});
