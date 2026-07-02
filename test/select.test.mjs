import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvents } from '../lib/select.mjs';

const ev = (sportKey, cov, region = 'intl', id = '') => ({ sportKey, region, id, sources: Array.from({ length: cov }, (_, i) => ({ url: `u${sportKey}${id}${i}` })) });

test('per-sport quota balances sports (no one sport dominates)', () => {
  const events = [
    ev('football', 5, 'intl', 'a'), ev('football', 4, 'intl', 'b'), ev('football', 4, 'intl', 'c'), ev('football', 3, 'intl', 'd'), ev('football', 3, 'intl', 'e'),
    ev('baseball', 3, 'intl', 'a'), ev('baseball', 2, 'intl', 'b'),
    ev('basketball', 2, 'intl', 'a'),
  ];
  const sel = selectEvents(events, { perSport: 3, maxEvents: 12, koreanFloor: 0 });
  const bySport = sel.reduce((m, e) => ((m[e.sportKey] = (m[e.sportKey] || 0) + 1), m), {});
  assert.equal(bySport.football, 5); // 3 from quota + 2 overflow (leftover capacity)
  assert.equal(bySport.baseball, 2);
  assert.equal(bySport.basketball, 1);
});

test('off-season sports are skipped, popular sport takes the freed slots', () => {
  const events = [
    ...Array.from({ length: 8 }, (_, i) => ev('football', 5 - (i % 3), 'intl', String(i))),
    ev('baseball', 2, 'intl', 'a'),
    // volleyball, basketball: none (off-season)
  ];
  const sel = selectEvents(events, { perSport: 3, maxEvents: 12, koreanFloor: 0 });
  assert.ok(sel.filter((e) => e.sportKey === 'football').length > 3, 'football exceeds its quota using empty slots');
  assert.equal(sel.filter((e) => e.sportKey === 'baseball').length, 1);
});

test('Korean floor is guaranteed when KR events exist', () => {
  const events = [
    ev('football', 5, 'intl', 'a'), ev('football', 5, 'intl', 'b'), ev('football', 5, 'intl', 'c'),
    ev('football', 5, 'intl', 'd'), ev('football', 5, 'intl', 'e'), ev('football', 5, 'intl', 'f'),
    ev('baseball', 2, 'kr', 'k1'), ev('football', 2, 'kr', 'k2'),
  ];
  const sel = selectEvents(events, { perSport: 3, maxEvents: 6, koreanFloor: 2 });
  assert.ok(sel.filter((e) => e.region === 'kr').length >= 2, 'at least 2 KR events selected');
  assert.equal(sel.length, 6);
});
