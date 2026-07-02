// Minimal RSS/Atom reader — no dependency. Fetches a feed and returns normalized items.
// RSS is published for syndication, which makes it the legally-cleanest discovery source.

const decodeEntities = (s) =>
  String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '') // strip any stray tags inside descriptions
    .replace(/\s+/g, ' ')
    .trim();

function field(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

// Atom <link href="..."/> or RSS <link>...</link>
function linkOf(xml) {
  const rss = field(xml, 'link');
  if (rss) return rss;
  const atom = xml.match(/<link[^>]*href="([^"]+)"/i);
  return atom ? atom[1] : '';
}

function blocks(text, tag) {
  const out = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}

// Returns [{ title, description, link, pubDate, isoDate }]
export async function fetchFeed(url, { timeoutMs = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'SportsNewsBlog/0.2 (+rss reader; contact: set CONTACT_EMAIL)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = blocks(xml, 'item').length ? blocks(xml, 'item') : blocks(xml, 'entry');
    return items.map((it) => {
      const title = field(it, 'title');
      const description = field(it, 'description') || field(it, 'summary') || field(it, 'content');
      const link = linkOf(it);
      const pubDate = field(it, 'pubDate') || field(it, 'updated') || field(it, 'published');
      const ts = Date.parse(pubDate);
      return { title, description, link, pubDate, isoDate: Number.isNaN(ts) ? null : new Date(ts).toISOString() };
    }).filter((i) => i.title && i.link);
  } finally {
    clearTimeout(t);
  }
}
