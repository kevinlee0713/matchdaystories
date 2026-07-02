// Personalization (②): per-user follow store + event matcher.
// Store = data/subscriptions.ndjson, one JSON line per subscriber:
//   { chatId: "123", follows: ["Tottenham","손흥민"], lang: "ko" }
// Subscribers receive a personalized DM card for any published event whose entities match
// one of their follows. This turns the firehose into a personal feed (retention driver).
import fs from 'node:fs';
import path from 'node:path';
import { normalizeName } from './util.mjs';

export function readSubscriptions(storePath) {
  if (!fs.existsSync(storePath)) return [];
  return fs.readFileSync(storePath, 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function writeSubscriptions(storePath, subs) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, subs.map((s) => JSON.stringify(s)).join('\n') + (subs.length ? '\n' : ''), 'utf8');
}

// Does any of the subscriber's follows match any of the event's entities?
// Normalized substring match so "manchester" follows "Manchester United".
export function followMatchesEvent(follows, event) {
  const ents = (event.entities ?? []).map(normalizeName);
  return (follows ?? []).some((f) => {
    const nf = normalizeName(f);
    return nf.length > 0 && ents.some((e) => e.includes(nf) || nf.includes(e));
  });
}

// Build a matcher usable as a pipeline dep: match(event) -> [{chatId, lang}]
export function makeSubscriptionMatcher(subs) {
  return {
    subs,
    match(event) {
      return (subs ?? [])
        .filter((s) => followMatchesEvent(s.follows, event))
        .map((s) => ({ chatId: s.chatId, lang: s.lang ?? 'ko' }));
    },
  };
}

// Mutating command application — returns { subs, reply }. Pure given inputs (no I/O).
export function applyCommand(subs, { chatId, command, arg, lang }) {
  const list = subs.map((s) => ({ ...s, follows: [...(s.follows ?? [])] }));
  let sub = list.find((s) => s.chatId === chatId);
  const ensure = () => {
    if (!sub) { sub = { chatId, follows: [], lang: lang ?? 'ko' }; list.push(sub); }
    return sub;
  };
  switch (command) {
    case 'follow': {
      if (!arg) return { subs: list, reply: '사용법: /follow <팀 또는 선수>' };
      ensure();
      const exists = sub.follows.some((f) => normalizeName(f) === normalizeName(arg));
      if (!exists) sub.follows.push(arg);
      return { subs: list, reply: exists ? `이미 팔로우 중: ${arg}` : `✅ 팔로우 추가: ${arg}` };
    }
    case 'unfollow': {
      if (!sub) return { subs: list, reply: '팔로우 목록이 비어 있습니다.' };
      const before = sub.follows.length;
      sub.follows = sub.follows.filter((f) => normalizeName(f) !== normalizeName(arg));
      return { subs: list, reply: sub.follows.length < before ? `🗑 언팔로우: ${arg}` : `목록에 없음: ${arg}` };
    }
    case 'myfeed':
    case 'list': {
      const follows = sub?.follows ?? [];
      return { subs: list, reply: follows.length ? `팔로우 중: ${follows.join(', ')}` : '아직 팔로우한 항목이 없습니다. /follow <팀>' };
    }
    default:
      return { subs: list, reply: '명령어: /follow <팀>, /unfollow <팀>, /myfeed' };
  }
}
