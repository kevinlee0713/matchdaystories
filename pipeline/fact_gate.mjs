// Fact-grounding gate (B1). DETERMINISTIC grounding — NOT an LLM opinion poll.
// Claims are extracted (by the LLM extractor) as structured items; this gate then verifies
// each claim against the synthesis source corpus via span / numeric / name matching.
// Fail-closed: any LOAD-BEARING ungrounded claim BLOCKS the issue. Soft claims are stripped.
import { normalizeText, normalizeName, normalizeScore } from '../lib/util.mjs';

// Only NUMERIC facts hard-block. Deterministic grounding reliably verifies numbers (scores,
// fees, dates) language-independently — and a wrong number is the main fabrication vector.
// Prose claims (player/team/outcome/quote) are PARAPHRASE- and TRANSLATION-sensitive: "earned
// the save" vs "recorded a save", or a Korean name vs an English source, can't be matched
// deterministically without false positives. So those are advisory (stripped + logged), never
// hard-block. Multi-source synthesis + advisory judges (+ a future entailment check) cover them.
const LOAD_BEARING_TYPES = new Set(['score', 'date', 'fee']);

function isLoadBearing(claim) {
  // A prose type never hard-blocks, regardless of the extractor's loadBearing flag.
  if (!LOAD_BEARING_TYPES.has(claim.type)) return false;
  if (typeof claim.loadBearing === 'boolean') return claim.loadBearing;
  return true;
}

// Extract all normalized scores present in the corpus, e.g. "2-1".
function corpusScores(normCorpus) {
  const set = new Set();
  const re = /(\d{1,3})\s*[-:]\s*(\d{1,3})/g;
  let m;
  while ((m = re.exec(normCorpus))) set.add(`${m[1]}-${m[2]}`);
  return set;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A number must appear in the corpus as a WHOLE number (not a digit-substring of a larger
// number) — so "80" does NOT match inside "180", and "3" in "3-0" does NOT match "13-0".
function wholeNumberInCorpus(num, normCorpus) {
  return new RegExp(`(?<!\\d)${escapeRe(num)}(?!\\d)`).test(normCorpus);
}

// A non-numeric token must appear bounded (word boundary for Latin; substring for CJK which
// has no word boundaries).
function tokenInCorpus(tok, normCorpus) {
  if (!tok) return false;
  if (/[　-鿿가-힯]/.test(tok)) return normCorpus.includes(tok);
  return new RegExp(`(?:^|\\s)${escapeRe(tok)}(?:$|\\s)`, 'u').test(normCorpus);
}

// Scale words that change a number's meaning — these MUST match (so "80 thousand" can't ground
// against an "80 million" corpus). Currency/unit words (euro/euros, dollar, won) and plurals are
// incidental and are NOT required — that avoids false blocks on "euro" vs "euros".
const MAGNITUDE = new Set(['million', 'billion', 'trillion', 'thousand', 'hundred', 'm', 'bn', 'k', '억', '만', '천만', '조', '천']);

// Ground a value that may mix numbers and words (fee "80 million euros", date "15 june 2026").
// Rule: every NUMBER must be a whole-number match, AND every MAGNITUDE word present in the claim
// must appear in the corpus. Incidental words (currency, plurals) are ignored.
function groundMixed(value, normCorpus) {
  const v = normalizeText(value);
  if (!v) return false;
  const numbers = v.match(/\d+/g) ?? [];
  if (numbers.length) {
    const numsOk = numbers.every((n) => wholeNumberInCorpus(n, normCorpus));
    const mags = v.split(/\s+/).filter((w) => MAGNITUDE.has(w));
    const magsOk = mags.every((w) => normCorpus.includes(w));
    return numsOk && magsOk;
  }
  // purely textual: require the whole phrase, bounded
  return tokenInCorpus(v, normCorpus) || (/[　-鿿가-힯]/.test(v) && normCorpus.includes(v));
}

// Is a single claim grounded in the corpus?
export function groundClaim(claim, normCorpus, scoreSet, nameCorpus) {
  const value = String(claim.normalized_value ?? claim.text ?? '').trim();
  if (!value) return false;
  switch (claim.type) {
    case 'score': {
      const cs = normalizeScore(value);
      // Exact whole-token score match only (scoreSet is built from regex-extracted tokens).
      return !!cs && scoreSet.has(cs);
    }
    case 'player':
    case 'team': {
      const nm = normalizeName(value);
      return nm.length > 0 && nameCorpus.includes(nm);
    }
    case 'quote': {
      const q = normalizeText(value);
      return q.length > 0 && normCorpus.includes(q);
    }
    case 'date':
    case 'fee':
    case 'outcome':
    default:
      return groundMixed(value, normCorpus);
  }
}

// Evaluate all claims for an article against its source corpus.
//
// HARD-BLOCK policy (deliberately narrow): only a clean match SCORELINE (N-M) that CONTRADICTS
// the scores stated in the sources blocks publication. A wrong scoreline is the highest-value,
// most-checkable fabrication in sports; everything else — fees, dates, win/loss records, names,
// prose — is expressed in too many formats (word-numbers like "five", "free transfer", date
// styles) for deterministic matching to verify without false positives, so those are ADVISORY
// (logged, never block). Multi-source synthesis + the no-invent prompt cover them; a future
// entailment check can harden them.
// Returns { ok, blocked, ungroundedLoadBearing[], strippedSoft[], checked }
export function factGate({ claims, corpus }) {
  const normCorpus = normalizeText(corpus);
  const nameCorpus = normalizeName(corpus);
  const scoreSet = corpusScores(normCorpus);

  const ungroundedLoadBearing = [];
  const strippedSoft = [];
  for (const claim of claims ?? []) {
    const cs = claim.type === 'score' ? normalizeScore(claim.normalized_value ?? claim.text) : null;
    if (cs) {
      // Clean scoreline. Grounded if it matches a score in the sources.
      if (scoreSet.has(cs)) continue;
      // Ungrounded: BLOCK only if the sources actually state a (different) score to contradict.
      // If the sources contain no scoreline, we can't verify it -> advisory, don't block.
      if (scoreSet.size > 0) ungroundedLoadBearing.push(claim);
      else strippedSoft.push(claim);
      continue;
    }
    // Non-scoreline claim: advisory only — check grounding for logging, never block.
    if (!groundClaim(claim, normCorpus, scoreSet, nameCorpus)) strippedSoft.push(claim);
  }
  const blocked = ungroundedLoadBearing.length > 0;
  return {
    ok: !blocked,
    blocked,
    ungroundedLoadBearing,
    strippedSoft,
    checked: (claims ?? []).length,
  };
}
