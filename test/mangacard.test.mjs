// Card integration guard: the 4-cut story card must always produce a Telegram-valid 1080x1350 PNG,
// and the headline must pass glyph-smoke (the font-missing/tofu regression class).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFourCutCard } from '../lib/img/fourcut.mjs';
import { mockCardImage } from '../lib/img/card_image.mjs';
import { glyphSmoke } from '../lib/img/glyph_smoke.mjs';

test('4-cut card renders a valid 1080x1350 PNG from (placeholder) art + Korean bubbles', async () => {
  const { art, dialogues } = await mockCardImage().fourCut();
  const card = await renderFourCutCard({
    sportKey: 'football', sportLabel: '축구', date: '2026.07.06',
    headline: '캐나다, 월드컵 첫 16강 진출', mangaBuffer: art, dialogues, accent: '#E4002B',
  });
  assert.equal(card.format, 'png');
  assert.equal(card.width, 1080);
  assert.equal(card.height, 1350);
  assert.ok(card.buffer.length > 1000, 'non-trivial PNG buffer');
});

test('glyph-smoke passes for a Korean headline (fonts present)', async () => {
  const smoke = await glyphSmoke('캐나다, 월드컵 첫 16강 진출');
  assert.ok(smoke.ok, smoke.reason);
});
