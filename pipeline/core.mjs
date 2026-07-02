// Pipeline orchestrator core. Deterministic, dependency-injected so the same spine runs live
// (run.mjs) or against fixtures/mocks (dryrun.mjs). Spine:
//   discover -> cluster(=DEDUP-B) -> DEDUP-A -> synthesize(2-3 src) -> fact-gate ->
//   plagiarism-gate -> render card-news -> glyph-smoke -> publish KO+EN -> Telegram -> ledger
import { clusterEvents } from './cluster.mjs';
import { buildPublishedView, dedupAgainstPublished, appendLedger } from './dedup.mjs';
import { synthesizeEvent, sourceCorpus } from './synthesize.mjs';
import { selectEvents } from '../lib/select.mjs';
import { factGate } from './fact_gate.mjs';
import { plagiarismGate } from './plagiarism_gate.mjs';
import { layoutMangaPage } from '../lib/img/card_layouts.mjs';
import { mockCardImage } from '../lib/img/card_image.mjs';
import { glyphSmoke } from '../lib/img/glyph_smoke.mjs';

export async function runPipeline({ deps, config, ledgerPath }) {
  const {
    discover, llm, judges, wp, telegram,
    subscriptions, // optional (②): { match(event) -> [{chatId, lang}] }
    fulltext,      // optional: { get(url) -> richer article text | null } (quality lever)
    cardImage = mockCardImage(), // manga-page image source (live=Gemini art, default=placeholder)
  } = deps;
  const minSources = config.minSourcesPerEvent ?? 2;
  const bucketHours = config.dateBucketHours ?? 24;
  const plagiarismThreshold = config.plagiarismJaccardMax ?? 0.30;
  const sportLabel = (key) => (config.sports?.find((s) => s.key === key)?.ko) ?? key;
  const cardAccent = config.cardAccent ?? '#E4002B';
  const cardDate = (config.now || '').slice(0, 10).replace(/-/g, '.');

  const report = {
    skippedDay: false,
    discovered: 0,
    events: 0,
    publishedAfterDedup: 0,
    published: [],
    ineligible: [],
    blockedByFact: [],
    blockedByPlagiarism: [],
    cardIssues: [],
    droppedDuplicate: [],
    alerts: [],
    ledgerWrites: 0,
    followerPushes: 0,
    personalized: [],
    deferredByCap: 0,
    synthSkipped: [],
    verifyRejected: [],
    verifyRevised: [],
  };
  const alert = async (msg) => { report.alerts.push(msg); try { await telegram.alert(msg); } catch { /* alert is best-effort */ } };

  // 1) Discover
  const raw = await discover.discover({ sports: config.sports });
  report.discovered = raw.length;
  if (!raw.length) {
    report.skippedDay = true;
    await alert('discovery returned 0 items — day skipped');
    return report;
  }

  // 2) Cluster (DEDUP-B: same event from multiple outlets -> one cluster)
  const events = clusterEvents(raw, { bucketHours });
  report.events = events.length;

  // 3) Published view (WP truth + committed ledger) and 4) DEDUP-A
  const publishedView = await buildPublishedView({ ledgerPath, wp });
  if (publishedView.wpError) {
    await alert(`WP dedup-oracle query failed (${publishedView.wpError}) — degraded to ledger-only dedup`);
  }
  const { kept, dropped } = dedupAgainstPublished(events, publishedView);
  report.droppedDuplicate = dropped.map((d) => ({ fingerprint: d.ev.fingerprint, why: d.why }));

  // Semantic same-event dedup. Entity tagging is non-deterministic (the same event gets different
  // entity names each run/cluster) and heavy paraphrase defeats lexical similarity, so URL/finger-
  // print/MinHash dedup can miss a heavily-covered event that splits into different article sets.
  // An LLM judges whether a synthesized article is the SAME event as any recently-published title
  // (cross-run) or one published earlier this run (same-event split into 2 clusters).
  const publishedTitles = publishedView.recentTitles ?? [];
  const runTitles = [];

  // Sport-balanced, popularity-weighted selection with a Korean-league floor (see lib/select.mjs):
  // ~perSport per sport, off-season sports skipped, popular sports overflow into freed slots, and
  // Korean-league (region:'kr') events guaranteed a floor. No silent truncation: record deferred.
  const maxEvents = config.maxEventsPerRun ?? 12;
  const selected = selectEvents(kept, {
    perSport: config.perSportPerRun ?? 3,
    maxEvents,
    koreanFloor: config.koreanFloor ?? 2,
  });
  report.deferredByCap = Math.max(0, kept.length - selected.length);
  if (report.deferredByCap) await alert(`event cap ${maxEvents}: ${report.deferredByCap} lower-coverage event(s) deferred to a later run`);

  // 5) Per surviving event
  for (const event of selected) {
    // 5a-pre) Enrich source material with full article text (quality lever): RSS summaries are
    // 1-2 sentences; the article body gives far more real facts to synthesize from. Fail-soft:
    // robots-disallowed / fetch failure keeps the RSS summary.
    if (fulltext?.get) {
      await Promise.all((event.sources ?? []).map(async (s) => {
        try { const full = await fulltext.get(s.url); if (full) s.text = full; } catch { /* keep summary */ }
      }));
    }

    // 5a) Synthesize (multi-source required). FAIL-SOFT: a single bad event (LLM refusal, parse
    // error, mis-clustered sources) must never crash the whole run — skip it and continue.
    let synth;
    try {
      synth = await synthesizeEvent({ event, llm, minSources });
    } catch (e) {
      report.synthSkipped.push({ fingerprint: event.fingerprint, reason: String(e.message).slice(0, 140) });
      await alert(`event ${event.fingerprint} skipped — synthesis error: ${String(e.message).slice(0, 90)}`);
      continue;
    }
    if (synth.ineligible) {
      report.ineligible.push({ fingerprint: event.fingerprint, reason: synth.reason });
      await alert(`event ${event.fingerprint} dropped — ${synth.reason}`);
      continue;
    }
    const article = synth.article;
    const corpus = sourceCorpus(event);

    // Semantic same-event dedup (LLM). Fail-OPEN: a dedup error must never block publishing.
    const candidates = [...publishedTitles, ...runTitles];
    if (candidates.length && llm.isDuplicateEvent) {
      let dup = false;
      try { dup = !!(await llm.isDuplicateEvent({ title: article.titleKo, candidates })).duplicate; }
      catch { dup = false; }
      if (dup) {
        report.droppedDuplicate.push({ fingerprint: event.fingerprint, why: 'same-event(llm)' });
        await alert(`event ${event.fingerprint} dropped — same event as an already-published issue: "${article.titleKo}"`);
        continue;
      }
    }
    runTitles.push(article.titleKo);

    // 5b) Advisory judges (cannot block; if panel can't run at all -> fail-closed)
    let judgeResult;
    try {
      judgeResult = await judges.evaluate(article);
    } catch (e) {
      await alert(`issue ${event.fingerprint} held — judge panel unavailable (${e.message})`);
      report.cardIssues.push({ fingerprint: event.fingerprint, stage: 'judges', reason: e.message });
      continue; // fail-closed: do not publish unjudged
    }
    article.judge = judgeResult;

    // 5c) Fact-grounding gate — extract claims from the ENGLISH article and ground against the
    // (typically English) source corpus. Same language => deterministic matching works; a KO
    // claim ("8천만 유로") could never match an EN source ("80 million"). The KO article is a
    // faithful translation, so grounding the EN article covers both. Fail-closed on load-bearing.
    let enClaims;
    try {
      enClaims = await llm.extractClaims({ event, article, lang: 'en' });
    } catch (e) {
      report.synthSkipped.push({ fingerprint: event.fingerprint, reason: `extract failed: ${String(e.message).slice(0, 100)}` });
      await alert(`event ${event.fingerprint} skipped — claim extraction error`);
      continue;
    }
    const fg = factGate({ claims: enClaims, corpus });
    if (fg.blocked) {
      report.blockedByFact.push({
        fingerprint: event.fingerprint,
        ungrounded: fg.ungroundedLoadBearing.map((c) => `${c.type}:${c.normalized_value ?? c.text}`),
      });
      await alert(`issue ${event.fingerprint} blocked — ungrounded claim(s): ${fg.ungroundedLoadBearing.map((c) => c.text).join('; ')}`);
      continue;
    }
    article.strippedSoftClaims = fg.strippedSoft;

    // 5d) Plagiarism gate — check BOTH language bodies so the EN body is compared against
    // (typically English) sources; KO-vs-EN alone would be a trivial always-pass.
    const pg = plagiarismGate({ articleText: `${article.bodyKo}\n${article.bodyEn}`, sources: event.sources, threshold: plagiarismThreshold });
    if (!pg.ok) {
      report.blockedByPlagiarism.push({ fingerprint: event.fingerprint, maxSimilarity: pg.maxSimilarity });
      await alert(`issue ${event.fingerprint} blocked — plagiarism ${pg.maxSimilarity} > ${pg.threshold}`);
      continue;
    }
    article.plagiarism = pg;

    // 5d.5) VERIFICATION AGENT — a skeptical editor reviews each language against the sources and
    // either passes, applies a cleaned-up body (removes topic-bleed / unsupported / AI-cliché), or
    // rejects. Separate lane from the writer. Fail-soft: a verifier error does not block.
    let rejected = false;
    for (const lang of ['ko', 'en']) {
      let v;
      try { v = await llm.verifyArticle({ article, corpus, lang }); }
      catch { v = { verdict: 'pass' }; }
      if (v.verdict === 'reject') {
        rejected = true;
        report.verifyRejected.push({ fingerprint: event.fingerprint, lang });
        await alert(`issue ${event.fingerprint} rejected by verifier (${lang})`);
        break;
      }
      if (v.revisedBody) {
        if (lang === 'ko') article.bodyKo = v.revisedBody; else article.bodyEn = v.revisedBody;
        report.verifyRevised.push({ fingerprint: event.fingerprint, lang });
      }
    }
    if (rejected) continue;

    // 5e) Render the MANGA-PAGE card. The wordless 2-cut (2컷) manga page is language-neutral, so
    // generate it ONCE per issue (only after the gates pass — no art spent on blocked issues), then
    // composite the KO + EN headline/summary text onto it. Fail-soft: any render failure blocks
    // publish (never ship a broken/half image to Telegram — AC#3).
    let pageBuffer;
    try {
      pageBuffer = await cardImage.page({ article, event });
    } catch (e) {
      report.cardIssues.push({ fingerprint: event.fingerprint, stage: 'image', reason: e.message });
      await alert(`issue ${event.fingerprint} manga image generation failed: ${e.message}`);
      continue;
    }

    // Card-news is KO-only (the blog/WP still publishes KO+EN articles; only the Telegram card is
    // Korean). The wordless manga page is shared regardless.
    const cards = [];
    let cardOk = true;
    for (const lang of ['ko']) {
      // Manga-card text: punchy headline + a longer key-content summary. Fail-soft -> article title.
      let text;
      try { text = await llm.comicCard({ article, lang }); }
      catch { text = { headline: lang === 'ko' ? article.titleKo : article.titleEn, summary: (lang === 'ko' ? article.bodyKo : article.bodyEn) || '' }; }

      let card;
      try {
        card = await layoutMangaPage({
          pageBuffer, headline: text.headline, summary: text.summary,
          date: cardDate, sportLabel: sportLabel(article.sport), accent: cardAccent,
        });
      } catch (e) {
        cardOk = false;
        report.cardIssues.push({ fingerprint: event.fingerprint, stage: 'render', lang, reason: e.message });
        await alert(`issue ${event.fingerprint} card render failed (${lang}): ${e.message}`);
        break;
      }
      if (card.format !== 'png' || card.width !== 1080 || card.height !== 1080) {
        cardOk = false;
        report.cardIssues.push({ fingerprint: event.fingerprint, stage: 'render', lang, reason: 'invalid PNG dims' });
        break;
      }
      const smoke = await glyphSmoke(text.headline);
      if (!smoke.ok) {
        cardOk = false;
        report.cardIssues.push({ fingerprint: event.fingerprint, stage: 'glyph', lang, reason: smoke.reason });
        await alert(`issue ${event.fingerprint} glyph-smoke failed (${lang}): ${smoke.reason}`);
        break;
      }
      cards.push({ lang, buffer: card.buffer, caption: text.headline });
    }
    if (!cardOk) continue; // no broken images to Telegram (AC#3)

    // 5f) Publish KO+EN (Polylang pair). The KO manga card doubles as the featured image for both
    // posts (the art is wordless / language-neutral).
    article.cardImage = cards[0]?.buffer ?? null;
    const sp = config.sports?.find((s) => s.key === article.sport);
    article.sportLabelKo = sp?.category || sp?.ko || article.sport;
    article.sportLabelEn = sp?.en || article.sport;
    const pub = await wp.publishPair(article);

    // 5g) Telegram distribution
    let tg;
    if (cards.length === 1) tg = await telegram.sendPhoto(cards[0]);
    else tg = await telegram.sendMediaGroup(cards);

    // 5h) Ledger write-back — fail-closed on write failure
    try {
      appendLedger(ledgerPath, {
        fingerprint: event.fingerprint,
        titleMinhash: event.titleMinhash,
        sport: event.sportKey,
        // Source article URLs — the DETERMINISTIC same-event key. Fingerprint/MinHash depend on
        // (non-deterministic) LLM entity tagging, so the same event can get a new fingerprint each
        // run and slip past dedup; the source URLs never change, so this is the reliable safety net.
        sourceUrls: (event.sources ?? []).map((s) => s.url).filter(Boolean),
        titleKo: article.titleKo, // for semantic same-event dedup against future runs
        koId: pub.koId,
        enId: pub.enId,
        publishedAt: config.now ?? '1970-01-01T00:00:00.000Z',
      });
      report.ledgerWrites++;
    } catch (e) {
      await alert(`ledger write FAILED for ${event.fingerprint} — exiting non-zero to protect dedup integrity`);
      throw new Error(`ledger write-back failed (fail-closed): ${e.message}`);
    }

    report.published.push({
      fingerprint: event.fingerprint,
      sport: event.sportKey,
      koId: pub.koId,
      enId: pub.enId,
      paired: pub.paired,
      telegram: tg,
      cards: cards.length,
      cardImages: cards.map((c) => ({ lang: c.lang, buffer: c.buffer })), // for saving/preview
      // article text preview so the operator can read what was actually generated (WP is mock).
      preview: {
        titleKo: article.titleKo, bodyKo: article.bodyKo,
        titleEn: article.titleEn, bodyEn: article.bodyEn,
        sources: article.sources,
      },
    });

    // 5i) Personalization (②): push to followers whose follows match this event's entities.
    if (subscriptions?.match) {
      const matched = subscriptions.match(event) ?? [];
      const cardByLang = Object.fromEntries(cards.map((c) => [c.lang, c]));
      for (const sub of matched) {
        const card = cardByLang[sub.lang] ?? cards[0];
        try {
          await telegram.sendPhoto({ buffer: card.buffer, caption: card.caption, chatId: sub.chatId });
          report.followerPushes++;
        } catch (e) {
          await alert(`follower push failed (${sub.chatId}) for ${event.fingerprint}: ${e.message}`);
        }
      }
      if (matched.length) {
        report.personalized.push({ fingerprint: event.fingerprint, followers: matched.length });
      }
    }
  }

  report.publishedAfterDedup = report.published.length;
  return report;
}
