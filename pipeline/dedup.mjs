// Cross-day dedup. Oracle = WordPress published-issue store (source of truth) +
// committed-to-repo ledger (data/fingerprints.ndjson) as the cross-run cache. This survives
// the ephemeral GitHub Actions runner (a runner-local SQLite would evaporate each run).
//
// Two passes:
//   DEDUP-A: before synthesize — drop event clusters whose fingerprint is already published.
//   DEDUP-B: handled by cluster.mjs (same-event from 2 outlets collapses to 1 cluster).
//
// Write-back: after a successful publish (KO+EN live + TG sent), append the fingerprint to the
// ledger BEFORE job exit. Fail-closed on write failure (caller exits non-zero).
import fs from 'node:fs';
import path from 'node:path';
import { minhashSimilarity } from '../lib/util.mjs';

const NEAR_DUP_SIM = 0.85; // MinHash similarity above which two events are treated as same issue.

export function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  return out;
}

export function appendLedger(ledgerPath, record) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(record) + '\n', 'utf8');
}

// Build the set of "already published" fingerprints by reconciling WP (truth) into the ledger.
export async function buildPublishedView({ ledgerPath, wp }) {
  const ledger = readLedger(ledgerPath);
  const fps = new Set(ledger.map((r) => r.fingerprint));
  const sigs = ledger.filter((r) => r.titleMinhash).map((r) => r.titleMinhash);
  const urls = new Set(ledger.flatMap((r) => r.sourceUrls ?? [])); // deterministic same-event key
  let wpError = null;
  if (wp?.listPublishedFingerprints) {
    try {
      const wpFps = await wp.listPublishedFingerprints();
      for (const fp of wpFps) fps.add(fp); // WP wins / augments
    } catch (e) {
      // Degrade to ledger-only dedup but SURFACE the error so the caller alerts (non-silent).
      wpError = e.message;
    }
  }
  // WP is the source of truth: also union the source URLs recorded on published posts, so dedup
  // survives a lost/rebuilt ledger (ephemeral CI) even when the fingerprint changed.
  if (wp?.listPublishedSourceUrls) {
    try { for (const u of await wp.listPublishedSourceUrls()) urls.add(u); }
    catch (e) { wpError = wpError || e.message; }
  }
  return { fps, sigs, urls, wpError };
}

// DEDUP-A: drop events already covered (exact fingerprint OR near-text MinHash match).
export function dedupAgainstPublished(events, publishedView) {
  const { fps, sigs, urls } = publishedView;
  const kept = [];
  const dropped = [];
  for (const ev of events) {
    if (fps.has(ev.fingerprint)) { dropped.push({ ev, why: 'fingerprint' }); continue; }
    // Deterministic same-event catch: any source article already published => duplicate. This is
    // the safety net for non-deterministic fingerprints (LLM entity tagging varies per run).
    const evUrls = (ev.sources ?? []).map((s) => s.url).filter(Boolean);
    if (urls && evUrls.some((u) => urls.has(u))) { dropped.push({ ev, why: 'source-url' }); continue; }
    const near = sigs.some((sig) => minhashSimilarity(ev.titleMinhash, sig) >= NEAR_DUP_SIM);
    if (near) { dropped.push({ ev, why: 'near-text' }); continue; }
    kept.push(ev);
  }
  return { kept, dropped };
}
