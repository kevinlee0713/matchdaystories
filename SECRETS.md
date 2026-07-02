# Secrets & Live Wiring Checklist (kevin must provide)

The locally-testable MVP runs fully **without** any of these via `npm run pipeline:dry-run`
(fixtures + mocks). The items below are required only to go **live** (`pipeline:run` + cron).

| # | Secret / Resource | Used by | How to obtain |
|---|---|---|---|
| 1 | `ANTHROPIC_API_KEY` | synthesis + fact-claim extraction | console.anthropic.com |
| 2 | `OPENAI_API_KEY` | advisory judge (gpt-4o-mini) | platform.openai.com |
| 3 | `GEMINI_API_KEY` | advisory judge (gemini-2.5-flash) | aistudio.google.com |
| 4 | `SERPER_API_KEY` and/or `NEWSAPI_KEY` | news discovery | serper.dev / newsapi.org |
| 5 | `WP_SSH_HOST` / `WP_SSH_USER` / `WP_SSH_KEY_PATH` / `WP_PATH` | WordPress publish (wp-cli over SSH) | your cPanel host; WP must have **Polylang** + **Rank Math** installed, KO+EN locales, sport categories |
| 6 | `TELEGRAM_BOT_TOKEN` / `TELEGRAM_GROUP_ID` | card-news distribution | @BotFather; add bot to the group, get chat id |
| 7 | New GitHub repo + Actions secrets | daily cron | create `kevinlee0713/sports-news-blog` (public for free Actions), add all secrets above as repo secrets |

## Live-wiring steps (after secrets)
1. `npm install` (adds live adapters — see `lib/adapters/README` once implemented).
2. Replace the mock adapters in `pipeline/run.mjs` deps with the live adapters.
3. WordPress: install Polylang (KO+EN) + Rank Math; create sport categories; run the legal-pages setup (disclaimer + source policy).
4. Telegram: create bot, add to group, capture group id.
5. Push repo, add Actions secrets, enable `.github/workflows/daily-aggregate.yml` cron.
6. Confirm `pipeline:dry-run` is green in CI before the first live cron run.

## Deferred (NOT in this MVP — see consensus plan)
KakaoTalk distribution, email newsletter, full-sport coverage, banner ads, opus-4-8 synthesis escalation, full Playwright scraping farm.
