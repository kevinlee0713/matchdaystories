// Story-video sample: a REAL published article -> 4 vertical manga scenes (with real-athlete
// likeness) -> Veo 3.1 image-to-video clips -> Korean captions -> one muted 1080x1920 reel.
//
// Kept in git (the earlier prototype was deleted and unrecoverable). Output goes to samples/video/
// which is NOT gitignored-cleaned, so the mp4 survives.
//   node --env-file-if-exists=.env scripts/make-story-video.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { generateComicImageFromPhoto, generateComicImage } from '../lib/img/comic_card.mjs';
import { resolveAthletePhoto } from '../lib/img/athlete_photo.mjs';
import { parseJsonLoose } from '../lib/llm/client.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview';
const FFMPEG = process.env.FFMPEG_PATH
  || 'C:/Users/kevin/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe';

const OUT = path.join(process.cwd(), 'samples', 'video');
fs.mkdirSync(OUT, { recursive: true });
const W = 1080, H = 1920, SEC = 4;

// The REAL published article (matchdaystories.com post 521)
const article = {
  sport: 'baseball',
  titleKo: '류현진, 한미 통산 2500탈삼진 달성에도 팀은 무승부',
  bodyKo: '류현진 선수가 한미 통산 2500탈삼진이라는 대기록을 세웠으나, 팀은 불펜 난조로 키움 히어로즈와 '
    + '무승부를 기록하며 승리를 챙기지 못했다. 마운드에서 삼진을 잡아내며 대기록을 완성한 순간 관중이 환호했지만, '
    + '이후 불펜이 리드를 지키지 못하면서 경기는 무승부로 끝났다.',
};

const ff = (args) => execFileSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'inherit'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Article -> 4 beats {scene (EN art), caption (KO)}
async function deriveBeats() {
  const prompt =
    `You are a manga storyboard writer for a Korean sports-news reel. Turn this real news into FOUR `
    + `dramatic vertical scenes (setup -> build-up -> climax -> aftermath) showing ONLY what actually `
    + `happened. For each: "scene" = concrete ENGLISH art description (one athlete in frame, clear action, `
    + `stadium setting, NO text/logos), "caption" = short KOREAN caption (<= 14 chars). `
    + `Output ONLY JSON: [{"scene":"...","caption":"..."} x4].\n\n`
    + `Headline: ${article.titleKo}\n${article.bodyKo}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } }),
  });
  const j = await res.json();
  const out = parseJsonLoose(j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim());
  const arr = Array.isArray(out) ? out : (out.scenes ?? out.panels ?? []);
  if (arr.length < 4) throw new Error('beat derivation failed');
  return arr.slice(0, 4);
}

// 2) Veo: image -> video (long-running op). We ship muted, so ask Veo NOT to generate audio —
// its audio RAI filter otherwise rejects otherwise-fine scenes. Returns null if filtered/failed
// so the caller can fall back to a still-frame motion clip.
async function veoOnce(imgBuf, prompt, idx, withAudioFlag) {
  const parameters = withAudioFlag ? { aspectRatio: '9:16', generateAudio: false } : { aspectRatio: '9:16' };
  const submit = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VEO_MODEL}:predictLongRunning?key=${KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt, image: { bytesBase64Encoded: imgBuf.toString('base64'), mimeType: 'image/png' } }],
      parameters,
    }),
  });
  const op = await submit.json();
  if (!op.name) return { err: `submit: ${JSON.stringify(op).slice(0, 160)}` };
  process.stdout.write(`   scene${idx} veo polling`);
  for (let t = 0; t < 40; t++) {
    await sleep(10000);
    const p = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${KEY}`)).json();
    process.stdout.write('.');
    if (p.done) {
      const r = p.response?.generateVideoResponse ?? p.response ?? {};
      const uri = r.generatedSamples?.[0]?.video?.uri;
      if (!uri) return { err: `filtered(${r.raiMediaFilteredCount ?? '?'}): ${(r.raiMediaFilteredReasons?.[0] ?? '').slice(0, 90)}` };
      const vid = Buffer.from(await (await fetch(`${uri}&key=${KEY}`)).arrayBuffer());
      console.log(` ok (${(vid.length / 1e6).toFixed(1)}MB)`);
      return { vid };
    }
  }
  return { err: 'timeout' };
}

async function veoClip(imgBuf, prompt, idx) {
  // try with generateAudio:false first; if the API rejects that field, retry without it
  for (const withFlag of [true, false]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await veoOnce(imgBuf, prompt, idx, withFlag);
      if (r.vid) return r.vid;
      console.log(` ✗ ${r.err}`);
      if (/submit:/.test(r.err)) break; // bad field -> try the other parameter shape
    }
  }
  return null; // caller falls back to still-frame motion
}

