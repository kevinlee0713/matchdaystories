// Injectable card-ART source for the 4-cut (4컷) STORY card. Produces the WORDLESS 2x2 manga art
// (no speech bubbles), then strips any text the model drew anyway (image models garble Korean).
// Separated so the pipeline runs live (real Gemini art) or, in the dry-run/tests, with a
// deterministic placeholder (no network).
//   fourCut({ article, event }) -> Promise<{ art: Buffer(1:1 PNG) }>
import sharp from 'sharp';
import { generateComicImage, generateComicImageFromPhoto, assessPanel, removeImageText } from './comic_card.mjs';
import { deriveFourBeats, panelPrompt, composeFourPanels } from './fourcut.mjs';
import { resolveAthletePhoto } from './athlete_photo.mjs';

const QUALITY_MIN = Number(process.env.FOURCUT_QUALITY_MIN ?? 0.6);
// A near-empty / burst / light-flash panel is mostly white; good manga panels sit ~0.1–0.5. Above this
// the panel is treated as empty regardless of the (unreliable) LLM score — a deterministic backstop.
const WHITE_MAX = Number(process.env.FOURCUT_WHITE_MAX ?? 0.68);
async function whiteRatio(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let w = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > 235) w++;
  return w / (info.width * info.height);
}

// LIVE: derive a wordless 4-beat story, then generate the 4 panels SEPARATELY and composite them
// ourselves. Per-panel generation is far more reliable than a single 2x2 image (which drops/empties/
// crops panels): each panel is guaranteed to contain a subject, and a weak panel is regenerated on its
// own. If the story has a single protagonist with a findable portrait, each panel is generated from
// that photo (image-to-image) so the athlete is recognizable and consistent across panels. Finally a
// text-strip pass removes any garbled Korean the model drew. Returns clean art (+ likeness name).
export function liveCardImage(env = process.env) {
  return {
    async fourCut({ article, event }) {
      const headline = article.titleKo || article.titleEn || '';
      const summary = (article.bodyKo || article.bodyEn || '').replace(/\s+/g, ' ').slice(0, 400);
      const beats = await deriveFourBeats(
        { sportKey: article.sport, headline, summary, eventType: event?.eventType || 'other' }, env);

      // Real-athlete likeness when the story centers on one findable person; else generic.
      const photo = await resolveAthletePhoto({ article, event }, env);
      const genPanel = (scene) => {
        const p = panelPrompt(scene, { likeness: !!photo });
        return photo
          ? generateComicImageFromPhoto(p, photo.buf, env, { aspectRatio: '1:1' })
          : generateComicImage(p, env, { aspectRatio: '1:1' });
      };

      // Score a panel: deterministic white-ratio backstop (kills empty/burst panels the LLM misses),
      // combined with the LLM usability score. A too-white panel is 0 regardless.
      const scorePanel = async (buf) => {
        if ((await whiteRatio(buf)) > WHITE_MAX) return 0;
        return null; // caller runs the LLM check when not vetoed
      };

      // Generate 4 panels in parallel; per-panel quality guard regenerates a weak (empty/burst/cropped/
      // blank-face) panel up to twice, keeping the best-scoring attempt.
      let anyOk = false;
      const panels = await Promise.all(beats.map(async (b) => {
        const evalPanel = async (buf) => (await scorePanel(buf)) ?? (await assessPanel(buf, b.scene, env)).score;
        let best = await genPanel(b.scene);
        let bestScore = best.ok ? await evalPanel(best.buffer) : 0;
        for (let i = 0; i < 2 && bestScore < QUALITY_MIN; i++) {
          const cand = await genPanel(b.scene);
          if (!cand.ok) continue;
          const s = await evalPanel(cand.buffer);
          if (s > bestScore) { best = cand; bestScore = s; }
        }
        if (best.ok) anyOk = true;
        return best.buffer;
      }));

      const grid = await composeFourPanels(panels, 1024);
      // Strip any residual text only when we have real art (placeholders have none).
      const art = anyOk ? await removeImageText(grid, env) : grid;
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
