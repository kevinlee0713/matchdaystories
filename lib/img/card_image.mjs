// Injectable card-ART source for the 4-cut (4컷) STORY card. Produces the wordless 2x2 manga art
// (Gemini leaves space for bubbles) + the 4 Korean speech-bubble dialogues. Separated so the pipeline
// runs live (real Gemini art) or, in the dry-run/tests, with a deterministic placeholder (no network).
//   fourCut({ article, event }) -> Promise<{ art: Buffer(1:1 PNG), dialogues: string[4] }>
import sharp from 'sharp';
import { generateComicImage } from './comic_card.mjs';
import { deriveFourBeats, fourCutPrompt, detectBubbles } from './fourcut.mjs';

// LIVE: derive a 4-beat story, generate the 2x2 manga art WITH AI-drawn bubbles, then DETECT the
// bubbles (their Korean is garbled — the card compositor overlays the correct text into them).
export function liveCardImage(env = process.env) {
  return {
    async fourCut({ article, event }) {
      const headline = article.titleKo || article.titleEn || '';
      const summary = (article.bodyKo || article.bodyEn || '').replace(/\s+/g, ' ').slice(0, 400);
      const beats = await deriveFourBeats(
        { sportKey: article.sport, headline, summary, eventType: event?.eventType || 'other' }, env);
      const { buffer } = await generateComicImage(fourCutPrompt(beats), env, { aspectRatio: '1:1' });
      const bubbles = await detectBubbles(buffer, env);
      return { art: buffer, bubbles, dialogues: beats.map((b) => b.dialogue) };
    },
  };
}

// MOCK: a deterministic 2x2 placeholder + fake bubble boxes + dialogues (no network) — keeps the
// dry-run hermetic while exercising the real compositor + glyph-smoke + dimension assertions.
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
      const art = await sharp(Buffer.from(svg)).png().toBuffer();
      // two bubbles (normalized 0-1000): upper-right (TR) and lower-right (BR)
      return { art, bubbles: [[70, 620, 200, 930], [560, 600, 690, 900]], dialogues: ['', '결정적 순간!', '', '역사적 승리!'] };
    },
  };
}
