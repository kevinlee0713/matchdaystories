// Clustering + event fingerprinting. Groups raw items reporting the SAME event (even from
// different outlets) into one cluster. This IS the DEDUP-B mechanism (collapse same-event from
// 2 outlets -> 1 issue).
//
// We cluster by TITLE/SUMMARY similarity (unigram Jaccard) within the same sport + date bucket.
// Title similarity is far more robust to cross-outlet naming variation than exact entity match
// ("Wolves" vs "Wolverhampton Wanderers" still cluster), while genuinely different events about
// the same team ("Spurs blow lead" vs "Spurs win Game 3") stay apart because their words differ.
// Mis-merges that slip through are caught downstream by the synthesis skip ("not the same event").
import { sha256, normalizeName, normalizeText, dateBucket, minhash, shingles } from '../lib/util.mjs';

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'with', 'at', 'as', 'is',
  'are', 'after', 'over', 'from', 'his', 'her', 'their', 'has', 'have', 'be', 'by', 'who', 'into', 'out']);

// Unigram token set of the HEADLINE (the strongest same-story signal; summaries vary too much
// across outlets and dilute the overlap).
function storyTokens(item) {
  const text = normalizeText(item.title || '');
  const isCJK = /[　-鿿가-힯]/.test(text);
  const toks = isCJK ? Array.from(text.replace(/\s+/g, '')) : text.split(' ');
  return new Set(toks.filter((t) => t.length > 1 && !STOP.has(t)));
}

function jaccardSet(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Event fingerprint = hash(sorted normalized entities + eventType + date bucket) — for the
// cross-run dedup ledger. Built from the cluster's merged entities.
export function eventFingerprint({ sportKey, entities, eventType, dateBucket: bucket }) {
  const ents = (entities ?? []).map(normalizeName).filter(Boolean).sort();
  return sha256(`${sportKey}|${ents.join(',')}|${eventType ?? 'news'}|${bucket}`).slice(0, 16);
}

// Greedy similarity clustering. SAME_STORY threshold tuned so paraphrased headlines about one
// event merge, but distinct events stay separate. Erring slightly loose is fine — the synthesis
// "not the same event" skip is the safety net for any over-merge.
const SAME_STORY = 0.3;

export function clusterEvents(rawItems, { bucketHours = 24 } = {}) {
  const clusters = [];
  for (const item of rawItems) {
    const bucket = dateBucket(item.publishedAt, bucketHours);
    const region = item.region || 'intl';
    const toks = storyTokens(item);
    const ents = new Set((item.entities ?? []).map(normalizeName).filter((e) => e.length > 1));
    // Join the best matching cluster: same sport+day AND (similar HEADLINE words OR >= 2 shared
    // ENTITIES). Entity overlap merges the same event across outlets that headline it differently
    // ("Mexico beat South Africa" vs "Azteca triumph for Mexico"). Bad merges are caught by the
    // synthesis "not the same event" skip.
    let best = null, bestScore = 0;
    for (const c of clusters) {
      if (c.sportKey !== item.sportKey || c.dateBucket !== bucket || c.region !== region) continue;
      const sim = jaccardSet(toks, c.repToks);
      let shared = 0;
      for (const e of ents) if (c.entitySet.has(e)) shared++;
      if (sim >= SAME_STORY || shared >= 2) {
        const score = sim + shared;
        if (score > bestScore) { bestScore = score; best = c; }
      }
    }
    if (best) {
      best.sources.push(item);
      best.entityBag.push(...(item.entities ?? []));
      for (const t of toks) best.repToks.add(t);
      for (const e of ents) best.entitySet.add(e);
    } else {
      clusters.push({
        sportKey: item.sportKey,
        dateBucket: bucket,
        region,
        repToks: new Set(toks),
        entitySet: new Set(ents),
        entityBag: [...(item.entities ?? [])],
        eventType: item.eventType ?? 'news',
        sources: [item],
      });
    }
  }

  return clusters.map((c) => {
    // Merged entities = those appearing across the cluster (dedup, keep order of first seen).
    const entities = [...new Set(c.entityBag.map((e) => e).filter(Boolean))];
    const ev = {
      sportKey: c.sportKey,
      entities,
      eventType: c.eventType,
      dateBucket: c.dateBucket,
      region: c.region,
      sources: c.sources,
    };
    ev.id = ev.fingerprint = eventFingerprint(ev);
    const titleSet = new Set();
    for (const s of c.sources) for (const sh of shingles(s.title, 2)) titleSet.add(sh);
    ev.titleMinhash = minhash(titleSet, 32);
    return ev;
  });
}
