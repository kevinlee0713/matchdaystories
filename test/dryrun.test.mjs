// B3 test: the E2E dry-run gate asserts all 5 acceptance criteria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dryRun } from '../pipeline/dryrun.mjs';

test('pipeline:dry-run asserts all 5 acceptance criteria', async () => {
  const { checks } = await dryRun();
  const failures = checks.filter((c) => !c.pass);
  assert.equal(failures.length, 0, `failing checks: ${JSON.stringify(failures, null, 2)}`);
  // sanity: every AC bucket is represented
  for (const ac of ['AC#1', 'AC#2', 'AC#3', 'AC#4', 'AC#5']) {
    assert.ok(checks.some((c) => c.ac === ac && c.pass), `${ac} must have a passing assertion`);
  }
});
