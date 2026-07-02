// Pre-match intelligence pipeline (①). For each upcoming fixture:
//   schedule -> intel (form/injuries/H2H) -> synthesize "what to watch" -> fact-gate (grounded
//   against intel) -> render pre-match card -> Telegram (group + personalized followers).
// Same fail-closed discipline as the news pipeline: an ungrounded note BLOCKS the card.
import { factGate } from './fact_gate.mjs';
import { renderPrematchCard } from '../lib/img/prematch_card.mjs';
import { glyphSmoke } from '../lib/img/glyph_smoke.mjs';

export async function runPrematch({ deps, config }) {
  const { schedule, intel, llm, telegram, subscriptions } = deps;
  const sportLabel = (key) => (config.sports?.find((s) => s.key === key)?.ko) ?? key;
  const report = { fixtures: 0, built: [], blockedByFact: [], advisoryFlags: [], cardIssues: [], alerts: [], followerPushes: 0 };
  const alert = async (m) => { report.alerts.push(m); try { await telegram.alert(m); } catch { /* best-effort */ } };

  const fixtures = await schedule.upcoming({ sports: config.sports });
  report.fixtures = fixtures.length;

  for (const fx of fixtures) {
    let info;
    try { info = await intel.get(fx); }
    catch (e) { report.cardIssues.push({ fixture: fx.id, stage: 'intel', reason: e.message }); await alert(`prematch ${fx.id} intel failed: ${e.message}`); continue; }

    let note;
    try { note = await llm.prematchNote({ fixture: fx, intel: info }); }
    catch (e) { report.cardIssues.push({ fixture: fx.id, stage: 'note', reason: String(e.message).slice(0, 100) }); await alert(`prematch ${fx.id} note failed: ${e.message}`); continue; }

    // The card's HARD facts (form W/D/L, injury text) come from `intel` (the trusted data
    // source) and are rendered verbatim — so there is nothing to fabricate there. The LLM note
    // is advisory color commentary: numeric claims still hard-block (a wrong stat), but prose
    // claims are only logged as advisory. A blocked NUMERIC claim drops the card; prose never does.
    const fg = factGate({ claims: note.claims ?? [], corpus: info.sourceText ?? '' });
    if (fg.blocked) {
      report.blockedByFact.push({ fixture: fx.id, ungrounded: fg.ungroundedLoadBearing.map((c) => c.text) });
      await alert(`prematch ${fx.id} blocked — ungrounded numeric: ${fg.ungroundedLoadBearing.map((c) => c.text).join('; ')}`);
      continue;
    }
    if (fg.strippedSoft.length) {
      report.advisoryFlags.push({ fixture: fx.id, advisory: fg.strippedSoft.map((c) => `${c.type}:${c.text}`) });
    }

    let card;
    try {
      card = await renderPrematchCard({
        sportKey: fx.sportKey, sportLabel: sportLabel(fx.sportKey),
        competition: fx.competition, kickoff: fx.kickoff,
        home: fx.home, away: fx.away,
        homeForm: info.homeForm, awayForm: info.awayForm, injury: info.injury,
        whatToWatch: note.whatToWatch,
      });
    } catch (e) { report.cardIssues.push({ fixture: fx.id, stage: 'render', reason: e.message }); await alert(`prematch ${fx.id} render failed: ${e.message}`); continue; }

    if (card.format !== 'png' || card.width !== 1080 || card.height !== 1080) {
      report.cardIssues.push({ fixture: fx.id, stage: 'render', reason: 'invalid PNG dims' }); continue;
    }
    const smoke = await glyphSmoke(`${fx.home} ${fx.away} ${note.whatToWatch}`);
    if (!smoke.ok) { report.cardIssues.push({ fixture: fx.id, stage: 'glyph', reason: smoke.reason }); await alert(`prematch ${fx.id} glyph-smoke failed`); continue; }

    const caption = `🔭 경기 전 인텔: ${fx.home} vs ${fx.away}`;
    await telegram.sendPhoto({ buffer: card.buffer, caption });

    // Personalization (②): followers of either team get a DM.
    if (subscriptions?.match) {
      const pseudoEvent = { sportKey: fx.sportKey, entities: [fx.home, fx.away] };
      const matched = subscriptions.match(pseudoEvent) ?? [];
      for (const sub of matched) {
        try { await telegram.sendPhoto({ buffer: card.buffer, caption, chatId: sub.chatId }); report.followerPushes++; }
        catch (e) { await alert(`prematch follower push failed (${sub.chatId}): ${e.message}`); }
      }
    }

    report.built.push({ fixture: fx.id, home: fx.home, away: fx.away });
  }
  return report;
}