// Fallback when Veo filters a scene: slow push-in on the still manga art (ffmpeg zoompan).
function stillMotionClip(scenePath, outPath) {
  ff(['-y', '-loop', '1', '-i', scenePath, '-t', String(SEC), '-filter_complex',
    `scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0008,1.12)':d=${SEC * 24}:s=${W}x${H}:fps=24`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', outPath]);
}

// 3) Korean caption strip as a transparent PNG (ffmpeg drawtext can't do CJK reliably here)
async function captionPng(text, idx) {
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${H - 300}" width="${W}" height="300" fill="#000" fill-opacity="0.55"/>
    <rect x="60" y="${H - 236}" width="84" height="7" fill="#E4002B"/>
    <text x="60" y="${H - 150}" font-family="'Malgun Gothic','Noto Sans KR',sans-serif" font-size="66"
      font-weight="900" fill="#ffffff">${esc}</text>
    <text x="60" y="${H - 80}" font-family="'Malgun Gothic',sans-serif" font-size="30"
      font-weight="700" fill="#c9c4ba" letter-spacing="3">MATCHDAY STORIES</text>
  </svg>`;
  const p = path.join(OUT, `cap${idx}.png`);
  fs.writeFileSync(p, await sharp(Buffer.from(svg)).png().toBuffer());
  return p;
}

// ---- run ----
console.log(`📰 ${article.titleKo}\n`);
console.log('1) deriving 4 beats…');
const beats = await deriveBeats();
beats.forEach((b, i) => console.log(`   씬${i + 1}: "${b.caption}" — ${b.scene.slice(0, 62)}`));

console.log('\n2) athlete likeness…');
const photo = await resolveAthletePhoto({ article, event: {} });
console.log(`   ${photo ? `reference photo for ${photo.name}` : '(generic — no portrait found)'}`);

const MANGA = 'black-and-white Japanese shonen manga style, bold ink line art, screentone, dramatic angle, vertical composition';
const segs = [];
for (let i = 0; i < beats.length; i++) {
  const b = beats[i];
  const seg = path.join(OUT, `seg${i + 1}.mp4`);
  if (fs.existsSync(seg)) { console.log(`\n3.${i + 1}) seg${i + 1} exists — reusing`); segs.push(seg); continue; }

  console.log(`\n3.${i + 1}) scene art…`);
  const scenePath = path.join(OUT, `scene${i + 1}.png`);
  let art = fs.existsSync(scenePath) ? fs.readFileSync(scenePath) : null;
  if (!art) {
    const p = `${MANGA}. ${b.scene}. ${photo ? 'The main athlete RESEMBLES the person in the reference photo (same face, hair, build).' : 'Generic athlete.'} `
      + 'Full figure clearly in frame, no cropped heads. Render NO text, NO letters, NO numbers anywhere.';
    for (let a = 0; a < 3 && !art; a++) {
      const g = photo
        ? await generateComicImageFromPhoto(p, photo.buf, process.env, { aspectRatio: '9:16' })
        : await generateComicImage(p, process.env, { aspectRatio: '9:16' });
      if (g.ok) art = g.buffer; else console.log(`   retry (${g.source})`);
    }
    if (!art) throw new Error(`scene ${i + 1} art failed`);
    fs.writeFileSync(scenePath, art);
  }

  const raw = path.join(OUT, `clip${i + 1}.mp4`);
  const cap = await captionPng(b.caption, i + 1);
  const clip = fs.existsSync(raw) ? fs.readFileSync(raw)
    : await veoClip(art, `${b.scene}. Subtle cinematic motion, camera slowly pushes in. Monochrome manga aesthetic.`, i + 1);

  if (clip) {
    if (!fs.existsSync(raw)) fs.writeFileSync(raw, clip);
    ff(['-y', '-i', raw, '-i', cap, '-filter_complex',
      `[0:v]trim=0:${SEC},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[v];[v][1:v]overlay=0:0`,
      '-an', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', seg]);
    console.log(`   ✅ seg${i + 1} (veo)`);
  } else {
    // Veo filtered this scene — fall back to a slow push-in on the still art so the reel completes
    const still = path.join(OUT, `still${i + 1}.mp4`);
    stillMotionClip(scenePath, still);
    ff(['-y', '-i', still, '-i', cap, '-filter_complex', '[0:v][1:v]overlay=0:0',
      '-an', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', seg]);
    console.log(`   ✅ seg${i + 1} (still push-in fallback)`);
  }
  segs.push(seg);
}

console.log('\n4) concat…');
const listFile = path.join(OUT, 'list.txt');
fs.writeFileSync(listFile, segs.map((s) => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
const final = path.join(OUT, 'matchday-story.mp4');
ff(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-an', final]);
const size = (fs.statSync(final).size / 1e6).toFixed(1);
console.log(`\n✅ DONE  ${final}  (${W}x${H}, ${beats.length * SEC}s, muted, ${size}MB)`);
