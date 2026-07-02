// Plagiarism gate. MinHash/Jaccard shingle overlap between the synthesized article and its
// source texts. High overlap => too close to verbatim => FAIL (forces rewrite / blocks publish).
// This is distinct from the fact gate: plagiarism = expression similarity; facts = grounding.
import { shingles, jaccard } from '../lib/util.mjs';

// Returns { ok, maxSimilarity, perSource, threshold }
export function plagiarismGate({ articleText, sources, threshold = 0.30, n = 4 }) {
  const artSet = shingles(articleText, n);
  let maxSim = 0;
  const perSource = [];
  for (const s of sources ?? []) {
    const srcText = `${s.title ?? ''}\n${s.text ?? ''}`;
    const srcSet = shingles(srcText, n);
    const sim = jaccard(artSet, srcSet);
    perSource.push({ url: s.url, outlet: s.outlet, similarity: Number(sim.toFixed(4)) });
    if (sim > maxSim) maxSim = sim;
  }
  return {
    ok: maxSim <= threshold,
    maxSimilarity: Number(maxSim.toFixed(4)),
    threshold,
    perSource,
  };
}
