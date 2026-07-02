// LLM client: multi-source synthesis (KO write + EN translate) and fact-claim extraction.
// liveLLM calls Anthropic (claude-sonnet-4-6). fixtureLLM returns recorded outputs so the
// dry-run is deterministic and needs no API key.
//
// The fact-claim EXTRACTOR is itself an LLM; its recall is a tracked follow-up — a missed
// extraction can't be grounded-checked. Temperature 0 + a structured instruction mitigate it.

// Robustly parse a JSON object/array from a model response that may wrap it in prose/fences.
export function parseJsonLoose(text) {
  if (!text) throw new Error('empty LLM response');
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through to balance scan */ }
  const start = s.search(/[[{]/);
  if (start >= 0) {
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === open) depth++;
      else if (s[i] === close) { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
    }
  }
  throw new Error(`could not parse JSON from LLM response: ${s.slice(0, 120)}`);
}

export function liveLLM(env = process.env) {
  const key = env.ANTHROPIC_API_KEY;
  const synthModel = env.SYNTHESIS_MODEL || 'claude-sonnet-4-6';
  const extractModel = env.EXTRACTOR_MODEL || 'claude-sonnet-4-6';
  let _client = null;

  async function client() {
    if (!key) throw new Error('LLM not wired: set ANTHROPIC_API_KEY (see SECRETS.md)');
    if (_client) return _client;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: key });
    return _client;
  }

  async function callJSON({ model, system, prompt, temperature, maxTokens = 2000 }) {
    const c = await client();
    return parseJsonLoose(await callText({ model, system, prompt, temperature, maxTokens }));
  }

  // Raw-text call (no JSON parsing) — used for the long article body via a delimiter format that
  // avoids JSON string-escaping pitfalls (unescaped quotes / literal newlines in prose).
  async function callText({ model, system, prompt, temperature, maxTokens = 2000 }) {
    const c = await client();
    const req = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] };
    if (typeof temperature === 'number') req.temperature = temperature;
    const res = await c.messages.create(req);
    return (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  // Parse the SKIP/TITLE/BODY delimiter format into { title, body } or { skip }.
  function parseArticle(text) {
    if (/^\s*SKIP:\s*yes/im.test(text) && !/TITLE:/i.test(text)) return { skip: true, reason: 'not the same event' };
    const title = (text.match(/TITLE:\s*(.+)/i) || [])[1]?.trim();
    const body = (text.match(/BODY:\s*\n?([\s\S]*)/i) || [])[1]?.trim();
    if (!title || !body || body.length < 80) return { skip: true, reason: 'unparseable synthesis' };
    return { title, body, claimMap: [] };
  }

  const SYNTH_SYSTEM =
    'You are a seasoned human sports journalist with a distinctive, confident voice. You write ' +
    'ORIGINAL articles by synthesizing facts from MULTIPLE source reports about the SAME event. ' +
    'Hard rules: (1) Use ONLY facts present in the provided sources — never invent scores, dates, ' +
    'names, or quotes. (2) Do NOT copy sentences verbatim; rewrite in your own structure and voice. ' +
    '(3) Never mention betting, gambling, odds, or any brand name — pure sports information only. ' +
    '(4) Follow the requested output format exactly.';

  // Humanizing guidance injected into both the article and card prompts.
  const HUMANIZE = (langName) =>
    `Write like a real human ${langName} sports journalist, NOT an AI:\n` +
    `- Vary sentence length: mix short punchy sentences with longer ones; avoid a uniform rhythm.\n` +
    `- Confident, direct, active voice. Lead with the most interesting angle, not a generic summary.\n` +
    `- Every sentence carries a concrete fact or sharp insight — no filler, no padding, no hedging-everything balance.\n` +
    (langName === 'Korean'
      ? `- 한국어: 다음 AI 상투구를 절대 쓰지 마라 — "미지수다", "관심이 쏠리고 있다", "귀추가 주목된다", "~로 풀이된다/분석된다", "~할 전망이다", "주목된다", 그리고 "한편"의 남발, "앞으로 ~가 주목된다"식 공허한 마무리. 실제 스포츠 기자처럼 자연스럽고 단정적으로 써라.`
      : `- English: never use "It remains to be seen", "one thing is clear", "in a move that", "only time will tell", or a formulaic wrap-up. Be specific and assertive.`);

  return {
    synthModel,
    extractModel,
    async synthesize({ event, lang }) {
      const langName = lang === 'ko' ? 'Korean (한국어)' : 'English';
      const sources = (event.sources ?? [])
        .map((s, i) => `[Source ${i + 1} — ${s.outlet}]\nTitle: ${s.title}\n${s.text ?? ''}`)
        .join('\n\n');
      const prompt =
        `Write one original ${langName} sports news article that synthesizes the facts across ` +
        `these ${event.sources?.length ?? 0} independent sources about a single ${event.sportKey} event.\n\n` +
        `${sources}\n\n` +
        `If these sources do NOT describe the same single event (e.g. unrelated stories that merely ` +
        `mention the same team), output exactly:\nSKIP: yes\nand nothing else.\n\n` +
        `Otherwise write a sharp, specific article:\n` +
        `- A headline that names the actual angle (not generic).\n` +
        `- A strong lead answering who/what/when.\n` +
        `- 4-6 short paragraphs weaving concrete facts from ALL sources — relevant background, ` +
        `numbers, names, context (records, prior managers, candidates, timeline). Specifics, not filler.\n` +
        `- Do NOT copy sentences verbatim; never invent facts.\n\n` +
        `${HUMANIZE(langName)}\n\n` +
        `Output EXACTLY this plain-text format (no JSON, no markdown fences):\n` +
        `SKIP: no\nTITLE: <one-line headline>\nBODY:\n<the article, paragraphs separated by blank lines>`;
      // A little warmth makes prose more human/varied; facts are constrained by the prompt + gate.
      return parseArticle(await callText({ model: synthModel, system: SYNTH_SYSTEM, prompt, temperature: 0.7, maxTokens: 4000 }));
    },
    // Edit an article into card-news form: a punchy headline + 3 short key-point bullets.
    // Cheap (haiku). Delimiter format avoids JSON-escaping issues.
    async cardSummary({ article, lang }) {
      const model = env.JUDGE_CLAUDE_MODEL || 'claude-haiku-4-5';
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = lang === 'ko' ? article.bodyKo : article.bodyEn;
      const langName = lang === 'ko' ? 'Korean' : 'English';
      const humanize = lang === 'ko'
        ? '한국어 헤드라인은 실제 스포츠 헤드라인처럼 자연스럽게. AI 상투구("속출","눈길","주목") 금지. 번역 티 내지 마라.'
        : 'Headline should read like a real sports headline — punchy and natural, no AI clichés.';
      const prompt =
        `Edit this sports article into a card-news summary in ${langName}.\n\n` +
        `TITLE: ${title}\n${body}\n\n` +
        `${humanize}\n\n` +
        `Output EXACTLY this format (no JSON):\n` +
        `HEADLINE: <punchy natural headline, <= 32 characters>\n` +
        `- <key point, <= 42 chars>\n- <key point, <= 42 chars>\n- <key point, <= 42 chars>\n` +
        `Use ONLY facts from the article. 3 bullets, each a single short line, no filler words.`;
      const text = await callText({ model, system: 'You are a sharp human card-news editor. Follow the format exactly.', prompt, temperature: 0.3, maxTokens: 400 });
      const headline = (text.match(/HEADLINE:\s*(.+)/i) || [])[1]?.trim() || title;
      const points = [...text.matchAll(/^\s*[-•]\s*(.+)$/gim)].map((m) => m[1].trim()).filter(Boolean).slice(0, 3);
      return { headline, points: points.length ? points : [title] };
    },
    // Comic/manga card text: punchy headline + a 3-sentence key-content summary (longer than the
    // bullet cardSummary). Used by the manga-page card renderer.
    async comicCard({ article, lang }) {
      const model = env.JUDGE_CLAUDE_MODEL || 'claude-haiku-4-5';
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = lang === 'ko' ? article.bodyKo : article.bodyEn;
      const langName = lang === 'ko' ? 'Korean' : 'English';
      const guide = lang === 'ko'
        ? '한국어로, 실제 스포츠 헤드라인처럼 자연스럽게. 번역 티 내지 말 것. AI 상투구 금지.'
        : 'Natural English sports style, no AI clichés.';
      const prompt =
        `Edit this article into card-news text in ${langName}.\n\nTITLE: ${title}\n${body}\n\n${guide}\n\n` +
        `Output EXACTLY (no JSON):\n` +
        `HEADLINE: <punchy headline, <= 22 chars>\n` +
        `SUMMARY: <3 sentences, ~120-150 chars total, the key facts — who/what/numbers/why-it-matters/next step>\n` +
        `Use ONLY facts from the article.`;
      const text = await callText({ model, system: 'You are a sharp human card-news editor. Follow the format exactly.', prompt, temperature: 0.3, maxTokens: 600 });
      const headline = (text.match(/HEADLINE:\s*(.+)/i) || [])[1]?.trim() || title;
      const summary = (text.match(/SUMMARY:\s*([\s\S]+)/i) || [])[1]?.trim().replace(/\s+/g, ' ') || (body || '').slice(0, 140);
      return { headline, summary };
    },
    async extractClaims({ article, lang }) {
      const title = lang === 'ko' ? article?.titleKo : article?.titleEn;
      const body = lang === 'ko' ? article?.bodyKo : article?.bodyEn;
      if (!body) return [];
      const system =
        'You extract atomic factual claims from a sports article for downstream grounding ' +
        'verification. Output strictly valid JSON array only.';
      const prompt =
        `Extract every checkable factual claim from this article. For each output ` +
        `{"type":"score|date|player|team|fee|outcome|quote","text":"<as written>",` +
        `"normalized_value":"<canonical form, e.g. score '2-1', fee '80 million'>",` +
        `"loadBearing":<true for score/date/outcome/fee/named-quote, else false>}.\n\n` +
        `Title: ${title}\n\n${body}\n\nReturn ONLY the JSON array.`;
      const out = await callJSON({ model: extractModel, system, prompt, temperature: 0, maxTokens: 1500 });
      return Array.isArray(out) ? out : (out.claims ?? []);
    },
    // VERIFICATION AGENT — a skeptical editor/fact-checker, separate from the writer. Reviews the
    // article ONLY against the provided sources and returns pass/reject + an optionally cleaned body.
    async verifyArticle({ article, corpus, lang }) {
      const model = synthModel; // reasoning-capable; could be swapped for a different vendor
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = lang === 'ko' ? article.bodyKo : article.bodyEn;
      if (!body) return { verdict: 'pass' };
      const system =
        'You are a STRICT sports news fact-checker and copy editor. You judge an article ONLY ' +
        'against the provided source material. You are skeptical and concise.';
      const prompt =
        `SOURCES:\n${corpus}\n\n` +
        `ARTICLE (${lang}):\nTITLE: ${title}\n${body}\n\n` +
        `Check, strictly against the SOURCES:\n` +
        `1) COHERENCE: Is the whole article about ONE event? Remove any paragraph that drifts into a ` +
        `different/unrelated story (e.g. preseason predictions mixed into a game recap).\n` +
        `2) GROUNDING: Remove any sentence stating a fact NOT supported by the sources.\n` +
        `3) TONE: Remove AI clichés — Korean: "한편" 남용, "미지수다", "귀추가 주목된다", "주목된다"; ` +
        `English: "it remains to be seen", "only time will tell". Keep the voice natural.\n` +
        `4) SAFETY: Remove any betting/gambling/odds or brand mentions.\n\n` +
        `If the article is fundamentally off-topic or largely unsupported, REJECT it.\n` +
        `Output EXACTLY (no JSON):\n` +
        `VERDICT: pass | reject\n` +
        `REVISED:\n<the corrected full article body — or the single word SAME if no change is needed>`;
      const text = await callText({ model, system, prompt, temperature: 0, maxTokens: 4000 });
      const verdict = /VERDICT:\s*reject/i.test(text) ? 'reject' : 'pass';
      const revRaw = (text.match(/REVISED:\s*\n?([\s\S]*)/i) || [])[1]?.trim();
      const revisedBody = (!revRaw || /^SAME\b/i.test(revRaw) || revRaw.length < 80) ? null : revRaw;
      return { verdict, revisedBody };
    },
    // Tag a batch of headlines with canonical entities + event type, so the clustering step can
    // merge the SAME event reported by different outlets (needed for multi-source synthesis).
    async tagItems(items) {
      if (!items.length) return [];
      const numbered = items.map((it, i) => `${i + 1}. [${it.sportKey || '?'}] ${it.title} — ${(it.text || '').slice(0, 160)}`).join('\n');
      const system = 'You tag sports headlines for clustering. Output strictly valid JSON only.';
      const prompt =
        `For each numbered headline, extract: (1) key entities (CANONICAL full team and person names, ` +
        `e.g. "Wolverhampton Wanderers","Rob Edwards" — same canonical names across headlines about ` +
        `the same event); (2) one event_type from [transfer, match_result, injury, signing, sacking, ` +
        `preview, other]; (3) the sport, one of [football, baseball, basketball, volleyball, other] ` +
        `(football = soccer).\n\n${numbered}\n\n` +
        `Return a JSON array aligned 1..${items.length}: [{"entities":["..."],"eventType":"...","sport":"..."}].`;
      const out = await callJSON({ model: extractModel, system, prompt, temperature: 0, maxTokens: 8000 });
      const arr = Array.isArray(out) ? out : (out.items ?? out.tags ?? []);
      return items.map((_, i) => ({ entities: arr[i]?.entities ?? [], eventType: arr[i]?.eventType ?? 'other', sportKey: arr[i]?.sport }));
    },
    // ① pre-match "what to watch" note, synthesized ONLY from the supplied intel.
    async prematchNote({ fixture, intel }) {
      const system =
        'You are a sports analyst writing a one-or-two sentence "what to watch" note for an ' +
        'upcoming match. Use ONLY the facts in the provided intel — never invent form, injuries, ' +
        'or stats. No betting/odds/brand language. Output strictly valid JSON only.';
      const prompt =
        `Upcoming ${fixture.sportKey}: ${fixture.home} vs ${fixture.away} (${fixture.competition || ''}).\n` +
        `Intel:\nHome form: ${intel.homeForm}\nAway form: ${intel.awayForm}\nInjury: ${intel.injury || 'none'}\n` +
        `Head-to-head: ${intel.h2h || 'n/a'}\nNotes: ${intel.sourceText || ''}\n\n` +
        `Return JSON: {"whatToWatch":"<1-2 sentence Korean note>","claims":[{"type":"player|team|outcome","text":"...","normalized_value":"...","loadBearing":true|false}]}. ` +
        `IMPORTANT: write each claim's normalized_value using the SAME terms as the intel above ` +
        `(English names and digits, e.g. "Reece James", not a Korean transliteration) so it can be ` +
        `verified against the intel. Mark loadBearing TRUE only for specific injuries or stated ` +
        `outcomes; general form/momentum notes are loadBearing false. Every claim must be in the intel.`;
      return callJSON({ model: synthModel, system, prompt, maxTokens: 700 });
    },
  };
}

