// Gemini-backed LLM adapter — same interface as liveLLM (lib/llm/client.mjs) but powered by the
// Gemini API, so the whole real pipeline (discover → tag → cluster → synthesize → card) can run
// with ONLY GEMINI_API_KEY. Implements: tagItems, synthesize, comicCard.
// Prompts/rules mirror liveLLM (multi-source synthesis, brand-neutral, no invented facts).
import { parseJsonLoose } from './client.mjs';

const ENDPOINT = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export function geminiLLM(env = process.env) {
  const key = env.GEMINI_API_KEY;
  const model = env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

  async function callText({ system, prompt, temperature = 0.7, maxTokens = 4000 }) {
    if (!key) throw new Error('geminiLLM: set GEMINI_API_KEY');
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const res = await fetch(ENDPOINT(model, key), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text || '').join('');
  }
  const callJSON = async (args) => parseJsonLoose(await callText(args));

  const SYNTH_SYSTEM =
    'You are a seasoned human sports journalist with a distinctive, confident voice. You write ' +
    'ORIGINAL articles by synthesizing facts from MULTIPLE source reports about the SAME event. ' +
    'Hard rules: (1) Use ONLY facts present in the provided sources — never invent scores, dates, ' +
    'names, or quotes. (2) Do NOT copy sentences verbatim; rewrite in your own structure and voice. ' +
    '(3) Never mention betting, gambling, odds, or any brand name — pure sports information only. ' +
    '(4) Follow the requested output format exactly.';

  function parseArticle(text) {
    if (/^\s*SKIP:\s*yes/im.test(text) && !/TITLE:/i.test(text)) return { skip: true, reason: 'not the same event' };
    const title = (text.match(/TITLE:\s*(.+)/i) || [])[1]?.trim();
    const body = (text.match(/BODY:\s*\n?([\s\S]*)/i) || [])[1]?.trim();
    if (!title || !body || body.length < 80) return { skip: true, reason: 'unparseable synthesis' };
    return { title, body, claimMap: [] };
  }

  return {
    synthModel: model,
    extractModel: model,

    // Tag headlines with canonical entities + event type for clustering (same-event merge).
    async tagItems(items) {
      if (!items.length) return [];
      const numbered = items.map((it, i) => `${i + 1}. [${it.sportKey || '?'}] ${it.title} — ${(it.text || '').slice(0, 160)}`).join('\n');
      const prompt =
        `For each numbered headline, extract: (1) the key entities (CANONICAL full team and person ` +
        `names, e.g. "Wolverhampton Wanderers","Rob Edwards" — use the SAME canonical names across ` +
        `headlines about the same event so they can be matched); (2) one event_type from ` +
        `[transfer, match_result, injury, signing, sacking, preview, other]; (3) the sport, one of ` +
        `[football, baseball, basketball, volleyball, other] (football = soccer; "other" for any ` +
        `non-sport or a different sport).\n\n${numbered}\n\n` +
        `Return a JSON array aligned 1..${items.length}: [{"entities":["..."],"eventType":"...","sport":"..."}].`;
      const out = await callJSON({ system: 'You tag sports headlines for clustering. Output strictly valid JSON only.', prompt, temperature: 0, maxTokens: 12000 });
      const arr = Array.isArray(out) ? out : (out.items ?? out.tags ?? []);
      return items.map((_, i) => ({ entities: arr[i]?.entities ?? [], eventType: arr[i]?.eventType ?? 'other', sportKey: arr[i]?.sport }));
    },

    // Multi-source synthesis → original article (KO or EN).
    async synthesize({ event, lang }) {
      const langName = lang === 'ko' ? 'Korean (한국어)' : 'English';
      const sources = (event.sources ?? [])
        .map((s, i) => `[Source ${i + 1} — ${s.outlet}]\nTitle: ${s.title}\n${s.text ?? ''}`).join('\n\n');
      const humanize = lang === 'ko'
        ? '한국어: AI 상투구 금지 — "미지수다","귀추가 주목된다","~로 풀이된다","주목된다","한편" 남발. 실제 스포츠 기자처럼 단정적으로.'
        : 'English: avoid "It remains to be seen","only time will tell". Be specific and assertive.';
      const prompt =
        `Write one original ${langName} sports news article that synthesizes the facts across ` +
        `these ${event.sources?.length ?? 0} independent sources about a single ${event.sportKey} event.\n\n` +
        `${sources}\n\n` +
        `If these sources do NOT describe the same single event, output exactly:\nSKIP: yes\nand nothing else.\n\n` +
        `Otherwise write a sharp, specific article: a headline naming the actual angle; a strong lead ` +
        `(who/what/when); 3-5 short paragraphs weaving concrete facts (numbers, names, context) from ALL ` +
        `sources. Do NOT copy sentences verbatim; never invent facts.\n${humanize}\n\n` +
        `Output EXACTLY this plain-text format (no JSON, no markdown fences):\n` +
        `SKIP: no\nTITLE: <one-line headline>\nBODY:\n<the article, paragraphs separated by blank lines>`;
      return parseArticle(await callText({ system: SYNTH_SYSTEM, prompt, temperature: 0.7, maxTokens: 4000 }));
    },

    // Comic-card text: a punchy headline + a 2-3 sentence summary (key content, longer than a
    // one-liner). Used directly by renderComicCard.
    async comicCard({ article, lang = 'ko' }) {
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
      const text = await callText({ system: 'You are a sharp human card-news editor. Follow the format exactly.', prompt, temperature: 0.3, maxTokens: 600 });
      const headline = (text.match(/HEADLINE:\s*(.+)/i) || [])[1]?.trim() || title;
      const summary = (text.match(/SUMMARY:\s*([\s\S]+)/i) || [])[1]?.trim().replace(/\s+/g, ' ') || (body || '').slice(0, 120);
      return { headline, summary };
    },

    // Bullet card summary (kept for compatibility with the legacy text-card path).
    async cardSummary({ article, lang }) {
      const { headline, summary } = await this.comicCard({ article, lang });
      const points = summary.split(/(?<=[.!?。])\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
      return { headline, points: points.length ? points.map((s) => s.slice(0, 42)) : [headline] };
    },

    // Atomic factual-claim extractor for the fact-gate (temp 0, JSON).
    async extractClaims({ article, lang }) {
      const title = lang === 'ko' ? article?.titleKo : article?.titleEn;
      const body = lang === 'ko' ? article?.bodyKo : article?.bodyEn;
      if (!body) return [];
      const prompt =
        `Extract every checkable factual claim from this article. For each output ` +
        `{"type":"score|date|player|team|fee|outcome|quote","text":"<as written>",` +
        `"normalized_value":"<canonical form, e.g. score '2-1', fee '80 million'>",` +
        `"loadBearing":<true for score/date/outcome/fee/named-quote, else false>}.\n\n` +
        `Title: ${title}\n\n${body}\n\nReturn ONLY the JSON array.`;
      const out = await callJSON({ system: 'You extract atomic factual claims. Output strictly valid JSON array only.', prompt, temperature: 0, maxTokens: 4000 });
      return Array.isArray(out) ? out : (out.claims ?? []);
    },

    // Skeptical fact-checker/editor — pass | reject + optionally a cleaned body.
    async verifyArticle({ article, corpus, lang }) {
      const title = lang === 'ko' ? article.titleKo : article.titleEn;
      const body = lang === 'ko' ? article.bodyKo : article.bodyEn;
      if (!body) return { verdict: 'pass' };
      const prompt =
        `SOURCES:\n${corpus}\n\nARTICLE (${lang}):\nTITLE: ${title}\n${body}\n\n` +
        `Check strictly against the SOURCES: (1) COHERENCE — one event only, drop drifting paragraphs; ` +
        `(2) GROUNDING — remove any fact not supported by the sources; (3) TONE — remove AI clichés; ` +
        `(4) SAFETY — remove betting/odds/brand mentions. If fundamentally off-topic or unsupported, REJECT.\n` +
        `Output EXACTLY (no JSON):\nVERDICT: pass | reject\nREVISED:\n<corrected full body, or SAME if unchanged>`;
      const text = await callText({ system: 'You are a STRICT sports fact-checker and copy editor. Judge ONLY against the sources.', prompt, temperature: 0, maxTokens: 4000 });
      const verdict = /VERDICT:\s*reject/i.test(text) ? 'reject' : 'pass';
      const revRaw = (text.match(/REVISED:\s*\n?([\s\S]*)/i) || [])[1]?.trim();
      const revisedBody = (!revRaw || /^SAME\b/i.test(revRaw) || revRaw.length < 80) ? null : revRaw;
      return { verdict, revisedBody };
    },

    // Semantic same-event dedup: is `title` about the SAME real-world sports event as any candidate?
    async isDuplicateEvent({ title, candidates = [] }) {
      if (!candidates.length) return { duplicate: false };
      const list = candidates.slice(0, 60).map((t, i) => `${i + 1}. ${t}`).join('\n');
      const prompt =
        `New article headline:\n"${title}"\n\nAlready-published headlines:\n${list}\n\n` +
        `Does the NEW headline describe the SAME real-world sports event (same match/result, same ` +
        `transfer, same game) as any already-published one? Different games/teams/dates = NOT the same. ` +
        `Return ONLY JSON: {"duplicate": true|false, "index": <matching number or 0>}`;
      try {
        const out = await callJSON({ system: 'You detect duplicate sports news events. Output strictly valid JSON only.', prompt, temperature: 0, maxTokens: 200 });
        return { duplicate: !!out.duplicate, index: out.index ?? 0 };
      } catch { return { duplicate: false }; }
    },

    // ① pre-match "what to watch" note, grounded ONLY in the supplied intel.
    async prematchNote({ fixture, intel }) {
      const prompt =
        `Upcoming ${fixture.sportKey}: ${fixture.home} vs ${fixture.away} (${fixture.competition || ''}).\n` +
        `Intel:\nHome form: ${intel.homeForm}\nAway form: ${intel.awayForm}\nInjury: ${intel.injury || 'none'}\n` +
        `Head-to-head: ${intel.h2h || 'n/a'}\nNotes: ${intel.sourceText || ''}\n\n` +
        `Return JSON: {"whatToWatch":"<1-2 sentence Korean note>","claims":[{"type":"player|team|outcome","text":"...","normalized_value":"...","loadBearing":true|false}]}. ` +
        `Write each claim's normalized_value using the SAME terms as the intel (English names/digits) so it can be verified. ` +
        `loadBearing TRUE only for specific injuries or stated outcomes. Every claim must be in the intel.`;
      return callJSON({ system: 'You write a grounded pre-match note. Use ONLY the intel. Output strictly valid JSON only.', prompt, maxTokens: 700 });
    },
  };
}
