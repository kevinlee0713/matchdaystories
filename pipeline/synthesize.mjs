// Multi-source synthesis. Each event needs >= minSources INDEPENDENT sources before synthesis
// (primary copyright mitigation: synthesizing 2-3 sources into a new factual account is
// defensibly transformative; single-source rewrite is the danger). Events with < minSources
// are INELIGIBLE -> routed to the degraded path, never single-source rewritten.
import { sha256 } from '../lib/util.mjs';

// Returns { article } or { ineligible: true, reason }.
export async function synthesizeEvent({ event, llm, minSources = 2 }) {
  const usable = (event.sources ?? []).filter((s) => s.text || s.snippetOnly);
  // Require >= minSources DISTINCT OUTLETS, not just items: 3 articles from one outlet are not
  // independent corroboration (and tend to bleed unrelated same-outlet topics into the cluster).
  const outlets = new Set(usable.map((s) => (s.outlet || '').toLowerCase()).filter(Boolean));
  if (outlets.size < minSources) {
    return { ineligible: true, reason: `only ${outlets.size} distinct outlet(s) (< ${minSources})`, event };
  }
  const ko = await llm.synthesize({ event, lang: 'ko' });
  // The model may decide the clustered sources aren't the same event -> not eligible.
  if (ko?.skip) return { ineligible: true, reason: `not the same event: ${ko.reason ?? 'sources differ'}`, event };
  const en = await llm.synthesize({ event, lang: 'en' });
  if (en?.skip) return { ineligible: true, reason: `not the same event: ${en.reason ?? 'sources differ'}`, event };
  const article = {
    eventId: event.id,
    fingerprint: event.fingerprint,
    sport: event.sportKey,
    titleKo: ko.title,
    bodyKo: ko.body,
    claimMapKo: ko.claimMap ?? [],
    titleEn: en.title,
    bodyEn: en.body,
    claimMapEn: en.claimMap ?? [],
    sources: usable.map((s) => ({ outlet: s.outlet, url: s.url, title: s.title })),
    titleMinhash: event.titleMinhash,
    contentHash: sha256(`${ko.title}|${ko.body}`),
  };
  return { article };
}

// Concatenated source corpus for an event — the grounding/plagiarism reference text.
export function sourceCorpus(event) {
  return (event.sources ?? []).map((s) => `${s.title}\n${s.text ?? ''}`).join('\n\n');
}
