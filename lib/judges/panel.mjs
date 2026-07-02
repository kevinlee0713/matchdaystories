// Advisory judge panel (tone/readability quality only). CRITICAL: judges are ADVISORY —
// they CANNOT block publication. Fact correctness is enforced by fact_gate (grounding),
// NOT by opinion-polling. evaluate() NEVER throws when at least one provider key is present —
// it returns whatever scored (advisory). It returns { panelRan:false } (still non-blocking)
// only when NO judge key is configured at all.
import { parseJsonLoose } from '../llm/client.mjs';

async function scoreWithClaude(env, article) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.JUDGE_CLAUDE_MODEL || 'claude-haiku-4-5';
  const res = await client.messages.create({
    model,
    max_tokens: 300,
    temperature: 0,
    system: 'You rate a Korean sports article on tone and readability only (NOT factual accuracy). Output JSON only.',
    messages: [{
      role: 'user',
      content: `Rate this article 0-10 on readability and natural tone. Return {"score":<0-10>,"note":"<one line>"}.\n\n` +
        `Title: ${article.titleKo}\n\n${article.bodyKo}`,
    }],
  });
  const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const out = parseJsonLoose(text);
  return { model, score: Number(out.score), note: out.note };
}

export function liveJudges(env = process.env) {
  return {
    async evaluate(article) {
      const scores = [];
      // Claude haiku judge (advisory). Best-effort: a provider error never blocks publication.
      if (env.ANTHROPIC_API_KEY) {
        try { scores.push(await scoreWithClaude(env, article)); }
        catch (e) { scores.push({ model: 'claude', error: e.message }); }
      }
      // openai / gemini judges are optional add-ons — wire when those keys exist (lazy import).
      // Left as a follow-up; Anthropic alone gives a working advisory panel.
      const panelRan = scores.some((s) => typeof s.score === 'number');
      return { panelRan, scores, advisory: true };
    },
  };
}

export function mockJudges() {
  return {
    async evaluate() {
      return { panelRan: true, scores: [{ model: 'mock', score: 8 }], advisory: true };
    },
  };
}
