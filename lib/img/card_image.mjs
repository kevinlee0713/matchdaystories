// Injectable card-ART source for the 4-cut (4컷) STORY card. Produces the WORDLESS 2x2 manga art
// (no speech bubbles), then strips any text the model drew anyway (image models garble Korean).
// Separated so the pipeline runs live (real Gemini art) or, in the dry-run/tests, with a
// deterministic placeholder (no network).
//   fourCut({ article, event }) -> Promise<{ art: Buffer(1:1 PNG) }>
import sharp from 'sharp';
import { generateComicImage, generateComicImageFromPhoto, assessStoryArt, removeImageText } from './comic_card.mjs';
import { deriveFourBeats, fourCutPrompt } from './fourcut.mjs';
import { resolveAthletePhoto } from './athlete_photo.mjs';

const QUALITY_MIN = Number(process.env.FOURCUT_QUALITY_MIN ?? 0.6);

// LIVE: derive a wordless 4-beat story; if the story has a single protagonist we can find a photo of,
// generate with that photo as a likeness reference (image-to-image), else generic art. A quality guard
// scores the result and regenerates once if it's weak. Finally strip any text the model drew (garbled
// Korean on scoreboards/signs). Returns clean text-free art (+ the likeness name for logging).
export function liveCardImage(env = process.env) {
  return {
    async fourCut({ article, event }) {
      const headline = article.titleKo || article.titleEn || '';
      const summary = (article.bodyKo || article.bodyEn || '').replace(/\s+/g, ' ').slice(0, 400);
      const beats = await deriveFourBeats(
        { sportKey: article.sport, headline, summary, eventType: event?.eventType || 'other' }, env);

      // Real-athlete likeness when the story centers on one findable person; else generic.
      const photo = await resolveAthletePhoto({ article, event }, env);
      const prompt = fourCutPrompt(beats, { likeness: !!photo });
      const gen = () => (photo
        ? generateComicImageFromPhoto(prompt, photo.buf, env, { aspectRatio: '1:1' })
        : generateComicImage(prompt, env, { aspectRatio: '1:1' }));

      let { buffer, ok } = await gen();
      // Quality guard (D): regenerate once if the 4-cut doesn't tell the story well.
      if (ok) {
        const { score } = await assessStoryArt(buffer, beats, env);
        if (score < QUALITY_MIN) {
          const retry = await gen();
          if (retry.ok) buffer = retry.buffer;
        }
      }
      // Only strip text on real art (the placeholder has none).
      const art = ok ? await removeImageText(buffer, env) : buffer;
      return { art, likeness: photo?.name || null };
    },
  };
}

// MOCK: a deterministic 2x2 placeholder (no network) — keeps the dry-run hermetic while exercising
// the real card compositor + glyph-smoke + dimension assertions.
export function mockCardImage() {
  return {
    async fourCut() {
      const W = 1024, h = W / 2;
      const svg = `<svg width="${W}" height="${W}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${W}" fill="#fff"/>
        <rect x="0" y="0" width="${W / 2 - 4}" height="${h - 4}" fill="#DAD6CC"/>
        <rect x="${W / 2 + 4}" y="0" width="${W / 2 - 4}" height="${h - 4}" fill="#CFC9BD"/>
        <rect x="0" y="${h + 4}" width="${W / 2 - 4}" height="${h - 4}" fill="#D2CDC1"/>
        <rect x="${W / 2 + 4}" y="${h + 4}" width="${W / 2 - 4}" height="${h - 4}" fill="#C6C0B4"/>
      </svg>`;
      return { art: await sharp(Buffer.from(svg)).png().toBuffer() };
    },
  };
}
