// Shared deterministic helpers: hashing, text normalization, shingles, MinHash.
// No external deps — keeps the locally-testable MVP install-light.
import crypto from 'node:crypto';

export function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex');
}

// Normalize text for matching: lowercase, collapse whitespace, strip most punctuation
// (keep digits, hyphens between digits for scores, and CJK).
export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s\-:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalize a name (team/player) for fuzzy compare: drop diacritics-ish, lowercase, no spaces.
export function normalizeName(s) {
  return normalizeText(s).replace(/\s+/g, '');
}

// Normalize a score like "2 - 1", "2:1", "2-1" -> "2-1".
export function normalizeScore(s) {
  const m = String(s).match(/(\d{1,3})\s*[-:vs]+\s*(\d{1,3})/i);
  return m ? `${m[1]}-${m[2]}` : null;
}

// Word/char shingles (n-grams) for similarity. CJK -> char shingles, else word shingles.
export function shingles(text, n = 3) {
  const norm = normalizeText(text);
  const isCJK = /[　-鿿가-힯]/.test(norm);
  const tokens = isCJK ? Array.from(norm.replace(/\s+/g, '')) : norm.split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= tokens.length; i++) {
    out.add(tokens.slice(i, i + n).join(isCJK ? '' : ' '));
  }
  if (out.size === 0 && tokens.length) out.add(tokens.join(isCJK ? '' : ' '));
  return out;
}

export function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Deterministic MinHash signature over a shingle set (k hash permutations via salted sha256).
export function minhash(shingleSet, k = 32) {
  const sig = new Array(k).fill(Infinity);
  for (const sh of shingleSet) {
    for (let i = 0; i < k; i++) {
      const h = parseInt(sha256(`${i}:${sh}`).slice(0, 12), 16);
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

export function minhashSimilarity(sigA, sigB) {
  if (!sigA?.length || sigA.length !== sigB?.length) return 0;
  let same = 0;
  for (let i = 0; i < sigA.length; i++) if (sigA[i] === sigB[i]) same++;
  return same / sigA.length;
}

// Date bucket: floor a timestamp to an N-hour bucket (UTC) -> stable string key.
export function dateBucket(iso, hours = 24) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  const ms = hours * 3600 * 1000;
  const bucket = Math.floor(t / ms) * ms;
  return new Date(bucket).toISOString().slice(0, hours >= 24 ? 10 : 13);
}
