// Glyph smoke test — detects the "fonts not installed -> nothing/tofu rendered" regression
// class before any Telegram sendPhoto. Runs ON the CI runner where fonts live.
// Mechanism: rasterize the title-only (transparent bg) layer and count opaque pixels.
// A totally-missing font renders (near-)zero opaque pixels -> FAIL (block sendPhoto).
import sharp from 'sharp';
import { titleLayerSvg } from './cardnews.mjs';

// Heuristic floor: expect at least this many opaque pixels per visible character.
const PIXELS_PER_CHAR_FLOOR = 30;

export async function glyphSmoke(title) {
  const visibleChars = String(title).replace(/\s+/g, '').length;
  const floor = Math.max(60, visibleChars * PIXELS_PER_CHAR_FLOOR);
  try {
    const svg = titleLayerSvg(title);
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    let opaque = 0;
    for (let i = 0; i < data.length; i += channels) {
      const alpha = data[i + channels - 1];
      if (alpha > 16) opaque++;
    }
    const ok = opaque >= floor;
    return {
      ok,
      opaquePixels: opaque,
      floor,
      reason: ok ? 'glyphs rendered' : `only ${opaque} opaque px (< floor ${floor}) — font likely missing/tofu`,
    };
  } catch (e) {
    return { ok: false, opaquePixels: 0, floor, reason: `render error: ${e.message}` };
  }
}
