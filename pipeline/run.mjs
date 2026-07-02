// Live production entry — progressive: each adapter goes live when its secret is present,
// otherwise falls back to fixture/mock (see pipeline/deps.mjs). With ONLY ANTHROPIC_API_KEY,
// this runs REAL Claude synthesis + fact-gating over sample news with mocked publish/Telegram.
// Exits non-zero on a skipped day or fatal error so the cron surfaces it.
import fs from 'node:fs';
import path from 'node:path';
import { runPipeline } from './core.mjs';
import { buildDeps } from './deps.mjs';
import { loadConfig, LEDGER_PATH, ROOT_DIR } from '../lib/config.mjs';

// Filesystem-safe filename from the article title (so the operator can tell files apart).
function safeName(title, fp) {
  const base = String(title || 'article')
    .replace(/[\\/:*?"<>|]/g, '')   // Windows-illegal chars
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[ .]+$/, '');          // no trailing space/dot
  return `${base || 'article'}__${String(fp).slice(0, 6)}`;
}

// Save generated articles as markdown so the operator can read what was actually written.
function saveArticles(published, day) {
  if (!published.length) return null;
  const dir = path.join(ROOT_DIR, 'out', day);
  fs.mkdirSync(dir, { recursive: true });
  for (const p of published) {
    const v = p.preview || {};
    const name = safeName(v.titleKo || v.titleEn, p.fingerprint); // name files by article title
    const md = `# ${v.titleKo || ''}\n\n${v.bodyKo || ''}\n\n---\n\n# ${v.titleEn || ''}\n\n${v.bodyEn || ''}\n\n---\n\n출처(참고):\n${(v.sources || []).map((s) => `- ${s.outlet}: ${s.url}`).join('\n')}\n`;
    fs.writeFileSync(path.join(dir, `${name}.md`), md, 'utf8');
    // Save the card-news PNGs (what goes to Telegram) so the operator can view them.
    for (const c of p.cardImages || []) {
      fs.writeFileSync(path.join(dir, `${name}-card-${c.lang}.png`), c.buffer);
    }
  }
  return dir;
}

async function main() {
  const config = { ...loadConfig(process.env), now: new Date().toISOString() };
  const { mode, news } = buildDeps(process.env, {
    subscriptionsPath: path.join(ROOT_DIR, 'data', 'subscriptions.ndjson'),
  });

  console.log('Adapter modes:', JSON.stringify(mode));
  if (mode.llm === 'fixture') {
    console.log('\n' + '='.repeat(64));
    console.log('⚠️  경고: ANTHROPIC_API_KEY 가 설정되지 않았습니다.');
    console.log('   → 가짜 SAMPLE 데이터로 실행됩니다 (실제 뉴스/Claude 아님).');
    console.log('   실제로 돌리려면 이 터미널에서 먼저:');
    console.log('   $env:ANTHROPIC_API_KEY = "당신의-키"');
    console.log('='.repeat(64) + '\n');
  }

  // News pipeline
  const report = await runPipeline({ deps: news, config, ledgerPath: LEDGER_PATH });
  console.log('\n=== News ===');
  console.log(`discovered ${report.discovered} -> ${report.events} events | published ${report.published.length} | fact-blocked ${report.blockedByFact.length} | plagiarism-blocked ${report.blockedByPlagiarism.length} | ineligible ${report.ineligible.length} | dup-dropped ${report.droppedDuplicate.length} | deferred(cap) ${report.deferredByCap} | follower-pushes ${report.followerPushes}`);
  for (const p of report.published) console.log(`  ✅ published ${p.sport} (${p.fingerprint}) KO#${p.koId}/EN#${p.enId}`);
  for (const b of report.droppedDuplicate) console.log(`  🔁 dup-dropped ${b.fingerprint} (${b.why}) — 이미 발행된 이슈`);
  for (const b of report.blockedByFact) console.log(`  🚫 fact-blocked ${b.fingerprint} — ungrounded: ${(b.ungrounded || []).join('; ')}`);
  for (const b of report.blockedByPlagiarism) console.log(`  🚫 plagiarism-blocked ${b.fingerprint} — similarity ${b.maxSimilarity}`);
  for (const b of report.ineligible) console.log(`  ⏭ ineligible ${b.fingerprint} — ${b.reason}`);
  for (const b of report.synthSkipped) console.log(`  ⤬ skipped ${b.fingerprint} — ${b.reason}`);
  for (const b of report.verifyRejected) console.log(`  ✗ verifier-rejected ${b.fingerprint} (${b.lang})`);
  if (report.verifyRevised.length) console.log(`  ✎ verifier revised ${report.verifyRevised.length} article body(ies)`);
  for (const b of report.cardIssues) console.log(`  ⚠ card-issue ${b.fingerprint} — ${b.stage}: ${b.reason}`);

  const savedDir = saveArticles(report.published, (config.now || '').slice(0, 10) || 'today');
  if (savedDir) console.log(`\n📄 생성된 기사 저장됨: ${savedDir} (열어서 읽어보세요)`);

  if (report.skippedDay) { console.error('Day skipped — no items discovered.'); process.exit(2); }
  console.log(`\nDone. Published ${report.published.length} issue(s).`);
}

main().catch((e) => { console.error('pipeline:run failed:', e.message); process.exit(1); });
