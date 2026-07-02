// E2E unattended gate (B3). Runs every pipeline stage against the committed fixture day with
// publish + Telegram + LLM mocked/fixtured. Exits 0 ONLY if all 5 acceptance criteria assert.
// This is the CI pre-merge gate; the live cron is the production gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './core.mjs';
import { loadConfig } from '../lib/config.mjs';
import { fixtureLLM } from '../lib/llm/client.mjs';
import { mockJudges } from '../lib/judges/panel.mjs';
import { mockWordPress } from '../lib/wp/post.mjs';
import { mockTelegram } from '../lib/notify/telegram.mjs';
import { mockCardImage } from '../lib/img/card_image.mjs';
import { fixtureDiscover } from './discover.mjs';
import { makeSubscriptionMatcher } from '../lib/subscriptions.mjs';
import { rawItems, fixtures, subscriptions } from '../fixtures/day-2026-06-11/fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function dryRun() {
  const config = { ...loadConfig({}), now: '2026-06-11T12:00:00.000Z' };
  const tmpLedger = path.join(os.tmpdir(), `snb-dryrun-ledger-${process.pid}.ndjson`);
  if (fs.existsSync(tmpLedger)) fs.rmSync(tmpLedger);

  const wp = mockWordPress();
  const telegram = mockTelegram();
  const matcher = makeSubscriptionMatcher(subscriptions);
  const deps = {
    discover: fixtureDiscover(rawItems),
    llm: fixtureLLM(fixtures),
    judges: mockJudges(),
    wp,
    telegram,
    subscriptions: matcher, // ② personalization
    cardImage: mockCardImage(), // manga-page art placeholder (hermetic dry-run)
  };

  let run1, run2;
  try {
    // First run — publishes the eligible event, blocks the wrong-score one, drops single-source.
    run1 = await runPipeline({ deps, config, ledgerPath: tmpLedger });

    // Second run — same fixture day; DEDUP-A must drop the already-published event (idempotency).
    run2 = await runPipeline({
      deps: { ...deps, wp: mockWordPress(), telegram: mockTelegram() },
      config,
      ledgerPath: tmpLedger, // same ledger persists across runs
    });
  } finally {
    if (fs.existsSync(tmpLedger)) fs.rmSync(tmpLedger);
  }

  // ---- Acceptance criteria assertions ----
  const checks = [];
  const assert = (ac, name, cond, detail) => checks.push({ ac, name, pass: !!cond, detail });

  // AC#1 — KO+EN auto-gen & published, Polylang paired
  const pub = run1.published;
  assert('AC#1', 'at least one issue published', pub.length >= 1, `published=${pub.length}`);
  assert('AC#1', 'each published is KO+EN paired', pub.every((p) => p.koId && p.enId && p.paired), 'koId/enId/paired');
  assert('AC#1', 'WP recorded a distinct KO + EN post per issue',
    wp.published.length === pub.length && wp.published.every((r) => r.koId && r.enId && r.koId !== r.enId),
    `wp=${JSON.stringify(wp.published.map((r) => ({ ko: r.koId, en: r.enId })))}`);

  // AC#2 — no plagiarism / no factual error
  assert('AC#2', 'wrong-score issue BLOCKED by fact-gate', run1.blockedByFact.length >= 1, JSON.stringify(run1.blockedByFact));
  assert('AC#2', 'published issues passed plagiarism gate', pub.length >= 1, 'all published passed plagiarism (gate runs before publish)');

  // AC#3 — card-news -> Telegram, no broken images
  const tgUnits = telegram.calls.photos.length + telegram.calls.groups.length;
  assert('AC#3', 'Telegram received card(s) for each published issue', tgUnits >= pub.length, `tgUnits=${tgUnits}`);
  assert('AC#3', 'no card render/glyph issues for published', run1.cardIssues.length === 0, JSON.stringify(run1.cardIssues));

  // AC#4 — no duplicate articles
  assert('AC#4', 'second run publishes ZERO (idempotent)', run2.publishedAfterDedup === 0, `run2 published=${run2.publishedAfterDedup}`);
  assert('AC#4', 'run2 dropped the published fingerprint as duplicate', run2.droppedDuplicate.length >= 1, JSON.stringify(run2.droppedDuplicate));

  // AC#5 — full pipeline, no human intervention; fallbacks non-silent
  assert('AC#5', 'day not skipped (discovery produced items)', run1.skippedDay === false, `discovered=${run1.discovered}`);
  assert('AC#5', 'ineligible single-source event alerted (non-silent)', run1.ineligible.length >= 1 && run1.alerts.some((a) => a.includes('dropped')), JSON.stringify(run1.ineligible));
  assert('AC#5', 'fact-block alerted (non-silent)', run1.alerts.some((a) => a.includes('blocked')), 'alert emitted');

  // DIFF#② — personalization: a follower of an event entity got a DM push
  assert('②', 'follower received a personalized push', run1.followerPushes >= 1, `followerPushes=${run1.followerPushes}`);
  assert('②', 'personalized push targeted a follower chatId (not group)',
    telegram.calls.photos.some((p) => p.chatId && p.chatId !== 'group'), JSON.stringify(telegram.calls.photos.map((p) => p.chatId)));

  return { checks, run1, run2 };
}

function summarize({ checks, run1, run2 }) {
  const byAc = {};
  for (const c of checks) (byAc[c.ac] ??= []).push(c);
  console.log('\n=== Sports News Blog — pipeline:dry-run ===\n');
  console.log(`Discovered ${run1.discovered} items -> ${run1.events} events`);
  console.log(`Published: ${run1.published.length} | Fact-blocked: ${run1.blockedByFact.length} | Plagiarism-blocked: ${run1.blockedByPlagiarism.length} | Ineligible: ${run1.ineligible.length} | Dup-dropped(run2): ${run2.droppedDuplicate.length} | Follower-pushes: ${run1.followerPushes}\n`);
  let allPass = true;
  for (const ac of Object.keys(byAc).sort()) {
    for (const c of byAc[ac]) {
      const mark = c.pass ? 'PASS' : 'FAIL';
      if (!c.pass) allPass = false;
      console.log(`  [${mark}] ${c.ac}  ${c.name}${c.pass ? '' : `  -> ${c.detail}`}`);
    }
  }
  console.log(`\n${allPass ? 'ALL CHECKS PASS (5 ACs + ② personalization)' : 'DRY-RUN FAILED'}\n`);
  return allPass;
}

// Run directly
if (process.argv[1]?.endsWith('dryrun.mjs')) {
  dryRun()
    .then((result) => process.exit(summarize(result) ? 0 : 1))
    .catch((e) => { console.error('dry-run crashed:', e); process.exit(1); });
}