// Fixture-driven LLM for dry-run/tests. Keyed by a stable `eventKey` carried on each source
// (cluster fingerprints are computed at runtime, so we key on author-controlled eventKey).
// `fixtures` shape:
// { synth: { "<eventKey>:<lang>": { title, body, claimMap } },
//   claims: { "<eventKey>:<lang>": [ {type,text,normalized_value,loadBearing} ] } }
function eventKeyOf(event) {
  return event?.sources?.[0]?.eventKey ?? event?.id;
}
export function fixtureLLM(fixtures) {
  return {
    synthModel: 'fixture',
    extractModel: 'fixture',
    async synthesize({ event, lang }) {
      const k = `${eventKeyOf(event)}:${lang}`;
      const v = fixtures.synth?.[k];
      if (!v) throw new Error(`fixtureLLM: no synth fixture for ${k}`);
      return v;
    },
    async extractClaims({ event, lang }) {
      const k = `${eventKeyOf(event)}:${lang}`;
      return fixtures.claims?.[k] ?? [];
    },
    async prematchNote({ fixture }) {
      const v = fixtures.prematch?.[fixture.id];
      if (!v) throw new Error(`fixtureLLM: no prematch fixture for ${fixture.id}`);
      return v;
    },
    async tagItems(items) {
      return items.map((it) => ({ entities: it.entities ?? [], eventType: it.eventType ?? 'other', sportKey: it.sportKey }));
    },
    async cardSummary({ article, lang }) {
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = (lang === 'ko' ? article.bodyKo : article.bodyEn) || '';
      const first = body.split(/[.!?。\n]/).map((s) => s.trim()).filter((s) => s.length > 8).slice(0, 3);
      return { headline: title, points: first.length ? first.map((s) => s.slice(0, 42)) : [title] };
    },
    // Deterministic manga-card text: title as headline + first 2 sentences of the body as summary.
    async comicCard({ article, lang }) {
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = (lang === 'ko' ? article.bodyKo : article.bodyEn) || '';
      const sents = body.split(/(?<=[.!?。])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 2);
      return { headline: title, summary: sents.join(' ') || title };
    },
    async verifyArticle() { return { verdict: 'pass' }; },
  };
}
