// ② personalization: bot commands mutate the store; matcher routes events to followers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, makeSubscriptionMatcher, followMatchesEvent } from '../lib/subscriptions.mjs';
import { parseCommand, processUpdate } from '../bot/commands.mjs';

test('/follow adds an entity; /unfollow removes it; idempotent', () => {
  let subs = [];
  ({ subs } = applyCommand(subs, { chatId: '1', command: 'follow', arg: 'Tottenham', lang: 'ko' }));
  assert.equal(subs[0].follows.length, 1);
  ({ subs } = applyCommand(subs, { chatId: '1', command: 'follow', arg: 'Tottenham' })); // dup
  assert.equal(subs[0].follows.length, 1, 'no duplicate follow');
  ({ subs } = applyCommand(subs, { chatId: '1', command: 'unfollow', arg: 'Tottenham' }));
  assert.equal(subs[0].follows.length, 0);
});

test('parseCommand handles /cmd@bot and args', () => {
  assert.deepEqual(parseCommand('/follow Tottenham Hotspur'), { command: 'follow', arg: 'Tottenham Hotspur' });
  assert.deepEqual(parseCommand('/myfeed@SportsBot'), { command: 'myfeed', arg: '' });
  assert.equal(parseCommand('hello'), null);
});

test('processUpdate persists via injected store', () => {
  let saved = [];
  const store = { read: () => saved, write: (s) => { saved = s; } };
  const reply = processUpdate({ chatId: 42, text: '/follow 손흥민', lang: 'ko' }, store);
  assert.match(reply, /팔로우 추가/);
  assert.equal(saved.find((s) => s.chatId === '42').follows[0], '손흥민');
});

test('matcher routes an event to followers by entity (substring-normalized)', () => {
  const matcher = makeSubscriptionMatcher([
    { chatId: '1', follows: ['Tottenham'], lang: 'ko' },
    { chatId: '2', follows: ['Liverpool'], lang: 'en' },
  ]);
  const matched = matcher.match({ sportKey: 'football', entities: ['Tottenham Hotspur', 'Chelsea'] });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].chatId, '1');
});

test('followMatchesEvent is false when nothing overlaps', () => {
  assert.equal(followMatchesEvent(['Arsenal'], { entities: ['Tottenham', 'Chelsea'] }), false);
});
