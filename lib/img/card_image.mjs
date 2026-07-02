// Injectable manga-page IMAGE source. Produces the wordless 2-cut (2컷) manga page that the
// manga-page card layout composites text onto. Separated from the card layout so the pipeline can
// run live (real Gemini art) or, in the dry-run/tests, with a deterministic placeholder (no network).
//   page({ article, event }) -> Promise<Buffer>  (a 21:9 PNG)
import sharp from 'sharp';
import { deriveTwoBeats, mangaPageTwoCutPrompt, generateComicImage } from './comic_card.mjs';

// LIVE: derive the two key beats from the article (type-aware) and generate the manga page.
export function liveCardImage(env = process.env) {
  return {
    async page({ article, event }) {
      const headline = article.titleEn || article.titleKo || '';
      const summary = (article.bodyEn || article.bodyKo || '').replace(/\s+/g, ' ').slice(0, 400);
      const { beat1, beat2 } = await deriveTwoBeats(
        { sportKey: article.sport, headline, summary, eventType: event?.eventType || 'other' }, env);
      const { buffer } = await generateComicImage(mangaPageTwoCutPrompt({ beat1, beat2 }), env, { aspectRatio: '21:9' });
      return buffer;
    },
  };
}

// MOCK: a deterministic two-panel placeholder (21:9), no network — keeps the dry-run hermetic while
// still exercising the real layout + glyph-smoke + PNG-dimension assertions.
export function mockCardImage() {
  return {
    async page() {
      const W = 1536, H = 672, gut = 24, pw = (W - gut) / 2;
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${H}" fill="#fff"/>
        <rect x="0" y="0" width="${pw}" height="${H}" fill="#D9D9D9"/>
        <rect x="${pw + gut}" y="0" width="${pw}" height="${H}" fill="#C8C8C8"/>
      </svg>`;
      return sharp(Buffer.from(svg)).png().toBuffer();
    },
  };
}
