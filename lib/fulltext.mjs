// Full-text fetcher — enriches an article's source material beyond the RSS summary so synthesis
// has more real facts to work with (the main quality lever). robots.txt is checked first; if the
// host disallows the path, we fall back to the RSS summary (which IS published for syndication).
// Plain HTTP fetch + heuristic <article>/<p> extraction — no Playwright needed for these outlets.

const clean = (s) =>
  String(s).replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();

const NAV_RE = /(skip to content|homepage|accessibility|sign in|sign up|cookie|newsletter|follow us|all rights reserved|©|terms of|privacy policy|advertisement|subscribe|download the app)/i;

function isProse(t) {
  if (t.length < 50) return false;
  if (!/[.!?]/.test(t)) return false;          // real sentences end with punctuation
  if (!/[a-z]{3}/.test(t)) return false;        // has lowercase words (not nav labels)
  if (NAV_RE.test(t)) return false;             // not boilerplate
  return true;
}

function extractText(html) {
  // Prefer the <article> region; fall back to <main>, then whole doc.
  let region = html;
  const art = html.match(/<article[\s>][\s\S]*?<\/article>/i) || html.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (art) region = art[0];
  const seen = new Set();
  const paras = [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => clean(m[1]))
    .filter(isProse)
    .filter((t) => { const k = t.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
  return paras.slice(0, 10).join('\n\n').slice(0, 1800);
}

async function robotsAllows(url, ua) {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': ua } });
    if (!res.ok) return true; // no robots.txt -> allowed
    const body = await res.text();
    const { default: robotsParser } = await import('robots-parser').catch(() => ({ default: null }));
    if (!robotsParser) return true; // parser unavailable -> don't block (RSS already invited us)
    return robotsParser(`${u.origin}/robots.txt`, body).isAllowed(url, ua) !== false;
  } catch {
    return true;
  }
}

export function liveFulltext(env = process.env) {
  const ua = env.CONTACT_UA || 'Mozilla/5.0 (compatible; SportsNewsBlog/0.2)';
  return {
    async get(url) {
      try {
        if (!(await robotsAllows(url, ua))) return null; // disallowed -> use RSS summary
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(url, { headers: { 'user-agent': ua }, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const text = extractText(await res.text());
        return text && text.length > 120 ? text : null;
      } catch {
        return null; // any failure -> fall back to summary
      }
    },
  };
}

// Dry-run/test: no network — keep the RSS summary.
export function mockFulltext() {
  return { async get() { return null; } };
}
