// Sport-balanced, popularity-weighted event selection with a Korean-league floor.
//
// Policy (operator, 2026-07-02):
//  - Target ~perSport events PER SPORT per run (football/baseball/basketball/volleyball).
//  - Off-season sports need NOT hit the target (just take what exists).
//  - In-season / popular sports MAY exceed the target: leftover slots (freed by empty sports)
//    go to the highest-coverage events regardless of sport (auto-adjust by popularity).
//  - Korean-league (region:'kr') events MUST appear: guaranteed a floor when any KR events exist.
//
// "Coverage" = number of distinct source outlets (more corroboration = more newsworthy).
const coverage = (e) => (e.sources?.length ?? 0);
const isKR = (e) => e.region === 'kr';

export function selectEvents(events, { perSport = 3, maxEvents = 12, koreanFloor = 2 } = {}) {
  // Group by sport; sort each by coverage desc, tie-break KR first (helps KR representation).
  const bySport = new Map();
  for (const ev of events) {
    if (!bySport.has(ev.sportKey)) bySport.set(ev.sportKey, []);
    bySport.get(ev.sportKey).push(ev);
  }
  for (const arr of bySport.values()) {
    arr.sort((a, b) => coverage(b) - coverage(a) || (isKR(b) - isKR(a)));
  }

  // Phase A — per-sport quota: up to `perSport` from each sport (guarantees balance/representation).
  const selected = [];
  const queues = [...bySport.values()];
  for (const q of queues) {
    for (let i = 0; i < perSport && q.length && selected.length < maxEvents; i++) selected.push(q.shift());
  }
  // Phase B — overflow: fill remaining capacity with the most-covered leftovers (any sport). This is
  // where an in-season/popular sport exceeds its quota using slots an off-season sport left empty.
  const leftover = queues.flat().sort((a, b) => coverage(b) - coverage(a));
  for (const ev of leftover) {
    if (selected.length >= maxEvents) break;
    selected.push(ev);
  }

  // Korean floor — ensure >= koreanFloor KR events when available: swap out the lowest-coverage
  // international picks for the highest-coverage unselected KR events.
  let krCount = selected.filter(isKR).length;
  if (krCount < koreanFloor) {
    const chosen = new Set(selected);
    const krPool = events.filter((e) => isKR(e) && !chosen.has(e)).sort((a, b) => coverage(b) - coverage(a));
    const intlAsc = selected.filter((e) => !isKR(e)).sort((a, b) => coverage(a) - coverage(b));
    while (krCount < koreanFloor && krPool.length && intlAsc.length) {
      const drop = intlAsc.shift();
      selected[selected.indexOf(drop)] = krPool.shift();
      krCount++;
    }
  }
  return selected.slice(0, maxEvents);
}
