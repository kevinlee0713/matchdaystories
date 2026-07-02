# Sports News Blog (자동 발행)

Daily multi-source sports-news aggregator. Discovers the day's sports news, **synthesizes 2-3
independent sources into an original KO+EN article** (the copyright-safe alternative to
single-source rewriting), gates it for grounding + plagiarism, renders **card-news images**,
publishes to WordPress (Polylang KO/EN), and distributes to **Telegram**.

> MVP scope: **blog + Telegram**. Deferred: KakaoTalk, email newsletter, full-sport coverage,
> banner ads. See `SECRETS.md` and the consensus plan.

## Pipeline
```
discover → cluster (=DEDUP-B) → DEDUP-A (vs published) → synthesize (2-3 src) →
fact-gate (grounding, fail-closed) → plagiarism-gate (MinHash) →
render card-news → glyph-smoke → publish KO+EN → Telegram → ledger write-back
```

## Quick start (no secrets needed)
```bash
npm install
npm run pipeline:dry-run   # runs the full pipeline on fixtures+mocks, asserts all 5 ACs
npm test                   # fact-gate, dedup idempotency, and dry-run gate
```

## Acceptance criteria (each has a runnable test)
1. KO+EN auto-generated & published (Polylang paired)
2. No plagiarism **and** no factual error (fact-gate blocks ungrounded load-bearing claims)
3. Card-news → Telegram, no broken images (glyph-smoke before sendPhoto)
4. No duplicate articles (entity/event fingerprint + committed ledger; run-twice → zero)
5. Full daily pipeline, no human intervention (cron + non-silent fail-closed fallbacks)

## Going live
Fill `.env` from `.env.example`, follow `SECRETS.md`, wire the live adapters
(`liveLLM` / `liveWordPress` / `liveTelegram` / `liveDiscover` / `liveJudges`), then enable the
`daily-aggregate` workflow. The dry-run gate must stay green in CI before each live cron run.

## Architecture notes
- **Extract, not fork:** WordPress publish / Polylang / sharp card-news primitives / judge
  fan-out / cron are adapted from the proven VOBET `blog-project` pipeline; the aggregator spine
  (discover/cluster/dedup/synthesize/gates) is net-new.
- **Dependency injection:** `pipeline/core.mjs` takes a `deps` object so the same spine runs live
  or against fixtures/mocks. This is what makes the MVP locally testable.
