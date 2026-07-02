// Discovery: find the day's candidate news items per sport.
// Live impl = RSS feeds (config/sources.json) — RSS is published for syndication, the legally-
// cleanest source. Pulls multiple English sports outlets, keeps recent items, and tags
// entities/eventType (via llm) so the SAME event from different outlets clusters for multi-source
// synthesis. Fixture impl returns recorded raw items so the dry-run is deterministic.
//
// rawItem shape:
//   { sportKey, outlet, url, title, text, publishedAt, entities: string[], eventType }
import fs from 'node:fs';
import path from 'node:path';
import { fetchFeed } from '../lib/rss.mjs';
import { ROOT_DIR } from '../lib/config.mjs';

export function liveDiscover(env = process.env, llm = null) {
  const cfgPath = path.join(ROOT_DIR, 'config', 'sources.json');
  return {
    async discover() {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const feeds = cfg.feeds ?? [];
      if (!feeds.length) throw new Error('No feeds in config/sources.json');
      const recencyMs = (cfg.recencyHours ?? 48) * 3600 * 1000;
      const maxPer = cfg.maxItemsPerFeed ?? 25;
      const nowMs = Date.parse(env.SNB_NOW || new Date().toISOString());

      // Fetch all feeds in parallel; skip failures (resilient — a dead feed never kills the run).
      const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f.url)));
      const raw = [];
      results.forEach((r, i) => {
        const f = feeds[i];
        if (r.status !== 'fulfilled') { console.warn(`  ⚠ feed failed: ${f.outlet} (${r.reason?.message})`); return; }
        const recent = r.value
          .filter((it) => !it.isoDate || (nowMs - Date.parse(it.isoDate)) <= recencyMs)
          .slice(0, maxPer);
        for (const it of recent) {
          raw.push({
            sportKey: f.sportKey,
            outlet: f.outlet,
            url: it.link,
            title: it.title,
            text: it.description || it.title,
            publishedAt: it.isoDate || new Date(nowMs).toISOString(),
          });
        }
      });
      if (!raw.length) return [];

      // Tag entities + eventType so cross-outlet same-event items cluster together.
      if (llm?.tagItems) {
        const tags = await llm.tagItems(raw);
        raw.forEach((it, i) => { it.entities = tags[i]?.entities ?? []; it.eventType = tags[i]?.eventType ?? 'other'; });
      } else {
        raw.forEach((it) => { it.entities = []; it.eventType = 'other'; });
      }
      return raw;
    },
  };
}

export function fixtureDiscover(rawItems) {
  return {
    async discover() {
      return rawItems;
    },
  };
}
