// Read-only go-live preflight: reports which secrets are present and runs SAFE connectivity checks
// (Telegram getMe, WP `wp option get blogname` + Polylang/Rank Math presence). Publishes nothing.
//   node scripts/live-check.mjs
//   node scripts/live-check.mjs --send-card   # ALSO sends ONE sample KO manga card to the group
import { wpCli, sshClose } from '../lib/wp/ssh.mjs';
import { liveTelegram } from '../lib/notify/telegram.mjs';
import { comicPrompt, generateComicImage } from '../lib/img/comic_card.mjs';
import { layoutMangaPage } from '../lib/img/card_layouts.mjs';
import { mockCardImage } from '../lib/img/card_image.mjs';

const env = process.env;
const ok = (b) => (b ? '✅' : '— ');
const sendCard = process.argv.includes('--send-card');

console.log('\n=== Go-live preflight (read-only) ===\n');
console.log('Secrets present:');
console.log(`  ${ok(env.ANTHROPIC_API_KEY)} ANTHROPIC_API_KEY (synthesis; else Gemini)`);
console.log(`  ${ok(env.GEMINI_API_KEY)} GEMINI_API_KEY (manga art + scenes${env.ANTHROPIC_API_KEY ? '' : ' + synthesis'})`);
console.log(`  ${ok(env.WP_SSH_HOST && env.WP_SSH_USER && env.WP_PATH)} WP_SSH_HOST/USER/PATH (+ a key/password)`);
console.log(`  ${ok(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_GROUP_ID)} TELEGRAM_BOT_TOKEN + TELEGRAM_GROUP_ID`);

// Telegram getMe (safe)
if (env.TELEGRAM_BOT_TOKEN) {
  try {
    const r = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`)).json();
    console.log(`\nTelegram: ${r.ok ? `bot @${r.result.username} reachable` : `getMe failed: ${JSON.stringify(r)}`}`);
  } catch (e) { console.log(`\nTelegram: getMe error — ${e.message}`); }
} else { console.log('\nTelegram: skipped (no token)'); }

// WordPress connectivity + required plugins (safe, read-only)
if (env.WP_SSH_HOST && env.WP_SSH_USER && env.WP_PATH) {
  try {
    const blog = await wpCli('option get blogname', env);
    console.log(`WordPress: connected — site "${blog}"`);
    const plugins = await wpCli('plugin list --status=active --field=name --format=csv', env).catch(() => '');
    const has = (p) => plugins.toLowerCase().includes(p);
    console.log(`  ${ok(has('polylang'))} Polylang active   ${ok(has('rank-math') || has('seo-by-rank-math'))} Rank Math active`);
  } catch (e) { console.log(`WordPress: connection FAILED — ${e.message}`); }
  finally { await sshClose(); }
} else { console.log('WordPress: skipped (no SSH secrets)'); }

// Optional: send ONE sample KO manga card to the group (opt-in)
if (sendCard) {
  if (!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_GROUP_ID)) { console.log('\n--send-card: skipped (no Telegram secrets)'); }
  else {
    console.log('\n--send-card: generating + sending a sample KO manga card …');
    const scene = 'two soccer players in plain kits — one firing a shot past a diving goalkeeper, the other celebrating';
    const { buffer: page } = env.GEMINI_API_KEY
      ? await generateComicImage(comicPrompt({ sportKey: 'football', scene, style: 'shonen' }), env, { aspectRatio: '21:9' })
      : { buffer: await mockCardImage().page() };
    const card = await layoutMangaPage({ pageBuffer: page, headline: '[테스트] 만화 카드 발송 확인', summary: '라이브 텔레그램 발송 점검용 샘플 카드입니다. 실제 기사가 아닙니다.', date: '2026.06.29', sportLabel: '축구', accent: '#E4002B' });
    const r = await liveTelegram(env).sendPhoto({ buffer: card.buffer, caption: '[테스트] 스포츠 뉴스 만화 카드' });
    console.log(`  sent — messageId ${r.messageId}`);
  }
}
console.log('\nDone.\n');
