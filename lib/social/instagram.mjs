// Instagram adapter — publishes a single-image feed post via the Instagram Graph API.
// Flow is two calls: (1) create a media container from a PUBLIC image_url + caption,
// (2) publish that container. Instagram fetches the image by URL (no byte upload), so the
// card must already live at a public URL — we reuse the WordPress featured-image URL.
//
// Requires an Instagram *Business/Creator* account linked to a Facebook Page, plus a
// long-lived access token. Set IG_USER_ID and IG_ACCESS_TOKEN in .env. If either is
// missing, publish() is a no-op (skipped) so dry-runs and un-provisioned envs stay green.
//
// A mock factory (for dry-run/tests) records calls without network.

const GRAPH = (version, path) => `https://graph.facebook.com/${version}/${path}`;

export function liveInstagram(env = process.env) {
  const igUserId = env.IG_USER_ID;
  const token = env.IG_ACCESS_TOKEN;
  const version = env.IG_GRAPH_VERSION || 'v21.0';
  const wired = Boolean(igUserId && token);

  async function graphPost(path, params) {
    const body = new URLSearchParams({ ...params, access_token: token });
    const res = await fetch(GRAPH(version, path), { method: 'POST', body });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Instagram Graph error (${path}): ${JSON.stringify(json.error ?? json)}`);
    }
    return json;
  }

  return {
    wired,
    // Publish one image post. { imageUrl (public), caption } -> { id, permalink }
    async publish({ imageUrl, caption }) {
      if (!wired) {
        console.warn('[instagram] not wired (IG_USER_ID / IG_ACCESS_TOKEN unset) — skipping');
        return { skipped: true };
      }
      if (!imageUrl) throw new Error('instagram.publish requires a public imageUrl');
      // 1) create container
      const container = await graphPost(`${igUserId}/media`, {
        image_url: imageUrl,
        ...(caption ? { caption } : {}),
      });
      // 2) publish container
      const published = await graphPost(`${igUserId}/media_publish`, {
        creation_id: container.id,
      });
      let permalink;
      try {
        const res = await fetch(
          GRAPH(version, `${published.id}?fields=permalink&access_token=${token}`)
        );
        const meta = await res.json();
        permalink = meta.permalink;
      } catch { /* permalink is best-effort */ }
      return { id: published.id, permalink };
    },
  };
}

// Mock for dry-run/tests — records every call, no network.
export function mockInstagram() {
  const calls = { posts: [] };
  return {
    calls,
    wired: true,
    async publish({ imageUrl, caption }) {
      if (!imageUrl) throw new Error('instagram.publish received empty imageUrl');
      calls.posts.push({ imageUrl, caption });
      return { id: `mock_${calls.posts.length}`, permalink: `https://instagram.com/p/mock${calls.posts.length}` };
    },
  };
}

// Build an Instagram caption from an article. Headline + short body + blog link + hashtags.
// IG caption limit is 2200 chars and max 30 hashtags — we stay well under both.
export function buildCaption({ headline, summary, url, hashtags = [] }) {
  const tags = hashtags
    .filter(Boolean)
    .slice(0, 30)
    .map((t) => (t.startsWith('#') ? t : `#${t.replace(/\s+/g, '')}`))
    .join(' ');
  const parts = [
    headline,
    summary,
    url ? `📰 전문: ${url}` : null,
    tags || null,
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, 2200);
}
