// WordPress publish adapter. Live impl ports VOBET's proven createWordPressPost + Polylang pairing
// (pll_set_post_language / pll_save_post_translations) + Rank Math meta over SSH/wp-cli.
// Publishes KO + EN as a linked translation pair; stores the issue fingerprint as post meta
// (`_snb_fingerprint`) so it doubles as the cross-run dedup oracle (DEDUP-A).
import { wpCli, sshPutBuffer, sshRm } from './ssh.mjs';

const FP_META = '_snb_fingerprint';
const SRC_META = '_snb_source_urls';
const esc = (s) => String(s ?? '').replace(/"/g, '\\"');

// Plain-text body (paragraphs separated by blank lines) -> HTML, with a source-attribution footer
// (copyright posture: the blog article credits sources; the card stays clean).
function bodyToHtml(body, sources, lang) {
  const paras = String(body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n');
  const label = lang === 'ko' ? '출처' : 'Sources';
  const links = (sources || []).filter((s) => s.url)
    .map((s) => `<li><a href="${s.url}" target="_blank" rel="nofollow noopener">${esc(s.outlet || s.url)}</a></li>`).join('');
  const footer = links ? `\n<hr>\n<p><strong>${label}</strong></p>\n<ul>${links}</ul>` : '';
  return `${paras}${footer}`;
}

export function liveWordPress(env = process.env) {
  function assertWired() {
    if (!env.WP_SSH_HOST || !env.WP_SSH_USER || !env.WP_PATH) {
      throw new Error('WordPress not wired: set WP_SSH_HOST/WP_SSH_USER/WP_SSH_KEY_PATH/WP_PATH (see SECRETS.md)');
    }
  }

  // Find-or-create a category by name; returns its term_id (idempotent — Polylang dedups by slug).
  async function getOrCreateCategory(name) {
    try {
      const out = await wpCli(`term list category --search="${esc(name)}" --format=json --fields=term_id,name`, env);
      const found = JSON.parse(out || '[]').find((t) => t.name === name);
      if (found) return parseInt(found.term_id, 10);
    } catch { /* fall through to create */ }
    try {
      return parseInt(await wpCli(`term create category "${esc(name)}" --porcelain`, env), 10);
    } catch (e) {
      const slug = name.toLowerCase().trim().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-');
      for (const lookup of [`--name="${esc(name)}"`, `--slug="${slug}"`]) {
        const id = (await wpCli(`term list category ${lookup} --field=term_id`, env).catch(() => '')).split(/\s+/)[0];
        if (id) return parseInt(id, 10);
      }
      throw e;
    }
  }

  // Upload a PNG buffer to the WP media library; returns the attachment id.
  async function uploadMedia(buffer, alt) {
    const remote = `/tmp/snb_img_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    await sshPutBuffer(buffer, remote, env);
    try {
      const id = parseInt(await wpCli(`media import "${remote}" --title="${esc(alt)}" --alt="${esc(alt)}" --porcelain`, env), 10);
      return Number.isNaN(id) ? null : id;
    } finally { await sshRm(remote, env).catch(() => {}); }
  }

  // Create one post via an eval-file PHP body (wp_insert_post + tags + meta + thumbnail). Returns id.
  async function createPost({ title, content, categoryId, tags = [], meta = {}, featuredMedia }) {
    const ts = `${Date.now()}_${Math.floor(Math.random() * 9999)}`;
    const dataFile = `/tmp/snb_data_${ts}.json`;
    const phpFile = `/tmp/snb_php_${ts}.php`;
    const postData = { title, content, status: 'publish', categories: [categoryId], tags, meta, featured_media: featuredMedia || 0 };
    const php = `<?php
$d = json_decode(file_get_contents('${dataFile}'), true);
$admins = get_users(['role'=>'administrator','number'=>1,'fields'=>'ID']);
$post_arr = [
  'post_title'=>$d['title'], 'post_content'=>$d['content'], 'post_status'=>$d['status'],
  'post_category'=>$d['categories'], 'post_author'=>(!empty($admins)?(int)$admins[0]:1),
];
$id = wp_insert_post($post_arr, true);
if (is_wp_error($id)) { fwrite(STDERR,'ERROR:'.$id->get_error_message()); exit(1); }
if (!empty($d['tags'])) wp_set_post_tags($id, $d['tags'], false);
foreach ($d['meta'] as $k=>$v) update_post_meta($id, $k, $v);
if (!empty($d['featured_media'])) set_post_thumbnail($id, (int)$d['featured_media']);
echo $id;`;
    await sshPutBuffer(Buffer.from(JSON.stringify(postData), 'utf8'), dataFile, env);
    await sshPutBuffer(Buffer.from(php, 'utf8'), phpFile, env);
    try {
      const idStr = await wpCli(`eval-file "${phpFile}"`, env);
      const id = parseInt(idStr, 10);
      if (Number.isNaN(id)) throw new Error(`createPost: WP-CLI returned: ${idStr}`);
      return id;
    } finally { await Promise.all([sshRm(dataFile, env), sshRm(phpFile, env)]).catch(() => {}); }
  }

  async function setLang(postId, slug) {
    await wpCli(`eval "if(function_exists('pll_set_post_language')) pll_set_post_language(${postId}, '${slug}');"`, env).catch(() => {});
  }

  return {
    // Publishes KO + EN and links them as a Polylang translation pair. Stores the fingerprint meta.
    async publishPair(article) {
      assertWired();
      const sportKo = article.sportLabelKo || article.sport;
      const sportEn = article.sportLabelEn || article.sport;
      const rankMath = (desc) => ({ rank_math_description: String(desc || '').slice(0, 160) });

      // Featured image: the (KO) manga card, uploaded once and reused for both posts.
      let media = null;
      if (article.cardImage) { try { media = await uploadMedia(article.cardImage, article.titleKo || 'sports'); } catch { media = null; } }

      const srcUrls = JSON.stringify((article.sources ?? []).map((s) => s.url).filter(Boolean));
      const commonMeta = { [FP_META]: article.fingerprint, [SRC_META]: srcUrls };
      const koCat = await getOrCreateCategory(sportKo);
      const koId = await createPost({
        title: article.titleKo, content: bodyToHtml(article.bodyKo, article.sources, 'ko'),
        categoryId: koCat, meta: { ...rankMath(article.bodyKo), ...commonMeta }, featuredMedia: media,
      });
      await setLang(koId, 'ko');

      const enCat = await getOrCreateCategory(sportEn);
      const enId = await createPost({
        title: article.titleEn, content: bodyToHtml(article.bodyEn, article.sources, 'en'),
        categoryId: enCat, meta: { ...rankMath(article.bodyEn), ...commonMeta }, featuredMedia: media,
      });
      await setLang(enId, 'en');

      // Link the translation pair.
      await wpCli(`eval "if(function_exists('pll_save_post_translations')) pll_save_post_translations(array('ko'=>${koId},'en'=>${enId}));"`, env).catch(() => {});

      return { koId, enId, paired: true };
    },

    // Dedup oracle: list every published issue fingerprint stored in post meta.
    async listPublishedFingerprints() {
      assertWired();
      const out = await wpCli(
        `eval "foreach(get_posts(array('post_type'=>'post','post_status'=>'publish','posts_per_page'=>-1,'fields'=>'ids','meta_key'=>'${FP_META}')) as \\$id){echo get_post_meta(\\$id,'${FP_META}',true).PHP_EOL;}"`,
        env);
      return out.split('\n').map((s) => s.trim()).filter(Boolean);
    },
    // Dedup oracle (deterministic): every source URL recorded on a published post. Each post meta
    // holds a JSON array; flatten across posts.
    async listPublishedSourceUrls() {
      assertWired();
      const out = await wpCli(
        `eval "foreach(get_posts(array('post_type'=>'post','post_status'=>'publish','posts_per_page'=>-1,'fields'=>'ids','meta_key'=>'${SRC_META}')) as \\$id){echo get_post_meta(\\$id,'${SRC_META}',true).PHP_EOL;}"`,
        env);
      const urls = [];
      for (const line of out.split('\n')) {
        try { const a = JSON.parse(line.trim()); if (Array.isArray(a)) urls.push(...a); } catch { /* skip */ }
      }
      return urls;
    },
    // Dedup oracle: recent published KO post titles (semantic same-event dedup candidates).
    async listPublishedTitles(limit = 60) {
      assertWired();
      const out = await wpCli(`post list --post_type=post --post_status=publish --posts_per_page=${limit} --orderby=date --order=DESC --fields=post_title --format=json`, env);
      try {
        const arr = JSON.parse(out);
        return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : x.post_title)).filter(Boolean) : [];
      } catch { return out.split('\n').map((s) => s.trim()).filter(Boolean); }
    },
  };
}

// Mock for dry-run/tests — records published pairs in-memory.
export function mockWordPress() {
  const published = [];
  let nextId = 1000;
  return {
    published,
    async publishPair(article) {
      const koId = nextId++;
      const enId = nextId++;
      const record = {
        koId,
        enId,
        paired: true,
        sport: article.sport,
        fingerprint: article.fingerprint,
        titleKo: article.titleKo,
        titleEn: article.titleEn,
        sourceUrls: (article.sources ?? []).map((s) => s.url).filter(Boolean),
      };
      published.push(record);
      return record;
    },
    async listPublishedFingerprints() {
      return published.map((p) => p.fingerprint);
    },
    async listPublishedSourceUrls() {
      return published.flatMap((p) => p.sourceUrls ?? []);
    },
    async listPublishedTitles() {
      return published.map((p) => p.titleKo).filter(Boolean);
    },
  };
}
