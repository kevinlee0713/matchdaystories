// B2 test: running the pipeline twice on the same fixture day publishes ZERO the second time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPipeline } from '../pipeline/core.mjs';
import { loadConfig } from '../lib/config.mjs';
import { fixtureLLM } from '../lib/llm/client.mjs';
import { mockJudges } from '../lib/judges/panel.mjs';
import { mockWordPress } from '../lib/wp/post.mjs';
import { mockTelegram } from '../lib/notify/telegram.mjs';
import { fixtureDiscover } from '../pipeline/discover.mjs';
import { rawItems, fixtures } from '../fixtures/day-2026-06-11/fixture.mjs';

function makeDeps() {
  return {
    discover: fixtureDiscover(rawItems),
    llm: fixtureLLM(fixtures),
    judges: mockJudges(),
    wp: mockWordPress(),
    telegram: mockTelegram(),
  };
}

test('second run on same day publishes zero (cross-run dedup via ledger)', async () => {
  const config = { ...loadConfig({}), now: '2026-06-11T12:00:00.000Z' };
  const ledger = path.join(os.tmpdir(), `snb-test-ledger-${process.pid}.ndjson`);
  if (fs.existsSync(ledger)) fs.rmSync(ledger);

  const run1 = await runPipeline({ deps: makeDeps(), config, ledgerPath: ledger });
  assert.ok(run1.published.length >= 1, 'first run should publish at least one issue');

  const run2 = await runPipeline({ deps: makeDeps(), config, ledgerPath: ledger });
  assert.equal(run2.publishedAfterDedup, 0, 'second run must publish zero');
  assert.ok(run2.droppedDuplicate.length >= 1, 'second run must drop the published fingerprint');

  fs.rmSync(ledger);
});
