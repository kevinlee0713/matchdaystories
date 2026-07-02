// ① pre-match intelligence: grounded fixture builds a card; ungrounded injury claim is BLOCKED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrematch } from '../pipeline/prematch.mjs';
import { loadConfig } from '../lib/config.mjs';
import { fixtureLLM } from '../lib/llm/client.mjs';
import { fixtureSchedule, fixtureIntel } from '../pipeline/intel.mjs';
import { mockTelegram } from '../lib/notify/telegram.mjs';
import { makeSubscriptionMatcher } from '../lib/subscriptions.mjs';
import { fixtures, schedule, intel, subscriptions } from '../fixtures/day-2026-06-11/fixture.mjs';

test('pre-match builds cards from trusted intel; ungrounded prose is advisory (not blocking)', async () => {
  const config = loadConfig({});
  const report = await runPrematch({
    deps: {
      schedule: fixtureSchedule(schedule),
      intel: fixtureIntel(intel),
      llm: fixtureLLM(fixtures),
      telegram: mockTelegram(),
      subscriptions: makeSubscriptionMatcher(subscriptions),
    },
    config,
  });
  assert.equal(report.fixtures, 2);
  // Card facts come from intel (verbatim), so both cards build — prose claims never hard-block.
  assert.equal(report.built.length, 2, 'both fixtures build a card');
  assert.equal(report.blockedByFact.length, 0, 'prose claims do not hard-block');
  // fx-epl-2's note references a player NOT in its intel -> flagged advisory (logged, not blocked).
  assert.ok(report.advisoryFlags.some((f) => f.fixture === 'fx-epl-2'), 'ungrounded prose flagged as advisory');
  assert.ok(report.followerPushes >= 1, 'Tottenham follower received the pre-match card');
});
