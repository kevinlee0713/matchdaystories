// Preview run: REAL news → synthesize → gates → manga card → LIVE Telegram group, but WordPress is
// MOCKED and a TEMP ledger is used (the committed dedup ledger is NOT touched, so real go-live later
// still publishes these stories). Lets you see real cards land in the group before WP is set up.
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_GROUP_ID=... node scripts/preview-to-telegram.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPipeline } from '../pipeline/core.mjs';
import { buildDeps } from '../pipeline/deps.mjs';
import { loadConfig } from '../lib/config.mjs';
import { mockWordPress } from '../lib/wp/post.mjs';

const config = { ...loadConfig(process.env), now: new Date().toISOString() };
const { mode, news } = buildDeps(process.env);
// Preview contract: never touch the live blog, even when WP creds exist in .env.
news.wp = mockWordPress();
mode.wp = 'mock(preview)';
console.log('Adapter modes:', JSON.stringify(mode));
if (mode.telegram !== 'live') {
  console.error('Telegram not live — set TELEGRAM_BOT_TOKEN + TELEGRAM_GROUP_ID'); process.exit(1);
}

// Temp ledger so this preview does NOT mark stories as published in the real ledger.
const tmpLedger = path.join(os.tmpdir(), `snb-preview-ledger-${process.pid}.ndjson`);
try {
  const report = await runPipeline({ deps: news, config, ledgerPath: tmpLedger });
  console.log(`\n=== Preview ===`);
  console.log(`discovered ${report.discovered} → ${report.events} events | published(→group) ${report.published.length} | fact-blocked ${report.blockedByFact.length} | plagiarism-blocked ${report.blockedByPlagiarism.length} | ineligible ${report.ineligible.length} | deferred(cap) ${report.deferredByCap}`);
  for (const p of report.published) console.log(`  ✅ ${p.sport} (${p.fingerprint}) → ${p.cards} card(s) to group`);
  for (const b of report.blockedByFact) console.log(`  🚫 fact-blocked ${b.fingerprint}`);
  for (const b of report.ineligible) console.log(`  ⏭ ineligible ${b.fingerprint} — ${b.reason}`);
  console.log('\n그룹 채팅을 확인하세요 — 실제 뉴스 만화 카드가 올라가 있습니다. (WordPress는 mock, 실 ledger 미반영)');
} finally {
  if (fs.existsSync(tmpLedger)) fs.rmSync(tmpLedger);
}
