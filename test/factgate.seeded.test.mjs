// B1 test: a load-bearing wrong score must be BLOCKED; a grounded article must PASS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factGate } from '../pipeline/fact_gate.mjs';

const corpus = 'The home team won 2-1 in extra innings. Manchester agreed an 80 million euro fee.';

test('blocks a load-bearing ungrounded score (sources say 2-1, article claims 3-0)', () => {
  const claims = [{ type: 'score', text: '3-0', normalized_value: '3-0', loadBearing: true }];
  const r = factGate({ claims, corpus });
  assert.equal(r.blocked, true, 'must block');
  assert.equal(r.ok, false);
  assert.equal(r.ungroundedLoadBearing.length, 1);
});

test('passes when the score claim matches the corpus (2-1)', () => {
  const claims = [{ type: 'score', text: '2-1', normalized_value: '2-1', loadBearing: true }];
  const r = factGate({ claims, corpus });
  assert.equal(r.blocked, false, 'must not block');
  assert.equal(r.ok, true);
});

test('grounds fee and team claims present in corpus', () => {
  const claims = [
    { type: 'fee', text: '8천만 유로', normalized_value: '80 million', loadBearing: true },
    { type: 'team', text: '맨체스터', normalized_value: 'Manchester', loadBearing: false },
  ];
  const r = factGate({ claims, corpus });
  assert.equal(r.ok, true);
  assert.equal(r.ungroundedLoadBearing.length, 0);
});

test('strips a soft ungrounded claim without blocking', () => {
  const claims = [{ type: 'color', text: 'a thrilling night', normalized_value: 'a thrilling night', loadBearing: false }];
  const r = factGate({ claims, corpus });
  assert.equal(r.blocked, false);
  assert.equal(r.strippedSoft.length, 1);
});

// Regression: substring false-positives must NOT ground (Phase-4 review BUG 1 & 2).
test('score 3-0 does NOT falsely match a corpus that says 13-0', () => {
  const r = factGate({
    claims: [{ type: 'score', text: '3-0', normalized_value: '3-0', loadBearing: true }],
    corpus: 'The home side won 13-0 in a rout.',
  });
  assert.equal(r.blocked, true, '3-0 must not match inside 13-0');
});

test('fee 80 million does NOT falsely match 180 million — flagged advisory, not blocked', () => {
  const r = factGate({
    claims: [{ type: 'fee', text: '80m', normalized_value: '80 million', loadBearing: true }],
    corpus: 'Sources confirm a 180 million euro valuation.',
  });
  // Fees are advisory (only scorelines hard-block): ungrounded -> stripped, never blocks.
  assert.equal(r.blocked, false, 'a fee never hard-blocks');
  assert.equal(r.strippedSoft.length, 1, '80 != 180 -> correctly flagged ungrounded (advisory)');
});

test('prose claim (outcome) is advisory — ungrounded prose is stripped, never hard-blocks', () => {
  // "win" must not falsely ground in "winter" (word-boundary), and as PROSE it is advisory:
  // ungrounded -> stripped (logged), NOT a publication block.
  const r = factGate({
    claims: [{ type: 'outcome', text: 'win', normalized_value: 'win', loadBearing: true }],
    corpus: 'It was a long winter of rebuilding.',
  });
  assert.equal(r.blocked, false, 'prose claim never hard-blocks');
  assert.equal(r.strippedSoft.length, 1, 'ungrounded prose is flagged advisory (stripped)');
});

test('only a contradicting scoreline hard-blocks; an ungrounded fee does not', () => {
  // A wrong score (sources say 2-1, article claims 3-0) blocks.
  const blockScore = factGate({
    claims: [{ type: 'score', text: '3-0', normalized_value: '3-0' }],
    corpus: 'The home team won 2-1 for a 50 million euro club.',
  });
  assert.equal(blockScore.blocked, true, 'contradicting scoreline blocks');

  // A fee that disagrees does NOT block (advisory).
  const feeOnly = factGate({
    claims: [{ type: 'fee', text: '90 million', normalized_value: '90 million' }],
    corpus: 'The fee was 80 million euros.',
  });
  assert.equal(feeOnly.blocked, false, 'fee is advisory, never blocks');
});

test('a scoreline with no score in the sources is advisory (cannot verify -> do not block)', () => {
  const r = factGate({
    claims: [{ type: 'score', text: '3-0', normalized_value: '3-0' }],
    corpus: 'The manager praised his squad after a strong season.', // no scoreline to contradict
  });
  assert.equal(r.blocked, false, 'no score in sources -> cannot verify -> advisory');
});
